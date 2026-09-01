/**
 * HTTP client for the opera-browser-cli bridge + bridge lifecycle management.
 *
 * The lifecycle rules, in one place:
 *
 *   - A process is only ever signalled once it has been positively identified
 *     as our bridge — by answering /health, or by matching a PID file entry
 *     recorded on this same boot. A recycled PID after a reboot must never be
 *     mistaken for ours.
 *   - A bridge running a different package version is unusable, however
 *     healthy it looks: it is serving pre-upgrade code from memory.
 *   - Exactly one process starts a bridge at a time (an exclusive lock), and
 *     if the port it wants is taken it moves to the next one.
 *   - A connection lost mid-command is recovered transparently, except for the
 *     expensive Opera AI tools, which are never silently replayed.
 */

import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { request } from "node:http";
import { AxiError } from "axi-sdk-js";
import {
  resolveBridgeLauncher,
  shouldRunHeaded,
  type LastSnapshotCache,
} from "./bridge.js";
import {
  computeBootMinute,
  isOurBridge,
  isUsableBridge,
  parseHealth,
  sameBoot,
  type BridgeHealth,
} from "./identity.js";
import { getPackageVersion } from "./version.js";

const STATE_DIR = join(homedir(), ".opera-browser-cli");
const PID_FILE = join(STATE_DIR, "bridge.pid");
const CONFIG_FILE = join(STATE_DIR, "config");
const LOG_FILE = join(STATE_DIR, "bridge.log");
const LOCK_FILE = join(STATE_DIR, "bridge.lock");
const DEFAULT_PORT = 9225;

/** How many consecutive ports to try before giving up. */
const PORT_SCAN_COUNT = 10;
/** Budget for a single bridge process to reach READY (Chrome launch is slow). */
const START_TIMEOUT_MS = 30_000;
/** A start lock older than this is assumed abandoned. */
const LOCK_STALE_MS = 60_000;
/** Grace period for a SIGTERMed bridge before escalating to SIGKILL. */
const STOP_GRACE_MS = 5_000;
/** Rotate the bridge log past this size so it cannot grow without bound. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** Lines of bridge.log to quote back when a startup fails. */
const LOG_TAIL_LINES = 20;

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
  /** Sign-in, subscription, or consent — only the user can resolve it. */
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_OPERATION"
  | "EXTENSION_NOT_FOUND"
  | "NOT_FOUND"
  | "CONVERSATION_NOT_FOUND"
  | "SERVER_DISCONNECTED"
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

// ---------------------------------------------------------------------------
// PID file
// ---------------------------------------------------------------------------

interface PidInfo {
  pid: number;
  port: number;
  token?: string;
  /** Absent on bridges from <= 0.1.45, which predate the identity fields. */
  version?: string;
  startedAt?: number;
  bootMinute?: number;
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

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Already gone — fine
  }
}

