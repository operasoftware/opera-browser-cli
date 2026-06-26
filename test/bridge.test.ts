import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import {
  buildTransportArgs,
  checkRequestAccess,
  extractBearerToken,
  extractToolText,
  generateBridgeToken,
  getErrorMessage,
  getLastSnapshotCache,
  handleBridgeRequest,
  isAllowedOrigin,
  isBridgeClientConnected,
  isLoopbackHost,
  parseBridgeCallPayload,
  resolveBridgeScript,
  resetLastSnapshotCache,
  wrapTransportForIdCapture,
  type BridgeClient,
} from "../src/bridge.js";

describe("extractToolText", () => {
  it("joins text blocks and ignores non-text content", () => {
    const result = extractToolText([
      { type: "text", text: "first" },
      { type: "image" },
      { type: "text", text: "second" },
    ]);

    expect(result).toBe("first\nsecond");
  });
});

describe("parseBridgeCallPayload", () => {
  it("defaults missing args to an empty object", () => {
    const result = parseBridgeCallPayload('{"name":"take_snapshot"}');

    expect(result).toEqual({ name: "take_snapshot", args: {} });
  });

  it("rejects payloads without a tool name", () => {
    expect(() => parseBridgeCallPayload('{"args":{}}')).toThrow("Invalid bridge request payload");
  });

  it("normalizes malformed JSON into a validation error", () => {
    expect(() => parseBridgeCallPayload("{")).toThrow("Invalid bridge request payload");
  });
});

describe("getErrorMessage", () => {
  it("extracts the message from an Error", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(getErrorMessage({ reason: "boom" })).toBe("[object Object]");
  });
});

describe("resolveBridgeScript", () => {
  it("prefers the TypeScript bridge entrypoint in the repo checkout", () => {
    expect(resolveBridgeScript(import.meta.dirname)).toMatch(/bin\/opera-browser-cli-bridge\.ts$/);
  });
});

