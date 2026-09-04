# Agentic benchmark v3 — post-fix re-run (2026-08-02)

Re-run of the same 6 tasks ([`suite.md`](suite.md)) against **v4** — HEAD plus the six
fix workstreams from [`docs/compact-v3-review.md`](../../docs/compact-v3-review.md).
Compared against v3's recorded numbers from
[`results-2026-08-01.md`](results-2026-08-01.md). v1 and v2 were not re-run: nothing in
the fixes touches them, and their ranking was never in question.

One condition, one fresh Haiku agent per task, same harness, same pinned answers,
`OPERA_CLI_SESSION` deliberately unset so this measures the **default path an agent gets
today**. Two tasks were additionally re-run with a **Sonnet 5** agent on the identical
build — see F-1, which that addendum overturned.

## Three predictions, stated before the run

| # | Prediction | Outcome |
|---|---|---|
| 1 | `find`/`chain` usage rises above zero once they appear in `--help` | **Right, with a condition.** `find` 0 → 5 and `snapshot @ref` 0 → 1 on Haiku; `chain` stayed 0 on Haiku but fired on both chain-shaped tasks with Sonnet 5 (F-1). |
| 2 | T1's emitted bytes drop sharply from 2.31 MB | **Partly.** 2.31 MB → 1.62 MB (−30%), but `--full` was still used 3×. |
| 3 | T4 answer quality holds or improves, cost flat | **Held.** Correct, and the trajectory changed shape (below). |

## Results

| Task | Calls | Bytes | Appended | Cache read | Cost | vs v3 |
|---|---|---|---|---|---|---|
| T1 rfc-deep-read | 14 | 1,618,766 | 147,583 | 1,327,022 | $0.337 | +108.5% |
| T2 spa-todomvc | 12 | 10,122 | 31,679 | 723,296 | $0.124 | −16.1% |
| T3 web-form | 6 | 6,675 | 23,545 | 337,065 | $0.069 | −4.6% |
| T4 table-extract | 7 | 28,942 | 47,335 | 444,433 | $0.115 | +28.5% |
| T5 wiki-journey | 5 | 28,603 | 42,103 | 296,656 | $0.090 | −21.2% |
| T6 shop-navigate | 6 | 35,202 | 52,339 | 383,608 | $0.113 | +39.9% |
| **Total** | 50 | **1,728,310** | 344,584 | 3,512,080 | **$0.849** | **+27.2%** |

**Bytes emitted by the CLI fell 28.5%** (2.42 MB → 1.73 MB) while **cost rose 27.2%**.
Both are true and they are not in conflict — see the caveat below.

### The aggregate is carried entirely by T1

| | v4 | v3 | delta |
|---|---|---|---|
| T1 only | $0.337 | $0.162 | +108% |
| **All tasks except T1** | **$0.512** | **$0.506** | **+1.3%** |

On five of six tasks the fixes are **cost-neutral** (+1.3%, well inside the ±23% per-task
noise established between v2 and v3 on unchanged code paths). T1 is the single noisiest
cell in the whole study — the most expensive task in every condition — and in this run the
agent simply took a longer route: 14 calls against v3's 10, with three `find`s, three
clicks and three `--full`s.

Do not read T1 as a regression caused by the fixes. Read it as: **n=1 per cell, and T1 has
the widest variance of any task in the suite.** The one structural change that plausibly
contributes is D7 now being dormant by default — v3's cheap T1 partly came from the
short-circuit withholding the page, which is precisely the behaviour we removed as
incorrect.

## What actually changed in agent behaviour

Feature usage across the six v4 runs, against 18 v1/v2/v3 runs:

| Command | v1/v2/v3 (18 runs) | v4 (6 runs) |
|---|---|---|
| `find` | **0** | **5** |
| `snapshot @ref` (subtree zoom) | **0** | **1** |
| `chain` | 0 | **0** (Haiku) / **3** (Sonnet, 2 tasks) |
| `snapshot --full` | 10 | 3 |
| `scroll` | 8 | 3 |

The T4 trajectory is the clearest evidence that a workflow which was previously
*unreachable* now works:

```
open https://en.wikipedia.org/wiki/List_of_chemical_elements
find Tungsten
snapshot @30.1835      <- subtree zoom, impossible before C-2
click @30.1835
```

