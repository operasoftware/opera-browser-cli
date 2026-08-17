/**
 * The real bridge start path — actual child processes, actual ports — with a
 * stub MCP server in place of opera-devtools-mcp so no browser is launched.
 *
 * Covers the three things that used to fail silently: the startup handshake,
 * losing a port race, and several CLI processes starting at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageVersion } from "../src/version.js";

type ClientModule = typeof import("../src/client.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_MCP = join(HERE, "fixtures", "stub-mcp.js");

let home: string;
let basePort: number;
let client: ClientModule;
const blockers: TcpServer[] = [];

function pickBasePort(): number {
  return 42_000 + Math.floor(Math.random() * 100) * 10;
}

/**
 * Hold a port with a plain TCP listener that never speaks HTTP.
 *
 * Connections are dropped on arrival so a probe fails instantly rather than
 * waiting out its timeout, and so nothing is left open to stall teardown.
 */
function blockPort(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createTcpServer((socket) => socket.destroy());
    blockers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "obc-startup-"));
  basePort = pickBasePort();
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("OPERA_CLI_PORT", String(basePort));
  vi.stubEnv("OPERA_CLI_MCP_BIN", STUB_MCP);
  vi.resetModules();
  client = await import("../src/client.js");
});

afterEach(async () => {
  await client.stopBridge();
  await Promise.all(
    blockers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
}, 60_000);

describe("bridge startup", () => {
  it("starts a bridge and reports it as healthy", async () => {
    const port = await client.ensureBridge();

    expect(port).toBe(basePort);
    const status = await client.getBridgeStatus();
    expect(status.healthy).toBe(true);
    expect(status.versionSkew).toBe(false);
    expect(status.runningVersion).toBe(getPackageVersion());
    expect(status.port).toBe(basePort);
  }, 60_000);

  it("reuses a running bridge instead of starting a second one", async () => {
    const first = await client.ensureBridge();
    const second = await client.ensureBridge();

    expect(second).toBe(first);
    const status = await client.getBridgeStatus();
    expect(status.pid).not.toBeNull();
  }, 60_000);

  it("falls back to the next port when the base port is taken", async () => {
    // A plain TCP listener: it answers no HTTP, so the probe cannot recognise
    // it, and only the bridge's own EADDRINUSE handling can resolve the clash.
    await blockPort(basePort);

    const port = await client.ensureBridge();

    expect(port).toBe(basePort + 1);
  }, 60_000);

  it("skips over several occupied ports", async () => {
    await blockPort(basePort);
    await blockPort(basePort + 1);
    await blockPort(basePort + 2);

    const port = await client.ensureBridge();

    expect(port).toBe(basePort + 3);
  }, 90_000);

  it("starts exactly one bridge when several commands race", async () => {
    const results = await Promise.all([
      client.ensureBridge(),
      client.ensureBridge(),
      client.ensureBridge(),
      client.ensureBridge(),
      client.ensureBridge(),
    ]);

    // All five callers succeed, and all of them are pointed at the same bridge.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe(basePort);
  }, 90_000);

  it("restarts into a new process", async () => {
    await client.ensureBridge();
    const before = (await client.getBridgeStatus()).pid;

    await client.restartBridge();
    const after = await client.getBridgeStatus();

    expect(after.healthy).toBe(true);
    expect(after.pid).not.toBe(before);
  }, 90_000);

  it("stops cleanly and leaves no pid file", async () => {
    await client.ensureBridge();

    const result = await client.stopBridge();

    expect(result.stopped).toBe(true);
    expect(result.forced).toBe(false);
    expect((await client.getBridgeStatus()).pidFileExists).toBe(false);
  }, 60_000);
});

describe("log hygiene", () => {
  it("rotates an oversized bridge log instead of appending forever", async () => {
    const stateDir = join(home, ".opera-browser-cli");
    mkdirSync(stateDir, { recursive: true });
    const logFile = join(stateDir, "bridge.log");
    writeFileSync(logFile, "x".repeat(6 * 1024 * 1024));

    await client.ensureBridge();

    expect(existsSync(`${logFile}.1`)).toBe(true);
    expect(statSync(logFile).size).toBeLessThan(1024 * 1024);
  }, 60_000);
});

describe("bridge startup failures", () => {
  it("names the MCP server when it cannot be started", async () => {
    vi.stubEnv("OPERA_CLI_MCP_BIN", join(HERE, "fixtures", "no-such-mcp-binary"));

    await expect(client.ensureBridge()).rejects.toThrow(/opera-devtools-mcp/);
  }, 60_000);

  it("fails fast rather than waiting out the startup timeout", async () => {
    vi.stubEnv("OPERA_CLI_MCP_BIN", join(HERE, "fixtures", "no-such-mcp-binary"));

    const started = Date.now();
    await expect(client.ensureBridge()).rejects.toThrow();

    // The point of the handshake: a child that dies immediately is noticed
    // immediately, instead of costing the full 30s poll.
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

  it("suggests checking the bridge log", async () => {
    vi.stubEnv("OPERA_CLI_MCP_BIN", join(HERE, "fixtures", "no-such-mcp-binary"));

    await expect(client.ensureBridge()).rejects.toMatchObject({
      code: "BRIDGE_NOT_READY",
      suggestions: expect.arrayContaining([expect.stringContaining("logs")]),
    });
  }, 60_000);
});