describe("buildTransportArgs", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.OPERA_CLI_HEADED = process.env.OPERA_CLI_HEADED;
    savedEnv.OPERA_CLI_CHROME_ARGS = process.env.OPERA_CLI_CHROME_ARGS;
    savedEnv.OPERA_CLI_BROWSER_URL = process.env.OPERA_CLI_BROWSER_URL;
    savedEnv.OPERA_CLI_USER_DATA_DIR = process.env.OPERA_CLI_USER_DATA_DIR;
    savedEnv.OPERA_CLI_EXECUTABLE_PATH = process.env.OPERA_CLI_EXECUTABLE_PATH;
    delete process.env.OPERA_CLI_HEADED;
    delete process.env.OPERA_CLI_CHROME_ARGS;
    delete process.env.OPERA_CLI_BROWSER_URL;
    delete process.env.OPERA_CLI_USER_DATA_DIR;
    delete process.env.OPERA_CLI_EXECUTABLE_PATH;
  });

  afterEach(() => {
    process.env.OPERA_CLI_HEADED = savedEnv.OPERA_CLI_HEADED;
    process.env.OPERA_CLI_CHROME_ARGS = savedEnv.OPERA_CLI_CHROME_ARGS;
    process.env.OPERA_CLI_BROWSER_URL = savedEnv.OPERA_CLI_BROWSER_URL;
    process.env.OPERA_CLI_USER_DATA_DIR = savedEnv.OPERA_CLI_USER_DATA_DIR;
    process.env.OPERA_CLI_EXECUTABLE_PATH = savedEnv.OPERA_CLI_EXECUTABLE_PATH;
  });

  it("defaults to headless and isolated", () => {
    const args = buildTransportArgs();
    expect(args).toEqual(["--isolated", "--headless"]);
  });

  it("omits --headless when OPERA_CLI_HEADED=1", () => {
    process.env.OPERA_CLI_HEADED = "1";
    const args = buildTransportArgs();
    expect(args).toEqual(["--isolated"]);
  });

  it("forwards chrome args via --chrome-arg=", () => {
    process.env.OPERA_CLI_CHROME_ARGS = "--enable-gpu --ignore-gpu-blocklist";
    const args = buildTransportArgs();
    expect(args).toContain("--chrome-arg=--enable-gpu");
    expect(args).toContain("--chrome-arg=--ignore-gpu-blocklist");
  });

  it("handles tabs, newlines, and extra whitespace in chrome args", () => {
    process.env.OPERA_CLI_CHROME_ARGS = "  --flag-a\t--flag-b\n--flag-c  ";
    const args = buildTransportArgs();
    expect(args).toContain("--chrome-arg=--flag-a");
    expect(args).toContain("--chrome-arg=--flag-b");
    expect(args).toContain("--chrome-arg=--flag-c");
    expect(args.filter((a) => a.startsWith("--chrome-arg="))).toHaveLength(3);
  });

  it("combines headed mode with chrome args", () => {
    process.env.OPERA_CLI_HEADED = "1";
    process.env.OPERA_CLI_CHROME_ARGS = "--enable-unsafe-webgpu";
    const args = buildTransportArgs();
    expect(args).not.toContain("--headless");
    expect(args).toContain("--chrome-arg=--enable-unsafe-webgpu");
  });

  it("uses --browserUrl when OPERA_CLI_BROWSER_URL is set", () => {
    process.env.OPERA_CLI_BROWSER_URL = "http://127.0.0.1:9222";
    const args = buildTransportArgs();
    expect(args).toContain("--browserUrl=http://127.0.0.1:9222");
    expect(args).not.toContain("--isolated");
    expect(args).not.toContain("--headless");
  });

  it("passes chrome args alongside --browserUrl", () => {
    process.env.OPERA_CLI_BROWSER_URL = "http://127.0.0.1:9222";
    process.env.OPERA_CLI_CHROME_ARGS = "--some-flag";
    const args = buildTransportArgs();
    expect(args).toContain("--browserUrl=http://127.0.0.1:9222");
    expect(args).toContain("--chrome-arg=--some-flag");
  });

  it("uses --userDataDir when OPERA_CLI_USER_DATA_DIR is set", () => {
    process.env.OPERA_CLI_USER_DATA_DIR = "/path/to/.opera-profile";
    const args = buildTransportArgs();
    expect(args).toContain("--userDataDir=/path/to/.opera-profile");
    expect(args).not.toContain("--isolated");
    expect(args).toContain("--headless");
  });

  it("respects headed mode with --userDataDir", () => {
    process.env.OPERA_CLI_USER_DATA_DIR = "/path/to/.opera-profile";
    process.env.OPERA_CLI_HEADED = "1";
    const args = buildTransportArgs();
    expect(args).toContain("--userDataDir=/path/to/.opera-profile");
    expect(args).not.toContain("--headless");
  });

  it("--browserUrl takes precedence over --userDataDir", () => {
    process.env.OPERA_CLI_BROWSER_URL = "http://127.0.0.1:9222";
    process.env.OPERA_CLI_USER_DATA_DIR = "/path/to/.opera-profile";
    const args = buildTransportArgs();
    expect(args).toContain("--browserUrl=http://127.0.0.1:9222");
    expect(args).not.toContain("--userDataDir=/path/to/.opera-profile");
  });

  it("uses --executablePath when OPERA_CLI_EXECUTABLE_PATH is set", () => {
    process.env.OPERA_CLI_EXECUTABLE_PATH = "/Applications/Opera Neon.app/Contents/MacOS/Opera";
    const args = buildTransportArgs();
    expect(args).toContain("--executablePath=/Applications/Opera Neon.app/Contents/MacOS/Opera");
    expect(args).toContain("--isolated");
    expect(args).toContain("--headless");
  });

  it("omits --executablePath when OPERA_CLI_BROWSER_URL is also set", () => {
    process.env.OPERA_CLI_BROWSER_URL = "http://127.0.0.1:9222";
    process.env.OPERA_CLI_EXECUTABLE_PATH = "/Applications/Opera Neon.app/Contents/MacOS/Opera";
    const args = buildTransportArgs();
    expect(args).toContain("--browserUrl=http://127.0.0.1:9222");
    expect(args).not.toContain("--executablePath=/Applications/Opera Neon.app/Contents/MacOS/Opera");
  });
});