Before the fixes, `find` was invisible in `--help` (B-4) and refs were stripped from
table/heading/article nodes (C-2), so `extractSubtree` could not address the thing `find`
had just located. Both halves had to be fixed for either to be useful — which is why the
original v2/v3 measurements showed no benefit from `find` at all.

`"2 items left"` is also now reported with its space on T2, in every condition that runs
the fixed compaction (C-1).

## Findings

### F-1 — Discoverability is necessary; `chain` additionally needs a model that plans

Putting `find` in `--help` moved it from 0 to 5 uses with Haiku. Putting `chain` in
`--help` moved it from 0 to 0 — with Haiku. **Re-running the two chain-shaped tasks with
Sonnet 5 on the identical build overturns the "dead code" reading:** Sonnet used `chain`
on both tasks, unprompted, on its first attempt.

```
chain fill @.5 "alpha"; press Enter; fill @.5 "beta"; press Enter; fill @.5 "gamma"; press Enter
chain click @.3; click @.14
chain fill @.5 "Jan Kowalski"; fill @.7 "secret1"; click @.32
```

| Task | Model | CLI calls | Bytes emitted | Cost |
|---|---|---|---|---|
| T2 spa-todomvc | Haiku 4.5 | 12 | 10,122 | $0.124 |
| T2 spa-todomvc | **Sonnet 5** | **5** | **6,650** | $0.359 (intro $0.239) |
| T3 web-form | Haiku 4.5 | 6 | 6,675 | $0.069 |
| T3 web-form | **Sonnet 5** | **4** | **5,807** | $0.134 (intro $0.089) |

Sonnet costs are at standard $3/$15 per MTok (cache write 1.25x, read 0.1x); the
parenthesised figure is the introductory $2/$10 rate in effect through 2026-08-31. Haiku
is at $1/$5. **Cross-model dollar comparison is not meaningful** — Sonnet is 3x the rate,
so it costs more per task despite doing less work. The comparable columns are CLI calls
and bytes, where Sonnet is 58% and 34% lower on T2.

So `chain` is not dead code — it is **model-gated**. `find` answers a question the agent
already has ("where is X"); `chain` requires planning several refs ahead, which means
having already snapshotted and retained the refs. Haiku does not plan that far; Sonnet
does it spontaneously. Two conclusions follow:

1. **Both fixes were needed for `chain` to ever fire.** It was absent from `--help` (B-4)
   *and* needs a capable driver. Fixing only one would still have measured zero.
2. **Judge `chain` on the models that will actually drive the CLI.** If that is a
   Sonnet-or-better agent, it earns its ~90 lines — 6 actions in 1 call, with one
   snapshot instead of six. If the target is Haiku-class, it does not pay for itself.

Note that Sonnet's chain arguments are quoted strings containing spaces
(`fill @.5 "Jan Kowalski"`), which is exactly the parsing path B-5 hardened.

### F-2 — The `--full` reflex survived the hint rewording

A-3's reworded hint leads with `find` and marks `--full` as rarely needed. `--full` usage
did fall (10 → 3 across fewer runs), but the T1 agent still finished with three of them
*after* successfully locating its answer with `find`. Hint wording is not enough to
suppress it. If `--full` on a 700 KB document is genuinely never the right move, the honest
fix is to make it cost something visible — e.g. require confirmation or a byte budget
above some size — rather than to keep rewording the suggestion.

### F-3 — Emitted bytes and billed tokens still disagree, and bytes are the honest metric

v4 emits 28.5% fewer bytes while billing 27.2% more in this harness. Claude Code truncates
oversized tool output before it reaches the model, so a `--full` on a 700 KB page is
charged to the CLI's byte count but largely not to the agent's context. Any client without
that cap would see the byte column, not the cost column. This is the same caveat recorded
for v3's T1 result, and it now cuts the other way — which is exactly why both instruments
are kept.

## Verification status

All six workstreams landed: **417 tests passing (up from 353), `tsc --noEmit` clean**, and
all six v4 answers correct against the pinned expectations. The suite gaps listed in
`results-2026-08-01.md` remain open — in particular, nothing here exercises the
session-scoped D7 path (`OPERA_CLI_SESSION` set) or stale-ref recovery, both of which need
tasks the suite does not yet have.
