/**
 * Lightpanda binary detection — powers OPERA_CLI_BROWSER_BACKEND=panda.
 */

import { describe, expect, it } from "vitest";
import { detectLightpanda, whichOnPath } from "../src/detect.js";

const existsOnly = (...paths: string[]) => (p: string) => paths.includes(p);

describe("whichOnPath", () => {
  it("finds a command in a PATH entry", () => {
    const found = whichOnPath(
      "lightpanda",
      { PATH: "/usr/bin:/opt/bin" },
      existsOnly("/opt/bin/lightpanda"),
    );
    expect(found).toBe("/opt/bin/lightpanda");
  });

  it("returns null when absent from every PATH entry", () => {
    expect(whichOnPath("lightpanda", { PATH: "/usr/bin" }, () => false)).toBeNull();
  });

  it("scans entries in order", () => {
    const found = whichOnPath(
      "lightpanda",
      { PATH: "/a:/b" },
      existsOnly("/b/lightpanda"),
    );
    expect(found).toBe("/b/lightpanda");
  });
});

describe("detectLightpanda", () => {
  it("prefers OPERA_CLI_LIGHTPANDA_BIN when it exists", () => {
    const found = detectLightpanda(
      { OPERA_CLI_LIGHTPANDA_BIN: "/custom/lightpanda" },
      existsOnly("/custom/lightpanda"),
    );
    expect(found).toBe("/custom/lightpanda");
  });

  it("ignores OPERA_CLI_LIGHTPANDA_BIN when the file is missing", () => {
    const found = detectLightpanda(
      { OPERA_CLI_LIGHTPANDA_BIN: "/gone/lightpanda", PATH: "/usr/bin" },
      existsOnly("/usr/bin/lightpanda"),
    );
    expect(found).toBe("/usr/bin/lightpanda");
  });

  it("falls back to PATH", () => {
    const found = detectLightpanda(
      { PATH: "/usr/bin" },
      existsOnly("/usr/bin/lightpanda"),
    );
    expect(found).toBe("/usr/bin/lightpanda");
  });

  it("returns null when not found anywhere", () => {
    expect(detectLightpanda({ PATH: "/usr/bin" }, () => false)).toBeNull();
  });
});