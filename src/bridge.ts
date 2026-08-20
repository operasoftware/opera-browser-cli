/**
 * Persistent MCP bridge server for opera-browser-cli.
 *
 * Spawns opera-devtools-mcp as a child process and maintains a single
 * persistent MCP session. Exposes a simple HTTP API:
 *   POST /call           { name, args }  → { result }
 *   GET  /tools                          → [{ name, description }]
 *   GET  /health                         → { status: "ok" }
 *   GET  /last-snapshot                  → { raw, pageUrl, capturedAt } | 404
 *
 * Writes a PID file to ~/.opera-browser-cli/bridge.pid on startup.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  createServer,
  request,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { extractPageOrigin } from "./snapshot.js";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  BRIDGE_SERVER_NAME,
  computeBootMinute,
  type BridgeHealth,
} from "./identity.js";
import { getPackageVersion } from "./version.js";

const DEFAULT_PORT = Number.parseInt(
  process.env.OPERA_CLI_PORT ?? "9225",
  10,
);
const STATE_DIR = join(homedir(), ".opera-browser-cli");
const PID_FILE = join(STATE_DIR, "bridge.pid");

const OPERA_AI_TIMEOUT = 300_000; // 5 minutes
const OPERA_AI_TOOLS = new Set([
  "opera_chat",
  "opera_do",
  "opera_research",
  "opera_make",
  "opera_call_mcp_tool",
]);

export interface LastSnapshotCache {
  raw: string;
  pageUrl: string | null;
  capturedAt: number;
}

// The most recent raw snapshot text returned by take_snapshot.
// Shared across all concurrent HTTP requests; last write wins.
// Survives navigation — callers use pageUrl to detect drift if needed.
let lastSnapshot: LastSnapshotCache | null = null;

export function getLastSnapshotCache(): LastSnapshotCache | null {
  return lastSnapshot;
}

/** Reset the snapshot cache — for use in tests only. */
export function resetLastSnapshotCache(): void {
  lastSnapshot = null;
}

export interface BridgeContentBlock {
  type: string;
  text?: string;
}

export interface BridgeCallPayload {
  name: string;
  args: Record<string, unknown>;
}

interface BridgeToolDescription {
  name: string;
  description?: string;
}

export interface BridgeClient {
  listTools(): Promise<{ tools: BridgeToolDescription[] }>;
  callTool(
    request: {
      name: string;
      arguments: Record<string, unknown>;
    },
    resultSchema?: unknown,
    options?: RequestOptions,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export async function isBridgeClientConnected(
  client: BridgeClient,
): Promise<boolean> {
  try {
    await client.listTools();
    return true;
  } catch {
    return false;
  }
}

/**
 * "Usable" health for the bridge: the MCP server is up AND, when the bridge is
 * in attach mode, the browser at the attach URL is actually reachable.
 *
 * In attach mode devtools-mcp stays connected over stdio even when the browser
 * it points at is gone (it reaches for the browser lazily on a tool call), so
 * MCP liveness alone cannot tell that a bridge is wedged on a dead URL. Probing
 * the attach endpoint directly keeps `/health` honest, which lets the CLI stop
 * reusing a wedged bridge and rebuild it against the current target.
 */
export async function isBridgeHealthConnected(
  client: BridgeClient,
): Promise<boolean> {
  if (!(await isBridgeClientConnected(client))) return false;
  const browserUrl = process.env.OPERA_CLI_BROWSER_URL;
  if (browserUrl) {
    return await probeHttp(`${browserUrl}/json/version`, 800);
  }
  return true;
}

/** GET a URL, answering whether it looks like a live CDP endpoint. */
function probeHttp(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let req;
    try {
      req = request(url, { method: "GET", timeout: timeoutMs }, (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            resolve(
              typeof (JSON.parse(body) as { Browser?: unknown }).Browser ===
                "string",
            );
          } catch {
            resolve(false);
          }
        });
      });
    } catch {
      // Malformed browser URL — treat as unreachable, never crash the health ping.
      resolve(false);
      return;
    }
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/** Wall-clock start of this bridge process — part of its identity. */
const STARTED_AT = Date.now();
const BOOT_MINUTE = computeBootMinute();

