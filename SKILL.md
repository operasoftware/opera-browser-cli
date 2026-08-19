---
name: opera-browser-cli
description: Browser automation and web interaction using the opera-browser-cli tool. Use for navigating pages, clicking elements, filling forms, taking screenshots, inspecting console/network, running performance audits, and Opera AI features (chat available on any Opera browser; invoke-do, make, research require Opera Neon). When a browser is already running without automation enabled, this tool can restart it with a debug port (takeover) or use a separate profile — ask the user which they prefer. 
metadata: {"openclaw": {"requires": {"bins": ["opera-browser-cli"]}}}
---

# Skill: opera-browser-cli Browser Automation

`opera-browser-cli` controls an Opera browser session.

- **Standard commands** (`open`, `click`, `fill`, `screenshot`, etc.) — work with any Opera browser session.
- **`chat`** — available on any Opera browser. Use `--model <id>` to select an AI model.
- **`models`** — list available AI models for chat (shows IDs and which is the default).
- **`invoke-do`, `make`, `research`** — require **Opera Neon** with an active sign-in.

Run `opera-browser-cli --help` for the full command list, or `opera-browser-cli <command> --help` for per-command flags and examples.

```bash
opera-browser-cli open https://example.com   # start here — navigate and snapshot the page
```

## Snapshot format

By default snapshots are **compact**: role names are shortened, refs use `@PAGE.ELEM` form (e.g. `@2.4`), headings become markdown, and redundant ARIA attributes are stripped. Pass `--raw` to any snapshot-returning command to get the unprocessed MCP output instead.

Repeated or very long URLs in compact output are replaced with `$uN` tokens. A `urls:` trailer at the end of the snapshot lists what each token resolves to.

```
  @2.4 link "Download" url=$u1
  ...
urls:
  $u1 /downloads/installer-v3.2.1-x86_64.tar.gz
```

Use `opera-browser-cli url $uN` or `opera-browser-cli url @ref` to resolve a token or element ref to its full URL without taking a new snapshot.

## Flags available on snapshot-returning commands

| Flag     | Effect                                                       |
|----------|--------------------------------------------------------------|
| `--full` | Show complete snapshot without truncation                    |
| `--raw`  | Unprocessed MCP output (disables compact format and URL LUT) |

Commands that accept these flags: `open`, `snapshot`, `click`, `fill`, `type`, `press`, `scroll`, `back`, `hover`, `drag`, `fillform`, `upload`, `newpage`, `selectpage`.

## Running inside an OpenClaw container

To wire this CLI into a Docker-based OpenClaw setup (Chromium sidecar, shared netns, config bootstrap), see [`openclaw/README.md`](openclaw/README.md).

## Exit codes

Branch on the exit code rather than parsing messages:

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success | — |
| 2 | Bad arguments, or the browser cannot do this | Fix the command; do not retry as-is |
| 3 | Environment not ready after auto-recovery | Run `opera-browser-cli doctor` |
| 4 | Sign-in, subscription, or consent needed | Ask the user — you cannot fix this |
| 5 | Timed out | Retry |
| 6 | Stale element ref or closed page | Re-run `snapshot`, then retry with fresh refs |
| 1 | Anything else | Report it |

## Recovery is automatic

The bridge restarts itself on version skew, a crash, or a dropped connection, and falls back to another port if one is taken. Do not run `stop`/`restart` speculatively — just re-run the command. The exception is the Opera AI tools (`invoke-do`, `make`, `research`, `chat`): if one reports the connection dropped mid-call, it was **not** retried, because it may already have acted. Ask before re-running it.

## When the browser can't be automated

The CLI only drives a browser started with a debug port. If the user's Opera is already open **without** one, the CLI can't attach to that window — `open`/AI then fail with **"Could not connect to Chrome"**. Run `opera-browser-cli doctor` (it reports the profile state); the bridge self-heals, so don't restart it blindly.

**Always ask the user** — restarting their browser is their call, not a judgement you infer:
> "Your Opera is open but wasn't started with automation. May I restart it with a debug port (tabs restored)? Or should I use a separate profile (you'd sign in there)?"

- **They approve restart** → run with `--takeover` (or `OPERA_CLI_TAKEOVER=1`). Restarts with a debug port, restores tabs, attaches — drives the real browser thereafter.
- **They decline** → no flag → separate profile at `~/.opera-browser-cli/profile` (they sign in there; AI may then return exit `4` — surface it).
- `opera-browser-cli launch-args` prints the flags to start Opera attachable so a restart is never needed later.

## Sign-in errors

If an AI command fails with `AUTH_REQUIRED` (exit code 4) — not signed in, no subscription, or consent pending — tell the user to run `opera-browser-cli login`, which opens the Opera account page in a visible window. `opera-browser-cli login --check` verifies the current state. Run `opera-browser-cli doctor` to diagnose anything else.