/** Read the bridge's per-instance auth token from the PID file, if present. */
function readBridgeToken(): string | null {
  return readPidFile()?.token ?? null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a PID file entry may be signalled.
 *
 * Requires the entry to record the boot it was written on, and that boot to be
 * the current one. Entries without a boot stamp (pre-0.1.46) are only
 * trustworthy when something has *also* identified the port as ours — see
 * `resolveSignalablePid`.
 */
function pidFileIsFromThisBoot(info: PidInfo): boolean {
  return (
    typeof info.bootMinute === "number" &&
    sameBoot(info.bootMinute, computeBootMinute())
  );
}

/**
 * Work out which PID, if any, it is safe to signal for the bridge on `port`.
 *
 * `health.pid` is authoritative — that process just told us who it is. Older
 * bridges do not report a PID; for those we fall back to the PID file, but only
 * when it names the same port, which means the file was written by whatever is
 * answering there now.
 */
function resolveSignalablePid(port: number, health: BridgeHealth): number | null {
  if (health.pid > 0) return health.pid;
  const info = readPidFile();
  if (info && info.port === port && isProcessAlive(info.pid)) return info.pid;
  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function httpGet(
  port: number,
  path: string,
  timeoutMs = 2000,
  token?: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        timeout: timeoutMs,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
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
  token?: string | null,
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
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** The ports a bridge may live on, in preference order. */
export function candidatePorts(): number[] {
  const base = Number.parseInt(
    process.env.OPERA_CLI_PORT ?? String(DEFAULT_PORT),
    10,
  );
  const start = Number.isFinite(base) ? base : DEFAULT_PORT;
  return Array.from({ length: PORT_SCAN_COUNT }, (_, i) => start + i);
}

/**
 * Ask what is listening on a port.
 *
 * Returns the identity if it is one of our bridges (of any version), and null
 * for everything else: nothing listening, a foreign server, or a response we
 * cannot parse. A foreign server is deliberately indistinguishable from an
 * empty port here — the caller handles both the same way, by moving on and
 * letting the bridge's own EADDRINUSE handling sort out the collision.
 */
async function probeHealth(port: number): Promise<BridgeHealth | null> {
  try {
    return parseHealth(await httpGet(port, "/health", 2000));
  } catch {
    return null;
  }
}

interface PortProbe {
  port: number;
  health: BridgeHealth | null;
}

async function probeAll(ports: number[]): Promise<PortProbe[]> {
  return Promise.all(
    ports.map(async (port) => ({ port, health: await probeHealth(port) })),
  );
}

/**
 * Find a bridge we can use, cleaning up any of our own that we cannot.
 *
 * Stale-version bridges are shut down rather than left running: they hold a
 * port, they will never become usable, and leaving them behind is how a machine
 * accumulates zombies across upgrades.
 */
export async function findUsableBridge(ports: number[]): Promise<number | null> {
  const version = getPackageVersion();
  const wantHeaded = shouldRunHeaded();

  // Fast path: the port in the PID file is nearly always the answer, and
  // checking it alone keeps the common case to a single round trip.
  const preferred = readPidFile()?.port;
  if (preferred !== undefined && ports.includes(preferred)) {
    const health = await probeHealth(preferred);
    if (isUsableBridge(health, version) && health.headed === wantHeaded) return preferred;
    if (isOurBridge(health)) await shutdownBridgeOnPort(preferred, health);
  }

  const probes = await probeAll(ports.filter((p) => p !== preferred));
  for (const { port, health } of probes) {
    if (isUsableBridge(health, version) && health.headed === wantHeaded) return port;
  }
  for (const { port, health } of probes) {
    if (isOurBridge(health)) await shutdownBridgeOnPort(port, health);
  }
  return null;
}

/** Poll for a bridge someone else is starting. */
async function waitForUsableBridge(
  ports: number[],
  timeoutMs: number,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = await findUsableBridge(ports);
    if (port !== null) return port;
    await sleep(250);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/** SIGTERM, wait, SIGKILL. Returns true if the process is gone afterwards. */
async function terminateProcess(pid: number): Promise<{ gone: boolean; forced: boolean }> {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return { gone: true, forced: false };
  }
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return { gone: true, forced: false };
    await sleep(100);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return { gone: true, forced: true };
  }
  await sleep(200);
  return { gone: !isProcessAlive(pid), forced: true };
}

/** Shut down a bridge we have positively identified on `port`. */
async function shutdownBridgeOnPort(
  port: number,
  health: BridgeHealth,
): Promise<void> {
  const pid = resolveSignalablePid(port, health);
  if (pid === null) return;
  await terminateProcess(pid);
  if (readPidFile()?.pid === pid) removePidFile();
}

/** Shut down every bridge of ours across the candidate ports. */
async function shutdownOurBridges(ports: number[]): Promise<void> {
  for (const { port, health } of await probeAll(ports)) {
    if (isOurBridge(health)) await shutdownBridgeOnPort(port, health);
  }
}

// ---------------------------------------------------------------------------
// Start lock
//
// Without this, N concurrent commands on a cold start all see no bridge and all
// spawn one. The losers die on EADDRINUSE, and whichever PID file lands last
// may not describe the survivor.
// ---------------------------------------------------------------------------

interface LockInfo {
  pid: number;
  startedAt: number;
}

let holdingLock = false;

function readLock(): LockInfo | null {
  try {
    const data = JSON.parse(readFileSync(LOCK_FILE, "utf-8")) as Partial<LockInfo>;
    if (typeof data.pid !== "number" || typeof data.startedAt !== "number") {
      return null;
    }
    return { pid: data.pid, startedAt: data.startedAt };
  } catch {
    return null;
  }
}

function acquireStartLock(): boolean {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const fd = openSync(LOCK_FILE, "wx");
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    } finally {
      closeSync(fd);
    }
    holdingLock = true;
    // Held only while we hold the lock, so an interrupted start still releases
    // it and we never accumulate listeners across repeated acquisitions.
    process.on("exit", releaseStartLock);
    return true;
  } catch {
    return false;
  }
}