function writePidFile(port: number, token: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  // Unlink first: writeFileSync's `mode` only applies on create, so overwriting
  // a stale file would keep its looser perms and expose the token.
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Didn't exist — fine
  }
  // 0600: only the owning user may read the auth token.
  // version/startedAt/bootMinute let a CLI process verify this file describes
  // *our* bridge on *this* boot before it ever signals the PID.
  writeFileSync(
    PID_FILE,
    JSON.stringify({
      pid: process.pid,
      port,
      token,
      version: getPackageVersion(),
      startedAt: STARTED_AT,
      bootMinute: BOOT_MINUTE,
    }),
    { mode: 0o600 },
  );
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Already gone — fine
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extractToolText(content: BridgeContentBlock[]): string {
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function getToolContent(result: unknown): BridgeContentBlock[] {
  if (
    !result ||
    typeof result !== "object" ||
    !("content" in result) ||
    !Array.isArray(result.content)
  ) {
    return [];
  }
  return result.content as BridgeContentBlock[];
}

export function parseBridgeCallPayload(body: string): BridgeCallPayload {
  let payload: { name?: unknown; args?: unknown };
  try {
    payload = JSON.parse(body) as { name?: unknown; args?: unknown };
  } catch {
    throw new Error("Invalid bridge request payload");
  }
  if (typeof payload.name !== "string" || payload.name.length === 0) {
    throw new Error("Invalid bridge request payload");
  }
  if (payload.args === undefined) {
    return { name: payload.name, args: {} };
  }
  if (
    payload.args === null ||
    typeof payload.args !== "object" ||
    Array.isArray(payload.args)
  ) {
    throw new Error("Invalid bridge request payload");
  }
  return { name: payload.name, args: payload.args as Record<string, unknown> };
}

export function resolveBridgeScript(importMetaDir: string): string {
  const builtScript = resolve(
    importMetaDir,
    "../bin/opera-browser-cli-bridge.js",
  );
  const sourceScript = builtScript.replace(/\.js$/, ".ts");
  return existsSync(sourceScript) ? sourceScript : builtScript;
}

export type BridgeLauncher =
  | { ok: true; command: string; args: string[] }
  | { ok: false; reason: string };

/** Locate the tsx CLI entrypoint without going through `npx`. */
function resolveTsxCli(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("tsx/package.json");
    const cli = join(dirname(pkgPath), "dist", "cli.mjs");
    return existsSync(cli) ? cli : null;
  } catch {
    return null;
  }
}

/**
 * Decide how to launch the bridge process.
 *
 * Prefers the built JavaScript. The TypeScript entrypoint is used only in a
 * source checkout (or under OPERA_CLI_DEV=1), and only when tsx is already
 * installed — never via `npx`, which blocks on an install prompt when the
 * package is uncached and would hang invisibly behind a redirected stdio.
 */
export function resolveBridgeLauncher(
  importMetaDir: string,
  execPath: string = process.execPath,
): BridgeLauncher {
  const builtScript = resolve(
    importMetaDir,
    "../bin/opera-browser-cli-bridge.js",
  );
  const sourceScript = builtScript.replace(/\.js$/, ".ts");
  const preferSource =
    process.env.OPERA_CLI_DEV === "1" || !existsSync(builtScript);

  if (preferSource && existsSync(sourceScript)) {
    const tsx = resolveTsxCli();
    if (tsx === null) return { ok: false, reason: "tsx-not-installed" };
    return { ok: true, command: execPath, args: [tsx, sourceScript] };
  }
  if (!existsSync(builtScript)) return { ok: false, reason: "bridge-not-built" };
  return { ok: true, command: execPath, args: [builtScript] };
}
async function readRequestBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
  }
  return body;
}

function writeJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.statusCode = statusCode;
  res.end(JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Access control — the bridge can run arbitrary in-browser script, so a loopback
// bind is not enough. Each request is verified on:
//   - Host: loopback only — rejects requests arriving under another hostname (DNS rebinding).
//   - Origin: absent or loopback only — rejects browser cross-site calls (which always carry one).
//   - Bearer token: required on every route except /health — gates local non-browser callers.
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** True when a Host/Origin host component (with optional port) is loopback. */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let hostname: string;
  if (hostHeader.startsWith("[")) {
    // IPv6 literal, e.g. "[::1]:9225" → keep the bracketed form.
    const end = hostHeader.indexOf("]");
    hostname = end === -1 ? hostHeader : hostHeader.slice(0, end + 1);
  } else {
    hostname = hostHeader.split(":")[0];
  }
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** Browsers always attach Origin; the CLI never does. Absent = trusted; present = must be loopback. */
export function isAllowedOrigin(originHeader: string | undefined): boolean {
  if (originHeader === undefined) return true;
  try {
    return isLoopbackHost(new URL(originHeader).host);
  } catch {
    return false;
  }
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Extract the token from an `Authorization: Bearer <token>` header. */
export function extractBearerToken(
  authHeader: string | undefined,
): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1] : null;
}

export interface BridgeAccessResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Gate on a loopback Host and an absent-or-loopback Origin; protected routes
 * also require the bearer token (null token skips the check, for tests).
 */
export function checkRequestAccess(
  req: IncomingMessage,
  token: string | null,
  requireToken: boolean,
): BridgeAccessResult {
  if (!isLoopbackHost(req.headers.host)) {
    return { ok: false, status: 403, error: "forbidden: invalid Host header" };
  }
  if (!isAllowedOrigin(req.headers.origin)) {
    return {
      ok: false,
      status: 403,
      error: "forbidden: cross-origin request rejected",
    };
  }
  if (requireToken && token) {
    const provided = extractBearerToken(req.headers.authorization);
    if (!provided || !timingSafeStrEqual(provided, token)) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
  }
  return { ok: true };
}

export function generateBridgeToken(): string {
  return randomBytes(32).toString("hex");
}

export function buildHealth(connected: boolean): BridgeHealth {
  return {
    status: connected ? "ok" : "not-connected",
    server: BRIDGE_SERVER_NAME,
    version: getPackageVersion(),
    pid: process.pid,
    startedAt: STARTED_AT,
    bootMinute: BOOT_MINUTE,
    browser: { connected },
  };
}

async function handleToolsRequest(
  client: BridgeClient,
  res: ServerResponse,
): Promise<void> {
  const result = await client.listTools();
  writeJson(
    res,
    200,
    result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  );
}

async function handleCallRequest(
  client: BridgeClient,
  req: IncomingMessage,
  res: ServerResponse,
  captureNextId?: () => Promise<string>,
): Promise<void> {
  const body = await readRequestBody(req);
  const payload = parseBridgeCallPayload(body);
  const isStreamable = OPERA_AI_TOOLS.has(payload.name);

  let mcpRequestId: string | undefined;
  if (isStreamable && captureNextId) {
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), OPERA_AI_TIMEOUT);

    // Register the capture BEFORE calling callTool so the synchronous
    // transport.send fires into our queue before we await the result.
    const idCapture = captureNextId();
    const callPromise = client.callTool(
      { name: payload.name, arguments: payload.args },
      undefined,
      { signal: controller.signal, timeout: OPERA_AI_TIMEOUT * 2 },
    );
    // Suppress unhandled-rejection if idCapture rejects (e.g. transport closes
    // before transport.send fires in a future SDK version). The rejection will
    // propagate through the `await idCapture` below and close the response.
    callPromise.catch(() => {});
    try {
      mcpRequestId = await idCapture; // resolves as soon as transport.send fires
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    requestLoggers.set(mcpRequestId, (chunk) => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), OPERA_AI_TIMEOUT);
      res.write(JSON.stringify({ log: chunk }) + "\n");
    });
    try {
      const result = await callPromise;
      const text = extractToolText(getToolContent(result));
      res.statusCode = 200;
      res.end(JSON.stringify({ result: text }));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: getErrorMessage(error) }));
    } finally {
      clearTimeout(timer);
      requestLoggers.delete(mcpRequestId);
    }
    return;
  }

  // Non-streaming path.
  try {
    const result = await client.callTool(
      { name: payload.name, arguments: payload.args },
      undefined,
    );
    const text = extractToolText(getToolContent(result));
    // MCP tool failures come back as isError results, not exceptions — surface
    // them as errors so callers (chain acks, --expect, exit codes) see failures.
    if ((result as { isError?: boolean }).isError) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: text || "Tool call failed" }));
      return;
    }
    if (payload.name === "take_snapshot") {
      lastSnapshot = {
        raw: text,
        pageUrl: extractPageOrigin(text),
        capturedAt: Date.now(),
      };
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ result: text }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: getErrorMessage(error) }));
  }
}

