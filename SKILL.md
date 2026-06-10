---
name: opera-browser-cli
description: Browser automation and web interaction using the opera-browser-cli tool. Use for navigating pages, clicking elements, filling forms, taking screenshots, inspecting console/network, running performance audits, and Opera AI features (chat available on any Opera browser; invoke-do, make, research require Opera Neon).
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

## Sign-in errors

If you hit `Opera: user is not signed in` on an AI command, suggest signing in to their Opera account. Run `opera-browser-cli setup` or `opera-browser-cli doctor` to configure or diagnose.
