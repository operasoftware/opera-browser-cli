# Task: Hacker News top stories — raw mode

**Mode:** raw (uncompressed MCP output)

Use `opera-browser-cli` to open Hacker News and return the top 5 stories.
For each story include:
- Story title
- Domain/source (e.g. "github.com")
- Points and comment count (if visible)
- URL of the story itself (not the HN comments page)

## Rules

- Use `opera-browser-cli` for all browser interaction (it is available in PATH).
- Pass `--raw` on EVERY command that produces a snapshot, e.g.:
  - `opera-browser-cli open <url> --raw`
  - `opera-browser-cli snapshot --raw`
  - `opera-browser-cli scroll down --raw`
  - `opera-browser-cli click @<ref> --raw`
- When you are done, output the 5 results in this exact format and nothing else:

```
1. <title> | <domain> | <points> pts <comments> comments | <url>
2. ...
```

Start now.
