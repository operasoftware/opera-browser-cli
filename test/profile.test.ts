import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultProfileDir,
  findAttachableEndpoint,
  inspectProfileLock,
  parseDevToolsActivePort,
  parseSingletonTarget,
  probeDevToolsEndpoint,
  readDevToolsPort,
} from "../src/profile.js";

let dir: string;
const servers: Server[] = [];

function startDevToolsStub(
  port: number,
  body: unknown,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (req.url === "/json/version") {
        res.setHeader("Content-Type", "application/json");
        res.end(typeof body === "string" ? body : JSON.stringify(body));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    servers.push(server);
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function pickPort(): number {
  return 44_000 + Math.floor(Math.random() * 1_000);
}

/** Write a SingletonLock symlink the way Chromium does. */
function writeLock(target: string): void {
  symlinkSync(target, join(dir, "SingletonLock"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "obc-profile-"));
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  rmSync(dir, { recursive: true, force: true });
});

describe("parseSingletonTarget", () => {
  it("splits hostname and pid", () => {
    expect(parseSingletonTarget("mymachine-4242")).toEqual({
      hostname: "mymachine",
      pid: 4242,
    });
  });

  it("handles a hostname containing dashes", () => {
    // The common case on macOS, and the one a naive split() gets wrong.
    expect(parseSingletonTarget("Someones-MacBook-Pro-24601")).toEqual({
      hostname: "Someones-MacBook-Pro",
      pid: 24601,
    });
  });

  it("rejects malformed targets", () => {
    expect(parseSingletonTarget("nodashhere")).toBeNull();
    expect(parseSingletonTarget("host-notanumber")).toBeNull();
    expect(parseSingletonTarget("host-")).toBeNull();
    expect(parseSingletonTarget("-123")).toBeNull(); // no hostname
    expect(parseSingletonTarget("host-0")).toBeNull(); // pid 0 is not a process
  });
});

describe("parseDevToolsActivePort", () => {
  it("reads the port from the first line", () => {
    expect(parseDevToolsActivePort("54321\n/devtools/browser/abc-def\n")).toBe(54321);
  });

  it("rejects junk and out-of-range values", () => {
    expect(parseDevToolsActivePort("")).toBeNull();
    expect(parseDevToolsActivePort("not-a-port")).toBeNull();
    expect(parseDevToolsActivePort("99999")).toBeNull();
  });
});

describe("inspectProfileLock", () => {
  it("reports a directory with no lock as free", () => {
    expect(inspectProfileLock(dir)).toMatchObject({ state: "free" });
  });

  it("reports a live local lock as locked, naming the pid", () => {
    writeLock(`${hostname()}-${process.pid}`);

    expect(inspectProfileLock(dir)).toEqual({
      state: "locked",
      pid: process.pid,
      hostname: hostname(),
    });
  });

  it("treats a lock from a dead process as free", () => {
    // Chromium cleans these up itself on the next launch, so calling it a
    // conflict would block a launch that would actually succeed.
    writeLock(`${hostname()}-999999`);

    expect(inspectProfileLock(dir, () => false)).toMatchObject({
      state: "free",
      pid: null,
    });
  });

  it("treats a dangling symlink as free", () => {
    writeLock(`${hostname()}-4242`);

    expect(inspectProfileLock(dir, () => false).state).toBe("free");
  });

  it("never attributes a lock written by another machine", () => {
    // A synced or networked profile: that pid means nothing here and must
    // never be signalled.
    writeLock("some-other-host-4242");

    const lock = inspectProfileLock(dir, () => true);
    expect(lock.state).toBe("unknown");
    expect(lock.pid).toBeNull();
  });

  it("reports a non-symlink lock as unknown rather than free", () => {
    // Windows writes a regular file — claimed, but by whom we cannot tell.
    writeFileSync(join(dir, "SingletonLock"), "");

    expect(inspectProfileLock(dir)).toMatchObject({ state: "unknown", pid: null });
  });
});

describe("readDevToolsPort", () => {
  it("returns null when the browser was started without a debug port", () => {
    expect(readDevToolsPort(dir)).toBeNull();
  });

  it("reads a recorded port", () => {
    writeFileSync(join(dir, "DevToolsActivePort"), "54321\n/devtools/browser/x\n");

    expect(readDevToolsPort(dir)).toBe(54321);
  });
});

describe("probeDevToolsEndpoint", () => {
  it("identifies an Opera browser", async () => {
    const port = pickPort();
    await startDevToolsStub(port, { Browser: "Opera/121.0.0.0" });

    const identity = await probeDevToolsEndpoint(port);

    expect(identity).toEqual({ browser: "Opera/121.0.0.0", isOpera: true });
  });

  it("identifies a non-Opera browser as such", async () => {
    const port = pickPort();
    await startDevToolsStub(port, { Browser: "Chrome/141.0.0.0" });

    expect((await probeDevToolsEndpoint(port))?.isOpera).toBe(false);
  });

  it("returns null when nothing is listening", async () => {
    expect(await probeDevToolsEndpoint(pickPort())).toBeNull();
  });

  it("returns null for a non-DevTools server on the port", async () => {
    const port = pickPort();
    await startDevToolsStub(port, "<html>not devtools</html>");

    expect(await probeDevToolsEndpoint(port)).toBeNull();
  });
});

describe("findAttachableEndpoint", () => {
  it("finds a live endpoint from the recorded port", async () => {
    const port = pickPort();
    await startDevToolsStub(port, { Browser: "Opera/121.0.0.0" });
    writeFileSync(join(dir, "DevToolsActivePort"), `${port}\n/devtools/browser/x\n`);

    const found = await findAttachableEndpoint(dir);

    expect(found?.url).toBe(`http://127.0.0.1:${port}`);
    expect(found?.identity.isOpera).toBe(true);
  });

  it("ignores a stale port file left by a browser that has exited", async () => {
    // DevToolsActivePort survives a clean exit, so the recorded port proves
    // nothing until something answers on it.
    writeFileSync(join(dir, "DevToolsActivePort"), `${pickPort()}\n/x\n`);

    expect(await findAttachableEndpoint(dir)).toBeNull();
  });

  it("returns null when the browser had no debug port at all", async () => {
    expect(await findAttachableEndpoint(dir)).toBeNull();
  });
});

describe("defaultProfileDir", () => {
  it("returns null on platforms Opera Neon does not ship for", () => {
    expect(defaultProfileDir(undefined, "/home/x", "linux")).toBeNull();
  });

  it("returns null when the expected directory does not exist", () => {
    expect(defaultProfileDir(undefined, join(dir, "nope"), "darwin")).toBeNull();
  });

  it("distinguishes the Developer build", () => {
    const home = join(dir, "home");
    const support = join(home, "Library", "Application Support");
    mkdirSync(join(support, "com.operasoftware.OperaNeonDeveloper"), { recursive: true });
    mkdirSync(join(support, "com.operasoftware.OperaNeon"), { recursive: true });

    expect(
      defaultProfileDir("/Applications/Opera Neon Developer.app/x", home, "darwin"),
    ).toContain("OperaNeonDeveloper");
    expect(defaultProfileDir("/Applications/Opera Neon.app/x", home, "darwin")).toBe(
      join(support, "com.operasoftware.OperaNeon"),
    );
  });
});
