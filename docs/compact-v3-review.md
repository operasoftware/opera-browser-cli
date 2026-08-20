# Critical review — `feat/compact-v2` (10 commits, `main`…`8397db3`)

Scope: `src/snapshot.ts` (+438), `src/cli.ts` (+573), `src/bridge.ts` (+7),
`src/suggestions.ts`, plus specs/docs/tests. Reviewed against `main`, with every claim
below either reproduced on the live CLI or traced to a specific line. Measured impact:
[`benchmarks/agentic-v3/results-2026-08-01.md`](../benchmarks/agentic-v3/results-2026-08-01.md).

## Verdict

The core bet is right and now measured: **58% cheaper than `main` on identical work**,
with the win concentrated exactly where the design predicted (large pages), and no
accuracy regression in 18 agent runs. Windowing (`--next`) is the load-bearing feature —
without it, `main` can only scroll and re-dump, and pays 3.6× on a 700KB document.

The problems are not in the compaction algorithms. They are in **discoverability**
(A-2: the two new commands are missing from `--help` and were used zero times in 18 runs),
**session identity** (B-2/B-3: state that is machine-global pretending to be per-agent),
and one **pre-existing bridge bug** that this benchmark tripped over twice and that will
bite real users (B-1).

## Bugs

### B-1 — A bridge that loses the port race deletes the *winning* bridge's PID file (high)

`runBridge` registers `process.on("exit", () => { removePidFile(); ... })` unconditionally
(`src/bridge.ts:670`) and installs no `error` handler on `server.listen`
(`src/bridge.ts:639`). A second bridge that fails to bind therefore crashes on
`EADDRINUSE` and, on the way out, unlinks `~/.opera-browser-cli/bridge.pid` — which
belongs to the healthy bridge still holding the port.

Every client then fails, because the auth token lives in that file
(`client.ts:106-109` → `checkRequestAccess`, `bridge.ts:276`):

```
error: unauthorized
code: UNKNOWN
hint: run `opera-browser-cli setup` to configure (first-time setup)
```

Reproduced deterministically:

```
$ ls ~/.opera-browser-cli/bridge.pid        # exists, bridge 58922 listening
$ node dist/bin/opera-browser-cli-bridge.js # second instance
second bridge exit=1
$ ls ~/.opera-browser-cli/bridge.pid
ls: No such file or directory
$ lsof -ti :9225
58922                                       # original still serving, now unusable
```

This is **pre-existing on `main`** (the exit handler is untouched by this branch), but it
is worth fixing here because the branch's `--expect`/`chain`/exit-code work makes the CLI
more attractive to script, and scripted use starts bridges concurrently.

It cost a real agent 10 wasted calls and ~4 minutes: the T3/v3 run
(`benchmarks/agentic-v3/logs/discarded-infra-v3-t3.tsv`) burned `setup`, `start`, `stop`,
`doctor`, `logs` chasing the hint, never recovered, and had to be re-run. The hint is
actively misleading — `setup` cannot fix this; only killing by port can. Note that
`setup` also *wrote a config file* pointing `OPERA_CLI_EXECUTABLE_PATH` at Google Chrome,
so the misleading hint has a side effect on the user's environment.

**Fix:** only remove the PID file if we wrote it — compare `pid` in the file against
`process.pid` before unlinking — and attach `server.on("error")` to exit with a clear
"another bridge already owns port N" message. Optionally teach the 401 path to say
"stale bridge — run `opera-browser-cli stop` or `lsof -ti :9225 | xargs kill`", which is
the fix CLAUDE.md already documents for the sibling `BRIDGE_NOT_READY` symptom.

**Fixed.** All three landed. Note that the PID file is now port-scoped
(`bridge-<port>.pid`, legacy `bridge.pid` still read when its recorded port matches), so
the paths in the reproduction above describe the pre-fix layout.

### B-1b — Two bridges on *different* ports also clobbered each other (high, found while fixing B-1)

