# Agent Task Cost Benchmarks

These tasks measure the real token cost of agent-driven browser automation
under two snapshot formats — **compact** (default) and **raw** (MCP verbatim).

## How to run a task

1. Open a **fresh Claude Code session** (clear context or start new).
2. Paste the entire contents of a task file as your first message.
3. Let Claude complete the task.
4. Run `/cost` to record the session cost.
5. Repeat with the matching `*-raw` variant.

Compare the `/cost` output between the two runs. The compact vs raw difference
shows the real-world token saving an agent gets on that page type.

## Tasks

| File | Scenario | Expected saving |
|---|---|---|
| `amazon-search-compact.md` / `*-raw.md` | Amazon product search → top 5 results | High (many long tracking URLs) |
| `hn-top-stories-compact.md` / `*-raw.md` | Hacker News front page → top 5 stories | Medium (link-heavy, clean URLs) |

## Notes

- Results will differ between runs (dynamic pages). That's fine — the goal is
  cost comparison, not result comparison.
- Both variants do the same task; only the snapshot format changes.
- The raw variants explicitly pass `--raw` on every command so the agent sees
  the uncompressed MCP output.
- Record your `/cost` output next to the task file for tracking over time.
