<h1 align="center">opera-browser-cli</h1>

<h3 align="center">The most agent-ergonomic browser automation</h3>

`opera-browser-cli` is a fork of [chrome-devtools-axi](https://github.com/kunchenguid/chrome-devtools-axi).
It wraps [opera-devtools-mcp](https://github.com/operasoftware/opera-devtools-mcp) with an [AXI](https://axi.md)-compliant CLI.

- **Token-efficient** — TOON-encoded output cuts token usage ~40% vs raw JSON
- **Combined operations** — one command navigates, captures, and suggests next steps
- **Contextual suggestions** — every response includes actionable next-step hints

## Quick Start

```sh
npm install -g opera-browser-cli
opera-browser-cli setup   # interactive wizard — run in a terminal where you can answer prompts
opera-browser-cli open https://example.com
```

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

Run first-time setup — this is an interactive wizard, so run it in a terminal where you can answer prompts:

```sh
opera-browser-cli setup
```

This detects Opera installations, lets you pick one, saves configuration to `~/.opera-browser-cli/config`, and installs the Claude Code skill to `~/.claude/skills/opera-browser-cli/SKILL.md`.

Verify:

```sh
opera-browser-cli --version
opera-browser-cli open https://example.com
```

### From source

```sh
# in this repo
npm install && npm run build && npm link
```

Then run `opera-browser-cli setup` as above.

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
│  opera-browser-cli  │  CLI — parse args, format output
└──────────┬────────────┘
           │ HTTP (localhost:9225)
           ▼
┌───────────────────────┐
│     Bridge Server     │  Persistent process, manages MCP session
└──────────┬────────────┘
           │ stdio
           ▼
┌───────────────────────┐
│  opera-devtools-mcp  │  Headless Chrome via DevTools Protocol
└───────────────────────┘
```

- **Persistent bridge** — a detached process keeps the MCP session alive across commands, so Chrome doesn't restart every invocation
- **Auto-lifecycle** — the bridge starts on first command and writes a PID file to `~/.opera-browser-cli/bridge.pid`
- **Snapshot parsing** — accessibility tree snapshots are extracted and analyzed for interactive elements (`uid=` refs)
- **TOON encoding** — structured metadata uses [TOON format](https://www.npmjs.com/package/@toon-format/toon) for compact, token-efficient output

## CLI Reference

### Navigation

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
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
| -------------------------- | ------------------------------ |
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
| ----------------- | --------------------------- |
| `pages`           | List all open tabs          |
| `newpage <url>`   | Open a new tab              |
| `selectpage <id>` | Switch to a tab by ID       |
| `closepage <id>`  | Close a tab by ID           |
| `resize <w> <h>`  | Resize the browser viewport |

### Emulation

| Command   | Description                     |
| --------- | ------------------------------- |
| `emulate` | Emulate device/network/viewport |

### DevTools Debugging

| Command            | Description                    |
| ------------------ | ------------------------------ |
| `console`          | List console messages          |
| `console-get <id>` | Get a specific console message |
| `network`          | List network requests          |
| `network-get [id]` | Get a specific network request |

### Performance

| Command                     | Description                   |
| --------------------------- | ----------------------------- |
| `lighthouse`                | Run a Lighthouse audit        |
| `perf-start`                | Start a performance trace     |
| `perf-stop`                 | Stop the performance trace    |
| `perf-insight <set> <name>` | Analyze a performance insight |
| `heap <path>`               | Capture a heap snapshot       |

### Opera AI

| Command             | Description                                   | Requires       |
| ------------------- | --------------------------------------------- | -------------- |
| `chat <prompt>`     | Send a chat message to Opera's built-in AI    | Any Opera           |
| `invoke-do <prompt>`| Ask the AI to perform a complex browsing task | Opera Neon     |
| `make <prompt>`     | Ask the AI to build a webpage or app          | Opera Neon     |
| `research <prompt>` | Ask the AI to research a topic in depth       | Opera Neon     |

`research` accepts `--type local` (default), `--type one-minute`, or `--type deep`.

### Configuration

| Command  | Description                                      |
| -------- | ------------------------------------------------ |
| `setup`  | Interactive first-time setup (browser path, etc) |
| `doctor` | Check configuration and environment              |
| `logs`   | Show bridge server logs                          |

### Bridge

| Command | Description             |
| ------- | ----------------------- |
| `start` | Start the bridge server |
| `stop`  | Stop the bridge server  |

Running with no command shows the CLI home view. It prepends `bin` and
`description` metadata, then includes the current snapshot when a browser
session is active or the no-session status/help block when one is not.

### Flags

| Flag                        | Description                                 |
| --------------------------- | ------------------------------------------- |
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

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPERA_CLI_PORT` | `9225` | Bridge server port |
| `OPERA_CLI_MCP_BIN` | _(bundled `opera-devtools-mcp`)_ | Override the MCP server binary |
| `OPERA_CLI_EXECUTABLE_PATH` | _(system Chrome)_ | Custom browser binary |
| `OPERA_CLI_BROWSER_URL` | — | Connect to an existing browser instance instead of launching one |
| `OPERA_CLI_USER_DATA_DIR` | — | Persistent Chrome profile directory (skips isolated mode) |
| `OPERA_CLI_HEADED` | — | Set to `1` to run in headed (visible) mode |
| `OPERA_CLI_CHROME_ARGS` | — | Extra Chrome flags, space-separated |
| `OPERA_CLI_DISABLE_HOOKS` | — | Set to `1` to skip auto-installing session hooks |

State is stored in `~/.opera-browser-cli/`:

| File         | Purpose                            |
| ------------ | ---------------------------------- |
| `bridge.pid` | PID and port of the running bridge |

### Session Hooks

On supported agents, the packaged CLI also installs a `SessionStart` hook in `~/.claude/settings.json` and `~/.codex/hooks.json`, and enables `codex_hooks` in `~/.codex/config.toml`.

Set `OPERA_CLI_DISABLE_HOOKS=1` to skip that auto-install behavior.

Development entrypoints such as `npm run dev` and `bin/opera-browser-cli.ts` do not modify those hook files.

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

## Development

```sh
npm run build      # Compile TypeScript to dist/
npm run dev        # Run CLI directly with tsx
npm test           # Run tests with vitest
npm run test:watch # Run tests in watch mode
```
