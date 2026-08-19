/**
 * Reading, writing, validating, and — on a fresh machine — inventing the
 * configuration file.
 *
 * The guiding rule: config is a cache of decisions, not a prerequisite. A user
 * who has never run `setup` should get a working browser on their first
 * command, not a hint telling them to go and configure something. Detection is
 * cheap and unambiguous on the platforms Opera ships for, so there is nothing
 * worth asking about up front.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfigFile, getStateDir, parseConfigValue } from "./client.js";
import { detectBrowser, type DetectedBrowser } from "./detect.js";
import { defaultProfileDir } from "./profile.js";

/**
 * Every variable the CLI reads. Used to catch typos, which otherwise sit in the
 * config file doing nothing and looking correct.
 */
export const KNOWN_CONFIG_KEYS = [
  "OPERA_CLI_PORT",
  "OPERA_CLI_MCP_BIN",
  "OPERA_CLI_EXECUTABLE_PATH",
  "OPERA_CLI_BROWSER_URL",
  "OPERA_CLI_USER_DATA_DIR",
  "OPERA_CLI_HEADED",
  "OPERA_CLI_CHROME_ARGS",
  "OPERA_CLI_ENABLE_HOOKS",
  "OPERA_CLI_TAKEOVER",
  "OPERA_CLI_DEV",
] as const;

/** Levenshtein distance, capped — only used to suggest a corrected key. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const curr = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j++) {
      curr[j] = Math.min(
        prev[j]! + 1,
        curr[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[cols - 1]!;
}

export interface UnknownKey {
  key: string;
  suggestion: string | null;
}

/** Config keys the CLI does not read, with a likely intended key where obvious. */
export function findUnknownConfigKeys(
  config: Record<string, string>,
): UnknownKey[] {
  const known = new Set<string>(KNOWN_CONFIG_KEYS);
  const unknown: UnknownKey[] = [];
  for (const key of Object.keys(config)) {
    if (known.has(key)) continue;
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of KNOWN_CONFIG_KEYS) {
      const distance = editDistance(key, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    // Scale the tolerance with key length. A fixed threshold is too tight for
    // the common abbreviation typo (EXEC_PATH for EXECUTABLE_PATH is six
    // edits) while still being loose enough to "suggest" a wholly unrelated
    // key, which is worse than saying nothing.
    const tolerance = Math.max(4, Math.ceil(key.length / 3));
    unknown.push({ key, suggestion: bestDistance <= tolerance ? best : null });
  }
  return unknown;
}

export function readConfigFile(): Record<string, string> {
  const configFile = getConfigFile();
  const config: Record<string, string> = {};
  if (!existsSync(configFile)) return config;
  try {
    for (const line of readFileSync(configFile, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      config[trimmed.slice(0, eq).trim()] = parseConfigValue(
        trimmed.slice(eq + 1).trim(),
      );
    }
  } catch {
    // Unreadable config is treated as absent — never fail a command over it.
  }
  return config;
}

export function writeConfigFile(config: Record<string, string>): void {
  mkdirSync(getStateDir(), { recursive: true });
  const lines = [
    "# opera-browser-cli configuration — auto-loaded on every run",
    "# Values here are used as defaults when the env var is not already set.",
    "",
    ...Object.entries(config).map(
      ([key, value]) => `${key}="${value.replace(/"/g, '\\"')}"`,
    ),
  ];
  writeFileSync(getConfigFile(), lines.join("\n") + "\n");
}

/** Apply a patch to the config file. A null value removes the key. */
export function updateConfigFile(patch: Record<string, string | null>): void {
  const config = readConfigFile();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete config[key];
    else config[key] = value;
  }
  writeConfigFile(config);
}

// ---------------------------------------------------------------------------
// First-run autoconfiguration
// ---------------------------------------------------------------------------

export interface AutoConfigureOptions {
  home?: string;
  platform?: NodeJS.Platform;
  exists?: (path: string) => boolean;
  /** Write the result to disk. Off for previewing what would happen. */
  persist?: boolean;
}

export type AutoConfigureResult =
  | { status: "already-configured" }
  | { status: "no-browser" }
  | {
      status: "configured";
      browser: DetectedBrowser;
      settings: Record<string, string>;
    };

/**
 * Decide the settings for a machine that has never been configured.
 *
 * Chooses the browser's real profile when there is one, rather than a private
 * CLI profile: the point of using Opera is the session you are already signed
 * in to. A profile that turns out to be in use is resolved at launch time —
 * see `browser-target.ts` — so preferring it here costs nothing.
 */
export function computeAutoConfig(
  options: AutoConfigureOptions = {},
): AutoConfigureResult {
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const exists = options.exists ?? existsSync;

  const alreadyConfigured =
    exists(getConfigFile()) ||
    Boolean(process.env.OPERA_CLI_EXECUTABLE_PATH) ||
    Boolean(process.env.OPERA_CLI_BROWSER_URL);
  if (alreadyConfigured) return { status: "already-configured" };

  const browser = detectBrowser(platform, home, exists);
  if (browser === null) return { status: "no-browser" };

  const settings: Record<string, string> = {
    OPERA_CLI_EXECUTABLE_PATH: browser.path,
    // Every Opera AI feature needs a window to sign in with; a real browser
    // implies the user wants to see it.
    OPERA_CLI_HEADED: "1",
    OPERA_CLI_USER_DATA_DIR:
      defaultProfileDir(browser.path, home, platform) ??
      join(getStateDir(), "profile"),
  };

  return { status: "configured", browser, settings };
}

/** Apply settings to this process, so the current command uses them too. */
export function applySettingsToEnv(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

/**
 * Configure a fresh machine, if it needs it. Returns what happened so the
 * caller can tell the user in one line.
 */
export function autoConfigure(
  options: AutoConfigureOptions = {},
): AutoConfigureResult {
  const result = computeAutoConfig(options);
  if (result.status !== "configured") return result;

  if (options.persist !== false) {
    try {
      writeConfigFile(result.settings);
    } catch {
      // An unwritable state dir should not stop this run — the settings still
      // apply in-process, and `doctor` reports the directory problem.
    }
  }
  applySettingsToEnv(result.settings);
  return result;
}
