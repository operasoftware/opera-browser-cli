<h1 align="center">opera-browser-cli</h1>

<h3 align="center">The most agent-ergonomic browser automation</h3>

`opera-browser-cli` is a fork of [chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi).
It wraps [opera-devtools-mcp](https://github.com/operasoftware/opera-devtools-mcp) with an [AXI](https://axi.md)-compliant CLI.

- **Token-efficient** — compact page snapshots cut token usage up to 80% vs raw MCP; TOON encoding reduces metadata overhead further (`opera-compact` in [benchmarks](#benchmarks))
- **Combined operations** — one command navigates, captures, and suggests next steps
- **Contextual suggestions** — every response includes actionable next-step hints

## Quick Start

```sh
npm install -g opera-browser-cli
opera-browser-cli open https://example.com
```

That is the whole setup. The first command detects your Opera installation,
writes `~/.opera-browser-cli/config`, and gets on with it. Run
`opera-browser-cli setup` only when you want to change what it chose.

Once installed, `open` navigates to a URL and returns a structured snapshot you can act on:

```sh
$ opera-browser-cli open https://example.com
page: {title: "Example Domain", url: "https://example.com", refs: 1}
snapshot:
RootWebArea "Example Domain"
  heading "Example Domain"
  paragraph "This domain is for use in illustrative examples..."
  uid=1 link "More information..."
help[1]:
  Run `opera-browser-cli click @1` to click the "More information..." link

$ opera-browser-cli click @1
page: {title: "IANA — IANA-Managed Reserved Domains", refs: 12}
snapshot:
...
```

### Opera AI features

With any Opera browser, you can use the built-in AI chat:

```sh
opera-browser-cli chat "summarise this page"       # ask the built-in AI about the current page
```

[Opera Neon](https://www.operaneon.com) additionally unlocks three advanced AI commands:

```sh
opera-browser-cli invoke-do "book a table for 2"   # let the AI perform a multi-step browsing task
opera-browser-cli make "a todo app in vanilla JS"  # generate and open a webpage or mini-app
opera-browser-cli research "solid-state batteries" # in-depth research across multiple sources
```

Run `opera-browser-cli setup` to get started, or `opera-browser-cli doctor` to check your configuration.

## Install

Prerequisites: **Node.js >= 20**, **Opera** browser ([Opera Neon](https://www.operaneon.com) recommended for AI features).

### npm (recommended)

```sh
npm install -g opera-browser-cli
```

No setup step is required. The first command you run detects your Opera
installation, writes `~/.opera-browser-cli/config`, and continues:

```sh
opera-browser-cli --version
opera-browser-cli open https://example.com
```

`setup` exists for when you want to change that choice — pick a different
browser or profile, or install the agent skill files:

```sh
opera-browser-cli setup             # interactive wizard
opera-browser-cli setup -y          # detect and accept, no prompts
opera-browser-cli setup --executable "/Applications/Opera Neon.app/Contents/MacOS/Opera" \
                        --profile skip --headless
```

It saves to `~/.opera-browser-cli/config` and installs the skill to
`~/.claude/skills/opera-browser-cli/SKILL.md` (Claude Code) and
`~/.agents/skills/opera-browser-cli/SKILL.md` (generic cross-agent path used by
Codex and other agents). The non-interactive form needs no terminal, so agents
and provisioning scripts can run it too.

### From source

```sh
# in this repo
npm install && npm run build && npm link
```

Then just run a command — configuration happens on first use.

### Usage examples

```sh
# Basic navigation
opera-browser-cli open https://example.com

# Use Opera as the browser
OPERA_CLI_EXECUTABLE_PATH="/Applications/Opera.app/Contents/MacOS/Opera" \
  opera-browser-cli open https://example.com

# Headed mode (visible browser window)
OPERA_CLI_HEADED=1 opera-browser-cli open https://example.com

# Persistent profile (stay logged in across sessions)
OPERA_CLI_USER_DATA_DIR=~/.opera-profile opera-browser-cli open https://example.com

# Connect to already-running browser
OPERA_CLI_BROWSER_URL=http://127.0.0.1:9222 opera-browser-cli open https://example.com
```

## How It Works

```
┌───────────────────────┐
│  opera-browser-cli    │  CLI — parse args, format output
└──────────┬────────────┘
           │ HTTP (localhost:9225)
           ▼
┌───────────────────────┐
│     Bridge Server     │  Persistent process, manages MCP session
└──────────┬────────────┘
           │ stdio
           ▼
┌───────────────────────┐
│  opera-devtools-mcp   │  Headless Chrome via DevTools Protocol
└───────────────────────┘
```

- **Persistent bridge** — a detached process keeps the MCP session alive across commands, so Chrome doesn't restart every invocation
- **Auto-lifecycle** — the bridge starts on first command, writes a PID file to `~/.opera-browser-cli/bridge.pid`, and restarts itself on version skew or a dropped connection
- **Snapshot parsing** — accessibility tree snapshots are extracted and analyzed for interactive elements (`uid=` refs)
- **TOON encoding** — structured metadata uses [TOON format](https://www.npmjs.com/package/@toon-format/toon) for compact, token-efficient output

## CLI Reference

### Navigation

| Command           | Description                                  |
|-------------------|----------------------------------------------|
| `open <url>`      | Navigate to URL and snapshot                 |
| `snapshot`        | Capture current page state                   |
| `screenshot <p>`  | Save a screenshot to a file                  |
| `scroll <dir>`    | Scroll: up, down, top, bottom                |
| `back`            | Navigate back                                |
| `wait <ms\|text>` | Wait for time or text to appear              |
| `eval <js>`       | Evaluate a JavaScript expression or function |
| `run`             | Execute a multi-step script from stdin       |

`eval` wraps plain input as `() => (<expr>)` before sending it to DevTools. For multi-statement logic, pass an arrow function, `function`, or IIFE yourself.

```sh
opera-browser-cli eval "document.title"
opera-browser-cli eval "(() => { const rows = [...document.querySelectorAll('tr')]; return rows.map((row) => row.textContent) })()"
```

### Interaction

| Command                    | Description                    |
|----------------------------|--------------------------------|
| `click @<uid>`             | Click an element by ref        |
| `fill @<uid> <text>`       | Fill a form field              |
| `type <text>`              | Type text at current focus     |
| `press <key>`              | Press a keyboard key           |
| `hover @<uid>`             | Hover over an element          |
| `drag @<from> @<to>`       | Drag an element onto another   |
| `fillform @<uid>=<val>...` | Fill multiple form fields      |
| `dialog <accept\|dismiss>` | Handle a browser dialog        |
| `upload @<uid> <path>`     | Upload a file through an input |

### Page Management

| Command           | Description                 |
|-------------------|-----------------------------|
| `pages`           | List all open tabs          |
| `newpage <url>`   | Open a new tab              |
| `selectpage <id>` | Switch to a tab by ID       |
| `closepage <id>`  | Close a tab by ID           |
| `resize <w> <h>`  | Resize the browser viewport |

### Emulation

| Command   | Description                     |
|-----------|---------------------------------|
| `emulate` | Emulate device/network/viewport |

### DevTools Debugging

| Command            | Description                    |
|--------------------|--------------------------------|
| `console`          | List console messages          |
| `console-get <id>` | Get a specific console message |
| `network`          | List network requests          |
| `network-get [id]` | Get a specific network request |

### Performance

| Command                     | Description                   |
|-----------------------------|-------------------------------|
| `lighthouse`                | Run a Lighthouse audit        |
| `perf-start`                | Start a performance trace     |
| `perf-stop`                 | Stop the performance trace    |
| `perf-insight <set> <name>` | Analyze a performance insight |
| `heap <path>`               | Capture a heap snapshot       |

### MCP Hub

| Command                                       | Description                                           | Requires         |
|-----------------------------------------------|-------------------------------------------------------|------------------|
| `mcp-servers`                                 | List MCP servers registered in the browser            | Opera Neon       |
| `mcp-tools --server <name>`                   | List tools exposed by a specific MCP server           | Opera Neon       |
| `mcp-call --server <name> --tool <name>`      | Execute a tool on an MCP server                       | Opera Neon       |

### Opera AI

| Command              | Description                                   | Requires   |
|----------------------|-----------------------------------------------|------------|
| `chat <prompt>`      | Send a chat message to Opera's built-in AI    | Any Opera  |
| `invoke-do <prompt>` | Ask the AI to perform a complex browsing task | Opera Neon |
| `make <prompt>`      | Ask the AI to build a webpage or app          | Opera Neon |
| `research <prompt>`  | Ask the AI to research a topic in depth       | Opera Neon |

`research` accepts `--type local` (default), `--type one-minute`, or `--type deep`.

### Configuration

| Command  | Description                                      |
|----------|--------------------------------------------------|
| `setup`  | Interactive first-time setup (browser path, etc) |
| `doctor` | Check configuration and environment              |
| `doctor --fix` | Repair what can be repaired mechanically   |
| `login` | Sign in to your Opera account (needed for AI)    |
| `logs`   | Show bridge server logs                          |

### Using your real Opera profile

By default the CLI launches its own browser. To drive **your** Opera — with your
logins, your session — the browser has to have been started with a debugging
port. That flag cannot be added to a browser that is already open, so there are
two ways in:

```sh
opera-browser-cli launch-args   # prints the command to start Opera with a port
```

Start Opera that way once, and every later command finds it automatically — the
port is recorded in `DevToolsActivePort` inside the profile, so nothing needs
configuring. Or let the CLI do it for you:

```sh
opera-browser-cli open example.com    # detects the conflict, offers to restart Opera
opera-browser-cli open example.com --takeover   # skip the prompt (scripts, agents)
```

If Opera is already running on the configured profile and has no debugging port,
the CLI asks whether to restart it (tabs are restored). Without a terminal to ask
in, it quietly uses a separate profile instead — an agent will never quit your
browser on its own. Restarting is always SIGTERM, never SIGKILL: a forced kill
risks a corrupted profile.

```sh
opera-browser-cli attach --port 9222   # connect to a specific endpoint
opera-browser-cli attach --clear       # go back to a CLI-launched browser
```

> **Note:** a debugging port has no authentication of its own — the CLI's bearer
> token protects the bridge, not the browser. Any local process can drive a
> browser with an open port, and this one is signed into everything you are. The
> CLI lets the browser pick a random port rather than a predictable 9222, binds
> it to loopback, and never passes `--remote-allow-origins`, which is what stops
> a web page from driving it. Close the browser when you are done.

### Bridge

| Command   | Description                                                        |
|-----------|--------------------------------------------------------------------|
| `start`   | Start the bridge server                                            |
| `stop`    | Stop the bridge server (escalates to SIGKILL; clears a stale PID)  |
| `restart` | Stop and start again — forces a clean state                        |
| `status`  | Report bridge pid, port, and running version without starting one  |

You should rarely need any of these. The bridge starts on first use, and repairs
itself without being asked:

- **Upgraded package** — a bridge running pre-upgrade code is detected by version
  and replaced on the next command.
- **Crashed or killed bridge** — the next command restarts it and retries. Opera AI
  commands are the exception: they are never silently re-run, since they may already
  have acted on the page.
- **Port in use** — the next port in the range is used instead of failing.
- **Several commands at once** — a start lock means exactly one bridge comes up.
- **Stale PID file** — cleared automatically, and never signalled if the PID could
  belong to an unrelated process from before a reboot.

### Exit codes

Scripts and agents can branch on why a command failed without parsing messages:

| Code | Meaning | Caller action |
|---|---|---|
| 0 | Success | — |
| 1 | Unknown / internal | Report |
| 2 | Bad arguments, or unsupported on this browser | Fix the command |
| 3 | Environment not ready after auto-recovery | Run `doctor` |
| 4 | Sign-in, subscription, or consent required | Ask the user |
| 5 | Timed out | Retry |
| 6 | Stale element ref or closed page | Re-snapshot, then retry |

Running with no command shows the CLI home view. It prepends `bin` and
`description` metadata, then includes the current snapshot when a browser
session is active or the no-session status/help block when one is not.

### Flags

| Flag                        | Description                                 |
|-----------------------------|---------------------------------------------|
| `--help`                    | Show usage information                      |
| `-v`, `-V`, `--version`     | Show the installed CLI version              |
| `--full`                    | Show complete output without truncation     |
| `--background`              | Open new page in background (newpage)       |
| `--uid @<uid>`              | Target a specific element (screenshot)      |
| `--full-page`               | Capture entire scrollable page (screenshot) |
| `--format <fmt>`            | Image format: png, jpeg, webp (screenshot)  |
| `--viewport <spec>`         | Viewport like "390x844x3,mobile" (emulate)  |
| `--color-scheme <value>`    | dark, light, or auto (emulate)              |
| `--network <condition>`     | Network throttle: Slow 3G, etc. (emulate)   |
| `--cpu <rate>`              | CPU throttling rate 1-20 (emulate)          |
| `--geolocation <lat>x<lon>` | Set geolocation (emulate)                   |
| `--user-agent <string>`     | Custom user agent (emulate)                 |
| `--type <type>`             | Filter by type (console, network)           |
| `--limit <n>`               | Max items to return (console, network)      |
| `--page <n>`                | Pagination (console, network)               |
| `--device <device>`         | desktop or mobile (lighthouse)              |
| `--mode <mode>`             | navigation or snapshot (lighthouse)         |
| `--output-dir <path>`       | Directory for reports (lighthouse)          |
| `--no-reload`               | Skip page reload (perf-start)               |
| `--no-auto-stop`            | Disable auto-stop (perf-start)              |
| `--file <path>`             | Save trace data to file (perf-start/stop)   |
| `--response-file <path>`    | Save response body (network-get)            |
| `--request-file <path>`     | Save request body (network-get)             |

## Configuration

| Variable                    | Default                          | Purpose                                                          |
|-----------------------------|----------------------------------|------------------------------------------------------------------|
| `OPERA_CLI_PORT`            | `9225`                           | Base bridge port; the next 9 are tried if it is occupied         |
| `OPERA_CLI_MCP_BIN`         | _(bundled `opera-devtools-mcp`)_ | Override the MCP server binary                                   |
| `OPERA_CLI_EXECUTABLE_PATH` | _(system Chrome)_                | Custom browser binary                                            |
| `OPERA_CLI_BROWSER_URL`     | —                                | Connect to an existing browser instance instead of launching one |
| `OPERA_CLI_USER_DATA_DIR`   | —                                | Persistent Chrome profile directory (skips isolated mode)        |
| `OPERA_CLI_HEADED`          | `1` when an Opera binary is configured | `1` headed, `0` headless. Opera AI needs a window to sign in |
| `OPERA_CLI_CHROME_ARGS`     | —                                | Extra Chrome flags, space-separated                              |
| `OPERA_CLI_ENABLE_HOOKS`    | —                                | Set to `1` to auto-install session hooks on startup              |
| `OPERA_CLI_TAKEOVER`        | —                                | Set to `1` to restart a running Opera without asking             |

State is stored in `~/.opera-browser-cli/`:

| File         | Purpose                            |
|--------------|------------------------------------|
| `bridge.pid` | PID and port of the running bridge |

### Session Hooks

Session hooks are opt-in. Set `OPERA_CLI_ENABLE_HOOKS=1` to have the packaged CLI auto-install a `SessionStart` hook in `~/.claude/settings.json` and `~/.codex/hooks.json` (and enable `codex_hooks` in `~/.codex/config.toml`) on supported agents.

Development entrypoints such as `npm run dev` and `bin/opera-browser-cli.ts` do not modify those hook files.

## Docker / OpenClaw

A ready-made Docker setup runs `opera-browser-cli` as a tool inside an
[OpenClaw](https://openclaw.ai) agent gateway, with a headless Chrome sidecar handling
the browser. No local browser or Node.js install is required on the host — Docker is
the only prerequisite. The skill is registered automatically so OpenClaw agents can
invoke `opera-browser-cli` commands directly.

The `docker/` directory ships with the npm package:

```sh
cd "$(npm root -g)/opera-browser-cli/openclaw"
```

See [`openclaw/README.md`](openclaw/README.md) for the full setup guide.

## Local Setup (Full Stack)

Both `opera-devtools-mcp` and `opera-browser-cli` need to be built and linked so they're available in PATH.

**1. Build and link `opera-devtools-mcp`:**

```sh
# in the opera-devtools-mcp repo
npm install
npm run build
npm link
```

**2. Build and link `opera-browser-cli`:**

```sh
# in this repo
npm install
npm run build
npm link
```

**3. Set the browser executable path:**

```sh
export OPERA_CLI_EXECUTABLE_PATH="/Applications/Opera Neon.app/Contents/MacOS/Opera"
```

**Tip:** Set `OPERA_CLI_MCP_BIN` to point to the locally linked `opera-devtools-mcp`:

```sh
export OPERA_CLI_MCP_BIN=opera-devtools-mcp
```

**Tip:** Set `OPERA_CLI_HEADED=1` to launch the browser in headed (visible) mode — useful during development to watch what's happening:

```sh
export OPERA_CLI_HEADED=1
```

## Benchmarks

### Page Snapshot

Runs snapshot command on 50 static pages (Wikipedia, GitHub, MDN, Python docs, RFC Editor) and counts output tokens via tiktoken. No LLM involved — purely mechanical measurement.

**Results (50 runs each):**

| Condition       | Avg tokens | Median tokens | p95 tokens |
|-----------------|------------|---------------|------------|
| `opera-compact` | 60.6k      | 24.3k         | 256.1k     |
| `opera-raw`     | 94.9k      | 45.1k         | 381.4k     |
| `axi`           | 98.5k      | 46.6k         | 396.9k     |
| `mcp-raw`       | 94.7k      | 45.0k         | 391.3k     |

`--full` variants (no char limit) are also measured; see the [detailed README](page-token-benchmark/README.md) and [results report](page-token-benchmark/results/report.md).

---

### Agentic Use

An LLM agent completes 7 browser tasks (adapted from the [axi bench-browser benchmark](https://github.com/kunchenguid/axi/tree/main/bench-browser)) across 4 conditions. Each run is graded pass/fail by an LLM judge. Captures input tokens, snapshot size, wall time, and tool call count.
The agent was selecting each tool with or without `--full` flag, depending on the context. 

**Results (35 runs each, 5 repeats × 7 tasks):**

| Condition            | Pass [%] | Avg input length [tokens] | Avg snapshot length [chars] | Avg task time [seconds] | Avg tool calls |
|----------------------|----------|---------------------------|-----------------------------|-------------------------|----------------|
| `opera-compact`      | 100%     | 36.3k                     | 83.1k                       | 6.8                     | 1.4            |
| `opera-raw `         | 100%     | 107.5k                    | 198.1k                      | 8.5                     | 1.6            |
| `axi`                | 100%     | 102.2k                    | 203.9k                      | 9.8                     | 1.5            |
| `mcp-raw`            | 100%     | 179.2k                    | 218.7k                      | 9.4                     | 2.1            |

> opera-compact saves **80%** total tokens vs mcp-raw baseline.

See the [detailed README](snapshot-agentic-use/README.md) and [results report](snapshot-agentic-use/results/v6/report.md).

---

## Development

```sh
npm run build      # Compile TypeScript to dist/
npm run dev        # Run CLI directly with tsx
npm test           # Run tests with vitest
npm run test:watch # Run tests in watch mode
```