function releaseStartLock(): void {
  if (!holdingLock) return;
  holdingLock = false;
  process.off("exit", releaseStartLock);
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Someone else cleaned it up — fine
  }
}

/** True when the lock is held by a dead process or has simply been there too long. */
function startLockIsStale(): boolean {
  const lock = readLock();
  if (lock === null) return true; // unreadable or malformed
  if (!isProcessAlive(lock.pid)) return true;
  return Date.now() - lock.startedAt > LOCK_STALE_MS;
}

/**
 * Remove an abandoned lock and take it.
 *
 * Two processes can both decide a lock is stale and both end up believing they
 * hold it. That is tolerable: the loser's bridge fails with EADDRINUSE and
 * retries the next port, which is exactly the path the port scan already
 * handles. The lock removes the common case; the port scan is the real backstop.
 */
function stealStartLock(): boolean {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Already gone
  }
  return acquireStartLock();
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Rotate the bridge log now, whatever its size. Used by `doctor --fix`. */
export function rotateBridgeLog(): boolean {
  try {
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
    return true;
  } catch {
    return false;
  }
}

function rotateLogIfLarge(): void {
  try {
    if (statSync(LOG_FILE).size < MAX_LOG_BYTES) return;
    renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // No log yet, or rotation is not possible — never block a start over it.
  }
}

/** The tail of the bridge log, for quoting back when a start fails. */
function readLogTail(lines = LOG_TAIL_LINES): string {
  try {
    const all = readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function openLogFd(): number | null {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    rotateLogIfLarge();
    return openSync(LOG_FILE, "a");
  } catch {
    // Log directory unwritable — the bridge still runs, just without logs.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  ok: boolean;
  /** Machine-readable failure class, matching the bridge's FAILED signals. */
  reason?: string;
  detail?: string;
}

/**
 * Start one bridge process on one port and wait for its handshake.
 *
 * The bridge reports READY or FAILED on stdout, so a dead child is detected in
 * milliseconds instead of costing the full startup budget. Its stderr goes to
 * the log file, whose tail is folded into the failure detail.
 */
async function spawnBridge(port: number): Promise<SpawnOutcome> {
  const launcher = resolveBridgeLauncher(import.meta.dirname);
  if (!launcher.ok) return { ok: false, reason: launcher.reason };

  const logFd = openLogFd();
  const child = spawn(launcher.command, launcher.args, {
    stdio: ["ignore", "pipe", logFd ?? "ignore"],
    env: { ...process.env, OPERA_CLI_PORT: String(port) },
    detached: true,
  });

  return new Promise<SpawnOutcome>((resolve) => {
    let settled = false;
    let buffer = "";

    const finish = (outcome: SpawnOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      child.stdout?.removeAllListeners("data");
      // Release the pipe so this process can exit; the bridge writes nothing
      // to stdout after the handshake and guards against EPIPE regardless.
      child.stdout?.destroy();
      child.unref();
      if (logFd !== null) {
        try {
          closeSync(logFd);
        } catch {
          // Already closed
        }
      }
      resolve(outcome);
    };

    const timer = setTimeout(
      () => finish({ ok: false, reason: "timeout", detail: readLogTail() }),
      START_TIMEOUT_MS,
    );

    child.stdout?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line === "READY") {
          finish({ ok: true });
          return;
        }
        if (line.startsWith("FAILED ")) {
          const rest = line.slice("FAILED ".length);
          const spaceAt = rest.indexOf(" ");
          finish({
            ok: false,
            reason: spaceAt === -1 ? rest : rest.slice(0, spaceAt),
            detail: spaceAt === -1 ? undefined : rest.slice(spaceAt + 1),
          });
          return;
        }
      }
    });

    child.on("error", (error) =>
      finish({ ok: false, reason: "spawn-failed", detail: error.message }),
    );

    child.on("exit", (code) =>
      finish({
        ok: false,
        reason: code === 75 ? "port-in-use" : "exited",
        detail: `bridge exited with code ${code}\n${readLogTail()}`,
      }),
    );
  });
}

