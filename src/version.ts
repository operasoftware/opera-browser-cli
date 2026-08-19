/**
 * Package version lookup, shared by the CLI, the bridge, and the health contract.
 *
 * Resolution walks up from this module so it works both from source
 * (`src/version.ts` → `../package.json`) and from the build output
 * (`dist/src/version.js` → `../../package.json`).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function getPackageVersion(): string {
  if (cached !== null) return cached;

  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(here, "..", "package.json"),
    join(here, "..", "..", "package.json"),
  ]) {
    if (!existsSync(candidate)) continue;
    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      cached = parsed.version;
      return cached;
    }
  }

  throw new Error("Could not determine opera-browser-cli package version");
}

/** Reset the memoised version — for use in tests only. */
export function resetVersionCache(): void {
  cached = null;
}
