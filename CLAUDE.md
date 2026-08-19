# opera-browser-cli — Claude guidance

## Repository overview

`opera-browser-cli` is a CLI tool and HTTP bridge that connects terminal users (and AI agents)
to a running Opera / Chrome browser session via the `opera-devtools-mcp` MCP server.

Key files:

| File | Role |
|---|---|
| `src/cli.ts` | Command parsing and dispatch (`opera-browser-cli <command>`) |
| `src/client.ts` | HTTP client for the bridge + bridge lifecycle (discovery, start lock, recovery) |
| `src/bridge.ts` | Persistent HTTP ↔ MCP adapter; spawns `opera-devtools-mcp` as a child process |
| `src/bridge.ts` → `runBridge()` | Entry point for the bridge process |
| `src/identity.ts` | Bridge identity contract — version skew and PID-recycling safety |
| `src/detect.ts` | Locating installed Opera builds |
| `src/config.ts` | Config read/write/validate, and first-run autoconfiguration |
| `src/profile.ts` | Profile lock (`SingletonLock`) and debug-port (`DevToolsActivePort`) inspection |
| `src/browser-target.ts` | Decides launch vs attach; quits and relaunches a browser on takeover |
| `src/version.ts` | Package version lookup shared by CLI, bridge, and `/health` |
| `bin/opera-browser-cli-bridge.js` | Bridge binary entrypoint (calls `runBridge`) |

### Bridge lifecycle invariants

Four rules hold the lifecycle together. Breaking any of them reintroduces a class of bug
that M1 removed — see `specs/robustness-hardening.md`.

1. **Never signal an unidentified PID.** A process is only signalled once it has answered
   `/health` as ours, or its PID file entry records the *current* boot (`identity.ts` →
   `sameBoot`). After a reboot a recycled PID may belong to anyone.
2. **Version equality, not just health.** A bridge on a different package version is
   unusable however healthy it looks — it is serving pre-upgrade code from memory.
3. **Bind the port before connecting to MCP.** `runBridge` listens first so that losing a
   start race costs nothing; connecting first would launch a browser only to discard it.
4. **Never silently replay an Opera AI tool.** `callTool` recovers dropped connections by
   restarting and retrying, except for `opera_do`/`opera_make`/`opera_research`/`opera_chat`,
   which may already have acted and are billable to re-run.

### Browser target invariants

5. **`--remote-debugging-port` is startup-only.** A browser the user opened normally can
   never be attached to. Everything in `browser-target.ts` follows from this.
6. **A live debug port beats the lock.** If `DevToolsActivePort` answers, attach — whatever
   `SingletonLock` says. Both files outlive the browser (a crash leaves the lock, a clean
   exit leaves the port file), so neither is trusted without confirming against the system.
7. **Never quit a browser unprompted.** Takeover needs a TTY answer or an explicit
   `--takeover`. Agents and other non-interactive callers fall back to a separate profile.
8. **SIGTERM, never SIGKILL, for a browser.** Chromium treats SIGTERM as a clean shutdown;
   SIGKILL risks a corrupted profile and loses the user's tabs. A browser that will not
   quit is reported, not forced.

### Caller-contract invariants

11. **Exit codes are a public interface.** `EXIT_CODES` in `cli.ts` is documented in
    `README.md` and `SKILL.md`, and agents branch on it. Changing a mapping is a breaking
    change; adding an `ErrorCode` means adding its exit code too.
12. **`AUTH_REQUIRED` is distinct from `BROWSER_ERROR`.** "Ask the user" (4) and "the
    environment is broken" (3) call for different responses, so entitlement failures must
    not be folded back into `BROWSER_ERROR`.

### Configuration invariants

9. **Config is a cache, not a prerequisite.** An absent config means "detect it now", never
   "fail" or "tell the user to run setup". `ensureConfigured` runs before every
   browser-touching command and works identically under an agent.
10. **Headless stays the default without a configured browser.** Headed is chosen only when
    an Opera binary is configured, because Opera AI sign-in needs a window. Machines with
    no display and no Opera — CI, Docker, the openclaw sidecar — must keep working.
    `OPERA_CLI_HEADED=0`/`=1` overrides either way.

## Benchmarks

Token-cost and agentic-quality measurements live in `benchmarks/`. See `benchmarks/CLAUDE.md` for file roles and how to run them.

## Specs directory

Planned and in-progress fixes are documented as Markdown specs in `specs/`.
Always check there before starting implementation work.

| Spec | Status |
|---|---|
| [`specs/robustness-hardening.md`](specs/robustness-hardening.md) | Planned — self-healing bridge, zero-config first run, graceful error handling |
| [`specs/fix-parallel-streaming-routing.md`](specs/fix-parallel-streaming-routing.md) | Planned — parallel chunk routing for concurrent Opera AI calls |
| [`specs/chat-model-selector.md`](specs/chat-model-selector.md) | Planned — model selector for chat command |

## Common issues

### Stale bridge after a rebuild — resolved as of M1

This used to require `opera-browser-cli stop`, or `lsof -ti :9224 | xargs kill` when the
PID file was missing. It no longer does: `/health` carries the package version, and a
bridge running different code is shut down and replaced automatically on the next
command. `opera-browser-cli status` shows the skew if you want to see it happen.

If a bridge ever does get wedged, `opera-browser-cli restart` is the one command to
reach for — it escalates to SIGKILL and clears any stale PID file.

## Architecture notes

### Bridge transport model

The bridge maintains **one** MCP client connected to `opera-devtools-mcp` over stdio.
All HTTP requests from `opera-browser-cli` processes share that single MCP connection.

```
Terminal A ──HTTP──▶ bridge (port 9225) ──stdio──▶ opera-devtools-mcp ──CDP──▶ Opera
Terminal B ──HTTP──▶  (same bridge)
```

### Streaming (Opera AI tools)

`opera_do`, `opera_chat`, `opera_make`, `opera_research`, `opera_call_mcp_tool`
are streamed: the bridge keeps the HTTP response open and flushes `{"log": "..."}`
lines as MCP `notifications/message` arrive, then ends the response with
`{"result": "..."}`. `opera_call_mcp_tool` streams when the underlying MCP tool
emits progress events.

The client (`client.ts → httpPost`) reads those lines and calls `onLog(msg)` which
writes to stderr so the user sees progress in real time.

### Concurrency

Non-Opera tools serialise through a mutex in `opera-devtools-mcp`. Opera tools bypass
that mutex and run in parallel. The bridge HTTP server handles concurrent requests
natively; see `specs/fix-parallel-streaming-routing.md` for the chunk-routing fix
required to support this correctly.
