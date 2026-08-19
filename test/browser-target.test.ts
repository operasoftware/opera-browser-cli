/**
 * Choosing between launching a browser and attaching to one, and the takeover
 * that resolves the case where neither is possible.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import {
  browserLaunchArgs,
  launchAttachableBrowser,
  quitBrowser,
  resolveBrowserTarget,
} from "../src/browser-target.js";
import { inspectProfileLock } from "../src/profile.js";

let dir: string;
const servers: Server[] = [];
const children: ChildProcess[] = [];

function pickPort(): number {
  return 45_000 + Math.floor(Math.random() * 1_000);
}

function startDevToolsStub(port: number, browser: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/json/version") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ Browser: browser }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function writeLock(pid: number): void {
  symlinkSync(`${hostname()}-${pid}`, join(dir, "SingletonLock"));
}

function writePortFile(port: number): void {
  writeFileSync(join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/x\n`);
}

/**
 * A process that holds the profile lock the way a browser does, and releases it
 * on SIGTERM. `stubborn` ignores SIGTERM, standing in for a browser that hangs.
 */
function startLockHolder(stubborn = false): ChildProcess {
  const lockPath = join(dir, "SingletonLock");
  const script = `
    const fs = require("fs");
    const os = require("os");
    fs.symlinkSync(os.hostname() + "-" + process.pid, process.argv[1]);
    process.on("SIGTERM", () => {
      if (${stubborn}) return;
      try { fs.unlinkSync(process.argv[1]); } catch {}
      process.exit(0);
    });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ["-e", script, lockPath], { stdio: "ignore" });
  children.push(child);
  return child;
}

async function waitForLock(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    // lstat, not existsSync: the lock is a symlink to "<hostname>-<pid>", which
    // is not a real path, so existsSync follows it and reports false.
    try {
      lstatSync(join(dir, "SingletonLock"));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw new Error("lock holder never took the lock");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "obc-target-"));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveBrowserTarget", () => {
  it("honours an explicit browser URL", async () => {
    const target = await resolveBrowserTarget({
      browserUrl: "http://127.0.0.1:9222",
      userDataDir: dir,
    });

    expect(target).toMatchObject({ mode: "attach", url: "http://127.0.0.1:9222" });
  });

  it("uses a managed launch when no profile is configured", async () => {
    // An isolated profile cannot be held by anything else.
    expect(await resolveBrowserTarget({})).toMatchObject({ mode: "managed" });
  });

  it("uses a managed launch when the profile is free", async () => {
    expect(await resolveBrowserTarget({ userDataDir: dir })).toMatchObject({
      mode: "managed",
    });
  });

  it("attaches to a running browser that exposes a debug port", async () => {
    // The case that makes this feel automatic: no prompt, no restart.
    const port = pickPort();
    await startDevToolsStub(port, "Opera/121.0.0.0");
    writePortFile(port);
    writeLock(process.pid);

    const target = await resolveBrowserTarget({ userDataDir: dir });

    expect(target).toMatchObject({
      mode: "attach",
      url: `http://127.0.0.1:${port}`,
    });
  });

  it("reports a conflict when the profile is held with no debug port", async () => {
    writeLock(process.pid);

    const target = await resolveBrowserTarget({ userDataDir: dir });

    expect(target.mode).toBe("conflict");
    expect(target).toMatchObject({ lock: { state: "locked", pid: process.pid } });
  });

  it("does not attach on a stale port file left by an exited browser", async () => {
    writePortFile(pickPort()); // nothing listening
    writeLock(process.pid);

    expect((await resolveBrowserTarget({ userDataDir: dir })).mode).toBe("conflict");
  });

  it("attaches even when the lock cannot be attributed, if the port is live", async () => {
    // A profile locked by another host is 'unknown', but a live debug port
    // settles the question regardless of what the lock says.
    const port = pickPort();
    await startDevToolsStub(port, "Opera/121.0.0.0");
    writePortFile(port);
    symlinkSync("some-other-host-4242", join(dir, "SingletonLock"));

    expect((await resolveBrowserTarget({ userDataDir: dir })).mode).toBe("attach");
  });
});

describe("quitBrowser", () => {
  it("stops a browser gracefully and waits for the profile to be released", async () => {
    const holder = startLockHolder();
    await waitForLock();

    const result = await quitBrowser(
      { state: "locked", pid: holder.pid!, hostname: hostname() },
      dir,
    );

    expect(result.ok).toBe(true);
    expect(inspectProfileLock(dir).state).toBe("free");
  }, 30_000);

  it("reports rather than escalating when the browser will not quit", async () => {
    // SIGKILL on a browser risks a corrupted profile and loses the user's
    // tabs, so a stubborn browser is reported, never forced.
    const holder = startLockHolder(true);
    await waitForLock();

    const result = await quitBrowser(
      { state: "locked", pid: holder.pid!, hostname: hostname() },
      dir,
      1_500,
    );

    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(holder.exitCode).toBeNull(); // still alive — we did not kill it
  }, 30_000);

  it("refuses to signal when the lock names no usable pid", async () => {
    const result = await quitBrowser(
      { state: "unknown", pid: null, hostname: "other-host" },
      dir,
    );

    expect(result).toEqual({ ok: false, reason: "no-pid" });
  });
});

describe("launchAttachableBrowser", () => {
  it("reports a missing executable instead of spawning nothing", async () => {
    const result = await launchAttachableBrowser(
      join(dir, "no-such-browser"),
      dir,
    );

    expect(result).toEqual({ ok: false, reason: "no-executable" });
  });

  it("reports no-executable when the path is unset", async () => {
    expect(await launchAttachableBrowser(undefined, dir)).toEqual({
      ok: false,
      reason: "no-executable",
    });
  });
});

describe("browserLaunchArgs", () => {
  it("lets the browser choose its own port", () => {
    // Port 0 means Chromium picks a free one and records it in
    // DevToolsActivePort — so we never squat a predictable port like 9222.
    expect(browserLaunchArgs()).toContain("--remote-debugging-port=0");
  });

  it("binds the debug port to loopback", () => {
    expect(browserLaunchArgs()).toContain("--remote-debugging-address=127.0.0.1");
  });

  it("never opens CDP to web origins", () => {
    // --remote-allow-origins=* would let any page drive a browser that is
    // logged into everything the user is.
    expect(browserLaunchArgs("/tmp/profile").join(" ")).not.toContain(
      "remote-allow-origins",
    );
  });

  it("includes the profile when one is given", () => {
    expect(browserLaunchArgs("/tmp/profile")).toContain("--user-data-dir=/tmp/profile");
  });
});
