---
name: opera-browser-cli
description: Browser automation and web interaction using the opera-browser-cli tool. Use for navigating pages, clicking elements, filling forms, taking screenshots, inspecting console/network, running performance audits, and Opera AI features (chat available on any Opera browser; invoke-do, make, research require Opera Neon).
---

# Skill: opera-browser-cli Browser Automation

`opera-browser-cli` controls a Opera browser browser session.

- **Standard commands** (`open`, `click`, `fill`, `screenshot`, etc.) — work with any Opera browser session.
- **`chat`** — available on any Opera browser.
- **`invoke-do`, `make`, `research`** — require **Opera Neon** with an active sign-in.

Run `opera-browser-cli --help` for the full command list, or `opera-browser-cli <command> --help` for per-command flags and examples.

```bash
opera-browser-cli open https://example.com   # start here — navigate and snapshot the page
```

If a user hits `Opera: user is not signed in` on an AI command, suggest they sign in to their Opera account. `invoke-do`, `make`, and `research` require Opera Neon with an active sign-in. Run `opera-browser-cli setup` or `opera-browser-cli doctor` to configure or diagnose.
