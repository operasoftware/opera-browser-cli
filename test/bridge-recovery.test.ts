/**
 * Recovery from a bridge that goes away mid-session.
 *
 * The rule under test: a dropped connection is repaired silently for ordinary
 * calls, and never silently for the Opera AI tools, which may already have
 * acted on the page and are billable to re-run.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
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

  it("treats an unreachable browser target as a real failure, not a fake success", async () => {
    // The wedge: the bridge answers (stdio up) but the browser it was told to
    // drive is dead. Previously the CLI handed back the "Could not connect to
    // Chrome" text as if it were a successful result.
    const unreachable = join(HERE, "fixtures", "stub-mcp-unreachable.js");
    vi.stubEnv("OPERA_CLI_MCP_BIN", unreachable);
    vi.resetModules();
    client = await import("../src/client.js");

    await expect(client.callTool("take_snapshot", {})).rejects.toMatchObject({
      code: "BROWSER_ERROR",
    });
  }, 90_000);

  it("recovers from an unreachable browser when the rebuilt bridge reaches one", async () => {
    // First bridge points at a dead browser. Mid-test we repoint the env at a
    // healthy stub, so the recovery rebuild picks a working target and succeeds.
    const unreachable = join(HERE, "fixtures", "stub-mcp-unreachable.js");
    vi.stubEnv("OPERA_CLI_MCP_BIN", unreachable);
    vi.resetModules();
    client = await import("../src/client.js");

    // Ensure the wedged bridge exists up front.
    await client.ensureBridge();
    // Repoint to the healthy stub for the recovery rebuild.
    vi.stubEnv("OPERA_CLI_MCP_BIN", STUB_MCP);
    vi.resetModules();
    client = await import("../src/client.js");

    const result = await client.callTool("take_snapshot", {});
    expect(result).toBe("stub:take_snapshot");
  }, 90_000);

  it("reports a bridge as unusable when its attach target is unreachable", async () => {
    // A fake CDP endpoint that /health should probe. With it live the bridge is
    // usable; once it goes away, the CLI must stop reusing the bridge (the
    // agent-side wedge) and report it unhealthy.
    const cdp = createServer((req, res) => {
      if (req.url === "/json/version") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ Browser: "Opera/121.0.0.0" }));
      } else {
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) =>
      cdp.listen(0, "127.0.0.1", () => resolve()),
    );
    const browserPort = (cdp.address() as { port: number }).port;

    vi.stubEnv("OPERA_CLI_BROWSER_URL", `http://127.0.0.1:${browserPort}`);
    vi.resetModules();
    client = await import("../src/client.js");

    await client.ensureBridge();
    // Live target → the bridge is usable and reused.
    expect(await client.findUsableBridge(client.candidatePorts())).not.toBeNull();

    // Kill the browser target. The bridge's MCP-over-stdio link is still up, so
    // only the reachability probe can tell that it is wedged.
    await new Promise<void>((resolve) => cdp.close(() => resolve()));
    await new Promise((r) => setTimeout(r, 400));

    expect(await client.findUsableBridge(client.candidatePorts())).toBeNull();
    expect((await client.getBridgeStatus()).healthy).toBe(false);
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