function startFailureError(outcome: SpawnOutcome, ports: number[]): CdpError {
  const detail = outcome.detail ? `\n${outcome.detail}` : "";
  switch (outcome.reason) {
    case "mcp-connect":
      return new CdpError(
        `Bridge could not connect to opera-devtools-mcp.${detail}`,
        "BRIDGE_NOT_READY",
        [
          "Check that opera-devtools-mcp is installed: `npx opera-devtools-mcp@latest --help`",
          "For local dev: set OPERA_CLI_MCP_BIN to the linked binary",
          "Run `opera-browser-cli logs` for the full bridge output",
        ],
      );
    case "state-dir-unwritable":
      return new CdpError(
        `Bridge cannot write to its state directory (${outcome.detail ?? STATE_DIR}).`,
        "BRIDGE_NOT_READY",
        [
          `Check ownership: \`ls -ld ${outcome.detail ?? STATE_DIR}\``,
          `If it is root-owned from an earlier sudo run: \`sudo chown -R "$(whoami)" ${outcome.detail ?? STATE_DIR}\``,
        ],
      );
    case "tsx-not-installed":
      return new CdpError(
        "Bridge cannot run from TypeScript source — tsx is not installed.",
        "BRIDGE_NOT_READY",
        [
          "Run `npm install` in the opera-browser-cli checkout",
          "Or build first: `npm run build`",
        ],
      );
    case "bridge-not-built":
      return new CdpError(
        "Bridge entrypoint not found — the package looks unbuilt.",
        "BRIDGE_NOT_READY",
        ["Run `npm run build` in the opera-browser-cli checkout"],
      );
    case "port-in-use":
      return new CdpError(
        `Ports ${ports[0]}-${ports[ports.length - 1]} are all in use by other servers.`,
        "BRIDGE_NOT_READY",
        [
          "Free one of those ports, or set OPERA_CLI_PORT to a different base port",
        ],
      );
    case "timeout":
      return new CdpError(
        `Bridge did not become ready within ${START_TIMEOUT_MS / 1000}s.${detail}`,
        "BRIDGE_NOT_READY",
        [
          "Run `opera-browser-cli logs` to see what the bridge was doing",
          "Run `opera-browser-cli doctor` to check the configuration",
        ],
      );
    default:
      return new CdpError(
        `Bridge failed to start.${detail}`,
        "BRIDGE_NOT_READY",
        [
          "Run `opera-browser-cli logs` for the full bridge output",
          "Run `opera-browser-cli doctor` to check the configuration",
        ],
      );
  }
}

/**
 * Take the start lock and bring a bridge up, walking the port range.
 *
 * If another process holds the lock we wait for its bridge instead of racing
 * it; only an abandoned lock is stolen.
 */
async function startBridge(ports: number[], attempt = 0): Promise<number> {
  if (!acquireStartLock()) {
    const port = await waitForUsableBridge(ports, START_TIMEOUT_MS);
    if (port !== null) return port;
    if (attempt >= 1 || !startLockIsStale() || !stealStartLock()) {
      throw new CdpError(
        "Timed out waiting for another opera-browser-cli process to start the bridge",
        "BRIDGE_NOT_READY",
        [
          "Run `opera-browser-cli logs` to see what the other process was doing",
          "Run `opera-browser-cli restart` to force a clean start",
        ],
      );
    }
    return startBridge(ports, attempt + 1);
  }

  try {
    let lastOutcome: SpawnOutcome = { ok: false, reason: "port-in-use" };
    for (const port of ports) {
      lastOutcome = await spawnBridge(port);
      if (lastOutcome.ok) return port;
      // Only a port collision is worth trying the next port for; anything else
      // will fail the same way everywhere, so surface it immediately.
      if (lastOutcome.reason !== "port-in-use") break;
    }
    throw startFailureError(lastOutcome, ports);
  } finally {
    releaseStartLock();
  }
}

// ---------------------------------------------------------------------------
// Public lifecycle API
// ---------------------------------------------------------------------------

export interface EnsureBridgeOptions {
  /** Tear down any bridge of ours first, then start fresh. */
  forceRestart?: boolean;
}

/**
 * Ensure a bridge running our version is up. Returns the port it is on.
 */
export async function ensureBridge(
  options: EnsureBridgeOptions = {},
): Promise<number> {
  const ports = candidatePorts();

  if (options.forceRestart) {
    await shutdownOurBridges(ports);
  } else {
    const existing = await findUsableBridge(ports);
    if (existing !== null) return existing;
  }

  return startBridge(ports);
}

