# opera-browser-cli — Claude guidance

## Repository overview

`opera-browser-cli` is a CLI tool and HTTP bridge that connects terminal users (and AI agents)
to a running Opera / Chrome browser session via the `opera-devtools-mcp` MCP server.

Key files:

| File | Role |
|---|---|
| `src/cli.ts` | Command parsing and dispatch (`opera-browser-cli <command>`) |
| `src/client.ts` | HTTP client for the bridge + bridge lifecycle (start/stop/health) |
| `src/bridge.ts` | Persistent HTTP ↔ MCP adapter; spawns `opera-devtools-mcp` as a child process |
| `src/bridge.ts` → `runBridge()` | Entry point for the bridge process |
| `bin/opera-browser-cli-bridge.js` | Bridge binary entrypoint (calls `runBridge`) |

## Benchmarks

Token-cost and agentic-quality measurements live in `benchmarks/`. See `benchmarks/CLAUDE.md` for file roles and how to run them.

## Specs directory

Planned and in-progress fixes are documented as Markdown specs in `specs/`.
Always check there before starting implementation work.

| Spec | Status |
|---|---|
| [`specs/fix-parallel-streaming-routing.md`](specs/fix-parallel-streaming-routing.md) | Planned — parallel chunk routing for concurrent Opera AI calls |
| [`specs/chat-model-selector.md`](specs/chat-model-selector.md) | Planned — model selector for chat command |

## Common issues

### Stale bridge process after update (`BRIDGE_NOT_READY` / "different server")

**Symptom:** `opera-browser-cli` commands fail with:
```
error: Port 9224 is in use by a different server (not opera-devtools-mcp).
code: BRIDGE_NOT_READY
```
even though the bridge is running (`lsof -i :9224` shows a `node` process).

**Cause:** The bridge process was started before `dist/src/bridge.js` was rebuilt. The
running process has old code in memory; its `/health` response is missing the
`server: "opera-browser-cli"` field that `checkPortStatus` (`client.ts`) requires to
recognise the bridge as healthy. Without that field the port is classified as a conflict.

**Fix:** Restart the bridge:
```sh
opera-browser-cli stop
# next command auto-starts a fresh bridge with current code
```

If `stop` does nothing (the bridge was started without a PID file, or the PID file was
deleted), kill it by port instead:
```sh
lsof -ti :9224 | xargs kill
```

## Architecture notes

### Bridge transport model

The bridge maintains **one** MCP client connected to `opera-devtools-mcp` over stdio.
All HTTP requests from `opera-browser-cli` processes share that single MCP connection.

```
Terminal A ──HTTP──▶ bridge (port 9225) ──stdio──▶ opera-devtools-mcp ──CDP──▶ Opera
Terminal B ──HTTP──▶  (same bridge)
```

### Streaming (Opera AI tools)

`opera_do`, `opera_chat`, `opera_make`, `opera_research` are streamed: the bridge
keeps the HTTP response open and flushes `{"log": "..."}` lines as MCP
`notifications/message` arrive, then ends the response with `{"result": "..."}`.

The client (`client.ts → httpPost`) reads those lines and calls `onLog(msg)` which
writes to stderr so the user sees progress in real time.

### Concurrency

Non-Opera tools serialise through a mutex in `opera-devtools-mcp`. Opera tools bypass
that mutex and run in parallel. The bridge HTTP server handles concurrent requests
natively; see `specs/fix-parallel-streaming-routing.md` for the chunk-routing fix
required to support this correctly.
