/**
 * Bridge discovery and shutdown, exercised against real loopback servers and
 * real processes — no browser involved.
 *
 * The assertions that matter most here are the negative ones: that a PID we
 * have not positively identified is never signalled, and that a foreign server
 * is never touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { BRIDGE_SERVER_NAME, computeBootMinute } from "../src/identity.js";
import { getPackageVersion } from "../src/version.js";

type ClientModule = typeof import("../src/client.js");

let home: string;
let basePort: number;
let client: ClientModule;
const servers: Server[] = [];
const children: ChildProcess[] = [];

/** A base port unlikely to collide with anything else on the machine or in CI. */
function pickBasePort(): number {
  return 41_000 + Math.floor(Math.random() * 100) * 10;
}

function pidFilePath(): string {
  return join(home, ".opera-browser-cli", "bridge.pid");
}

function writePidFile(contents: Record<string, unknown>): void {
  mkdirSync(join(home, ".opera-browser-cli"), { recursive: true });
  writeFileSync(pidFilePath(), JSON.stringify(contents));
}

function bridgeHealth(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "ok",
    server: BRIDGE_SERVER_NAME,
    version: getPackageVersion(),
    pid: 0,
    startedAt: Date.now(),
    bootMinute: computeBootMinute(),
    browser: { connected: true },
    ...overrides,
  };
}

/** Stand in for a bridge on `port`, answering /health with whatever we say. */
function startFakeServer(port: number, payload: unknown): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") {
        res.statusCode = 200;
        res.end(JSON.stringify(payload));
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

interface Victim {
  pid: number;
  exited: Promise<void>;
  hasExited: () => boolean;
}

/** A real, long-lived process we can assert is — or crucially is not — killed. */
function startVictim(): Victim {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  children.push(child);
  let done = false;
  const exited = new Promise<void>((resolve) => {
    child.on("exit", () => {
      done = true;
      resolve();
    });
  });
  return { pid: child.pid!, exited, hasExited: () => done };
}

function settle(ms = 400): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "obc-lifecycle-"));
  basePort = pickBasePort();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("OPERA_CLI_PORT", String(basePort));
  vi.resetModules();
  // Imported after HOME is stubbed: the state dir is resolved at module load.
  client = await import("../src/client.js");
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("PID recycling safety", () => {
  it("never signals a PID recorded on a previous boot", async () => {
    // The exact post-reboot shape: the PID file survives, the number in it now
    // belongs to somebody else's process. Signalling it would kill a stranger.
    const victim = startVictim();
    writePidFile({
      pid: victim.pid,
      port: basePort,
      token: "stale-token",
      version: getPackageVersion(),
      startedAt: 0,
      bootMinute: 1, // long before this machine booted
    });

    const result = await client.stopBridge();

    expect(result.stale).toBe(true);
    expect(result.stopped).toBe(false);
    await settle();
    expect(victim.hasExited()).toBe(false);
    // ...and the misleading file is cleared so it cannot mislead twice.
    expect(existsSync(pidFilePath())).toBe(false);
  });

  it("does signal a PID recorded on this boot", async () => {
    const victim = startVictim();
    writePidFile({
      pid: victim.pid,
      port: basePort,
      token: "t",
      version: getPackageVersion(),
      startedAt: Date.now(),
      bootMinute: computeBootMinute(),
    });

    const result = await client.stopBridge();

    expect(result.stopped).toBe(true);
    expect(result.pid).toBe(victim.pid);
    await victim.exited;
  });

  it("reports a stale pid file through getBridgeStatus without signalling", async () => {
    const victim = startVictim();
    writePidFile({
      pid: victim.pid,
      port: basePort,
      bootMinute: 1,
    });

    const status = await client.getBridgeStatus();

    expect(status.stalePidFile).toBe(true);
    expect(status.processAlive).toBe(false);
    await settle(150);
    expect(victim.hasExited()).toBe(false);
  });
});

describe("version skew", () => {
  it("refuses a bridge running different code and shuts it down", async () => {
    // A pre-upgrade bridge answers /health perfectly while serving stale code.
    const victim = startVictim();
    await startFakeServer(
      basePort,
      bridgeHealth({ version: "0.0.1-old", pid: victim.pid }),
    );

    const found = await client.findUsableBridge(client.candidatePorts());

    expect(found).toBeNull();
    await victim.exited;
  });

  it("accepts a bridge on our version", async () => {
    await startFakeServer(basePort, bridgeHealth({ pid: process.pid }));

    expect(await client.findUsableBridge(client.candidatePorts())).toBe(basePort);
  });

  it("surfaces the skew in getBridgeStatus", async () => {
    await startFakeServer(
      basePort,
      bridgeHealth({ version: "0.0.1-old", pid: process.pid }),
    );

    const status = await client.getBridgeStatus();

    expect(status.versionSkew).toBe(true);
    expect(status.healthy).toBe(false);
    expect(status.runningVersion).toBe("0.0.1-old");
    expect(status.expectedVersion).toBe(getPackageVersion());
  });
});

describe("port discovery", () => {
  it("finds a bridge that landed on a fallback port", async () => {
    await startFakeServer(basePort + 3, bridgeHealth({ pid: process.pid }));

    expect(await client.findUsableBridge(client.candidatePorts())).toBe(basePort + 3);
  });

  it("prefers the port named in the pid file", async () => {
    await startFakeServer(basePort + 1, bridgeHealth({ pid: process.pid }));
    await startFakeServer(basePort + 5, bridgeHealth({ pid: process.pid }));
    writePidFile({ pid: process.pid, port: basePort + 5, bootMinute: computeBootMinute() });

    expect(await client.findUsableBridge(client.candidatePorts())).toBe(basePort + 5);
  });

  it("ignores a foreign server and leaves it running", async () => {
    const foreign = await startFakeServer(basePort, {
      status: "ok",
      server: "some-other-dev-server",
    });

    expect(await client.findUsableBridge(client.candidatePorts())).toBeNull();
    expect(foreign.listening).toBe(true);
  });

  it("treats an unparseable /health as not ours", async () => {
    await startFakeServer(basePort, "<html>hello</html>");

    expect(await client.findUsableBridge(client.candidatePorts())).toBeNull();
  });
});

describe("stopBridge", () => {
  it("is a no-op when nothing is running", async () => {
    const result = await client.stopBridge();

    expect(result).toMatchObject({ stopped: false, stale: false, pid: null });
  });

  it("stops a live bridge found by port scan even with no pid file", async () => {
    const victim = startVictim();
    await startFakeServer(basePort + 2, bridgeHealth({ pid: victim.pid }));

    const result = await client.stopBridge();

    expect(result.stopped).toBe(true);
    expect(result.port).toBe(basePort + 2);
    await victim.exited;
  });
});
