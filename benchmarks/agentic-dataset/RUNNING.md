# Running the agentic-dataset suite

How to run the dataset benchmark headlessly, target just the runnable (T1) tasks,
and read the output. Same harness as `benchmarks/agentic-v3`; the only differences
are the task corpus (51 tasks, 5 categories, `tasks.tsv`) and the conditions
(`head` = this feature branch, `main` = upstream baseline).

A full run is one command driven by `claude -p`.

---

## Prerequisites

| | |
|---|---|
| A running browser | Opera or Chrome the CLI can attach to (`node dist/bin/opera-browser-cli.js open https://example.com`) |
| `claude` CLI | `claude --version`. The driver calls `claude -p` once per cell |
| Internet | required for the 18 **T1** tasks (live Wikipedia / RFC / MDN / docs / demos) |
| Node ≥ 20 | to build the baseline worktree |
| `python3` | analysis only |

Cost: **$0.15–0.30 per cell** with Sonnet. A 2-contition × 18-task × 1-repeat T1
run is ~36 cells — budget ~$6–10 and ~30–60 min. The full 51-task corpus needs the
T2 fixtures (see `suite.md` → "Ship T2 fixtures").

> The **T2** (local-fixture) tasks are defined in the suite but not yet runnable:
> they need a local app serving their pages. **Run the T1 subset** for now.

---

## One-time: build the conditions

`head` is the current working tree (already built). `main` is a git worktree of the
upstream baseline that must be compiled once:

```sh
SP=/tmp/obc-bench
git worktree add $SP/wt-main main
ln -sfn "$PWD/node_modules" $SP/wt-main/node_modules
(cd $SP/wt-main && npx tsc)
npx tsc                     # head = this working tree
```

Both scripts find the baseline under `BENCH_WT_ROOT` (default `$TMPDIR/obc-bench`);
matching that path is all it takes. To add a build, add a `case` arm to
`harness/gen.zsh` and `harness/runctl.zsh`.

Tear down with `git worktree remove $SP/wt-main --force` when finished.

---

## Run the T1 subset

```sh
cd benchmarks/agentic-dataset/harness

# T1 tasks only, one pass, head vs main
BENCH_TASKS_FILE=../tasks-tier1.tsv ./run-matrix.zsh strict 1

# also the open arm (eval allowed) to measure real-world cost
BENCH_TASKS_FILE=../tasks-tier1.tsv ./run-matrix.zsh open  1
```

Arguments: `<arm> <repeats> [conditions…]`, conditions defaulting to `head main`.

Environment overrides (same as agentic-v3):

| Variable | Default | Purpose |
|---|---|---|
| `BENCH_MODEL` | `sonnet` | any model string `claude --model` accepts |
| `BENCH_MAX_TURNS` | `40` | bounds a runaway cell |
| `BENCH_TASKS_FILE` | `tasks.tsv` | point at `../tasks-tier1.tsv` to run only T1 |

**Smoke-test first.** One cell proves browser + bridge + driver:

```sh
head -1 ../tasks-tier1.tsv > /tmp/one.tsv
BENCH_TASKS_FILE=/tmp/one.tsv ./run-matrix.zsh open 1 head
```

**Runs are resumable** — an existing result JSON is skipped. To re-run, delete it.

> **Do not touch the browser while a run is in progress** — every cell drives the same
> browser, bridge, and state directory. Any other CLI call corrupts the run.

---

## The two arms

| Arm | `eval` | Measures |
|---|---|---|
| `strict` | forbidden | The snapshot pipeline (without this, agents script the DOM and never take a snapshot, so both builds score identically) |
| `open` | allowed | What the tool actually costs in normal use |

Run both. `strict` is what isolates the compaction work; `open` is what matters.

---

## Output

```
results/<arm>/<cond>-<task>-r<n>.json     the claude -p envelope (cost, usage, answer)
logs/<cond>-<task><arm-tag><n>.tsv        one row per CLI invocation
logs/<cond>-<task><arm-tag><n>.out        each invocation's output (capped, OBC_TEE_CAP)
```

The result JSON carries `total_cost_usd`, `usage`, `num_turns`, `is_error`, and the
agent's final `ANSWER:` / `CALLS:` lines. The TSV is the independent instrument:
`epoch · duration · exit code · stdout bytes · stderr bytes · argv`.

### Analysis + grading

```sh
python3 harness/analyze-matrix.py open strict        # cost + feature-usage table
python3 harness/grade.py strict                       # pass/fail vs suite.md pinned answers
```

`grade.py` reads each `ANSWER:` line from `results/<arm>/*.json` and compares it
against the pinned answers in `suite.md` (or a small `answers.json` you pin before
the run), reporting pass rate overall and **broken out by category A–E**.

> **Pin answers before running, don't retrofit.** Several T1 expected values are
> marked `verify` in `suite.md`; confirm them by hand first, then freeze them so a
> task whose answer drifts converts into noise rather than a wrong grade.

---

## Troubleshooting

Same as agentic-v3 (`RUNNING.md` there): a dead bridge 401s every call (`lsof -ti :9225
| xargs kill`), an unbuilt worktree fails `runctl switch` (check `dist/bin/` and
`~/.opera-browser-cli/bridge.log`), `/tmp/puppeteer_dev_chrome_profile-*` piles up after
kill -9 bridges (pkill after the run), and disk can fill if you raise `OBC_TEE_CAP`
(a `--full` on a large page is megabytes).
