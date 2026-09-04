# Agentic benchmark v3 — task suite

Six real-world browser tasks, each run by a **fresh Haiku 4.5 agent** against three
builds of `opera-browser-cli`. Every agent gets an identical prompt except the path
to the binary it must use; each version's own `help` output is its only primer, so
the "help diet" introduced in compact v2 is measured rather than papered over by a
hand-written primer.

## Conditions

| Id | Build | Commit | What it has |
|---|---|---|---|
| `v1` | `main` | `65428db` | Pre-compact-v2 baseline: role renames, URL v2, description dedup, text-run collapse |
| `v2` | branch | `d9a1f4f` | + landmark collapse, ref stripping, windowing (`--next`), ref-prefix factoring, post-action diffs, `find`, `chain`, `--quiet/--expect` |
| `v3` | `HEAD` | `8397db3` | + unchanged short-circuit, stale-ref hints, `find` surfaced in truncation help, MCP `isError` surfacing |

## Measurement

Two independent instruments, neither of which relies on the agent's self-report:

1. **CLI shim** (`bin/_shim.zsh`) — wraps the condition binary, logging every
   invocation: argv, exit code, wall time, and the full stdout/stderr. This gives
   exact tool-output bytes, the causal driver of context growth, plus a ground-truth
   call count and a complete audit trail of what each agent saw.
2. **Subagent transcripts** (`~/.claude/projects/<session>/subagents/agent-*.jsonl`) —
   per-agent API usage: input, cache-write, cache-read, and output tokens, converted
   to dollars at Haiku 4.5 rates ($1.00/M in, $5.00/M out, $1.25/M cache write,
   $0.10/M cache read).

Accuracy is graded against answers pinned **before** any agent ran (below), verified
by the author driving the CLI directly.

## Controls

- **Sequential execution only.** The CLI's session state (`~/.opera-browser-cli/`:
  `last-tree.txt`, `prev-tree.txt`, `snapshot-state.json`, `last-url-map.json`) is a
  single machine-global directory with no per-session namespacing, and all conditions
  share one browser. Parallel agents would corrupt each other's diff baselines and
  window cursors. See finding S-1 in the review.
- **State reset between every run** — the four state files are deleted and the browser
  is parked on `about:blank`, so no run inherits another's diff baseline.
- **Condition-appropriate bridge** — the bridge is killed and restarted from the
  condition's own build before its runs (the bridge differs between v2 and v3).
- **Rotated condition order per task** so HTTP-cache warming does not systematically
  favour any one condition. Order actually run: T1 `v1,v2,v3` · T2 `v3,v2,v1` ·
  T3 `v1,v3,v2` · T4 `v2,v3,v1` · T5 `v1,v3,v2` · T6 `v2,v1,v3`. Token counts are
  cache-independent anyway; this matters only for the wall-time column.

## Pilot finding that shaped the rules (P-1)

The first two pilot runs (T1 on v1 and v2, discarded) were solved **without ever
looking at a snapshot**: both Haiku agents reached for `eval` and pulled the answer
out of the DOM with `document.querySelectorAll` / XPath. Snapshot compaction was
therefore never exercised, and the two conditions were indistinguishable.

This is a genuine result about agent behaviour — an unconstrained small model prefers
scripting the page over reading a compacted tree, so snapshot-token savings simply do
not materialise on read-only extraction tasks. It is reported as finding **A-1**. To
make the suite measure what it is meant to measure, the graded runs forbid `eval`.

## Tasks

Each task is given to the agent verbatim. Expected answers are never shown to agents.

### T1 `rfc-deep-read` — content far past the first snapshot window
> On https://www.rfc-editor.org/rfc/rfc9110.html, find the section that defines the
> 404 status code. Report its section number and its exact title.

*Expected:* section **15.5.5**, title **"404 Not Found"**.
*Stresses:* truncation recovery (`--next` / `find` / `--full`) on a ~1MB document.

### T2 `spa-todomvc` — multi-step interaction loop on a React SPA
> Open https://demo.playwright.dev/todomvc and do this in order: add three todos named
> "alpha", "beta", "gamma" (type each name into the input and press Enter); then mark
> "beta" as completed by clicking its checkbox; then click the "Active" filter link.
> Report (a) the exact "items left" counter text and (b) which todo names are listed
> under the Active filter.

*Expected:* **"2 items left"**; Active shows **alpha and gamma**.
*Stresses:* post-action diffs vs full snapshots, ref stability across mutations, `chain`.

### T3 `web-form` — form fill, submit, read result page
> Open https://www.selenium.dev/selenium/web/web-form.html, fill the "Text input" field
> with "Jan Kowalski" and the "Password" field with "secret1", then click the Submit
> button. Report the heading and the message text shown on the page you land on.

*Expected:* heading **"Form submitted"**, message **"Received!"**.
*Stresses:* `fill`/`fillform`, navigation-triggered full-snapshot fallback, `--expect`.

### T4 `table-extract` — one row out of a very large data table
> On https://en.wikipedia.org/wiki/List_of_chemical_elements, report the atomic number,
> the chemical symbol, and the standard atomic weight of Tungsten.

*Expected:* **74**, **W**, **183.84**.
*Stresses:* `find` on a ~90KB tree; robustness of text-run collapsing on table rows
(see finding C-1 — the row cells are merged without separators in *all* conditions).

### T5 `wiki-journey` — multi-page navigation
> Starting from https://en.wikipedia.org/wiki/Moon, navigate to the "Giant-impact
> hypothesis" article by following a link on the Moon page (do not type its URL
> directly), then report approximately how long ago the giant impact is estimated to
> have occurred.

*Expected:* **~4.5 billion years ago** (4.4–4.6 Gya accepted).
*Stresses:* URL LUT, link discovery on a huge page, cross-page ref invalidation.

### T6 `shop-navigate` — real site, browse + compare
> Open https://books.toscrape.com/, navigate to the "Travel" category by clicking its
> link, and report (a) how many results the category shows and (b) the title and price
> of the cheapest book in it.

*Expected:* **11 results**; cheapest is **"The Road to Little Dribbling: Adventures of
an American in Britain (Notes From a Small Island #2)"** at **£23.21**.
*Stresses:* click-through navigation, list/price extraction, wrapper flattening.

## Agent prompt (identical across conditions bar `<BIN>`)

```
You are testing a browser-automation CLI. Drive the browser using ONLY this exact
command: <BIN>

Hard rules:
- Never use the bare `opera-browser-cli` command or any other path — only <BIN>.
- Never use WebFetch, WebSearch, curl, or any other way of reading the page. The
  browser CLI is the only permitted source of page content.
- Do not use the CLI's `eval` command (or any other JavaScript execution) to read page
  content. Treat JavaScript evaluation as unavailable: everything you learn about the
  page must come from the CLI's page-inspection commands. You may still use the
  interaction commands (click/fill/press/...) freely.
- Do not edit files, do not run git.
- Start by running `<BIN> help` to see what commands exist, then use them.
- Work efficiently: minimise both the number of CLI calls and the amount of output
  you pull into context. If output is truncated, use whatever the CLI offers for
  reading more rather than always asking for everything.

TASK: <task text>

Finish with exactly these two lines:
ANSWER: <one line>
CALLS: <how many CLI invocations you made>
```
