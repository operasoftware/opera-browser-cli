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
