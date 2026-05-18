# Task: Amazon product search — raw mode

**Mode:** raw (uncompressed MCP output)

Use `opera-browser-cli` to search Amazon for "rgb mechanical keyboards" and
return the top 5 results. For each result include:
- Product title
- Price (if visible)
- Product URL

## Rules

- Use `opera-browser-cli` for all browser interaction (it is available in PATH).
- Pass `--raw` on EVERY command that produces a snapshot, e.g.:
  - `opera-browser-cli open <url> --raw`
  - `opera-browser-cli snapshot --raw`
  - `opera-browser-cli scroll down --raw`
  - `opera-browser-cli click @<ref> --raw`
- Skip sponsored/ad results; only list organic results.
- If you need to scroll to find more results, do so.
- When you are done, output the 5 results in this exact format and nothing else:

```
1. <title> | <price or "n/a"> | <url>
2. <title> | <price or "n/a"> | <url>
3. <title> | <price or "n/a"> | <url>
4. <title> | <price or "n/a"> | <url>
5. <title> | <price or "n/a"> | <url>
```

Start now.
