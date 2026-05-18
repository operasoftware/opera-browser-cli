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
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { extractPageOrigin } from "./snapshot.js";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

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

function writePidFile(port: number): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, port }));
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
): Promise<void> {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/health") {
    if (await isBridgeClientConnected(client)) {
      writeJson(res, 200, { status: "ok", server: "opera-browser-cli" });
    } else {
      writeJson(res, 503, { status: "not-connected", server: "opera-browser-cli" });
    }
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

export function createBridgeServer(
  client: BridgeClient,
  captureNextId?: () => Promise<string>,
): Server {
  return createServer((req, res) => {
    void handleBridgeRequest(client, req, res, captureNextId);
  });
}

function logBridgeMessage(message: string): void {
  process.stderr.write(`[opera-browser-cli] ${message}\n`);
}

function writeReadySignal(): void {
  process.stdout.write("READY\n");
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
      args.push("--show-component-extension-options");
    } else {
      args.push("--isolated");
    }
    if (process.env.OPERA_CLI_HEADED !== "1") {
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
  const transport = createTransport();
  const captureNextId = wrapTransportForIdCapture(transport);
  const client = createBridgeClient();
  await client.connect(transport);
  logBridgeMessage("Connected to opera-devtools-mcp");

  const server = createBridgeServer(client, captureNextId);
  server.listen(port, "127.0.0.1", () => {
    writePidFile(port);
    logBridgeMessage(`Listening on http://127.0.0.1:${port}`);
    writeReadySignal();
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    removePidFile();
    await closeServer(server);
    await client.close();
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
