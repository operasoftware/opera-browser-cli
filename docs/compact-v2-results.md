# Compact v2 — what was accomplished

July 2026, branch `feat/compact-v2`. Companion to the design doc
(`specs/compact-v2-token-efficiency.md`) and the follow-up benchmark design
(`benchmarks/agentic-v2-proposal.md`).

## Summary

Compact v2 reduces the token cost of browser snapshots in three ways: it makes
each snapshot smaller (static transforms), it makes the *cap* smarter (spend
the budget on content, page through the rest), and it changes the trajectory
cost model from per-snapshot to per-change (diffs after actions). Measured
results: full snapshots are a further **~15% smaller than compact v1** (~45%
below raw) on the 50-page static benchmark, and an agent completing a 7-task
browsing suite spent **14% fewer tokens than v1** and **29% fewer than raw
mode** — on tasks that barely exercise the trajectory-level features.

## What was implemented

### Format (each snapshot smaller)

| Item | Change |
|---|---|
| S1 refs only on actionables | `@X.Y` refs appear only on interactive elements and landmarks; text/headings/images are refless, headings are plain markdown |
| S2 prefix factoring | dominant ref prefix declared once (`snap:` in page metadata); refs shrink to relative `@.N`, unambiguous vs full and legacy forms; expanded transparently by every ref-taking command |
| S3 indentation | halved to 1 space per level |
| S4 wrapper flattening | label-less `generic`/`presentation`/`LayoutTable*` hoisted always, `listitem`/`paragraph`/`group` when single-child; empty wrappers dropped |
| S6 echo dedup | image alt echoing the parent link's label dropped; `description=` equal to the node's own label dropped |
| S7 URL cleaning v2 | same-page anchors → fragment only; bare `#` hrefs dropped; 11 more tracking params/prefixes stripped |
| S8 label hygiene | whitespace runs collapsed; labels capped at 300 chars |
| role renames | `navigation`→`nav`, `contentinfo`→`footer`, `complementary`→`aside` |

### Cap model (the 12k budget goes further)

| Item | Change |
|---|---|
| R1 landmark collapse | on over-cap pages, nav/banner/footer/aside subtrees render as one summary line with counts and an expand hint; budget goes to `main` |
| R1 `snapshot @ref` | subtree zoom for any node — the expansion path for collapsed landmarks |
| D1 `snapshot --next` | sequential windowing through the whole compacted tree from a persisted cursor; truncated outputs suggest it before `--full` (previously, `scroll` + head-truncation re-showed the same 12k chars forever) |

### Trajectory (per-change, not per-snapshot)

| Item | Change |
|---|---|
| D3 post-action diffs | interactions return `diff: {changed, added, removed}` with `~`/`+`/`-` lines vs the persisted last tree; ref-stability pairs changed nodes; full-snapshot fallback on navigation, missing baseline, or >40% delta |
| D4 `chain` | several actions, one-line acks, one final diff/snapshot |
| D4 `--quiet` / `--expect` | ack-only and verification-only action responses (`EXPECT_FAILED` + exit 1 on miss) |
| D5 `find` | page grep with ancestor breadcrumbs (`--role` filter) — locate elements for ~100 tokens instead of a snapshot |
| D6 help diet | eval tip only on `open`; scroll suggestion only when truncated |

### Fixed along the way

MCP tool-level failures (`isError` results) were passed through the bridge as
successful text, so failed clicks/fills looked like successes (chain acked "ok",
exit codes stayed 0). They now surface as errors end-to-end.

## Measured results

### Static page-token benchmark (50 pages, uncapped, tiktoken)

| Condition | Avg | Median | p95 |
|---|---|---|---|
| compact v2 | **51.6k** | **20.5k** | **219.5k** |
| compact v1 | 60.6k | 24.3k | 256.1k |
| opera-raw (control) | 93.8k | 44.4k | 383.7k |

The raw control matches its pre-v2 measurement (94.9k), confirming the delta is
the transforms, not corpus drift. These are *uncapped* sizes: R1/D1/D3 savings
are on top and invisible here.

### Agentic mini-benchmark (7 tasks, haiku agent, one run per condition)

Same task list, same agent model, same shell protocol; each condition's primer
documents its own feature set. Task 5 (DuckDuckGo search) hit bot-detection in
all three conditions and is excluded; all conditions answered the remaining 6
tasks correctly.

| Condition | Agent tokens (total) | Correct | Wall time |
|---|---|---|---|
| compact v2 | **70.6k** | 6/6 | 151s |
| compact v1 | 82.4k | 6/6 | 144s |
| raw (16k cap) | 99.3k | 6/6 | 188s |

v2 spends **14% fewer tokens than v1** and **29% fewer than raw** at equal
accuracy. Caveats, honestly stated: n=1 per condition; token totals include the
agent's fixed overhead (system prompt, reasoning), which *understates* the
relative snapshot savings; the raw condition is capped at 16k, which flatters
it vs true uncapped MCP; and — most importantly — these tasks are mostly
single-lookup shaped, which barely exercises diffs, windowing, `find`, or
`chain`. That last point is by inheritance from the original suite and is the
motivation for the redesigned benchmark in `benchmarks/agentic-v2-proposal.md`,
whose task groups (deep reads past the cap, ≥5-action interaction loops,
element location, multi-page journeys) are built to price exactly those
features, and whose headline metric is marginal action cost (first-result
tokens vs mean subsequent-result tokens).

### Live verification

Four rounds of live tests (real browser, real pages) in
`test/live-compact-v2-plan.md`, executed by a small-model agent: 35 checks
across compact shape, landmark collapse/expansion, contiguous windowing (58
windows through the 682k-char Moon page), relative-ref actions, diff/full
fallback semantics, find/chain/--quiet/--expect, and error paths. All pass.
353 unit tests in the suite (63 added for v2).

## Not implemented (deliberately)

- **S5 data-driven attribute pruning** — needs the corpus frequency analysis first.
- **S9 generalized string LUT, R2 repeated-subtree folding → tabular rows, R3
  markdown-hybrid reader mode** — measure-first bets with real accuracy risk;
  R2 is the highest-upside one for list-shaped pages.
- **D2 ref-stability documentation** landed in SKILL.md; the "nearest match"
  stale-ref hint has not.
- The **agentic benchmark v2 harness** (tasks.yaml/conditions.yaml extensions,
  marginal-cost metric in `AgentState`) is specified in the proposal but not built.

## Commit trail

| Commit | Contents |
|---|---|
| `25d456d` | R1 landmark collapse + `snapshot @ref`, S1, S3, S7, S8, D6, role renames |
| `427a0d6` | D1 `snapshot --next`, S2 prefix factoring |
| `e442f28` | D3 post-action diffs + static benchmark rerun |
| `57ae63c` | S4, S6, D4 (`chain`/`--quiet`/`--expect`), D5 (`find`), README + SKILL.md rewrite |
| `3e7557f` | bridge isError fix, agentic-v2 proposal, round-4 live tests |
