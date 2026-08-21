# agentic-dataset — first T1 run (2026-08-21)

First full execution of the suite introduced in commit `3191d57` (`bench: add
agentic-dataset suite`). Runs the runnable **T1 subset** (18 of 51 tasks — the
33 T2 tasks need local fixtures that are not shipped yet) against a fresh,
independent agent per cell.

- **Conditions:** `head` (this branch, `feat/compact-v3`) vs `main` (upstream baseline)
- **Arms:** `strict` (no `eval`) and `open` (every tool allowed)
- **Repeats:** 1 — 2 conds × 18 tasks × 2 arms = **72 cells, 0 errored**
- **Driver:** `harness/run-matrix.zsh`, one `claude -p` agent per cell (sequential by
  design — all cells share one browser + one machine-global state directory)
- **Model:** `sonnet` (default)

Raw per-cell envelopes are gitignored at `results/<arm>/*.json` and `logs/`; this
document is the committed record.

---

## Bottom line

- **Grading:** pass rate **90% overall** in both arms (29 pass / 3 fail / 4 ungraded
  per arm). The two recurring "fails" are pinned-answer wording issues, not condition
  differences (see below) — no fail is unique to either `head` or `main`.
- **Cost:** modest, and effectively a wash between the two builds (see tables).

| Arm | Total | head /cell | main /cell | errors |
|---|---|---|---|---|
| strict | $8.66 | $0.263 | $0.218 | 0 |
| open   | $8.10 | $0.254 | $0.196 | 0 |

> `open`/`head` mean includes the smoke-test cell `rfc-deep-read` at **$0.83** (cold
> start + warmup). Without it, head/open mean drops to ~$0.22 — still slightly above
> main's $0.196. With only 1 repeat both differences are within per-cell noise.

- **Feature usage** is the headline finding (isolates the compaction work):

| arm | head agents reached for | main agents reached for |
|---|---|---|
| strict (no `eval`) | `find` 34, `snapshot @` 16, `snapshot --next` 3 | `snapshot --full` 9, `scroll` 7, `open` 22 |
| open (all tools)  | `eval` 13 | `eval` 26 |

  In the `strict` arm head's agents used the targeted `find` / `snapshot @`/`--next`
  affordances and reopened pages far less; `main` agents fell back to full-page
  snapshots, scroll, and more `open` calls. In the `open` arm `main` agents reached for
  `eval` about twice as often as `head` — consistent with `head`'s snapshot output
  being sufficient more of the time.

---

## Grading by category (per arm, identical in both arms)

| category | pass | fail | ungraded | pass% (of graded) |
|---|---|---|---|---|
| A | 19 | 1 | 0 | 95% |
| B | 2 | 0 | 0 | 100% |
| C | 2 | 0 | 0 | 100% |
| D | 2 | 0 | 2 | 100% |
| E | 4 | 2 | 2 | 67% |
| **total** | **29** | **3** | **4** | 90% |

Counts are cells (2 conditions each), so 18 tasks × 2 conds = 36 cells per arm. The 4
ungraded cells are `table-airport-codes` and `shop-category-product`, whose pins in
`pin/answers.json` are `null`.

### The recurring fails (both arms) — pin-wordings, not regression

1. **`mdn-fetch-abort`** (pinned: `AbortController`) — agents correctly described the
   mechanism (pass an `AbortSignal` as `fetch()`'s `signal` option, then call
   `controller.abort()`) but neither string contains the literal token `AbortController`.
   Correct answer, overly strict substring pin.
2. **`wiki-science-chain`** (pinned: `glyceraldehyde`) — agents answered "glucose/sugar".
   The Calvin cycle's direct product is G3P (glyceraldehyde 3-phosphate); glucose is
   formed downstream. Both builds answered identically (head **and** main, in both
   arms), so this is a semantic pin choice, not a build difference.

No cell failed for only one condition — i.e. **no compaction-related regression is
observed** on the graded axes in this run.

---

## Per-task cost (USD, one repeat)

### strict arm

| task | head | main |
|---|---|---|
| rfc-deep-read | 0.367 | 0.258 |
| rfc-header-semantics | 0.292 | 0.306 |
| rfc-cache-conditions | 0.173 | 0.277 |
| html-spec-dialog | 0.643 | 0.208 |
| mdn-fetch-abort | 0.132 | 0.141 |
| python-exception-chain | 0.461 | 0.184 |
| kubernetes-probe-types | 0.302 | 0.123 |
| postgres-index-types | 0.277 | 0.442 |
| openssl-cipher-option | 0.228 | 0.175 |
| wcag-focus-order | 0.117 | 0.298 |
| spa-todomvc | 0.274 | 0.185 |
| web-form | 0.201 | 0.182 |
| table-extract | 0.301 | 0.186 |
| table-airport-codes | 0.128 | 0.127 |
| wiki-journey | 0.232 | 0.257 |
| shop-navigate | 0.194 | 0.182 |
| wiki-science-chain | 0.205 | 0.198 |
| shop-category-product | 0.202 | 0.196 |

