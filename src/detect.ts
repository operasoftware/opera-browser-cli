/**
 * Finding an installed browser.
 *
 * Opera Neon is preferred because it is the only build with the full Opera AI
 * tool set; a plain Opera still gives `chat`. Anything else means the AI
 * commands cannot work, which the caller reports rather than discovering
 * halfway through a command.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Look a bare command up on PATH, returning its resolved path (like a shell). */
export function whichOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const pathVar = env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const entry of pathVar.split(separator)) {
    if (!entry) continue;
    for (const ext of extensions) {
      const candidate = resolve(entry, command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Locate the Lightpanda ("panda") browser binary, which powers the alternative
 * backend behind the adapter shim. `OPERA_CLI_LIGHTPANDA_BIN` wins; otherwise it
 * is found on PATH as `lightpanda`.
 */
export function detectLightpanda(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const fromEnv = env.OPERA_CLI_LIGHTPANDA_BIN;
  if (fromEnv && exists(fromEnv)) return fromEnv;
  return whichOnPath("lightpanda", env, exists);
}

export function neonCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  home: string = "",
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Opera Neon.app/Contents/MacOS/Opera",
      "/Applications/Opera Neon Developer.app/Contents/MacOS/Opera",
      `${home}/Applications/Opera Neon.app/Contents/MacOS/Opera`,
      `${home}/Applications/Opera Neon Developer.app/Contents/MacOS/Opera`,
    ];
  }
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    return [
      `${localAppData}\\Programs\\Opera Neon\\opera.exe`,
      `${programFiles}\\Opera Neon\\opera.exe`,
      `${localAppData}\\Programs\\Opera Neon Developer\\opera.exe`,
      `${programFiles}\\Opera Neon Developer\\opera.exe`,
    ];
  }
  // Opera Neon does not ship for Linux.
  return [];
}

export function operaCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  home: string = "",
): string[] {
  if (platform === "darwin") {
    return [
      "/Applications/Opera GX.app/Contents/MacOS/Opera",
      "/Applications/Opera.app/Contents/MacOS/Opera",
      `${home}/Applications/Opera GX.app/Contents/MacOS/Opera`,
      `${home}/Applications/Opera.app/Contents/MacOS/Opera`,
    ];
  }
  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? `${home}\\AppData\\Local`;
    const programFiles = process.env.PROGRAMFILES ?? "C:\\Program Files";
    return [
      `${localAppData}\\Programs\\Opera GX\\opera.exe`,
      `${localAppData}\\Programs\\Opera\\opera.exe`,
      `${programFiles}\\Opera GX\\opera.exe`,
      `${programFiles}\\Opera\\opera.exe`,
    ];
  }
  return [];
}

export function browserDisplayName(binPath: string): string {
  if (binPath.includes("Neon Developer")) return "Opera Neon Developer";
  if (binPath.includes("Neon")) return "Opera Neon";
  if (binPath.includes("GX")) return "Opera GX";
  return "Opera";
}

export interface DetectedBrowser {
  path: string;
  name: string;
  /** Only Neon has invoke-do / make / research. */
  isNeon: boolean;
}

/** Every Opera install we can find, Neon first. */
export function detectBrowsers(
  platform: NodeJS.Platform = process.platform,
  home: string = "",
  exists: (p: string) => boolean = existsSync,
): DetectedBrowser[] {
  const neon = neonCandidatePaths(platform, home).filter(exists);
  const opera = operaCandidatePaths(platform, home).filter(exists);
  return [...neon, ...opera].map((path) => ({
    path,
    name: browserDisplayName(path),
    isNeon: neon.includes(path),
  }));
}

/** The browser to use when nobody has said which. */
export function detectBrowser(
  platform: NodeJS.Platform = process.platform,
  home: string = "",
  exists: (p: string) => boolean = existsSync,
): DetectedBrowser | null {
  return detectBrowsers(platform, home, exists)[0] ?? null;
}