The non-crash sibling of B-1: `writePidFile` ignored the port when choosing a filename, so
a second bridge on a different port succeeded at `listen` and silently overwrote the
first's PID and token — same 401 against a healthy bridge, no crash required. Worse,
`getBridgeStatus`, `stopBridge`, `getLastSnapshot`, and `getSessionSnapshotIfRunning` all
read the single global PID file while ignoring `OPERA_CLI_PORT` entirely, so on a custom
port they operated on the wrong bridge.

**Fixed** — PID files are port-scoped and every one of those call sites now resolves its
target port first.

### B-2 — The "unchanged" short-circuit is machine-global, so a fresh reader gets nothing (medium)

D7 compares the current page against `snapshot-state.json` and, on a match, returns a
one-line acknowledgement instead of the page (`cli.ts:1360-1380`). "Last shown" is a
property of a file in `~/.opera-browser-cli/`, not of the asking agent's context.

```
$ node dist/bin/opera-browser-cli.js open https://example.com   # process A
$ node dist/bin/opera-browser-cli.js snapshot                   # separate process
snapshot: unchanged since last shown — "Example Domain" (2 refs)
```

The second process has never seen the page. In practice that second process is a new
agent session, a session resumed after context compaction, or terminal B in the
two-terminal workflow CLAUDE.md documents. The recovery (`--force`) is suggested, so the
cost is one wasted round trip rather than a wrong answer — but it lands precisely on the
"session resumption" case `results-2026-07-18-v3.md` names as the feature's motivation,
where it does the opposite of what is wanted.

This fired in the graded runs: the v3/T1 agent hit
`snapshot: unchanged since last shown — "RFC 9110: HTTP Semantics" (3397 refs)` and then
escalated to `snapshot --full` twice — the most expensive escape hatch available (A-3).

**Fix:** make the short-circuit opt-in per consumer. Simplest workable version: have the
caller pass a session key (env var, defaulting to the parent PID or `CLAUDE_SESSION_ID`)
and key `snapshot-state.json` by it, so "unchanged since last shown" can only be said to
whoever was shown it.

### B-3 — All session state is one machine-global directory, so concurrent use corrupts it (medium)

`STATE_DIR` is `join(homedir(), ".opera-browser-cli")` with no override (`client.ts:13`,
`bridge.ts:37`), while `OPERA_CLI_PORT` *is* overridable. `last-tree.txt`, `prev-tree.txt`,
`snapshot-state.json`, and `last-url-map.json` are all written unconditionally by every
snapshot, action, and `find`. Two agents driving the same bridge — the documented
Terminal A / Terminal B model — will overwrite each other's diff baseline and window
cursor, producing diffs against the *other* agent's page and `--next` windows that jump.

This forced the benchmark to run strictly sequentially, which is why 18 runs took ~40
minutes of wall time.

**Fix:** add `OPERA_CLI_STATE_DIR`, and key the per-page files by target id so two pages
in one session don't share a baseline either.

### B-4 — `--help` is out of sync with the command registry (medium; see A-2 for impact)

`src/cli.ts:64` is a hand-written string beginning `commands[41]:`. The registry has 45
entries; `find` and `chain` are missing from the text. `flags[2]` lists only `--help` and
`--version` — never `--full`, `--raw`, `--next`, `--quiet`, `--expect`, `--force`, nor
`snapshot @ref`. Verified mechanically:

```
registry commands: 45
missing from --help: find, chain
```

**Fix:** generate the command list from `Object.keys(COMMANDS)` so it cannot drift, and
add a `flags` line for the snapshot-shaping options. This is a handful of lines and,
per A-2, likely the highest-leverage change left in the branch.

### B-5 — `chain` splits on `;` before tokenizing quotes (low)

`handleChain` does `args.join(" ").split(";")` (`cli.ts:2939`) and only afterwards applies
the quote-aware `tokenizeStep`. A step whose text legitimately contains a semicolon —
`chain 'fill @.7 "hello; world"'` — is split mid-string and both halves fail. The
quote-aware tokenizer exists; it is just applied one level too late.

### B-6 — `--expect` has no wait, so it races async UIs (low)

`formatActionOutput` checks the needle against the single snapshot taken with the action
(`cli.ts:1150-1160`) and throws `EXPECT_FAILED` if absent. On any page that updates after
a network round trip, the correct outcome and the failure are a timing coin flip. As the
CLI's only assertion primitive it should poll to a deadline (`--expect "text" --timeout 5s`)
rather than sample once.

