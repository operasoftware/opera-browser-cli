import { describe, it, expect } from "vitest";
import {
  extractTakeoverFlag,
  formatStopOutput,
  formatScreenshotOutput,
  getCommandHelp,
  parseChatArgs,
  parseScreenshotArgs,
  parseSetupArgs,
  UID_NOT_FOUND_RE,
} from "../src/cli.js";

describe("formatStopOutput", () => {
  const base = { stopped: false, stale: false, forced: false, pid: null, port: null };

  it("returns stopped status when bridge was running", () => {
    const output = formatStopOutput({ ...base, stopped: true, pid: 42, port: 9225 });
    expect(output).toContain("stopped");
    expect(output).not.toContain("no-op");
    expect(output).toContain("42");
    expect(output).toContain("9225");
  });

  it("returns no-op status when bridge was not running", () => {
    const output = formatStopOutput(base);
    expect(output).toContain("no-op");
  });

  it("reports a forced kill distinctly", () => {
    const output = formatStopOutput({ ...base, stopped: true, forced: true, pid: 42 });
    expect(output).toContain("forced");
  });

  it("reports a cleared stale pid file", () => {
    const output = formatStopOutput({ ...base, stale: true, pid: 42 });
    expect(output).toContain("stale");
    expect(output).not.toContain("no-op");
  });
});

describe("parseSetupArgs", () => {
  it("defaults to the interactive wizard", () => {
    expect(parseSetupArgs([])).toMatchObject({ interactive: true });
  });

  it("accepts the non-interactive flags", () => {
    expect(parseSetupArgs(["--non-interactive"]).interactive).toBe(false);
    expect(parseSetupArgs(["-y"]).interactive).toBe(false);
    expect(parseSetupArgs(["--yes"]).interactive).toBe(false);
  });

  it("treats any explicit setting as non-interactive", () => {
    // Passing a value means the caller already knows what they want; stopping
    // to ask would defeat the point in a provisioning script.
    expect(parseSetupArgs(["--executable", "/x/opera"])).toMatchObject({
      interactive: false,
      executable: "/x/opera",
    });
    expect(parseSetupArgs(["--profile", "skip"])).toMatchObject({
      interactive: false,
      profile: "skip",
    });
    expect(parseSetupArgs(["--headless"])).toMatchObject({
      interactive: false,
      headed: false,
    });
    expect(parseSetupArgs(["--headed"])).toMatchObject({
      interactive: false,
      headed: true,
    });
  });

  it("ignores a flag with no value rather than consuming the next one", () => {
    expect(parseSetupArgs(["--executable"])).toMatchObject({
      interactive: true,
      executable: undefined,
    });
  });
});

describe("extractTakeoverFlag", () => {
  it("strips the flag so it never reaches command parsing", () => {
    expect(extractTakeoverFlag(["open", "https://x", "--takeover"])).toEqual({
      argv: ["open", "https://x"],
      takeover: true,
    });
  });

  it("leaves other args untouched", () => {
    expect(extractTakeoverFlag(["open", "https://x"])).toEqual({
      argv: ["open", "https://x"],
      takeover: false,
    });
  });
});

describe("getCommandHelp", () => {
  it("returns help text for known commands", () => {
    const help = getCommandHelp("open");
    expect(help).toContain("open");
    expect(help).toContain("--full");
    expect(help).toContain("example");
  });

  it("returns null for unknown commands", () => {
    expect(getCommandHelp("nonexistent")).toBeNull();
  });

  it("includes --full flag for snapshot-producing commands", () => {
    for (const cmd of ["open", "snapshot", "click", "fill", "type", "press", "scroll", "back"]) {
      expect(getCommandHelp(cmd)).toContain("--full");
    }
  });

  it("does not include --full for non-snapshot commands", () => {
    expect(getCommandHelp("eval")).not.toContain("--full");
    expect(getCommandHelp("start")).not.toContain("--full");
    expect(getCommandHelp("stop")).not.toContain("--full");
  });

  it("has help for all 13 commands", () => {
    const commands = ["open", "snapshot", "screenshot", "click", "fill", "type", "press", "scroll", "back", "wait", "eval", "start", "stop"];
    for (const cmd of commands) {
      expect(getCommandHelp(cmd)).not.toBeNull();
    }
  });

  it("screenshot help includes flags", () => {
    const help = getCommandHelp("screenshot");
    expect(help).toContain("--uid");
    expect(help).toContain("--full-page");
    expect(help).toContain("--format");
  });
});

describe("parseScreenshotArgs", () => {
  it("parses path only", () => {
    const result = parseScreenshotArgs(["./shot.png"]);
    expect(result).toEqual({ filePath: "./shot.png", uid: undefined, fullPage: false, format: undefined });
  });

  it("parses all flags", () => {
    const result = parseScreenshotArgs(["./shot.jpg", "--uid", "@3", "--full-page", "--format", "jpeg"]);
    expect(result).toEqual({ filePath: "./shot.jpg", uid: "3", fullPage: true, format: "jpeg" });
  });

  it("strips @ prefix from uid", () => {
    const result = parseScreenshotArgs(["out.png", "--uid", "@12"]);
    expect(result.uid).toBe("12");
  });

  it("returns null filePath when missing", () => {
    const result = parseScreenshotArgs(["--full-page"]);
    expect(result.filePath).toBeNull();
  });
});

describe("formatScreenshotOutput", () => {
  it("includes file path in output", () => {
    const output = formatScreenshotOutput("./shot.png");
    expect(output).toContain("./shot.png");
  });
});

describe("parseChatArgs", () => {
  it("parses prompt only", () => {
    const result = parseChatArgs(["Hello", "world"]);
    expect(result).toEqual({ prompt: "Hello world", model: undefined });
  });

  it("parses --model flag with prompt", () => {
    const result = parseChatArgs(["--model", "gpt-4o", "What", "is", "this?"]);
    expect(result).toEqual({ prompt: "What is this?", model: "gpt-4o" });
  });

  it("parses --model at end of args", () => {
    const result = parseChatArgs(["Hello", "--model", "claude-sonnet-4"]);
    expect(result).toEqual({ prompt: "Hello", model: "claude-sonnet-4" });
  });

  it("returns empty prompt when only --model is given", () => {
    const result = parseChatArgs(["--model", "gpt-4o"]);
    expect(result).toEqual({ prompt: "", model: "gpt-4o" });
  });

  it("ignores --model without a value", () => {
    const result = parseChatArgs(["Hello", "--model"]);
    expect(result).toEqual({ prompt: "Hello", model: undefined });
  });
});

describe("UID_NOT_FOUND_RE", () => {
  it("matches MCP ref-not-found messages in uid and dot form", () => {
    expect(UID_NOT_FOUND_RE.test("Element uid 2_4 not found")).toBe(true);
    expect(UID_NOT_FOUND_RE.test("uid \"2_4\" not found")).toBe(true);
    expect(UID_NOT_FOUND_RE.exec("uid 2_4 not found")?.[1]).toBe("2_4");
    expect(UID_NOT_FOUND_RE.test("some other error")).toBe(false);
  });
});