export interface StopResult {
  /** A running bridge was signalled and is now gone. */
  stopped: boolean;
  /** A PID file was present but the process was already dead. */
  stale: boolean;
  /** SIGTERM was ignored and SIGKILL was needed. */
  forced: boolean;
  pid: number | null;
  port: number | null;
}

/**
 * Stop the bridge.
 *
 * Looks past the PID file: if the file is missing or stale but a bridge of ours
 * is answering on one of the candidate ports, that one is stopped too. Escalates
 * to SIGKILL rather than reporting success against a process that ignored the
 * signal, and always leaves the PID file cleaned up.
 */
export async function stopBridge(): Promise<StopResult> {
  const result: StopResult = {
    stopped: false,
    stale: false,
    forced: false,
    pid: null,
    port: null,
  };

  // Prefer a live, identified bridge — that is the one actually holding a port.
  for (const { port, health } of await probeAll(candidatePorts())) {
    if (!isOurBridge(health)) continue;
    const pid = resolveSignalablePid(port, health);
    if (pid === null) continue;
    const outcome = await terminateProcess(pid);
    result.stopped ||= outcome.gone;
    result.forced ||= outcome.forced;
    result.pid ??= pid;
    result.port ??= port;
  }

  const info = readPidFile();
  if (info) {
    if (!result.stopped) {
      // Nothing answered. Only signal the recorded PID if the file is provably
      // from this boot — otherwise the PID may belong to a stranger.
      if (pidFileIsFromThisBoot(info) && isProcessAlive(info.pid)) {
        const outcome = await terminateProcess(info.pid);
        result.stopped = outcome.gone;
        result.forced = outcome.forced;
        result.pid = info.pid;
        result.port = info.port;
      } else {
        result.stale = true;
        result.pid = info.pid;
        result.port = info.port;
      }
    }
    removePidFile();
  }

  return result;
}

