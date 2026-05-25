# Adding opera-browser-cli to OpenClaw (Docker)

`opera-browser-cli` can be added to any Docker-based OpenClaw setup. Two approaches —
pick whichever suits your workflow:

- **[Option A: Runtime install](#option-a-runtime-install)** — install into the running
  container, no image rebuild required
- **[Option B: Dockerfile](#option-b-dockerfile)** — extend the OpenClaw image so the
  install is baked in and fully persistent

> **Browser is generic headless Chromium, not Opera.** The sidecar uses
> `chromedp/headless-shell` (upstream Chromium). Standard automation commands
> (`open`, `newpage`, `snapshot`, `click`, `fill`, `type`, `screenshot`, `eval`,
> `pages`, `network`, `console`, `lighthouse`, …) work fine. Opera-specific
> commands — `chat`, `invoke-do`, `make`, `research` — **will not work**; they
> need an Opera browser with a signed-in user session.
>
> Do **not** run `opera-browser-cli setup` or `doctor` inside the container.
> Both are interactive Opera-Neon detectors and will fail. All required env vars
> are injected by the compose file — no further config is needed.

## Prerequisites

- Docker Desktop (Mac/Windows) or Docker Engine + Compose plugin (Linux)

## Compose changes (required for both options)

Add a headless Chrome sidecar and wire OpenClaw's network namespace to it:

```yaml
services:
  chrome:
    image: chromedp/headless-shell:latest
    ports:
      - "18789:18789"  # expose OpenClaw's gateway here — openclaw shares this netns
    restart: unless-stopped

  openclaw:
    # ... your existing config, with these additions:
    network_mode: "service:chrome"
    environment:
      OPERA_CLI_BROWSER_URL: http://localhost:9222
```

**Note:** `network_mode: "service:chrome"` is incompatible with `networks:` and `ports:`
on the `openclaw` service. Move any ports you were exposing on `openclaw` to the `chrome`
service instead (as shown above).

Then start the stack:

```bash
docker compose up -d
```

## Option A: Runtime install

No Dockerfile or image rebuild needed. Once the stack is up, run:

```bash
docker compose exec openclaw sh -c '
  npm install -g opera-browser-cli &&
  mkdir -p ~/.openclaw/skills/opera-browser-cli &&
  cp $(npm root -g)/opera-browser-cli/SKILL.md ~/.openclaw/skills/opera-browser-cli/SKILL.md
'
```

This installs the binary and registers the skill in one step. The SKILL.md is written
to the `openclaw-config` named volume and persists across restarts and `docker compose
down`. The binary lives in the container filesystem and is lost when the container is
recreated — re-run `npm install -g opera-browser-cli` after each `docker compose down`.

## Option B: Dockerfile

Extend the official OpenClaw image so the install is baked in and survives `docker
compose down`. Use the `Dockerfile` in this directory (the reference implementation
below), or create your own using it as a starting point.

Point your compose service at it:

```yaml
openclaw:
  build: .   # path to the directory containing the Dockerfile
  # ... rest of your existing config
```

Build once, then start normally:

```bash
docker compose build
docker compose up -d
```

Re-run `docker compose build` when a new version of `opera-browser-cli` is released.

## Reference implementation

This directory contains a complete working example for a standalone fresh install:

- `Dockerfile` — the Option B extension above
- `docker-compose.yml` — a full compose file including the Chrome sidecar
- `.env.example` — template for environment variables

For OpenClaw gateway configuration (mode, auth token, AI provider keys), see the
[OpenClaw docs](https://docs.openclaw.ai).

## Using opera-browser-cli

For the full command reference see [SKILL.md](../SKILL.md).

**From the host** (for manual testing or debugging):

```bash
docker compose exec openclaw opera-browser-cli <command>
```

### Opening pages

Because `OPERA_CLI_BROWSER_URL` is set, the CLI connects to the existing Chrome rather
than launching one. Use `newpage` to open a fresh tab:

```bash
opera-browser-cli newpage https://example.com
```

`open <url>` also works, but only after a `stop` first — which resets the bridge so it
reconnects cleanly:

```bash
opera-browser-cli stop
opera-browser-cli open https://example.com
```

Without `stop` first, `open` returns `No page selected` because no tab is pre-selected
when connecting to an already-running Chrome instance.

## Environment variables

`OPERA_CLI_BROWSER_URL` is the only variable required. Set it in your compose file as
shown above.

| Variable | Set to | Purpose |
|---|---|---|
| `OPERA_CLI_BROWSER_URL` | `http://localhost:9222` | Connect to the headless-shell sidecar instead of launching a browser |

Other `opera-browser-cli` variables (not needed unless customising):

| Variable | Purpose |
|---|---|
| `OPERA_CLI_EXECUTABLE_PATH` | Path to a browser binary (launch mode only — not relevant here) |
| `OPERA_CLI_CHROME_ARGS` | Extra Chrome flags (launch mode only) |
| `OPERA_CLI_HEADED` | `1` for headed mode — not useful in a headless container |
| `OPERA_CLI_USER_DATA_DIR` | Persistent Chrome profile path (launch mode only) |
| `OPERA_CLI_PORT` | Bridge HTTP port inside the container (default `9225`) |

## Troubleshooting

**`opera-browser-cli open` returns "No page selected"**

You are in connect mode. Use `newpage <url>` instead, or run `opera-browser-cli stop`
first and then `open`.

**Chrome connection errors (`Failed to fetch browser webSocket URL`)**

The headless-shell container may not be ready yet. Wait a few seconds and retry.
Check its status with `docker compose ps`.

**Chromium SIGTRAP / crash if using a different base image or architecture**

Debian's system Chromium (`apt install chromium`) crashes on ARM64 Docker Desktop
with `Trace/breakpoint trap (core dumped)`. Do not substitute it for the
`chromedp/headless-shell` sidecar.