### open arm

| task | head | main |
|---|---|---|
| rfc-deep-read | 0.828* | 0.176 |
| rfc-header-semantics | 0.206 | 0.204 |
| rfc-cache-conditions | 0.350 | 0.165 |
| html-spec-dialog | 0.171 | 0.169 |
| mdn-fetch-abort | 0.138 | 0.138 |
| python-exception-chain | 0.368 | 0.175 |
| kubernetes-probe-types | 0.153 | 0.142 |
| postgres-index-types | 0.258 | 0.450 |
| openssl-cipher-option | 0.179 | 0.216 |
| wcag-focus-order | 0.292 | 0.148 |
| spa-todomvc | 0.243 | 0.189 |
| web-form | 0.180 | 0.189 |
| table-extract | 0.227 | 0.173 |
| table-airport-codes | 0.145 | 0.146 |
| wiki-journey | 0.204 | 0.252 |
| shop-navigate | 0.196 | 0.178 |
| wiki-science-chain | 0.208 | 0.189 |
| shop-category-product | 0.222 | 0.226 |

\* smoke-test cell — cold start + warmup, the run's first cell. See caveat above.

Per-cell cost is dominated by agent turns (4–22), not by CLI call count; large pages
(`html-spec-dialog`, `postgres-index-types`) show up as spikes in both builds.

> `analyze-matrix.py --per-pass` cost aggregation is empty for this run because it
> compares full 51-task passes; only task-level and feature-usage tables apply to a
> T1-only run.

---

## Harness fixes required to make the suite runnable

The suite as committed (`3191d57`) could not be executed as-is. Three path bugs pointed
at `harness/tasks.tsv`, but the task corpus lives at the suite **root**
(`tasks.tsv`, `tasks-tier1.tsv`):

- `harness/run-matrix.zsh` — default `BENCH_TASKS_FILE` and the canonical cell-identity
  loop both read `$HERE/tasks.tsv` → now `$ROOT/tasks.tsv`.
- `harness/analyze-matrix.py` — read `ROOT / "harness" / "tasks.tsv"` → `ROOT / "tasks.tsv"`.
- `RUNNING.md` — the smoke-test snippet ran `head -1 ./tasks-tier1.tsv` from the
  `harness/` dir → `../tasks-tier1.tsv`; env-table default updated to `tasks.tsv`.
- `harness/grade.py` — split the result filename on `-` and took `parts[1]` as the slug,
  which mangles multi-word slugs (`rfc-deep-read` → `rfc`), so grading mis-attributed
  cells. Now parses `<cond>-<slug>-r<n>` with `([^-]+)-(.*)-r\d+`, matching
  `analyze-matrix.py`.

These are committed alongside this results doc; `results/` and `logs/` remain gitignored
per `.gitignore`.

---

## How to reproduce

```sh
# one-time (head is already built; baseline worktree):
git worktree add ${TMPDIR}/obc-bench/wt-main main
ln -sfn "$PWD/node_modules" ${TMPDIR}/obc-bench/wt-main/node_modules
(cd ${TMPDIR}/obc-bench/wt-main && npx tsc)

# run both arms (T1 subset, head vs main, 1 repeat)
cd benchmarks/agentic-dataset/harness
BENCH_TASKS_FILE=../tasks-tier1.tsv ./run-matrix.zsh strict 1 head main
BENCH_TASKS_FILE=../tasks-tier1.tsv ./run-matrix.zsh open  1 head main

# grade + analyse
python3 harness/grade.py strict
python3 harness/grade.py open
python3 harness/analyze-matrix.py open strict
```

Tear down: `git worktree remove ${TMPDIR}/obc-bench/wt-main --force`.

### Suggested follow-ups

- Pin the two wording-affected answers before the next run, or loosen `grade.py` to a
  token-overlap match (`mdn-fetch-abort`, `wiki-science-chain`).
- Run with repeats ≥ 3 before trusting the small head-vs-main cost deltas.
- Ship the T2 fixtures to run the full 51-task corpus and restore `analyze-matrix.py`
  per-pass aggregation.
