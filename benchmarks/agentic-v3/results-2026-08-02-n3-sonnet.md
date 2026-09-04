# Agentic benchmark v3 — n=3, Sonnet 5, v1 vs v2 vs v4 (2026-08-02)

The definitive run. **54 graded runs**: 6 real-world tasks ([`suite.md`](suite.md)) ×
3 builds × **3 repeats**, one fresh **Claude Sonnet 5** agent per cell, strictly
sequential against one live browser.

## Conditions

| Id | Build | Commit | What it is |
|---|---|---|---|
| `v1` | `main` | `65428db` | Pre-compact-v2 baseline |
| `v2` | branch | `d9a1f4f` | Landmark collapse, ref stripping, windowing, post-action diffs, `find`, `chain` |
| `v4` | working tree | `8397db3` + fixes | v3 plus the six fix workstreams — the "ultimate version" |

v3 (`8397db3`, unfixed branch HEAD) was not run: its only active deltas over v2 are the
D7 short-circuit — now correctly dormant unless `OPERA_CLI_SESSION` is set — and the
stale-ref hint, which never fired in 24 prior runs. v4 supersedes it.

## Controls

Same harness and pinned answers as the earlier runs, with two changes:

- **Latin-square ordering.** Condition order rotates per repeat (r1 `v1,v2,v4`;
  r2 `v4,v1,v2`; r3 `v2,v4,v1`), so each build occupies each position exactly once and
  HTTP-cache warming cannot favour any condition.
- **Self-resetting cells.** Each wrapper clears the four per-page state files on its first
  invocation, so no cell inherits another's diff baseline or window cursor.

`OPERA_CLI_SESSION` deliberately unset throughout — this measures the default path.

## Headline: suite totals, one value per repeat

| Metric | v1 | v2 | **v4** |
|---|---|---|---|
| **Cost** (mean ± sd) | $1.454 ± 0.129 | $1.441 ± 0.099 | **$1.266 ± 0.051** |
| — per repeat | 1.441 / 1.332 / 1.589 | 1.556 / 1.389 / 1.379 | 1.324 / 1.239 / 1.234 |
| **Bytes emitted** (mean) | 1,624,738 ± 650,047 | 1,560,483 ± 613,924 | **150,878 ± 42,943** |
| — per repeat | 0.97M / 2.27M / 1.62M | 1.84M / 1.99M / 0.86M | 0.10M / 0.18M / 0.18M |
| CLI calls | 35.3 ± 0.6 | 38.3 ± 1.5 | **29.7 ± 1.5** |
| Appended tokens | 224,754 ± 21,780 | 210,696 ± 13,036 | **180,068 ± 2,554** |
| Cache read | 1,673,967 | 1,745,213 | **1,588,319** |
| Agent turns | 71.0 ± 5.2 | 72.7 ± 4.7 | **67.0 ± 1.0** |

**Accuracy: 54/54 substantively correct**, every condition. Three runs got a sub-part's
exact wording wrong — see Accuracy below.

### Two findings the ranges make unambiguous

**1. v4 separates completely from both older builds.** Every one of v4's three repeats is
cheaper than every one of v1's and v2's:

```
cost   v1: 1.332 .. 1.589
cost   v2: 1.379 .. 1.556
cost   v4: 1.234 .. 1.324     ← max below both other minima
```

That is −12.9% vs v1 and −12.1% vs v2. With 3-vs-3 and complete separation, the exact
two-sided rank test bottoms out at p = 0.10 — *the smallest value attainable at this
sample size*. So: the direction is unambiguous and every repeat agrees, but n=3 cannot
push the p-value lower. Treat the effect as real and the magnitude as ±few points.

**Bytes separate far harder** — v4's worst repeat (176 KB) is 5.5× below v1's best
(975 KB), a **10.8× reduction** on the mean. No overlap, no ambiguity.

**2. v1 and v2 are indistinguishable with Sonnet** ($1.454 vs $1.441, ranges heavily
overlapping). This **contradicts the Haiku result**, where v2 was 53% cheaper than v1.

The explanation is in the trajectories, not the compaction. Haiku, given v1, fell into
`scroll` + `--full` loops it could not escape; v2's windowing rescued it. Sonnet never
falls into that hole — it navigates v1 about as efficiently as v2, so v2's byte savings
never convert into token savings. **v2's measured value was largely a floor for weak
models, not a ceiling gain for strong ones.** What v4 adds — `find`, `chain`, subtree
zoom — is what a strong model actually converts into fewer calls.

### v4 is also far more *predictable*

Standard deviation across repeats, v4 vs the better of v1/v2:

