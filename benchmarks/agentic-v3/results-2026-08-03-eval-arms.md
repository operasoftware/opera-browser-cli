# Does blocking `eval` change the answer? (2026-08-03)

Earlier runs forbade the CLI's `eval` command so the suite would exercise the snapshot
pipeline. That is a clean experiment but an artificial one — agents in real use have `eval`.
This measures both arms.

| Arm | `eval` | Cells | Repeats |
|---|---|---|---|
| `open` | available | **89/90** | n=5 (v1 n=4 — one cell lost to a session usage limit) |
| `strict` | forbidden | 28/54 | pass 1 complete for all three builds |

Every cell: a fresh Sonnet 5 agent via `claude -p`, sequential, rotating build order, per-cell
state reset, and a **prompt-cache warmup immediately before each cell** so every cell starts
from the same session-overhead baseline (achieved: median $0.0079, only the very first cold at
$0.0552). **All 89 open-arm answers correct.**

> Supersedes the n=3 figures in the first version of this document. Those were run without the
> warmup and at three repeats; several of their conclusions did not survive more data. Where
> they differ, these numbers stand. The archived n=3 data is under `archive/open-n3-unwarmed/`.

---

## Headline: with `eval` available, the builds are close

Suite totals, one value per pass:

| Build | passes | mean | sd | range |
|---|---|---:|---:|---|
| v1 baseline | 0.908 · 0.887 · 0.854 · 0.808 | **$0.864** | 0.044 | 0.808 – 0.908 |
| v2 | 0.855 · 0.919 · 0.878 · 0.901 · 0.867 | **$0.884** | 0.026 | 0.855 – 0.919 |
| **v4** | 0.813 · 0.841 · 0.885 · 0.779 · 0.800 | **$0.824** | 0.041 | 0.779 – 0.885 |

Pairwise (Welch):

| Comparison | delta | p |
|---|---:|---:|
| v4 vs v1 | **−4.7%** | 0.15 — **not significant** |
| v4 vs v2 | **−6.8%** | **0.006** — significant |
| v2 vs v1 | +2.2% | 0.43 — not significant |

**v4 is the only build with a defensible cost edge, and against the baseline it is ~5% and
does not clear significance at this sample size.** All three ranges overlap. This is a very
different picture from the strict arm, where v4 separated completely from both.

### Two n=3 conclusions that did not survive

1. **"v2 is ~7% cheaper than v1 with `eval` available."** Gone. At n=5, v2 is 2.2% *worse*
   than v1 and the difference is noise (p = 0.43). The earlier result came from three passes
   where v1 happened to draw an expensive one.
2. **"v4 emits a third of the bytes."** Also gone — see below. That figure rested on a single
   v1 pass with a megabyte page dump.

This is the cost of n=3, and the reason for re-running at n=5 with a controlled environment.

---

## Bytes emitted

| Build | mean | sd | passes |
|---|---:|---:|---|
| v1 | **97,410** | 2,675 | all four within 95–100 KB |
| v2 | 360,963 | 374,496 | three at ~87 KB, **two at ~771 KB** |
| v4 | 104,509 | 5,124 | all five within 102–114 KB |

**v1 and v4 are equivalent on bytes here (~97 KB vs ~105 KB).** The strict-arm byte advantage
disappears once `eval` is available, because v1's agents stop reading pages altogether — they
`open` and then query the DOM. v2 is the outlier, with two passes where an agent still fell
into a full-page dump.

What survives from the strict arm is *consistency*: v4's spread is 5 KB, v1's 2.7 KB, v2's
374 KB. v4 and v1 are both predictable; v2 is the one that occasionally explodes.

---

## Where v4 does separate: call count and shape

| | v1 | v2 | **v4** |
|---|---:|---:|---:|
| CLI calls per suite | 38.0 | 38.8 | **29.0** |
| Agent turns | 38.8 | 40.6 | **35.0** |

**25% fewer CLI calls**, which is the one structural advantage `eval` does not erase. The
reason is visible in what the agents reached for:

| Command | v1 | v2 | **v4** |
|---|---:|---:|---:|
| `eval` | **31** | **22** | **11** |
| `chain` | — | 0 | **28** |
| `find` | — | 0 | **16** |
| `snapshot @ref` | — | 0 | 2 |
| `snapshot --full` | 0 | 2 | 0 |
| `open` | 30 | 30 | **17** |