export async function handleBridgeRequest(
  client: BridgeClient,
  req: IncomingMessage,
  res: ServerResponse,
  captureNextId?: () => Promise<string>,
  token: string | null = null,
): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  // Host/Origin guard runs on every route, including /health.
  const baseAccess = checkRequestAccess(req, token, false);
  if (!baseAccess.ok) {
    writeJson(res, baseAccess.status ?? 403, { error: baseAccess.error });
    return;
  }

  // /health is token-free so the CLI can detect a running bridge before it knows
  // the token. It carries the full identity (version, pid, boot) so the caller
  // can tell a usable bridge from a stale-version one from a foreign server.
  if (req.method === "GET" && req.url === "/health") {
    const connected = await isBridgeHealthConnected(client);
    writeJson(res, connected ? 200 : 503, buildHealth(connected));
    return;
  }

  // Every remaining route exposes browser state or automation — require the token.
  const tokenAccess = checkRequestAccess(req, token, true);
  if (!tokenAccess.ok) {
    writeJson(res, tokenAccess.status ?? 401, { error: tokenAccess.error });
    return;
  }

  if (req.method === "GET" && req.url === "/last-snapshot") {
    if (lastSnapshot === null) {
      writeJson(res, 404, { error: "no snapshot cached" });
    } else {
      writeJson(res, 200, lastSnapshot);
    }
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/tools") {
      await handleToolsRequest(client, res);
      return;
    }

    if (req.method === "POST" && req.url === "/call") {
      await handleCallRequest(client, req, res, captureNextId);
      return;
    }
  } catch (error) {
    writeJson(res, 500, { error: getErrorMessage(error) });
    return;
  }

  writeJson(res, 404, { error: "not found" });
}

/**
 * Build the HTTP server.
 *
 * `resolve` is called per request rather than the client being captured up
 * front, so the port can be bound before the MCP connection exists. Until it
 * returns a client every route answers 503 with a well-formed health body —
 * which is exactly what a caller probing /health during startup should see.
 */
export function createBridgeServer(
  resolve: () => {
    client: BridgeClient | null;
    captureNextId?: () => Promise<string>;
  },
  token: string | null = null,
): Server {
  return createServer((req, res) => {
    const { client, captureNextId } = resolve();
    if (client === null) {
      res.setHeader("Content-Type", "application/json");
      writeJson(res, 503, buildHealth(false));
      return;
    }
    void handleBridgeRequest(client, req, res, captureNextId, token);
  });
}

function logBridgeMessage(message: string): void {
  process.stderr.write(`[opera-browser-cli] ${message}\n`);
}

// ---------------------------------------------------------------------------
// Startup handshake
//
// The parent spawns us with stdout on a pipe and reads exactly one line:
//   READY            — listening, MCP connected, PID file written
//   FAILED <reason>  — fatal, with a machine-readable reason
//
// Without this the parent can only poll /health blind, which costs a full
// timeout window even when we died in milliseconds. stderr goes to the log
// file, so stdout carries nothing but this handshake.
// ---------------------------------------------------------------------------

