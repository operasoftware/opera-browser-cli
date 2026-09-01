/**
 * Bridge identity — the contract that lets a CLI process decide whether a
 * process or a listening port is *our* bridge, and whether it is running the
 * same code we are.
 *
 * Two problems this solves:
 *
 *   1. Version skew. A bridge started before an upgrade keeps serving stale
 *      code from memory and looks perfectly healthy. `version` makes the skew
 *      visible so the client can restart it.
 *
 *   2. PID recycling. After a reboot the PID in a leftover PID file may belong
 *      to an unrelated process. Signalling it would kill a stranger's process.
 *      `bootMinute` scopes a PID to the boot it was recorded in.
 *
 * The rule the client enforces: never signal a PID that has not been positively
 * identified as our bridge, either by answering /health or by matching both the
 * PID file and the current boot.
 */

import { uptime } from "node:os";

export const BRIDGE_SERVER_NAME = "opera-browser-cli";

/** Payload returned by GET /health. */
export interface BridgeHealth {
  status: "ok" | "not-connected";
  server: string;
  version: string;
  pid: number;
  startedAt: number;
  bootMinute: number;
  browser: { connected: boolean };
  /** Whether the bridge launched the browser in headed (visible) mode. */
  headed: boolean;
}

/**
 * The instant this machine booted, in whole minutes since the epoch.
 *
 * Derived from uptime rather than stored, so any process can compute it
 * independently. Uptime drifts by a second or two across suspend/resume and
 * between processes, so callers must compare with `sameBoot` (±1 minute)
 * rather than testing for equality.
 */
export function computeBootMinute(
  nowMs: number = Date.now(),
  uptimeSeconds: number = uptime(),
): number {
  return Math.floor((nowMs - uptimeSeconds * 1000) / 60_000);
}

/**
 * True when two boot minutes describe the same boot.
 *
 * The ±1 tolerance absorbs both uptime drift and the case where two processes
 * compute the value either side of a minute boundary. A false negative is
 * cheap (we decline to signal a PID and start a fresh bridge on another port);
 * a false positive would mean signalling a stranger, so the tolerance stays
 * tight.
 */
export function sameBoot(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1;
}

/** True when the payload came from a bridge of ours (any version). */
export function isOurBridge(health: BridgeHealth | null): health is BridgeHealth {
  return health !== null && health.server === BRIDGE_SERVER_NAME;
}

/** True when the bridge is ours, connected, and running our exact version. */
export function isUsableBridge(
  health: BridgeHealth | null,
  ourVersion: string,
): health is BridgeHealth {
  return (
    isOurBridge(health) &&
    health.status === "ok" &&
    health.version === ourVersion
  );
}

/**
 * Parse a /health response body. Returns null for anything that is not a
 * well-formed bridge identity — a foreign server, an HTML error page, or a
 * bridge old enough to predate the identity fields.
 */
export function parseHealth(body: string): BridgeHealth | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.server !== BRIDGE_SERVER_NAME) return null;

  const browser = record.browser as { connected?: unknown } | undefined;
  return {
    status: record.status === "ok" ? "ok" : "not-connected",
    server: BRIDGE_SERVER_NAME,
    // Pre-identity bridges (<= 0.1.45) omit these. Coercing to sentinel values
    // rather than rejecting keeps them recognisable as ours — which is what
    // lets the client shut one down instead of colliding with it.
    version: typeof record.version === "string" ? record.version : "unknown",
    pid: typeof record.pid === "number" ? record.pid : 0,
    startedAt: typeof record.startedAt === "number" ? record.startedAt : 0,
    bootMinute:
      typeof record.bootMinute === "number" ? record.bootMinute : Number.NaN,
    browser: { connected: browser?.connected === true },
    // Pre-0.2.7 bridges omit headed; they launched headless by default.
    headed: typeof record.headed === "boolean" ? record.headed : false,
  };
}