Three things worth reading off this table:

- **v1 agents never take a snapshot at all.** Thirty `open`s and thirty-one `eval`s — the
  snapshot pipeline is entirely bypassed. That is what the strict arm was built to prevent,
  and it is exactly what happens when you don't.
- **Better native tools displace DOM scripting.** v4's agents used `eval` a third as often as
  v1's, because `find` and `chain` already answered the question.
- **`chain` absorbs the navigation**: 28 chains, and `open` drops from 30 to 17. That is where
  the call-count saving comes from.

---

## Per-task mean cost

| Task | v1 | v2 | v4 | Best |
|---|---:|---:|---:|---|
| rfc-deep-read | 0.1236 | **0.1207** | 0.1427 | v2 |
| spa-todomvc | 0.1533 | 0.1567 | **0.1064** | **v4 −31%** |
| web-form | 0.1384 | 0.1502 | **0.0922** | **v4 −33%** |
| table-extract | **0.1193** | 0.1220 | 0.1630 | v1 |
| wiki-journey | 0.1740 | 0.1889 | **0.1728** | v4 |
| shop-navigate | 0.1477 | **0.1451** | 0.1467 | tie |

The split is clean and it explains the modest headline:

- **Interaction-heavy tasks: v4 wins decisively** — 31% on the SPA, 33% on the form. These are
  the tasks where `chain` collapses several round trips into one.
- **Pure lookups: v4 loses** — `rfc-deep-read` and `table-extract` go to the older builds.
  Given `eval`, a lookup is one DOM query, and no amount of snapshot engineering beats that.
  v4's agents do the grounded thing (`find`, then zoom) and pay for it.
- **Navigation: a tie.**

Averaged over a suite that is half lookups, those cancel to ~5%.

---

## Cross-arm comparison

Same measurement path, pass 1 of each arm (the only pass complete in both):

| Build | strict | open | effect of allowing `eval` |
|---|---:|---:|---:|
| v1 | $1.042 | $0.940 | −9.8% |
| v2 | $1.053 | $0.872 | −17.2% |
| v4 | $0.886 | $0.849 | −4.1% |

Normalised to v1: strict **1.000 / 1.011 / 0.850**; open (n=5 means) **1.000 / 1.023 / 0.954**.

**Blocking `eval` roughly triples v4's apparent advantage** — from ~5% to ~15%. It did not
invent the advantage: v4 is ahead in both arms, and it wins the interaction tasks in both. But
the headline number is arm-dependent, and the strict arm is the flattering one.

The weaker a build's own tools, the more `eval` rescues it (v2 −17%, v1 −10%, v4 −4%) — v4
gains least because its commands were already doing that work.

---

## `eval` masks a real defect

In the strict arm, v1 and v2 agents reported the TodoMVC counter as `"2items left"` —
faithfully relaying the glued text those builds produce (defect C-1). In the open arm **every
build got `"2 items left"` right**, because the agent read the DOM rather than the snapshot.

The fidelity bug is invisible whenever `eval` is available. It is still real, and it bites
exactly when an agent is restricted to the text path.

---

## What this means

1. **Report both arms.** `strict` answers "is the compaction any good" — yes, decisively.
   `open` answers "does it matter in ordinary use" — much less than the strict arm implies.
2. **v4 remains the build to ship**, but for structural reasons more than cost: 25% fewer
   calls, no byte blow-ups, wins on every interaction task, and never worse than a tie except
   on pure lookups.
3. **`eval`'s prominence is now the biggest open question in the tool.** With it available, the
   baseline build never takes a snapshot at all. It is advertised in the hints on every
   snapshot. Either document it as the intended fast path for extraction and scope the
   compaction work to interaction flows, or stop recommending it in snapshot output.

## Limitations

- v1 is n=4 on suite totals (one cell lost to a usage limit); v2 and v4 are n=5. Per-task means
  use all 89 cells.
- One model (Sonnet 5). The ranking is known to be model-dependent — the same builds ranked
  very differently under Haiku.
- The strict arm is 28/54; its cross-arm figures are n=1. Finish with
  `./run-matrix.zsh strict 5` when usage limits allow.
- Cost is specific to this harness, which truncates oversized tool output and so under-charges
  page dumps.