| Metric | v1 sd | v2 sd | v4 sd |
|---|---|---|---|
| Cost | 0.129 | 0.099 | **0.051** |
| Bytes | 650,047 | 613,924 | **42,943** |
| Appended tokens | 21,780 | 13,036 | **2,554** |
| Agent turns | 5.2 | 4.7 | **1.0** |

v4 is 2–15× tighter on every axis. For a tool inside an agent loop that matters
independently of the mean: the worst case is what blows a context budget, and v4's worst
case is close to its average. The older builds' spread comes from whether the agent
happened to reach for `--full` on a large page.

## Per-task mean cost (n=3)

| Task | v1 | v2 | v4 | Best |
|---|---|---|---|---|
| T1 rfc-deep-read | 0.2980 | 0.2955 | **0.2138** | v4 |
| T2 spa-todomvc | 0.2108 | 0.2384 | **0.1827** | v4 |
| T3 web-form | 0.1900 | 0.1499 | **0.1338** | v4 |
| T4 table-extract | **0.2199** | 0.2734 | 0.2783 | v1 |
| T5 wiki-journey | 0.2994 | 0.2566 | **0.2232** | v4 |
| T6 shop-navigate | 0.2359 | **0.2278** | 0.2338 | v2 |

v4 wins 4 of 6. **T4 is the one clear loss** and it is worth understanding rather than
explaining away: on the chemical-elements table, v1's agents read the glued row, pattern-
matched `74W` against known chemistry and answered in 3–4 calls. v4's agents used
`find` → `snapshot @ref` to isolate the row properly — more calls, more cost, a
better-grounded answer. **v4 pays for rigour there.** T6 is a tie within noise
(0.6% spread across all three).

## Feature usage (18 runs per condition)

| Command | v1 | v2 | v4 |
|---|---|---|---|
| `find` | — | 0 | **12** |
| `chain` | — | 0 | **13** |
| `snapshot @ref` | — | 0 | **5** |
| `snapshot --next` | — | 3 | 0 |
| `snapshot --full` | 8 | 9 | **2** |
| `scroll` | 0 | 0 | 0 |

This is the mechanism behind the headline. **v2 shipped `find` and `chain` and Sonnet used
neither, 0 times in 18 runs** — they were absent from `--help` (B-4). After the fix the
same model reaches for them 25 times, and `--full` collapses from 9 to 2. The features
were never weak; they were invisible.

`chain` usage confirms the earlier Sonnet addendum at scale: 13 uses, collapsing runs of
6 actions into single calls, with quoted arguments containing spaces — the parsing path
B-5 hardened.

## Accuracy

All 54 runs answered the substantive question correctly. Three inexact sub-parts, all in
the "report the *exact* text" half of a task:

| Run | Sub-part missed | Cause |
|---|---|---|
| v2 T2 r3 | counter reported as `"2items left"` | v2 glues text runs (C-1) — the agent faithfully reported what the CLI showed |
| v2 T1 r1 | title as `"404 (Not Found)"` | Read from body prose rather than the heading |
| v4 T1 r1 | title as `"404 (Not Found)"` | Same — a task-wording ambiguity, not a build difference |

Only the first is attributable to a build. **v4 reported `"2 items left"` correctly in all
three repeats**, as did its T4 answers, which quote clean separated values
(`74 W … 183.84`) instead of reverse-engineering `...primordialsolid74W`. That is C-1
working, and it is the one place where the fixes changed *what the agent could know*
rather than what it cost.

## Honest limits

- **n=3 is the resolution floor.** Complete separation at 3-vs-3 gives p = 0.10 at best.
  The cost ranking is consistent across all three repeats and every per-metric mean, but a
  confident effect *size* needs n≥5.
- **Cost is harness-specific.** Claude Code truncates oversized tool output before it
  reaches the model, so v1/v2's `--full` calls are charged to their byte count far more
  than to their token bill. In a client without that cap the cost gap would widen
  substantially toward v4. Bytes is the metric that generalises.
- **Sonnet-only.** The v1-vs-v2 null result here is a statement about strong models. The
  earlier Haiku matrix (`results-2026-08-01.md`) remains the correct reference for weak
  ones, where v2's windowing is worth 53%.
- Nothing here exercises session-scoped D7 (`OPERA_CLI_SESSION` set) or stale-ref
  recovery; both remain unit-tested only.

## Bottom line

**v4 is the version to ship.** Against the `main` baseline it is 12.9% cheaper, emits
10.8× fewer bytes, makes 16% fewer CLI calls, and is 2–15× more consistent — with no
accuracy cost and one fidelity gain. Against v2 it is 12.1% cheaper for the same reason
v2 failed to beat v1 with a strong model: the compaction was already good enough, and what
was missing was letting the agent *find* things instead of re-reading pages.
