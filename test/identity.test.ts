import { describe, expect, it } from "vitest";
import {
  BRIDGE_SERVER_NAME,
  computeBootMinute,
  isOurBridge,
  isUsableBridge,
  parseHealth,
  sameBoot,
  type BridgeHealth,
} from "../src/identity.js";

function health(overrides: Partial<BridgeHealth> = {}): BridgeHealth {
  return {
    status: "ok",
    server: BRIDGE_SERVER_NAME,
    version: "1.2.3",
    pid: 4242,
    startedAt: 1_700_000_000_000,
    bootMinute: 28_000_000,
    browser: { connected: true },
    ...overrides,
  };
}

describe("computeBootMinute", () => {
  it("derives the boot instant from now minus uptime", () => {
    // 10:00:00 with 600s uptime → booted 09:50.
    const now = Date.UTC(2026, 0, 1, 10, 0, 0);
    expect(computeBootMinute(now, 600)).toBe(
      Math.floor(Date.UTC(2026, 0, 1, 9, 50, 0) / 60_000),
    );
  });

  it("agrees between two processes measuring seconds apart", () => {
    const now = Date.UTC(2026, 0, 1, 10, 0, 0);
    const a = computeBootMinute(now, 600);
    const b = computeBootMinute(now + 3_000, 603);
    expect(sameBoot(a, b)).toBe(true);
  });
});

describe("sameBoot", () => {
  it("tolerates a minute of drift in either direction", () => {
    expect(sameBoot(100, 100)).toBe(true);
    expect(sameBoot(100, 101)).toBe(true);
    expect(sameBoot(101, 100)).toBe(true);
  });

  it("rejects anything further apart — a reboot must never look like drift", () => {
    expect(sameBoot(100, 102)).toBe(false);
    expect(sameBoot(100, 5_000)).toBe(false);
  });
});

describe("parseHealth", () => {
  it("parses a full identity payload", () => {
    const parsed = parseHealth(JSON.stringify(health()));
    expect(parsed).toEqual(health());
  });

  it("rejects a foreign server", () => {
    expect(
      parseHealth(JSON.stringify({ status: "ok", server: "some-other-tool" })),
    ).toBeNull();
  });

  it("rejects a non-JSON body", () => {
    expect(parseHealth("<html>404</html>")).toBeNull();
  });

  it("still recognises a pre-identity bridge as ours", () => {
    // 0.1.45 and earlier answered with only status + server. Recognising these
    // is what lets the client shut one down after an upgrade instead of
    // colliding with it forever.
    const parsed = parseHealth(
      JSON.stringify({ status: "ok", server: BRIDGE_SERVER_NAME }),
    );
    expect(isOurBridge(parsed)).toBe(true);
    expect(parsed?.version).toBe("unknown");
    expect(parsed?.pid).toBe(0);
  });
});

describe("isUsableBridge", () => {
  it("accepts our bridge on our version", () => {
    expect(isUsableBridge(health(), "1.2.3")).toBe(true);
  });

  it("rejects a healthy bridge running different code", () => {
    // The whole point: a pre-upgrade bridge looks perfectly healthy while
    // serving stale code from memory.
    expect(isUsableBridge(health({ version: "1.2.2" }), "1.2.3")).toBe(false);
  });

  it("rejects a bridge whose MCP client is not connected", () => {
    expect(isUsableBridge(health({ status: "not-connected" }), "1.2.3")).toBe(false);
  });

  it("rejects null", () => {
    expect(isUsableBridge(null, "1.2.3")).toBe(false);
  });
});