### B-7 — Stale-ref recovery depends on upstream error wording (low)

`UID_NOT_FOUND_RE = /uid "?([\d_]+)"? not found/i` (`cli.ts:2989`) pattern-matches an
`opera-devtools-mcp` message. A reword upstream silently disables D2b — no test fails,
no hint appears, and the feature's absence is invisible. Worth a contract test against
the pinned MCP version, or an error-code check if one is available.

### B-8 — Action diffs leave the URL map and window cursor stale (low)

The diff path in `formatActionOutput` writes `last-tree.txt` but never refreshes
`last-url-map.json` or `snapshot-state.json`. After any diffed action, `url @u3` resolves
against the map from the previous full snapshot, and `snapshot --next` sees a signature
mismatch and silently restarts from the top of the page instead of continuing.

### B-9 — `find` caps at 20 matches with no way to see the rest (low)

`FIND_MAX_MATCHES = 20` prints `... (N more)` and offers no paging or narrowing hint.
For the search-the-page use case this is the same cliff `--next` was built to remove.

## Quality

### C-1 — Text-run collapsing concatenates without a separator, and it corrupts data (medium)

`collapseTextRuns` merges adjacent same-indent text nodes with `merged += next[2]` — no
separator (`snapshot.ts:462`). Consequences observed live, in **all three builds** (this
predates the branch):

- TodoMVC's counter renders as `2items left`. The v1 agent reported the exact text as
  `"2items left"` — the one substantively imperfect answer in 18 runs. v2/v3 agents got
  it right only by inferring the missing space.
- A Wikipedia table row becomes `text "56d-block180.9516.69329057310.141.52primordialsolid74W"`.
  Column boundaries are unrecoverable: `180.95` `16.69` `3290` `5731` is a guess. Both
  T4 agents had to reverse-engineer the schema, and both wrote out their reasoning about
  where the numbers split before answering.

The branch does not make this worse in the cases measured (v1 glues identically), but
wrapper flattening hoists table cells to sibling depth, which can only increase the number
of runs eligible to merge. **Fix:** join with a single space. One token per merge, and a
whole class of silent numeric corruption disappears.

### C-2 — `snapshot @ref` cannot target the things worth zooming into (medium)

`KEEP_REF_ROLES` keeps refs on actionable nodes and landmarks and strips them everywhere
else (`snapshot.ts:191-202`), so `heading`, `table`, `list`, `listitem`, and `article`
lose theirs. But `extractSubtree` can only address a node that still has a ref — meaning
the "cheap zoom for any node" cannot zoom into a section, a table, or a list, which is
exactly what a reader wants after `find` locates something. Combined with B-4 (subtree
mode is absent from `--help`), it went unused in all 18 runs.

**Fix:** keep refs on `heading`, `table`, and `article` — a bounded set, small byte cost,
and it makes `find` → `snapshot @ref` a complete workflow.

### C-3 — `snapshotSig` is a weak identity (low)

`${text.length}:${text.slice(0, 80)}` (`cli.ts:1055`). Any edit that preserves total
length below the first 80 characters — a price change, a counter tick, a status swap —
reads as "unchanged", and B-2's short-circuit then withholds a page that *did* change.
A cheap hash of the whole text costs microseconds and removes the class.

### C-4 — Label hygiene skips markdown headings (low)

The whitespace/length pass matches `[A-Za-z][a-zA-Z]*` as the role (`snapshot.ts:335`),
so `#`-form heading lines never get interior whitespace collapsed or the 300-char cap
applied — on documentation-heavy pages, headings are exactly where long labels live.

### C-5 — The two new commands have no tests (medium)

`test/snapshot-compact-v2.test.ts` covers the pure snapshot functions well (367 lines,
and the full suite is green: 353 passing). But `find` and `chain` — the two new
user-facing commands, ~200 lines of `cli.ts` including a hand-rolled tokenizer and a
step dispatcher — have no test that names them. `findBreadcrumb` and `tokenizeStep` are
pure functions with obvious table-driven tests; B-5 is exactly the kind of bug one would
have caught.

