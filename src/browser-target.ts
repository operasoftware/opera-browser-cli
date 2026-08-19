/**
 * Decide what browser the bridge should talk to, before it starts.
 *
 * The constraint that shapes all of this: --remote-debugging-port is a
 * startup-only flag. A browser the user opened normally cannot be attached to,
 * ever. So there is no way to "connect to the Opera that is already open" —
 * only ways to arrange that the open Opera was started with a port in the first
 * place, and a way to detect it when it was.
 *
 * That gives three states for a configured profile:
 *
 *   free                        → let opera-devtools-mcp launch it, as before.
 *   locked, debug port live     → attach. No prompt, no restart, nothing to do.
 *   locked, no debug port       → a conflict only the user can resolve, by
 *                                 letting us restart their browser.
 *
 * The second case is the one that makes this feel automatic: once a browser has
 * been started with a port — by us, or by the user following `launch-args` —
 * every later command finds it on its own via DevToolsActivePort.
 */

import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  findAttachableEndpoint,
  inspectProfileLock,
  probeDevToolsEndpoint,
  readDevToolsPort,
  type ProfileLock,
} from "./profile.js";

export interface BrowserTargetContext {
  browserUrl?: string | undefined;
  userDataDir?: string | undefined;
  executablePath?: string | undefined;
}

export type BrowserTarget =
  /** Connect to a browser that is already running. */
  | { mode: "attach"; url: string; note: string }
  /** Let opera-devtools-mcp launch the browser, as it always has. */
  | { mode: "managed"; note: string }
  /** The profile is in use and we cannot reach the browser holding it. */
  | { mode: "conflict"; userDataDir: string; lock: ProfileLock };

export async function resolveBrowserTarget(
  ctx: BrowserTargetContext,
): Promise<BrowserTarget> {
  // An explicit browser URL is the user telling us they manage the browser.
  if (ctx.browserUrl) {
    return { mode: "attach", url: ctx.browserUrl, note: "OPERA_CLI_BROWSER_URL" };
  }

  // No persistent profile means an isolated one, which nothing else can hold.
  if (!ctx.userDataDir) {
    return { mode: "managed", note: "isolated profile" };
  }

  // A live debug port wins outright: the browser is running and reachable, so
  // there is no conflict to resolve regardless of what the lock says.
  const attachable = await findAttachableEndpoint(ctx.userDataDir);
  if (attachable !== null) {
    return {
      mode: "attach",
      url: attachable.url,
      note: `running ${attachable.identity.browser}`,
    };
  }

  const lock = inspectProfileLock(ctx.userDataDir);
  if (lock.state === "free") {
    return { mode: "managed", note: "profile is free" };
  }
  return { mode: "conflict", userDataDir: ctx.userDataDir, lock };
}

// ---------------------------------------------------------------------------
// Takeover
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface QuitResult {
  ok: boolean;
  reason?: "no-pid" | "timeout";
}

/**
 * Ask a running browser to quit, and wait for it to let go of the profile.
 *
 * SIGTERM only. Chromium treats it as a clean shutdown — session saved, profile
 * flushed — whereas SIGKILL risks a corrupted profile and loses the user's
 * tabs. If it will not go, we say so rather than escalating: this is somebody's
 * browser, and forcing it is not ours to decide.
 */
export async function quitBrowser(
  lock: ProfileLock,
  userDataDir: string,
  timeoutMs = 20_000,
): Promise<QuitResult> {
  if (lock.pid === null) return { ok: false, reason: "no-pid" };

  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // Already gone between inspection and now — that is a success.
    return { ok: true };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    if (inspectProfileLock(userDataDir).state === "free") return { ok: true };
  }
  return { ok: false, reason: "timeout" };
}

export interface LaunchResult {
  ok: boolean;
  url?: string;
  reason?: "no-executable" | "spawn-failed" | "timeout";
  detail?: string;
}

/**
 * Start a browser we can attach to, and that outlives us.
 *
 * `--remote-debugging-port=0` has Chromium pick a free port itself and record
 * it in DevToolsActivePort. That satisfies two requirements at once: we never
 * squat a predictable port like 9222, and the port is discoverable by every
 * later command without being written to any config.
 *
 * The browser is detached deliberately. Having just restarted the user's
 * browser, closing it again when the CLI's bridge stops would be a poor trade.
 */
export async function launchAttachableBrowser(
  executablePath: string | undefined,
  userDataDir: string,
  extraArgs: string[] = [],
  timeoutMs = 30_000,
): Promise<LaunchResult> {
  if (!executablePath || !existsSync(executablePath)) {
    return { ok: false, reason: "no-executable" };
  }

  // Chromium rewrites this on startup, but clearing it first means a stale port
  // from a previous run can never be mistaken for the new browser's.
  const portFile = join(userDataDir, "DevToolsActivePort");
  try {
    unlinkSync(portFile);
  } catch {
    // Absent already — fine.
  }

  const args = [
    "--remote-debugging-port=0",
    // Explicit even though it is the default: the debug port must never be
    // reachable from off-box.
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${userDataDir}`,
    // We just took their browser away; give the tabs back.
    "--restore-last-session",
    ...extraArgs,
  ];

  let child;
  try {
    child = spawn(executablePath, args, { stdio: "ignore", detached: true });
  } catch (error) {
    return {
      ok: false,
      reason: "spawn-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  child.unref();

  let spawnError: string | null = null;
  child.on("error", (error) => {
    spawnError = error.message;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError !== null) {
      return { ok: false, reason: "spawn-failed", detail: spawnError };
    }
    const port = readDevToolsPort(userDataDir);
    if (port !== null && (await probeDevToolsEndpoint(port)) !== null) {
      return { ok: true, url: `http://127.0.0.1:${port}` };
    }
    await sleep(250);
  }
  return { ok: false, reason: "timeout" };
}

/**
 * The flags a user needs to start Opera themselves so the CLI can attach.
 *
 * Deliberately not `--remote-allow-origins=*`: Chromium's default rejection of
 * CDP WebSocket upgrades that carry an Origin header is what stops a web page
 * from driving the browser, and this profile is logged into everything.
 */
export function browserLaunchArgs(userDataDir?: string): string[] {
  const args = [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
  ];
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  return args;
}
