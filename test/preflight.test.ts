import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiError } from "axi-sdk-js";
import { mkdtempSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";

// The conflict-resolution path must run even when a bridge is already alive.
// Previously `preflightBrowser` returned early on `findUsableBridge !== null`,
// so a running browser (no debug port) was silently ignored and the restart
// prompt / separate-profile fallback never ran.
const mocks = vi.hoisted(() => ({
  findUsableBridge: vi.fn(),
  restartBridge: vi.fn(),
  getStateDir: vi.fn(),
}));

vi.mock("../src/client.js", () => ({
  CdpError: class CdpError extends AxiError {
    constructor(
      message: string,
      public readonly code: string,
      public readonly suggestions: string[] = [],
    ) {
      super(message, code, suggestions);
    }
  },
  candidatePorts: vi.fn(() => [9225]),
  ensureBridge: vi.fn(),
  findUsableBridge: mocks.findUsableBridge,
  getSessionSnapshotIfRunning: vi.fn(),
  getStateDir: mocks.getStateDir,
  loadConfig: vi.fn(),
  restartBridge: mocks.restartBridge,
  stopBridge: vi.fn(),
}));

vi.mock("../src/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config.js")>()),
  autoConfigure: vi.fn(() => ({ status: "already-configured" as const })),
}));

// Default to the real implementations (the first two tests rely on real
// profile-lock detection); the takeover test overrides them per-test and
// afterEach restores the originals.
vi.mock("../src/browser-target.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/browser-target.js")>();
  return {
    ...actual,
    quitBrowser: vi.fn(actual.quitBrowser),
    launchAttachableBrowser: vi.fn(actual.launchAttachableBrowser),
    resolveBrowserTarget: vi.fn(actual.resolveBrowserTarget),
  };
});

import { preflightBrowser } from "../src/cli.js";
import {
  launchAttachableBrowser,
  quitBrowser,
  resolveBrowserTarget,
} from "../src/browser-target.js";

describe("preflightBrowser reconciles even when a bridge is running", () => {
  let profile: string;

  beforeEach(() => {
    process.env.OPERA_CLI_HEADED = "1";
    mocks.getStateDir.mockReturnValue(profile = mkdtempSync(join(tmpdir(), "preflight-state-")));
    // A profile locked by a live local process, with NO debug port => conflict.
    const lockDir = mkdtempSync(join(tmpdir(), "preflight-profile-"));
    mkdirSync(lockDir, { recursive: true });
    symlinkSync(`${hostname()}-${process.pid}`, join(lockDir, "SingletonLock"));
    process.env.OPERA_CLI_USER_DATA_DIR = lockDir;
    delete process.env.OPERA_CLI_BROWSER_URL;
    process.env.OPERA_CLI_EXECUTABLE_PATH = "/fake/opera";
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveBrowserTarget).mockRestore();
    vi.mocked(quitBrowser).mockRestore();
    vi.mocked(launchAttachableBrowser).mockRestore();
    delete process.env.OPERA_CLI_USER_DATA_DIR;
    delete process.env.OPERA_CLI_BROWSER_URL;
    delete process.env.OPERA_CLI_EXECUTABLE_PATH;
    delete process.env.OPERA_CLI_HEADED;
  });

  it("resolves the conflict and REUSES a running bridge on the separate-profile path", async () => {
    mocks.findUsableBridge.mockResolvedValue(9225);

    const writes: string[] = [];
    const note = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: unknown) => {
        writes.push(String(s));
        return true;
      });
    try {
      await preflightBrowser(["open", "https://x"], false);
    } finally {
      note.mockRestore();
    }

    // The conflict is still settled (falls back to a separate profile), but the
    // running bridge is already on that separate profile, so it must be reused
    // — not reset, which would relaunch its browser on every command.
    expect(mocks.restartBridge).not.toHaveBeenCalled();
    expect(process.env.OPERA_CLI_USER_DATA_DIR).toContain("profile");
    expect(writes.join("\n")).not.toContain("browser selection changed");
    expect(writes.join("\n")).toContain("using");
  });

  it("does not reset the bridge when none is running", async () => {
    mocks.findUsableBridge.mockResolvedValue(null);

    const note = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await preflightBrowser(["open", "https://x"], false);
    } finally {
      note.mockRestore();
    }

    expect(mocks.restartBridge).not.toHaveBeenCalled();
  });

  it("restarts a running bridge after a takeover relaunches the browser", async () => {
    // A bridge is already running on some browser.
    mocks.findUsableBridge.mockResolvedValue(9225);

    // Takeover quits the profile-holder and relaunches it with a debug port.
    const launchedUrl = `http://127.0.0.1:59999`;
    vi.mocked(quitBrowser).mockResolvedValue({ ok: true });
    vi.mocked(launchAttachableBrowser).mockResolvedValue({
      ok: true,
      url: launchedUrl,
    });
    vi.mocked(resolveBrowserTarget).mockResolvedValue({
      mode: "conflict",
      userDataDir: process.env.OPERA_CLI_USER_DATA_DIR as string,
      lock: { pid: process.pid, state: "locked" as const },
    });

    const writes: string[] = [];
    const note = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((s: unknown) => {
        writes.push(String(s));
        return true;
      });
    try {
      await preflightBrowser(["open", "https://x"], true);
    } finally {
      note.mockRestore();
    }

    // The relaunch set a fresh BROWSER_URL, which the already-running bridge
    // (it fixed its browser at startup) does not reflect — so it must be
    // replaced, not silently reused to keep driving the old browser.
    expect(mocks.restartBridge).toHaveBeenCalled();
    expect(process.env.OPERA_CLI_BROWSER_URL).toBe(launchedUrl);
    expect(writes.join("\n")).toContain("browser selection changed");
  });
});
