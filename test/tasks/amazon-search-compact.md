# Task: Amazon product search — compact mode

**Mode:** compact (default opera-browser-cli output)

Use `opera-browser-cli` to search Amazon for "rgb mechanical keyboards" and
return the top 5 results. For each result include:
- Product title
- Price (if visible)
- Product URL (resolve via `opera-browser-cli url @<ref>` if the URL is
  tokenised as `$uN` in the snapshot)

## Rules

- Use `opera-browser-cli` for all browser interaction (it is available in PATH).
- Do NOT pass `--raw` to any command — use the default compact output.
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