/** Exit code signalling "port taken, try the next one" (EX_TEMPFAIL). */
export const EXIT_PORT_IN_USE = 75;

function writeReadySignal(): void {
  process.stdout.write("READY\n");
}

function writeFailedSignal(reason: string, detail?: string): void {
  process.stdout.write(`FAILED ${reason}${detail ? ` ${detail}` : ""}\n`);
}

/**
 * Whether to launch a visible browser.
 *
 * Headless is the safe default for a tool — it is the only thing that works on
 * a server with no display. But a configured Opera binary means the user wants
 * *their* browser, and every Opera AI feature needs a window: sign-in and
 * consent cannot be completed headlessly, so a headless AI command fails on a
 * state the user has no way to fix.
 *
 * So: headed when an Opera executable is configured, headless otherwise, and
 * OPERA_CLI_HEADED=0 or =1 overrides either way. A machine with no Opera
 * installed — CI, Docker, a plain-Chrome setup — keeps the old behaviour.
 */
export function shouldRunHeaded(): boolean {
  const explicit = process.env.OPERA_CLI_HEADED;
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return Boolean(process.env.OPERA_CLI_EXECUTABLE_PATH);
}

export function buildTransportArgs(): string[] {
  const args: string[] = [];

  const browserUrl = process.env.OPERA_CLI_BROWSER_URL;
  const userDataDir = process.env.OPERA_CLI_USER_DATA_DIR;
  const executablePath = process.env.OPERA_CLI_EXECUTABLE_PATH;

  if (browserUrl) {
    // Connect to an existing browser instance — skip --isolated and --headless
    // since the user manages the browser lifecycle externally.
    args.push(`--browserUrl=${browserUrl}`);
  } else {
    if (executablePath) {
      args.push(`--executablePath=${executablePath}`);
    }
    if (userDataDir) {
      // Persistent profile — skip --isolated so the profile is preserved.
      args.push(`--userDataDir=${userDataDir}`);
      // Puppeteer adds --use-mock-keychain and --password-store=basic by default,
      // which prevent the browser from decrypting cookies stored with the real
      // macOS Keychain. Drop them so a persistent profile stays logged in.
      args.push("--ignore-default-chrome-arg=--use-mock-keychain");
      args.push("--ignore-default-chrome-arg=--password-store=basic");
      args.push("--ignore-default-chrome-arg=--disable-extensions");
      args.push("--ignore-default-chrome-arg=--disable-component-extensions-with-background-pages");
      // Load the Opera AI component extension with the persistent profile (0.2.6+).
      args.push("--chrome-arg=--show-component-extension-options");
      // Allow external extension loader and download services
      args.push("--ignore-default-chrome-arg=--disable-default-apps");
      args.push("--ignore-default-chrome-arg=--disable-background-networking");
    } else {
      args.push("--isolated");
    }
    if (!shouldRunHeaded()) {
      args.push("--headless");
    }
  }

  const extraChromeArgs = process.env.OPERA_CLI_CHROME_ARGS;
  if (extraChromeArgs) {
    for (const arg of extraChromeArgs.trim().split(/\s+/)) {
      args.push(`--chrome-arg=${arg}`);
    }
  }

  return args;
}

export interface McpBinStatus {
  bin: string;
  found: boolean;
  source: "env" | "dependency" | "path";
}

/** Look a bare command up on PATH, the way a shell would. */
function existsOnPath(command: string): boolean {
  const pathVar = process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const entry of pathVar.split(separator)) {
    if (!entry) continue;
    for (const ext of extensions) {
      if (existsSync(join(entry, command + ext))) return true;
    }
  }
  return false;
}

/**
 * Where opera-devtools-mcp is coming from, and whether it is actually there.
 * Used by `doctor` so a missing MCP server is named before it costs a failed
 * bridge start.
 */
