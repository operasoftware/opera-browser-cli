/**
 * First-run configuration and config-file hygiene.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KNOWN_CONFIG_KEYS,
  findUnknownConfigKeys,
} from "../src/config.js";
import {
  browserDisplayName,
  detectBrowser,
  detectBrowsers,
  neonCandidatePaths,
} from "../src/detect.js";

type ConfigModule = typeof import("../src/config.js");

let home: string;
let config: ConfigModule;

/** A fake filesystem predicate so detection can be tested off-machine. */
function existsOnly(...paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

const NEON = "/Applications/Opera Neon.app/Contents/MacOS/Opera";
const OPERA = "/Applications/Opera.app/Contents/MacOS/Opera";

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "obc-config-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("OPERA_CLI_EXECUTABLE_PATH", "");
  vi.stubEnv("OPERA_CLI_BROWSER_URL", "");
  delete process.env.OPERA_CLI_EXECUTABLE_PATH;
  delete process.env.OPERA_CLI_BROWSER_URL;
  vi.resetModules();
  config = await import("../src/config.js");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("detectBrowsers", () => {
  it("prefers Opera Neon over plain Opera", () => {
    const found = detectBrowsers("darwin", home, existsOnly(NEON, OPERA));

    expect(found[0]).toMatchObject({ path: NEON, isNeon: true });
    expect(found[1]).toMatchObject({ path: OPERA, isNeon: false });
  });

  it("falls back to plain Opera when Neon is absent", () => {
    const found = detectBrowser("darwin", home, existsOnly(OPERA));

    expect(found).toMatchObject({ name: "Opera", isNeon: false });
  });

  it("finds nothing on Linux, where Opera Neon does not ship", () => {
    expect(neonCandidatePaths("linux", home)).toEqual([]);
    expect(detectBrowser("linux", home, () => true)).toBeNull();
  });

  it("returns null when nothing is installed", () => {
    expect(detectBrowser("darwin", home, () => false)).toBeNull();
  });

  it("names the Developer build distinctly", () => {
    expect(browserDisplayName("/Applications/Opera Neon Developer.app/x")).toBe(
      "Opera Neon Developer",
    );
    expect(browserDisplayName("/Applications/Opera GX.app/x")).toBe("Opera GX");
  });
});

describe("computeAutoConfig", () => {
  it("configures a fresh machine from a detected browser", () => {
    const result = config.computeAutoConfig({
      home,
      platform: "darwin",
      exists: existsOnly(NEON),
    });

    expect(result.status).toBe("configured");
    if (result.status !== "configured") return;
    expect(result.browser.isNeon).toBe(true);
    expect(result.settings.OPERA_CLI_EXECUTABLE_PATH).toBe(NEON);
    // Headed, because sign-in and every Opera AI feature need a window.
    expect(result.settings.OPERA_CLI_HEADED).toBe("1");
    expect(result.settings.OPERA_CLI_USER_DATA_DIR).toBeTruthy();
  });

  it("prefers the browser's real profile over a private one", () => {
    // The point of using Opera is the session you are already signed in to.
    // A profile that turns out to be in use is resolved at launch time.
    const realProfile = join(home, "Library", "Application Support", "com.operasoftware.OperaNeon");
    mkdirSync(realProfile, { recursive: true });

    const result = config.computeAutoConfig({
      home,
      platform: "darwin",
      exists: (p) => p === NEON || existsSync(p),
    });

    expect(result.status).toBe("configured");
    if (result.status !== "configured") return;
    expect(result.settings.OPERA_CLI_USER_DATA_DIR).toBe(realProfile);
  });

  it("falls back to a CLI-owned profile when there is no real one", () => {
    const result = config.computeAutoConfig({
      home,
      platform: "darwin",
      exists: existsOnly(NEON),
    });

    expect(result.status).toBe("configured");
    if (result.status !== "configured") return;
    expect(result.settings.OPERA_CLI_USER_DATA_DIR).toContain(".opera-browser-cli");
  });

  it("does nothing when a config file already exists", () => {
    config.writeConfigFile({ OPERA_CLI_HEADED: "1" });

    expect(
      config.computeAutoConfig({ home, platform: "darwin", exists: () => true }),
    ).toEqual({ status: "already-configured" });
  });

  it("does nothing when the environment already points at a browser", () => {
    vi.stubEnv("OPERA_CLI_EXECUTABLE_PATH", NEON);

    expect(
      config.computeAutoConfig({ home, platform: "darwin", exists: existsOnly(NEON) }),
    ).toEqual({ status: "already-configured" });
  });

  it("reports no-browser rather than writing a useless config", () => {
    expect(
      config.computeAutoConfig({ home, platform: "darwin", exists: () => false }),
    ).toEqual({ status: "no-browser" });
  });
});

describe("autoConfigure", () => {
  it("writes the config and applies it to this process", () => {
    const result = config.autoConfigure({
      home,
      platform: "darwin",
      exists: existsOnly(NEON),
    });

    expect(result.status).toBe("configured");
    expect(existsSync(join(home, ".opera-browser-cli", "config"))).toBe(true);
    // Applied in-process too, so the very first command benefits.
    expect(process.env.OPERA_CLI_EXECUTABLE_PATH).toBe(NEON);
  });

  it("never overwrites a value already set in the environment", () => {
    vi.stubEnv("OPERA_CLI_HEADED", "0");

    config.autoConfigure({ home, platform: "darwin", exists: existsOnly(NEON) });

    expect(process.env.OPERA_CLI_HEADED).toBe("0");
  });

  it("still applies settings when the config file cannot be written", () => {
    rmSync(home, { recursive: true, force: true });
    writeFileSync(home, "not a directory");

    const result = config.autoConfigure({
      home,
      platform: "darwin",
      exists: existsOnly(NEON),
    });

    expect(result.status).toBe("configured");
    expect(process.env.OPERA_CLI_EXECUTABLE_PATH).toBe(NEON);
  });
});

describe("findUnknownConfigKeys", () => {
  it("accepts every documented key", () => {
    const all = Object.fromEntries(KNOWN_CONFIG_KEYS.map((k) => [k, "x"]));

    expect(findUnknownConfigKeys(all)).toEqual([]);
  });

  it("suggests the intended key for a typo", () => {
    // Silently ignored at load time and looks correct in the file — the only
    // place this can surface is a check like this one.
    const found = findUnknownConfigKeys({ OPERA_CLI_EXEC_PATH: "/x" });

    expect(found).toHaveLength(1);
    expect(found[0]?.suggestion).toBe("OPERA_CLI_EXECUTABLE_PATH");
  });

  it("flags an unrelated key without a misleading suggestion", () => {
    const found = findUnknownConfigKeys({ TOTALLY_UNRELATED_THING: "1" });

    expect(found).toHaveLength(1);
    expect(found[0]?.suggestion).toBeNull();
  });
});

describe("config file round-trip", () => {
  it("preserves values containing quotes", () => {
    config.writeConfigFile({ OPERA_CLI_CHROME_ARGS: '--flag="value"' });

    expect(config.readConfigFile().OPERA_CLI_CHROME_ARGS).toBe('--flag="value"');
  });

  it("patches without disturbing other keys", () => {
    config.writeConfigFile({ OPERA_CLI_HEADED: "1", OPERA_CLI_PORT: "9225" });

    config.updateConfigFile({ OPERA_CLI_PORT: null, OPERA_CLI_BROWSER_URL: "http://x" });

    expect(config.readConfigFile()).toEqual({
      OPERA_CLI_HEADED: "1",
      OPERA_CLI_BROWSER_URL: "http://x",
    });
  });

  it("treats an unreadable config as absent rather than failing", () => {
    mkdirSync(join(home, ".opera-browser-cli", "config"), { recursive: true });

    expect(config.readConfigFile()).toEqual({});
  });
});
