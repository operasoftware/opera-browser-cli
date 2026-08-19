/**
 * The caller contract: exit codes, browser classification, and log filtering.
 *
 * Exit codes are a documented interface — an agent branches on them to decide
 * between retrying, fixing its command, and asking the user. Changing one is a
 * breaking change.
 */

import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  EXIT_CODES,
  classifyBrowser,
  exitCodeForCdpError,
  filterLogLines,
  formatCliError,
  parseLogsArgs,
} from "../src/cli.js";
import { CdpError, type ErrorCode } from "../src/client.js";

describe("exit codes", () => {
  it("maps each error class to its documented code", () => {
    const expected: Record<ErrorCode, number> = {
      VALIDATION_ERROR: 2,
      UNSUPPORTED_OPERATION: 2,
      BRIDGE_NOT_READY: 3,
      BROWSER_ERROR: 3,
      AUTH_REQUIRED: 4,
      TIMEOUT: 5,
      REF_NOT_FOUND: 6,
      PAGE_CLOSED: 6,
      UNKNOWN: 1,
    };

    expect(EXIT_CODES).toEqual(expected);
  });

  it("separates 'fix your command' from 'ask the user' from 'retry'", () => {
    // The distinctions an agent actually branches on.
    expect(exitCodeForCdpError(new CdpError("bad args", "VALIDATION_ERROR"))).toBe(2);
    expect(exitCodeForCdpError(new CdpError("signed out", "AUTH_REQUIRED"))).toBe(4);
    expect(exitCodeForCdpError(new CdpError("slow", "TIMEOUT"))).toBe(5);
    expect(exitCodeForCdpError(new CdpError("stale ref", "REF_NOT_FOUND"))).toBe(6);
  });

  it("falls back to 1 for anything unrecognised", () => {
    expect(exitCodeForCdpError(new Error("boom"))).toBe(1);
    expect(exitCodeForCdpError("not an error")).toBe(1);
    expect(exitCodeForCdpError(new AxiError("odd", "SOMETHING_ELSE"))).toBe(1);
  });
});

describe("formatCliError", () => {
  it("renders the code and suggestions alongside the exit code", () => {
    const result = formatCliError(
      new CdpError("Opera: user is not signed in", "AUTH_REQUIRED", [
        "Run `opera-browser-cli login`",
      ]),
    );

    expect(result.exitCode).toBe(4);
    expect(result.output).toContain("AUTH_REQUIRED");
    expect(result.output).toContain("login");
  });

  it("handles a plain Error without suggestions", () => {
    const result = formatCliError(new Error("boom"));

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("boom");
  });
});

describe("classifyBrowser", () => {
  it("identifies Neon from the executable path", () => {
    expect(
      classifyBrowser("/Applications/Opera Neon.app/Contents/MacOS/Opera"),
    ).toBe("neon");
  });

  it("distinguishes a plain Opera build from Neon", () => {
    // The case the old existsSync check waved through, and which then failed
    // at runtime with a confusing protocol error.
    expect(classifyBrowser("/Applications/Opera.app/Contents/MacOS/Opera")).toBe(
      "opera",
    );
  });

  it("identifies a non-Opera browser", () => {
    expect(classifyBrowser("/usr/bin/google-chrome")).toBe("other");
  });

  it("reports unknown when nothing is configured", () => {
    expect(classifyBrowser(undefined)).toBe("unknown");
  });

  it("prefers what an attached browser says about itself", () => {
    // A live browser's own version string beats a guess from the path.
    expect(classifyBrowser("/usr/bin/google-chrome", "Opera Neon/121.0")).toBe("neon");
    expect(classifyBrowser(undefined, "Opera/121.0")).toBe("opera");
    expect(classifyBrowser(undefined, "Chrome/141.0")).toBe("other");
  });
});

describe("parseLogsArgs", () => {
  it("defaults to a plain tail", () => {
    expect(parseLogsArgs([])).toEqual({ lines: 50, follow: false, errorsOnly: false });
  });

  it("parses follow and errors flags", () => {
    expect(parseLogsArgs(["-f"]).follow).toBe(true);
    expect(parseLogsArgs(["--follow"]).follow).toBe(true);
    expect(parseLogsArgs(["--errors"]).errorsOnly).toBe(true);
  });

  it("combines flags with a line count", () => {
    expect(parseLogsArgs(["--errors", "-n", "200", "-f"])).toEqual({
      lines: 200,
      follow: true,
      errorsOnly: true,
    });
  });
});

describe("filterLogLines", () => {
  const lines = [
    "[opera-browser-cli] Listening on http://127.0.0.1:9225",
    "[opera-browser-cli] Connected to opera-devtools-mcp",
    "[opera-browser-cli] Port 9225 already in use",
    "Error: connect ECONNREFUSED 127.0.0.1:9225",
  ];

  it("returns everything by default", () => {
    expect(filterLogLines(lines, false)).toHaveLength(4);
  });

  it("keeps only the lines worth acting on", () => {
    const errors = filterLogLines(lines, true);

    expect(errors).toHaveLength(2);
    expect(errors.every((l) => /in use|ECONNREFUSED/.test(l))).toBe(true);
  });
});