export function resolveMcpBinStatus(): McpBinStatus {
  const bin = resolveOperaMcpBin();
  if (process.env.OPERA_CLI_MCP_BIN) {
    return { bin, found: existsSync(bin) || existsOnPath(bin), source: "env" };
  }
  if (bin === "opera-devtools-mcp") {
    return { bin, found: existsOnPath(bin), source: "path" };
  }
  return { bin, found: existsSync(bin), source: "dependency" };
}

function resolveOperaMcpBin(): string {
  if (process.env.OPERA_CLI_MCP_BIN) return process.env.OPERA_CLI_MCP_BIN;
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("opera-devtools-mcp/package.json");
    const pkgDir = dirname(pkgPath);
    const pkg = require("opera-devtools-mcp/package.json") as {
      bin?: Record<string, string> | string;
    };
    const binEntry =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin?.["opera-devtools-mcp"];
    if (binEntry) {
      const resolved = join(pkgDir, binEntry);
      if (existsSync(resolved)) return resolved;
    }
  } catch {
    // Not installed as a dependency — fall back to PATH
  }
  return "opera-devtools-mcp";
}

function createTransport(): StdioClientTransport {
  const bin = resolveOperaMcpBin();
  const args = buildTransportArgs();
  if (bin.endsWith(".js")) {
    return new StdioClientTransport({
      command: "node",
      args: [bin, ...args],
    });
  }
  return new StdioClientTransport({ command: bin, args });
}

const requestLoggers = new Map<string, (chunk: string) => void>();

type IdResolver = { resolve: (id: string) => void; reject: (err: Error) => void };

/**
 * Wraps transport.send to intercept outgoing JSON-RPC request IDs so each
 * streaming callTool call can register its own log writer before the first
 * notification arrives.
 *
 * INVARIANT: The MCP SDK's Client.request() calls transport.send() synchronously
 * inside its Promise constructor (see @modelcontextprotocol/sdk shared/protocol.js).
 * This means callTool() triggers transport.send before yielding, allowing us to
 * capture the ID before any concurrent handler can interleave.
 * Verify this invariant when upgrading @modelcontextprotocol/sdk.
 */
export function wrapTransportForIdCapture(
  transport: StdioClientTransport,
): () => Promise<string> {
  const queue: IdResolver[] = [];
  // Cast origSend to the full Transport.send signature so we can forward the
  // options argument even though StdioClientTransport currently ignores it.
  const origSend = transport.send.bind(transport) as (
    msg: JSONRPCMessage,
    options?: TransportSendOptions,
  ) => Promise<void>;

  // Forward send — preserve the options parameter so future SDK versions that
  // use TransportSendOptions over stdio are not silently broken.
  transport.send = (async (msg: JSONRPCMessage, options?: TransportSendOptions) => {
    if ("id" in msg && "method" in msg && queue.length > 0) {
      queue.shift()!.resolve(String((msg as { id: unknown }).id));
    }
    return origSend(msg, options);
  }) as unknown as StdioClientTransport["send"];

  // Latent safety net: if a future SDK version makes transport.send async,
  // reject any queued capture so callers do not hang. In the current SDK the
  // queue is always empty by the time onclose can fire (transport.send is
  // called synchronously before the first await in Client.request). The primary
  // protection against a dead-transport hang is the runBridge onclose handler
  // that calls shutdown(); this drain is a belt-and-suspenders fallback.
  const origOnClose = transport.onclose;
  transport.onclose = () => {
    const err = new Error("MCP transport disconnected");
    while (queue.length > 0) queue.shift()!.reject(err);
    origOnClose?.();
  };

  return () => new Promise<string>((resolve, reject) => queue.push({ resolve, reject }));
}

