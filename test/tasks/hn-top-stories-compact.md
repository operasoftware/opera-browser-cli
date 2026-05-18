# Task: Hacker News top stories — compact mode

**Mode:** compact (default opera-browser-cli output)

Use `opera-browser-cli` to open Hacker News and return the top 5 stories.
For each story include:
- Story title
- Domain/source (e.g. "github.com")
- Points and comment count (if visible)
- URL of the story itself (not the HN comments page)

## Rules

- Use `opera-browser-cli` for all browser interaction (it is available in PATH).
- Do NOT pass `--raw` to any command — use the default compact output.
- If a URL is tokenised as `$uN`, resolve it with `opera-browser-cli url $uN`.
- When you are done, output the 5 results in this exact format and nothing else:

```
1. <title> | <domain> | <points> pts <comments> comments | <url>
2. ...
```

Start now.