describe("bridge health", () => {
  it("reports disconnected clients as unhealthy", async () => {
    const healthy = await isBridgeClientConnected({
      listTools: async () => {
        throw new Error("Not connected");
      },
      callTool: async () => ({}),
      close: async () => {},
    });

    expect(healthy).toBe(false);
  });

  it("reports connected clients as healthy", async () => {
    const healthy = await isBridgeClientConnected({
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({}),
      close: async () => {},
    });

    expect(healthy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers for handleBridgeRequest / wrapTransportForIdCapture tests
// ---------------------------------------------------------------------------

function makeMockTransport() {
  const transport = {
    send: async (_msg: JSONRPCMessage) => {},
    onclose: undefined as (() => void) | undefined,
  } as unknown as StdioClientTransport;
  return transport;
}

function makeMockRequest(
  method: string,
  url: string,
  body = "",
  headers: Record<string, string> = { host: "127.0.0.1:9225" },
): IncomingMessage {
  return {
    method,
    url,
    headers,
    [Symbol.asyncIterator]: async function* () { yield body; },
  } as unknown as IncomingMessage;
}

function makeMockResponse() {
  const written: string[] = [];
  let endPayload = "";
  const res = {
    statusCode: 200,
    setHeader: () => {},
    write: (data: string) => { written.push(data); },
    end: (data: string) => { endPayload = data; },
  } as unknown as ServerResponse;
  return {
    res,
    written,
    get endPayload() { return endPayload; },
  };
}

// ---------------------------------------------------------------------------
// wrapTransportForIdCapture
// ---------------------------------------------------------------------------

describe("wrapTransportForIdCapture", () => {
  it("resolves with the request ID from the first outgoing JSON-RPC request", async () => {
    const transport = makeMockTransport();
    const captureNextId = wrapTransportForIdCapture(transport);

    const idPromise = captureNextId();
    await transport.send({ jsonrpc: "2.0", id: "42", method: "tools/call", params: {} });

    expect(await idPromise).toBe("42");
  });

  it("assigns IDs in FIFO order across concurrent captures", async () => {
    const transport = makeMockTransport();
    const captureNextId = wrapTransportForIdCapture(transport);

    const idA = captureNextId();
    const idB = captureNextId();

    await transport.send({ jsonrpc: "2.0", id: "1", method: "tools/call", params: {} });
    await transport.send({ jsonrpc: "2.0", id: "2", method: "tools/call", params: {} });

    expect(await idA).toBe("1");
    expect(await idB).toBe("2");
  });

  it("rejects pending captures when the transport disconnects", async () => {
    const transport = makeMockTransport();
    const captureNextId = wrapTransportForIdCapture(transport);

    const idPromise = captureNextId();
    transport.onclose?.();

    await expect(idPromise).rejects.toThrow("MCP transport disconnected");
  });

  it("ignores response messages (no method) and pure notifications (no id)", async () => {
    const transport = makeMockTransport();
    const captureNextId = wrapTransportForIdCapture(transport);

    const idPromise = captureNextId();

    // Response message — has id but no method
    await transport.send({ jsonrpc: "2.0", id: "99", result: {} });
    // Notification — has method but no id
    await transport.send({ jsonrpc: "2.0", method: "notifications/message", params: {} });
    // Actual request — has both id and method
    await transport.send({ jsonrpc: "2.0", id: "7", method: "tools/call", params: {} });

    expect(await idPromise).toBe("7");
  });

  it("still forwards all messages to the original send implementation", async () => {
    let sentMessages: JSONRPCMessage[] = [];
    const transport = {
      send: async (msg: JSONRPCMessage) => { sentMessages.push(msg); },
      onclose: undefined as (() => void) | undefined,
    } as unknown as StdioClientTransport;

    const captureNextId = wrapTransportForIdCapture(transport);
    const idPromise = captureNextId();

    const msg: JSONRPCMessage = { jsonrpc: "2.0", id: "5", method: "tools/call", params: {} };
    await transport.send(msg);
    await idPromise;

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// Access control — Host / Origin guard + bearer token
// ---------------------------------------------------------------------------

describe("isLoopbackHost", () => {
  it("accepts loopback hostnames with or without a port", () => {
    expect(isLoopbackHost("127.0.0.1:9225")).toBe(true);
    expect(isLoopbackHost("localhost:9225")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]:9225")).toBe(true);
  });

  it("rejects non-loopback and missing hosts", () => {
    expect(isLoopbackHost("mario.evil.example:9225")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.example")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("allows an absent Origin (non-browser caller)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it("allows loopback origins", () => {
    expect(isAllowedOrigin("http://localhost:9225")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects web origins and the null origin", () => {
    expect(isAllowedOrigin("https://mario.evil.example")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
  });
});

describe("extractBearerToken", () => {
  it("parses a Bearer token case-insensitively", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer abc123")).toBe("abc123");
  });

  it("returns null for missing or malformed headers", () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("Basic abc123")).toBeNull();
  });
});

describe("checkRequestAccess", () => {
  const reqWith = (headers: Record<string, string>) =>
    ({ headers } as unknown as IncomingMessage);

  it("rejects a forged (non-loopback) Host header", () => {
    const result = checkRequestAccess(
      reqWith({ host: "mario.evil.example:9225" }),
      null,
      false,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects a cross-origin request even with a loopback Host", () => {
    const result = checkRequestAccess(
      reqWith({ host: "127.0.0.1:9225", origin: "https://mario.evil.example" }),
      null,
      false,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("requires a valid bearer token on protected routes", () => {
    const headers = { host: "127.0.0.1:9225" };
    expect(checkRequestAccess(reqWith(headers), "secret", true).status).toBe(401);
    expect(
      checkRequestAccess(
        reqWith({ ...headers, authorization: "Bearer wrong" }),
        "secret",
        true,
      ).status,
    ).toBe(401);
    expect(
      checkRequestAccess(
        reqWith({ ...headers, authorization: "Bearer secret" }),
        "secret",
        true,
      ).ok,
    ).toBe(true);
  });

  it("accepts a loopback request with no Origin and no token required", () => {
    expect(
      checkRequestAccess(reqWith({ host: "127.0.0.1:9225" }), null, false).ok,
    ).toBe(true);
  });
});

describe("generateBridgeToken", () => {
  it("produces a 64-char hex token that differs each call", () => {
    const a = generateBridgeToken();
    const b = generateBridgeToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("handleBridgeRequest access control", () => {
  const okClient: BridgeClient = {
    listTools: async () => ({ tools: [{ name: "click", description: "" }] }),
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {},
  };

  it("rejects a forged-Host /call with 403 before dispatching", async () => {
    let called = false;
    const spyClient: BridgeClient = {
      ...okClient,
      callTool: async () => { called = true; return { content: [] }; },
    };
    const req = makeMockRequest(
      "POST",
      "/call",
      JSON.stringify({ name: "list_pages", args: {} }),
      { host: "mario.evil.example:9225" },
    );
    const mock = makeMockResponse();
    await handleBridgeRequest(spyClient, req, mock.res, undefined, "secret");
    expect(mock.res.statusCode).toBe(403);
    expect(called).toBe(false);
  });

  it("rejects a cross-origin /call with 403", async () => {
    const req = makeMockRequest(
      "POST",
      "/call",
      JSON.stringify({ name: "list_pages", args: {} }),
      { host: "127.0.0.1:9225", origin: "https://mario.evil.example" },
    );
    const mock = makeMockResponse();
    await handleBridgeRequest(okClient, req, mock.res, undefined, "secret");
    expect(mock.res.statusCode).toBe(403);
  });

  it("rejects /call without the bearer token (401)", async () => {
    const req = makeMockRequest(
      "POST",
      "/call",
      JSON.stringify({ name: "list_pages", args: {} }),
      { host: "127.0.0.1:9225" },
    );
    const mock = makeMockResponse();
    await handleBridgeRequest(okClient, req, mock.res, undefined, "secret");
    expect(mock.res.statusCode).toBe(401);
  });

  it("accepts /call with a valid bearer token", async () => {
    const req = makeMockRequest(
      "POST",
      "/call",
      JSON.stringify({ name: "list_pages", args: {} }),
      { host: "127.0.0.1:9225", authorization: "Bearer secret" },
    );
    const mock = makeMockResponse();
    await handleBridgeRequest(okClient, req, mock.res, undefined, "secret");
    expect(JSON.parse(mock.endPayload)).toEqual({ result: "ok" });
  });

  it("serves /health without a token but still enforces the Host guard", async () => {
    const good = makeMockRequest("GET", "/health", "", { host: "127.0.0.1:9225" });
    const goodMock = makeMockResponse();
    await handleBridgeRequest(okClient, good, goodMock.res, undefined, "secret");
    expect(goodMock.res.statusCode).toBe(200);

    const bad = makeMockRequest("GET", "/health", "", { host: "evil.example" });
    const badMock = makeMockResponse();
    await handleBridgeRequest(okClient, bad, badMock.res, undefined, "secret");
    expect(badMock.res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// handleBridgeRequest — streaming path
// ---------------------------------------------------------------------------

describe("handleBridgeRequest streaming", () => {
  it("writes the tool result to the response for a streaming tool call", async () => {
    const client: BridgeClient = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [{ type: "text", text: "streamed result" }] }),
      close: async () => {},
    };

    const captureNextId = () => Promise.resolve("req-1");
    const req = makeMockRequest("POST", "/call", JSON.stringify({ name: "opera_do", args: { prompt: "hello" } }));
    const mock = makeMockResponse();

    await handleBridgeRequest(client, req, mock.res, captureNextId);

    expect(JSON.parse(mock.endPayload)).toEqual({ result: "streamed result" });
  });

  it("returns a 500 when callTool throws during a streaming call", async () => {
    const client: BridgeClient = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => { throw new Error("browser crashed"); },
      close: async () => {},
    };

    const captureNextId = () => Promise.resolve("req-err");
    const req = makeMockRequest("POST", "/call", JSON.stringify({ name: "opera_do", args: { prompt: "fail" } }));
    const mock = makeMockResponse();

    await handleBridgeRequest(client, req, mock.res, captureNextId);

    expect(mock.res.statusCode).toBe(500);
    expect(JSON.parse(mock.endPayload)).toEqual({ error: "browser crashed" });
  });

  it("routes concurrent streaming calls to their respective responses", async () => {
    let resolveA!: (v: unknown) => void;
    let resolveB!: (v: unknown) => void;

    const client: BridgeClient = {
      listTools: async () => ({ tools: [] }),
      callTool: async ({ name }) => {
        if (name === "opera_do") {
          await new Promise(r => { resolveA = r; });
          return { content: [{ type: "text", text: "result-A" }] };
        }
        await new Promise(r => { resolveB = r; });
        return { content: [{ type: "text", text: "result-B" }] };
      },
      close: async () => {},
    };

    const idQueue = ["id-A", "id-B"];
    const captureNextId = () => Promise.resolve(idQueue.shift()!);

    const reqA = makeMockRequest("POST", "/call", JSON.stringify({ name: "opera_do", args: { prompt: "A" } }));
    const reqB = makeMockRequest("POST", "/call", JSON.stringify({ name: "opera_research", args: { prompt: "B" } }));
    const mockA = makeMockResponse();
    const mockB = makeMockResponse();

    const promiseA = handleBridgeRequest(client, reqA, mockA.res, captureNextId);
    const promiseB = handleBridgeRequest(client, reqB, mockB.res, captureNextId);

    // Flush all pending microtasks so both callTool calls have started and
    // resolveA / resolveB are guaranteed to be set before we call them.
    await new Promise(r => setTimeout(r, 0));
    resolveA(undefined);
    resolveB(undefined);
    await Promise.all([promiseA, promiseB]);

    expect(JSON.parse(mockA.endPayload)).toEqual({ result: "result-A" });
    expect(JSON.parse(mockB.endPayload)).toEqual({ result: "result-B" });
  });
});

// ---------------------------------------------------------------------------
// Snapshot cache — lastSnapshot state + /last-snapshot endpoint
// ---------------------------------------------------------------------------

describe("snapshot cache", () => {
  beforeEach(() => resetLastSnapshotCache());

  const snapshotClient: BridgeClient = {
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({
      content: [{ type: "text", text: 'uid=1_0 RootWebArea "Page" url="https://example.com/"\n  link "Home"' }],
    }),
    close: async () => {},
  };

  it("cache is empty before any snapshot call", () => {
    expect(getLastSnapshotCache()).toBeNull();
  });

  it("GET /last-snapshot returns 404 when cache is cold", async () => {
    const req = makeMockRequest("GET", "/last-snapshot");
    const mock = makeMockResponse();
    await handleBridgeRequest(snapshotClient, req, mock.res);
    expect(mock.res.statusCode).toBe(404);
    expect(JSON.parse(mock.endPayload)).toHaveProperty("error");
  });

  it("take_snapshot call populates the cache", async () => {
    const req = makeMockRequest("POST", "/call", JSON.stringify({ name: "take_snapshot", args: {} }));
    const mock = makeMockResponse();
    await handleBridgeRequest(snapshotClient, req, mock.res);

    const cached = getLastSnapshotCache();
    expect(cached).not.toBeNull();
    expect(cached!.raw).toContain('RootWebArea "Page"');
    expect(cached!.pageUrl).toBe("https://example.com");
    expect(cached!.capturedAt).toBeGreaterThan(0);
  });

  it("GET /last-snapshot returns 200 with cached data after a snapshot", async () => {
    // Populate cache
    const postReq = makeMockRequest("POST", "/call", JSON.stringify({ name: "take_snapshot", args: {} }));
    await handleBridgeRequest(snapshotClient, postReq, makeMockResponse().res);

    // Now fetch it
    const getReq = makeMockRequest("GET", "/last-snapshot");
    const mock = makeMockResponse();
    await handleBridgeRequest(snapshotClient, getReq, mock.res);

    expect(mock.res.statusCode).toBe(200);
    const data = JSON.parse(mock.endPayload);
    expect(data.raw).toContain("RootWebArea");
    expect(data.pageUrl).toBe("https://example.com");
    expect(typeof data.capturedAt).toBe("number");
  });

  it("a non-snapshot tool call does not overwrite the cache", async () => {
    // Populate with snapshot
    const snapReq = makeMockRequest("POST", "/call", JSON.stringify({ name: "take_snapshot", args: {} }));
    await handleBridgeRequest(snapshotClient, snapReq, makeMockResponse().res);
    const first = getLastSnapshotCache()!.raw;

    // Call a different tool
    const clickClient: BridgeClient = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [{ type: "text", text: "clicked" }] }),
      close: async () => {},
    };
    const clickReq = makeMockRequest("POST", "/call", JSON.stringify({ name: "click", args: { uid: "1_1" } }));
    await handleBridgeRequest(clickClient, clickReq, makeMockResponse().res);

    expect(getLastSnapshotCache()!.raw).toBe(first);
  });

  it("second take_snapshot overwrites the cache (last write wins)", async () => {
    let callCount = 0;
    const twoSnapshotClient: BridgeClient = {
      listTools: async () => ({ tools: [] }),
      callTool: async () => {
        callCount++;
        return {
          content: [{ type: "text", text: `RootWebArea "Page ${callCount}"` }],
        };
      },
      close: async () => {},
    };

    const req1 = makeMockRequest("POST", "/call", JSON.stringify({ name: "take_snapshot", args: {} }));
    const req2 = makeMockRequest("POST", "/call", JSON.stringify({ name: "take_snapshot", args: {} }));
    await handleBridgeRequest(twoSnapshotClient, req1, makeMockResponse().res);
    await handleBridgeRequest(twoSnapshotClient, req2, makeMockResponse().res);

    expect(getLastSnapshotCache()!.raw).toContain("Page 2");
  });
});