function createBridgeClient(): Client {
  const client = new Client({ name: "opera-browser-cli-bridge", version: "1.0.0" });
  client.setNotificationHandler(
    LoggingMessageNotificationSchema,
    (notification) => {
      // opera-devtools-mcp sets `logger` to String(extra.requestId) so the bridge
      // can route the chunk to the correct HTTP response. `data` stays a plain
      // string so non-bridge MCP hosts (Claude Desktop, VS Code, etc.) render it
      // as readable text without any change.
      const { data, logger } = notification.params;
      if (logger && requestLoggers.has(logger)) {
        const chunk = typeof data === "string" ? data : JSON.stringify(data);
        requestLoggers.get(logger)!(chunk);
      }
      // No matching logger: notification is from a non-Opera tool or an older
      // server version — silently ignore.
    },
  );
  return client;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export async function runBridge(port = DEFAULT_PORT): Promise<void> {
  // The parent destroys its end of the stdout pipe once the handshake is read.
  // We never write to stdout again, but guard anyway so a stray write can never
  // take the bridge down with an EPIPE.
  process.stdout.on("error", () => {});

  // Bind the port before anything expensive happens. Connecting to MCP first
  // would launch an entire browser only to throw it away when the listen
  // fails — so losing a start race would cost a browser launch and leave an
  // orphaned child. Binding first makes losing the race free.
  let client: BridgeClient | null = null;
  let captureNextId: (() => Promise<string>) | undefined;
  const token = generateBridgeToken();
  const server = createBridgeServer(() => ({ client, captureNextId }), token);

  // Without an error handler this is an uncaught exception: the bridge dies
  // with a stack trace in the log and the parent waits out the whole startup
  // timeout. EADDRINUSE is routine — we lost a start race, or the port was
  // taken between the parent's probe and our listen — so exit with a code the
  // parent can read as "try the next port".
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      writeFailedSignal("port-in-use", String(port));
      logBridgeMessage(`Port ${port} already in use`);
      process.exit(EXIT_PORT_IN_USE);
    }
    writeFailedSignal("listen-failed", getErrorMessage(error));
    logBridgeMessage(`Listen failed: ${getErrorMessage(error)}`);
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    server.listen(port, "127.0.0.1", resolve);
  });
  logBridgeMessage(`Listening on http://127.0.0.1:${port}`);

  const transport = createTransport();
  captureNextId = wrapTransportForIdCapture(transport);
  const mcpClient = createBridgeClient();
  try {
    await mcpClient.connect(transport);
  } catch (error) {
    // Almost always a missing or broken opera-devtools-mcp. Name it now rather
    // than letting the parent time out with nothing to report.
    writeFailedSignal("mcp-connect", getErrorMessage(error));
    logBridgeMessage(
      `Failed to connect to opera-devtools-mcp: ${getErrorMessage(error)}`,
    );
    process.exit(1);
  }
  client = mcpClient;
  logBridgeMessage("Connected to opera-devtools-mcp");

  try {
    writePidFile(port, token);
  } catch (error) {
    // Typically a state dir left root-owned by an earlier `sudo` run. This used
    // to throw uncaught from inside the listen callback, killing the bridge
    // *after* it had bound the port.
    writeFailedSignal("state-dir-unwritable", STATE_DIR);
    logBridgeMessage(
      `Cannot write ${PID_FILE}: ${getErrorMessage(error)} — check ownership of ${STATE_DIR}`,
    );
    process.exit(1);
  }
  writeReadySignal();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    removePidFile();
    await closeServer(server);
    await mcpClient.close();
    await transport.close();
    process.exit(0);
  };

  // If opera-devtools-mcp exits (transport closes), shut the bridge down too.
  // Without this, the bridge would keep accepting HTTP requests and hang on any
  // streaming call: captureNextId() queues a resolver, callTool() early-rejects
  // without calling transport.send, and `await idCapture` never resolves.
  // Chain after the drain handler already installed by wrapTransportForIdCapture.
  const afterDrain = transport.onclose;
  transport.onclose = () => {
    afterDrain?.();
    void shutdown();
  };

  // Kill our entire process group on exit so opera-devtools-mcp children
  // don't survive as orphans. The bridge is spawned with detached:true,
  // making it a process group leader — all children share our PGID.
  process.on("exit", () => {
    removePidFile();
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      // Already dead or not a group leader
    }
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
}
