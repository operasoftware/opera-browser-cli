/**
 * Recovery from a bridge that goes away mid-session.
 *
 * The rule under test: a dropped connection is repaired silently for ordinary
 * calls, and never silently for the Opera AI tools, which may already have
 * acted on the page and are billable to re-run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type ClientModule = typeof import("../src/client.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_MCP = join(HERE, "fixtures", "stub-mcp.js");

let home: string;
let basePort: number;
let client: ClientModule;

function pickBasePort(): number {
  return 43_000 + Math.floor(Math.random() * 100) * 10;
}

function pidFilePath(): string {
  return join(home, ".opera-browser-cli", "bridge.pid");
}

/** Kill the running bridge and its children outright, as a crash would. */
async function crashBridge(): Promise<number> {
  const status = await client.getBridgeStatus();
  const pid = status.pid!;
  try {
    process.kill(-pid, "SIGKILL"); // the bridge leads its own process group
  } catch {
    process.kill(pid, "SIGKILL");
  }
  // Wait for the port to actually go quiet.
  for (let i = 0; i < 50; i++) {
    if (!(await client.getBridgeStatus()).processAlive) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pid;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "obc-recovery-"));
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
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
}, 60_000);

describe("recovery from a dropped bridge", () => {
  it("restarts and replays an ordinary tool call", async () => {
    await client.ensureBridge();
    const deadPid = await crashBridge();

    // No manual restart, no error surfaced to the caller.
    const result = await client.callTool("take_snapshot");

    expect(result).toBe("stub:take_snapshot");
    const status = await client.getBridgeStatus();
    expect(status.healthy).toBe(true);
    expect(status.pid).not.toBe(deadPid);
  }, 90_000);

  it("recovers from a stale auth token by reissuing one", async () => {
    await client.ensureBridge();

    // The shape this takes in the wild: the pid file and the running bridge
    // disagree about the token, so every call comes back 401.
    const info = JSON.parse(readFileSync(pidFilePath(), "utf-8"));
    writeFileSync(pidFilePath(), JSON.stringify({ ...info, token: "wrong-token" }));

    const result = await client.callTool("take_snapshot");

    expect(result).toBe("stub:take_snapshot");
  }, 90_000);

  it("does not replay opera_do when the bridge dies mid-call", async () => {
    // The dangerous case: the tool was already running, so it may have booked
    // the table before the bridge went away. Re-running it must be the user's
    // call, not ours.
    await client.ensureBridge();
    const call = client.callTool("opera_do", { prompt: "book a table" });
    setTimeout(() => void crashBridge(), 500);

    await expect(call).rejects.toThrow(/not retried automatically/);
  }, 90_000);

  it("tells the user to re-run rather than leaving them guessing", async () => {
    await client.ensureBridge();
    const call = client.callTool("opera_make", { prompt: "a todo app" });
    setTimeout(() => void crashBridge(), 500);

    await expect(call).rejects.toMatchObject({
      code: "BRIDGE_NOT_READY",
      suggestions: expect.arrayContaining([expect.stringContaining("Re-run")]),
    });
  }, 90_000);

  it("runs an AI tool normally when the bridge was already down", async () => {
    // Distinct from the case above: nothing had started, so there is no risk of
    // a double booking. Starting a bridge and running it once is the whole job.
    await client.ensureBridge();
    await crashBridge();

    await expect(client.callTool("opera_do", { prompt: "book a table" })).resolves.toBe(
      "stub:opera_do",
    );
  }, 90_000);

  it("gives up with a clear error when the bridge cannot come back", async () => {
    await client.ensureBridge();
    await crashBridge();
    // Break the restart too, so recovery has nowhere to go.
    vi.stubEnv("OPERA_CLI_MCP_BIN", join(HERE, "fixtures", "no-such-mcp-binary"));

    await expect(client.callTool("take_snapshot")).rejects.toThrow(
      /opera-devtools-mcp/,
    );
  }, 90_000);

  it("leaves no pid file behind after a crash and recovery cycle", async () => {
    await client.ensureBridge();
    await crashBridge();
    await client.callTool("take_snapshot");
    await client.stopBridge();

    expect(existsSync(pidFilePath())).toBe(false);
  }, 90_000);
});
