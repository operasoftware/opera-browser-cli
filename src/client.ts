/**
 * HTTP client for the opera-browser-cli bridge + bridge lifecycle management.
 */

import { spawn } from "node:child_process";
import { mkdirSync, openSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { request } from "node:http";
import { AxiError } from "axi-sdk-js";
import { resolveBridgeScript } from "./bridge.js";

const STATE_DIR = join(homedir(), ".opera-browser-cli");
const PID_FILE = join(STATE_DIR, "bridge.pid");
const CONFIG_FILE = join(STATE_DIR, "config");
const LOG_FILE = join(STATE_DIR, "bridge.log");
const DEFAULT_PORT = 9224;

export function getLogFile(): string {
  return LOG_FILE;
}

export function getStateDir(): string {
  return STATE_DIR;
}

export function getConfigFile(): string {
  return CONFIG_FILE;
}

export function parseConfigValue(raw: string): string {
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return raw;
}

/**
 * Load ~/.opera-browser-cli/config and apply KEY=VALUE pairs as env var defaults.
 * Only sets a var if it is not already set in the environment.
 */
export function loadConfig(): void {
  if (!existsSync(CONFIG_FILE)) return;
  try {
    const lines = readFileSync(CONFIG_FILE, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = parseConfigValue(trimmed.slice(eq + 1).trim());
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // Best-effort — never fail over a missing or malformed config
  }
}

export type ErrorCode =
  | "BRIDGE_NOT_READY"
  | "REF_NOT_FOUND"
  | "TIMEOUT"
  | "PAGE_CLOSED"
  | "BROWSER_ERROR"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

export class CdpError extends AxiError {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly suggestions: string[] = [],
  ) {
    super(message, code, suggestions);
    this.name = "CdpError";
  }
}

interface PidInfo {
  pid: number;
  port: number;
}

function readPidFile(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const data = JSON.parse(readFileSync(PID_FILE, "utf-8"));
    if (typeof data.pid === "number" && typeof data.port === "number") {
      return data as PidInfo;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpGet(
  port: number,
  path: string,
  timeoutMs = 2000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method: "GET", timeout: timeoutMs },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}

function httpPost(
  port: number,
  path: string,
  body: unknown,
  timeoutMs = 120_000,
  onLog?: (message: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let buffer = "";
        res.on("data", (chunk) => {
          buffer += chunk;
          if (onLog) {
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (!line) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.log !== undefined) {
                  onLog(parsed.log);
                }
              } catch {
                // Not a JSON log line — accumulate for final parse
              }
            }
          }
        });
        res.on("end", () => {
          const finalData = onLog ? (buffer || "{}") : buffer;
          try {
            const parsed = JSON.parse(finalData);
            if (parsed.error) {
              reject(new Error(parsed.error));
            } else {
              resolve(finalData);
            }
          } catch {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(finalData));
            } else {
              resolve(finalData);
            }
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function checkBridgeHealth(port: number): Promise<boolean> {
  try {
    const resp = await httpGet(port, "/health");
    const data = JSON.parse(resp);
    return data.status === "ok";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ensure the bridge is running, starting it if needed. Returns the port.
 */
export async function ensureBridge(): Promise<number> {
  const port = parseInt(
    process.env.OPERA_CLI_PORT ?? String(DEFAULT_PORT),
    10,
  );

  // Check existing bridge via PID file
  const pidInfo = readPidFile();
  if (pidInfo && isProcessAlive(pidInfo.pid)) {
    if (await checkBridgeHealth(pidInfo.port)) {
      return pidInfo.port;
    }
    try {
      process.kill(pidInfo.pid, "SIGTERM");
    } catch {
      // Best effort — if shutdown fails, the startup poll below will time out.
    }
  }

  // Start a new bridge

  const bridgeScript = resolveBridgeScript(import.meta.dirname);
  // Try .ts first (dev mode), fall back to .js (built)
  const script = existsSync(bridgeScript.replace(/\.js$/, ".ts"))
    ? bridgeScript.replace(/\.js$/, ".ts")
    : bridgeScript;
  const runner = script.endsWith(".ts") ? "tsx" : "node";

  // Pipe bridge stdout/stderr to ~/.opera-browser-cli/bridge.log so failures
  // are inspectable. Falls back to "ignore" if the file can't be opened.
  let stdio: "ignore" | ["ignore", number, number] = "ignore";
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const logFd = openSync(LOG_FILE, "a");
    stdio = ["ignore", logFd, logFd];
  } catch {
    // Log directory unwritable — bridge still runs, just no logs.
  }

  const child = spawn(
    runner === "tsx" ? "npx" : "node",
    runner === "tsx" ? ["tsx", script] : [script],
    {
      stdio,
      env: { ...process.env, OPERA_CLI_PORT: String(port) },
      detached: true,
    },
  );
  child.unref();

  // Poll for health (max 30s — Chrome launch can be slow)
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await checkBridgeHealth(port)) {
      return port;
    }
    await sleep(500);
  }

  throw new CdpError("Bridge failed to start within 30s", "BRIDGE_NOT_READY", [
    "For local dev: set OPERA_CLI_MCP_BIN to the linked binary, e.g. OPERA_CLI_MCP_BIN=opera-devtools-mcp",
    "For published version: check that opera-devtools-mcp is installed: npx opera-devtools-mcp@latest --help",
  ]);
}

const OPERA_AI_TIMEOUT = 1_200_000; // 20 minutes
const OPERA_AI_TOOLS = new Set([
  "opera_chat",
  "opera_do",
  "opera_research",
  "opera_make",
]);

/**
 * Call an MCP tool via the bridge. Returns the text result.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const port = await ensureBridge();
  const isStreaming = OPERA_AI_TOOLS.has(name);
  const timeoutMs = isStreaming ? OPERA_AI_TIMEOUT : undefined;
  const onLog = isStreaming
    ? (msg: string) => process.stderr.write(msg + "\n")
    : undefined;

  try {
    const resp = await httpPost(port, "/call", { name, args }, timeoutMs, onLog);
    const data = JSON.parse(resp);
    if (data.error) {
      throw new Error(data.error);
    }
    return data.result ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw mapErrorMessage(message);
  }
}

export function mapErrorMessage(message: string): CdpError {
  if (message.includes("ECONNREFUSED") || message.includes("ECONNRESET")) {
    return new CdpError("Bridge is not running", "BRIDGE_NOT_READY", [
      "Run `opera-browser-cli open <url>` — the bridge starts automatically",
    ]);
  }
  if (
    (message.includes("uid") || message.includes("element")) &&
    (message.includes("not found") || message.includes("invalid"))
  ) {
    return new CdpError(message, "REF_NOT_FOUND", [
      "Run `opera-browser-cli snapshot` to see available elements and their @uid refs",
    ]);
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return new CdpError(message, "TIMEOUT", [
      "Run `opera-browser-cli snapshot` to see current page state",
    ]);
  }
  if (message.includes("selected page has been closed")) {
    return new CdpError(message, "PAGE_CLOSED", [
      "Run `opera-browser-cli pages` to see open pages",
      "Run `opera-browser-cli selectpage <id>` to switch to an open page",
    ]);
  }
  if (
    message.includes("User is not signed in") ||
    (message.includes("Opera.dispatchAction") &&
      message.includes("not signed in"))
  ) {
    return new CdpError(
      "Opera: user is not signed in",
      "BROWSER_ERROR",
      [
        "Sign in to your Opera account to use this feature",
        "Run `opera-browser-cli setup` to configure the executable path",
      ],
    );
  }
  // Try to parse JSON error
  try {
    const parsed = JSON.parse(message);
    if (parsed.error) {
      return new CdpError(parsed.error, "BROWSER_ERROR", [
        "Run `opera-browser-cli snapshot` to see current page state",
      ]);
    }
  } catch {
    // Not JSON
  }
  return new CdpError(message, "UNKNOWN");
}

export interface BridgeStatus {
  pidFileExists: boolean;
  processAlive: boolean;
  healthy: boolean;
  port: number | null;
  pid: number | null;
}

/**
 * Inspect the bridge without starting it. Used by `opera-browser-cli doctor`.
 */
export async function getBridgeStatus(): Promise<BridgeStatus> {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    return {
      pidFileExists: false,
      processAlive: false,
      healthy: false,
      port: null,
      pid: null,
    };
  }
  const alive = isProcessAlive(pidInfo.pid);
  const healthy = alive ? await checkBridgeHealth(pidInfo.port) : false;
  return {
    pidFileExists: true,
    processAlive: alive,
    healthy,
    port: pidInfo.port,
    pid: pidInfo.pid,
  };
}

