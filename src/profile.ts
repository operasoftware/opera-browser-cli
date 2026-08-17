/**
 * Browser profile inspection — is this user-data-dir in use, and if so, can we
 * talk to the browser that holds it?
 *
 * Chromium refuses to start a second instance on a user-data-dir that is
 * already open: it hands its command line to the running instance through a
 * singleton socket and exits. Launching into a live profile therefore does not
 * fail loudly, it fails as "the browser we asked for never appeared" — which is
 * why this has to be detected before launch rather than diagnosed after it.
 *
 * Two files in the user-data-dir root tell us what we need:
 *
 *   SingletonLock       a symlink whose target is "<hostname>-<pid>" (POSIX).
 *                       Present and live => the profile is in use.
 *   DevToolsActivePort  written whenever the browser was started with
 *                       --remote-debugging-port. Line 1 is the port. Its
 *                       presence is what makes attaching to an already-running
 *                       browser possible without any configuration.
 *
 * Neither file is authoritative on its own: SingletonLock outlives a crash, and
 * DevToolsActivePort outlives a clean exit. Both are confirmed against the live
 * system before being acted on.
 */

import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

export type ProfileLockState =
  /** No lock file, or the lock belongs to a process that is gone. */
  | "free"
  /** A live process on this machine holds the profile. */
  | "locked"
  /** A lock exists but we cannot attribute it — another host, or unreadable. */
  | "unknown";

export interface ProfileLock {
  state: ProfileLockState;
  /** The owning browser process, when the lock names one we can verify. */
  pid: number | null;
  hostname: string | null;
}

/**
 * Split a SingletonLock target into hostname and pid.
 *
 * The hostname routinely contains dashes ("Someones-MacBook-Pro-24601"), so the
 * split has to come from the right.
 */
export function parseSingletonTarget(
  target: string,
): { hostname: string; pid: number } | null {
  const split = target.lastIndexOf("-");
  if (split <= 0) return null;
  const pid = Number.parseInt(target.slice(split + 1), 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { hostname: target.slice(0, split), pid };
}

/** First line of DevToolsActivePort is the port; the second is a ws path. */
export function parseDevToolsActivePort(contents: string): number | null {
  const first = contents.split("\n")[0]?.trim() ?? "";
  const port = Number.parseInt(first, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  return port;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Determine whether a user-data-dir is currently held by a running browser.
 *
 * A dangling lock reads as "free": Chromium cleans those up itself on the next
 * launch, so treating one as a conflict would block a launch that would in fact
 * succeed.
 */
export function inspectProfileLock(
  userDataDir: string,
  aliveCheck: (pid: number) => boolean = isProcessAlive,
): ProfileLock {
  const lockPath = join(userDataDir, "SingletonLock");

  let target: string;
  try {
    // lstat, not stat: the link is expected to dangle after a crash, and a
    // dangling symlink is exactly the case we want to report as free.
    if (!lstatSync(lockPath).isSymbolicLink()) {
      // Windows writes a regular file instead of a symlink. We can see that the
      // profile is claimed but not by whom.
      return { state: "unknown", pid: null, hostname: null };
    }
    target = readlinkSync(lockPath);
  } catch {
    return { state: "free", pid: null, hostname: null };
  }

  const parsed = parseSingletonTarget(target);
  if (parsed === null) return { state: "unknown", pid: null, hostname: null };

  // A lock written by a different machine (a synced or networked profile) says
  // nothing about processes here, and its pid must never be signalled.
  if (parsed.hostname !== hostname()) {
    return { state: "unknown", pid: null, hostname: parsed.hostname };
  }
  if (!aliveCheck(parsed.pid)) {
    return { state: "free", pid: null, hostname: parsed.hostname };
  }
  return { state: "locked", pid: parsed.pid, hostname: parsed.hostname };
}

/** The debug port a running browser advertised, if it was given one. */
export function readDevToolsPort(userDataDir: string): number | null {
  const portFile = join(userDataDir, "DevToolsActivePort");
  try {
    if (!existsSync(portFile)) return null;
    return parseDevToolsActivePort(readFileSync(portFile, "utf-8"));
  } catch {
    return null;
  }
}

export interface DevToolsIdentity {
  /** e.g. "Opera/121.0.0.0" or "Chrome/141.0.0.0" */
  browser: string;
  isOpera: boolean;
}

/**
 * Confirm a debug port is live and find out what is on the other end.
 *
 * DevToolsActivePort survives a clean exit, so a recorded port proves nothing
 * until something answers on it.
 */
export function probeDevToolsEndpoint(
  port: number,
  timeoutMs = 1500,
): Promise<DevToolsIdentity | null> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/json/version",
        method: "GET",
        timeout: timeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body) as { Browser?: unknown };
            if (typeof parsed.Browser !== "string") return resolve(null);
            resolve({
              browser: parsed.Browser,
              isOpera: /opera|opr\//i.test(parsed.Browser),
            });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

/**
 * The browser URL to attach to for this profile, or null if there is nothing
 * live to attach to.
 */
export async function findAttachableEndpoint(
  userDataDir: string,
): Promise<{ url: string; identity: DevToolsIdentity } | null> {
  const port = readDevToolsPort(userDataDir);
  if (port === null) return null;
  const identity = await probeDevToolsEndpoint(port);
  if (identity === null) return null;
  return { url: `http://127.0.0.1:${port}`, identity };
}

// ---------------------------------------------------------------------------
// Default profile locations
// ---------------------------------------------------------------------------

/** Where the given Opera build keeps its real profile, if we can find it. */
export function defaultProfileDir(
  browserPath: string | undefined,
  home: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  let candidate: string;
  if (platform === "darwin") {
    const isDeveloper = browserPath?.includes("Opera Neon Developer.app") ?? false;
    const bundle = isDeveloper
      ? "com.operasoftware.OperaNeonDeveloper"
      : "com.operasoftware.OperaNeon";
    candidate = `${home}/Library/Application Support/${bundle}`;
  } else if (platform === "win32") {
    const appData = process.env.APPDATA ?? `${home}\\AppData\\Roaming`;
    const isDeveloper = browserPath?.includes("Developer") ?? false;
    candidate = isDeveloper
      ? `${appData}\\Opera Software\\Opera Neon Developer`
      : `${appData}\\Opera Software\\Opera Neon`;
  } else {
    return null;
  }
  return existsSync(candidate) ? candidate : null;
}