/** Stop whatever is running and bring a fresh bridge up. Returns the port. */
export async function restartBridge(): Promise<number> {
  return ensureBridge({ forceRestart: true });
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

const OPERA_AI_TIMEOUT = 1_200_000; // 20 minutes
const OPERA_AI_TOOLS = new Set([
  "opera_chat",
  "opera_do",
  "opera_research",
  "opera_make",
  "opera_call_mcp_tool",
  "opera_authenticate_mcp_server",
]);

/**
 * Tools that must never be replayed after a dropped connection.
 *
 * All four Opera AI tools are long-running, billable, and may have already
 * acted on the page before the bridge went away. A silent second run could
 * double a booking as easily as it could double a bill.
 */
const NON_REPLAYABLE_TOOLS = OPERA_AI_TOOLS;

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A dropped or rejected bridge connection, as opposed to a tool-level failure. */
function isTransportFailure(message: string): boolean {
  return (
    /ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|MCP transport disconnected/i.test(
      message,
    ) || isAuthFailure(message)
  );
}

/**
 * The bridge's own 401. Matched exactly: page content and tool output routinely
 * contain the word "unauthorized" and must not trigger a restart.
 */
function isAuthFailure(message: string): boolean {
  return message.trim().toLowerCase() === "unauthorized";
}

/**
 * A page-state race rather than a real failure: the DOM moved under us while
 * the call was in flight. Common during navigation, and almost always gone by
 * the time we ask again.
 */
function isTransientPageFailure(message: string): boolean {
  return /detached|execution context was destroyed|cannot find context|no node with given id|target closed/i.test(
    message,
  );
}

async function callToolOnce(
  name: string,
  args: Record<string, unknown>,
  options: EnsureBridgeOptions,
): Promise<string> {
  const port = await ensureBridge(options);
  const isStreaming = OPERA_AI_TOOLS.has(name);
  const timeoutMs = isStreaming ? OPERA_AI_TIMEOUT : undefined;
  const onLog = isStreaming
    ? (msg: string) => process.stderr.write(msg + "\n")
    : undefined;

  const resp = await httpPost(
    port,
    "/call",
    { name, args },
    timeoutMs,
    onLog,
    readBridgeToken(),
  );
  const data = JSON.parse(resp);
  if (data.error) throw new Error(data.error);
  return data.result ?? "";
}

/**
 * Call an MCP tool via the bridge. Returns the text result.
 *
 * A connection lost mid-call is recovered once: the bridge is restarted and the
 * call replayed. The Opera AI tools are exempt from *that* recovery — they are
 * reported instead, so the user decides whether to pay for a second run.
 *
 * A second, distinct failure is also repaired: the bridge answers, but the
 * browser it was told to drive is unreachable (a dead attach URL, or a managed
 * launch that never produced a browser). devtools-mcp reports that as a tool
 * *result*, not an error, so it would otherwise look like success. We rebuild
 * the bridge against the current target and retry once — safe for every tool,
 * because nothing could have acted on a browser that was never reached.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  let result: string;
  try {
    result = await callToolOnce(name, args, {});
  } catch (error) {
    return recoverFailedCall(name, args, error);
  }

  // The bridge answered, but the browser it was told to drive is unreachable
  // (a dead attach URL, or a managed launch that never produced a browser).
  // Rebuild the bridge against the current target and retry once — safe for
  // every tool, because nothing could have acted on a browser that was never
  // reached. A persistent failure is a real error, not a fake success.
  if (isBrowserUnreachableResult(result)) {
    try {
      const recovered = await callToolOnce(name, args, { forceRestart: true });
      if (!isBrowserUnreachableResult(recovered)) return recovered;
    } catch (retryError) {
      return recoverFailedCall(name, args, retryError);
    }
    throw browserUnreachableError();
  }

  return result;
}

/**
 * Handle an exception thrown by the bridge: recover what is worth recovering
 * (transient page races, dropped transport), and map the rest to an error code.
 */
async function recoverFailedCall(
  name: string,
  args: Record<string, unknown>,
  error: unknown,
): Promise<string> {
  const message = errorMessageOf(error);

  // A page-state race is worth one immediate retry against the same bridge —
  // no restart, no user-visible failure.
  if (isTransientPageFailure(message) && !NON_REPLAYABLE_TOOLS.has(name)) {
    await sleep(250);
    try {
      return await callToolOnce(name, args, {});
    } catch (retryError) {
      throw mapErrorMessage(errorMessageOf(retryError));
    }
  }

  if (!isTransportFailure(message)) throw mapErrorMessage(message);

  if (NON_REPLAYABLE_TOOLS.has(name)) {
    throw new CdpError(
      `The bridge connection dropped while running ${name}, and the command was not retried automatically because it may already have taken effect.`,
      "BRIDGE_NOT_READY",
      [
        "Re-run the command — the bridge restarts automatically",
        "Run `opera-browser-cli logs` to see why the bridge dropped",
      ],
    );
  }

  try {
    return await callToolOnce(name, args, { forceRestart: true });
  } catch (retryError) {
    throw mapErrorMessage(errorMessageOf(retryError));
  }
}

/** devtools-mcp's "I have no browser to talk to" result text. */
function isBrowserUnreachableResult(result: string): boolean {
  return /could not connect to chrome|failed to fetch browser websocket url/i.test(
    result,
  );
}

function browserUnreachableError(): CdpError {
  return new CdpError(
    "The browser is not reachable. It may be running without a debugging port, or the bridge is pointing at a browser that has closed.",
    "BROWSER_ERROR",
    [
      "Run `opera-browser-cli doctor` to check the profile and bridge state",
      "Restart the running browser with a debug port: `opera-browser-cli open <url> --takeover`",
      "Or use a separate profile (no flag) if the browser cannot be restarted",
    ],
  );
}

export function mapErrorMessage(message: string): CdpError {
  if (isAuthFailure(message)) {
    return new CdpError(
      "Bridge rejected the auth token",
      "BRIDGE_NOT_READY",
      [
        "Run `opera-browser-cli restart` to issue a fresh token",
        "Run `opera-browser-cli doctor` to inspect the bridge state",
      ],
    );
  }
  if (message.includes("ECONNREFUSED") || message.includes("ECONNRESET")) {
    return new CdpError("Bridge is not running", "BRIDGE_NOT_READY", [
      "Run `opera-browser-cli open <url>` — the bridge starts automatically",
      "Run `opera-browser-cli restart` if it keeps failing",
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
    return new CdpError("Opera: user is not signed in", "AUTH_REQUIRED", [
      "Run `opera-browser-cli login` to sign in to your Opera account",
      "Run `opera-browser-cli doctor` to inspect the current configuration",
    ]);
  }
  if (message.includes("MCP Hub extension not available")) {
    return new CdpError(
      "MCP Hub extension not loaded. Load it in opera://extensions.",
      "EXTENSION_NOT_FOUND",
      ["Visit opera://extensions", "Load the MCP Hub extension (unpacked)"],
    );
  }

  // MCP-specific errors: guarded by MCP context to avoid false matches on generic server/not found.
  // The extension surfaces these as raw strings from thrown hub errors.
  if (
    (message.includes("MCP") || message.includes("opera_list_mcp")) &&
    message.includes("not found")
  ) {
    return new CdpError(message, "NOT_FOUND", [
      "Run 'opera-browser-cli mcp-servers' to see available servers.",
    ]);
  }

  if (
    (message.includes("MCP") || message.includes("opera_list_mcp")) &&
    message.includes("not connected")
  ) {
    return new CdpError(message, "SERVER_DISCONNECTED", [
      "Connect the server in the MCP Hub sidepanel.",
    ]);
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

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

export interface BridgeStatus {
  pidFileExists: boolean;
  processAlive: boolean;
  healthy: boolean;
  port: number | null;
  pid: number | null;
  /** Version the running bridge reports, when one is answering. */
  runningVersion: string | null;
  /** Our version — differs from runningVersion after an upgrade. */
  expectedVersion: string;
  /** Running, ours, but on stale code: needs a restart to become usable. */
  versionSkew: boolean;
  /** PID file names a process from a previous boot, or a dead one. */
  stalePidFile: boolean;
}

/**
 * Inspect the bridge without starting it. Used by `doctor` and `status`.
 */
export async function getBridgeStatus(): Promise<BridgeStatus> {
  const expectedVersion = getPackageVersion();
  const base: BridgeStatus = {
    pidFileExists: false,
    processAlive: false,
    healthy: false,
    port: null,
    pid: null,
    runningVersion: null,
    expectedVersion,
    versionSkew: false,
    stalePidFile: false,
  };

  // A live bridge is the best source of truth, wherever its port came from.
  for (const { port, health } of await probeAll(candidatePorts())) {
    if (!isOurBridge(health)) continue;
    return {
      ...base,
      pidFileExists: existsSync(PID_FILE),
      processAlive: true,
      healthy: isUsableBridge(health, expectedVersion),
      port,
      pid: health.pid > 0 ? health.pid : (readPidFile()?.pid ?? null),
      runningVersion: health.version,
      versionSkew: health.version !== expectedVersion,
    };
  }

  const info = readPidFile();
  if (!info) return base;

  const fromThisBoot = pidFileIsFromThisBoot(info);
  const alive = fromThisBoot && isProcessAlive(info.pid);
  return {
    ...base,
    pidFileExists: true,
    processAlive: alive,
    port: info.port,
    pid: info.pid,
    // Nothing answered on any port, so a PID file that survives is stale
    // whether its process is gone or merely wedged.
    stalePidFile: !alive || !fromThisBoot,
  };
}

export type { LastSnapshotCache };

/** The bridge to read from, without starting one. */
async function activeBridge(): Promise<{ port: number; token: string | null } | null> {
  const info = readPidFile();
  if (info) {
    const health = await probeHealth(info.port);
    if (isUsableBridge(health, getPackageVersion())) {
      return { port: info.port, token: info.token ?? null };
    }
  }
  const port = await findUsableBridge(candidatePorts());
  if (port === null) return null;
  return { port, token: readBridgeToken() };
}

/** Retrieve the most recent snapshot the bridge has cached, without triggering a new one. */
export async function getLastSnapshot(): Promise<LastSnapshotCache | null> {
  const bridge = await activeBridge();
  if (bridge === null) return null;
  try {
    const resp = await httpGet(bridge.port, "/last-snapshot", 2000, bridge.token);
    const data = JSON.parse(resp) as { error?: string } & Partial<LastSnapshotCache>;
    if (data.error || !data.raw) return null;
    return {
      raw: data.raw,
      pageUrl: data.pageUrl ?? null,
      capturedAt: data.capturedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export async function getSessionSnapshotIfRunning(): Promise<string | null> {
  const bridge = await activeBridge();
  if (bridge === null) return null;
  try {
    const resp = await httpPost(
      bridge.port,
      "/call",
      { name: "take_snapshot", args: {} },
      5000,
      undefined,
      bridge.token,
    );
    const data = JSON.parse(resp);
    if (data.error) return null;
    return data.result ?? null;
  } catch {
    return null;
  }
}