/**
 * Get the current page snapshot without starting the bridge.
 * Returns null if the bridge is not running or healthy.
 */
export interface CachedSnapshot {
  raw: string;
  pageUrl: string | null;
  capturedAt: number;
}

/** Retrieve the most recent snapshot the bridge has cached, without triggering a new one. */
export async function getLastSnapshot(): Promise<CachedSnapshot | null> {
  const pidInfo = readPidFile();
  if (!pidInfo || !isProcessAlive(pidInfo.pid)) return null;
  try {
    const resp = await httpGet(pidInfo.port, "/last-snapshot", 2000);
    const data = JSON.parse(resp) as { error?: string } & Partial<CachedSnapshot>;
    if (data.error || !data.raw) return null;
    return { raw: data.raw, pageUrl: data.pageUrl ?? null, capturedAt: data.capturedAt ?? 0 };
  } catch {
    return null;
  }
}

export async function getSessionSnapshotIfRunning(): Promise<string | null> {
  const pidInfo = readPidFile();
  if (!pidInfo || !isProcessAlive(pidInfo.pid)) {
    return null;
  }
  if (!(await checkBridgeHealth(pidInfo.port))) {
    return null;
  }
  try {
    const resp = await httpPost(
      pidInfo.port,
      "/call",
      { name: "take_snapshot", args: {} },
      5000,
    );
    const data = JSON.parse(resp);
    if (data.error) return null;
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Stop the bridge process.
 */
export function stopBridge(): boolean {
  const pidInfo = readPidFile();
  if (!pidInfo) {
    return false;
  }
  if (isProcessAlive(pidInfo.pid)) {
    process.kill(pidInfo.pid, "SIGTERM");
    return true;
  }
  return false;
}