## Status — all fixed, and measured at n=3 (2026-08-02)

**Definitive result** ([`results-2026-08-02-n3-sonnet.md`](../benchmarks/agentic-v3/results-2026-08-02-n3-sonnet.md)):
54 runs, Sonnet 5, 3 repeats of the full suite per build. The fixed build (v4) is **12.9%
cheaper than `main` and 12.1% cheaper than v2**, emits **10.8x fewer bytes**, and is 2-15x
more consistent run-to-run — with all 54 answers correct. Every v4 repeat beat every v1 and
v2 repeat on cost (complete separation).

Two results reframe the branch:

- **v1 and v2 are indistinguishable with a strong model** ($1.454 vs $1.441). v2's measured
  win over `main` was a floor for weak models — Haiku fell into `--full` loops that
  windowing rescued; Sonnet never does. The compaction was already good enough.
- **The gain came from discoverability, not compaction.** v2 shipped `find` and `chain` and
  Sonnet used them **0 times in 18 runs** because they were missing from `--help` (B-4).
  After the fix the same model uses them 25 times and `--full` drops from 9 to 2.



Every item in the backlog below has landed, in six file-scoped workstreams. Test count went
353 -> 417, `tsc --noEmit` clean. Re-measured in
[`benchmarks/agentic-v3/results-2026-08-02-postfix.md`](../benchmarks/agentic-v3/results-2026-08-02-postfix.md):
cost-neutral on five of six tasks (+1.3%), 28.5% fewer bytes emitted, all answers correct,
and `find` went from 0 uses in 18 runs to 5 in 6 — with the `find` -> `snapshot @ref`
workflow functioning for the first time.

Two results worth carrying forward:

- **`chain` is model-gated, not dead** (F-1). It stayed at 0 uses with Haiku even after
  being added to `--help`, but a Sonnet 5 agent reached for it unprompted on both
  chain-shaped tasks, collapsing 6 actions into 1 call (12 CLI calls -> 5 on TodoMVC).
  Discoverability was necessary but not sufficient: `chain` also needs a driver that plans
  several refs ahead. Judge it against the model class that will actually drive the CLI.
- **The `--full` reflex survived the hint rewording** (F-2). Wording is not enough; if
  `--full` on a 700KB page is never right, it needs to cost something visible.

## Ranked backlog

| # | Change | Why | Effort |
|---|---|---|---|
| 1 | Generate `--help` from the registry; add a `flags` line (B-4) | `find`/`chain` used 0× in 18 runs purely because agents can't see them | trivial |
| 2 | Join collapsed text runs with a space (C-1) | Silent numeric corruption in tables; the one imperfect answer in the matrix | trivial |
| 3 | Don't unlink another process's PID file; handle `listen` errors (B-1) | Hard-fails every client with a misleading hint; cost a benchmark run | small |
| 4 | Key snapshot state by session; `OPERA_CLI_STATE_DIR` (B-2, B-3) | Withholds pages from agents that never saw them; blocks concurrency | medium |
| 5 | Keep refs on `heading`/`table`/`article` (C-2) | Makes `find` → `snapshot @ref` a real workflow | small |
| 6 | Tests for `find`/`chain`; fix `;`-in-quotes (C-5, B-5) | New surface, zero coverage | small |
| 7 | Re-word the truncation hint, lead with `find` (A-3) | v3's hint plausibly steered the agent to the 30×-more-expensive path | trivial + a measurement |
| 8 | `--expect --timeout`; real hash for `snapshotSig` (B-6, C-3) | Correctness of the assertion and change-detection primitives | small |

## One strategic note

Finding **A-1**: given `eval`, Haiku solves read-only extraction tasks without ever taking
a snapshot — and does it more cheaply than any graded run. `eval` is advertised in the
contextual `help[]` block of every single snapshot. Either that is the intended fast path
for extraction, in which case the docs should say so and the snapshot work should be
scoped to interaction-heavy flows; or it is not, in which case it should stop being the
most prominent suggestion on the page. Worth deciding deliberately, because right now the
tool's own hints are steering agents away from its most heavily engineered feature.
