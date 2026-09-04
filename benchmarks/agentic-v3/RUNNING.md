# Running the agentic benchmark

> For the current `main` vs `head` comprehensive rerun, including the cache-verification
> gate and isolated run directories, use [`COMPREHENSIVE-RUN.md`](COMPREHENSIVE-RUN.md).

How to run the whole matrix unattended, add tasks or builds, and read the output.

The suite pits builds of `opera-browser-cli` against each other by giving a fresh agent a
real browsing task and measuring what the tool cost it. Everything is driven headlessly by
`claude -p`, so a full run is one command.

---

## Prerequisites

| | |
|---|---|
| A running browser | Opera or Chrome the CLI can attach to. Confirm with `node dist/bin/opera-browser-cli.js open https://example.com` |
| `claude` CLI | `claude --version`. The driver calls `claude -p` once per cell |
| Node ≥ 20 | for building the condition worktrees |
| `python3` | analysis only |

Cost: roughly **$0.15–0.30 per cell** with Sonnet. A 3-build × 6-task × 3-repeat matrix is
54 cells — budget ~$10–15 and 1.5–2.5 hours.

---

## One-time: build the conditions

Each build under test is a git worktree with its own compiled `dist/`. `node_modules` is
symlinked from the main checkout, so this is fast and uses no extra disk.

```sh
SP=/tmp/obc-bench          # anywhere outside the repo
git worktree add $SP/wt-v1 main       # baseline
git worktree add $SP/wt-v2 d9a1f4f    # compaction build
for d in wt-v1 wt-v2; do ln -sfn "$PWD/node_modules" $SP/$d/node_modules; done
(cd $SP/wt-v1 && npx tsc)
(cd $SP/wt-v2 && npx tsc)
npx tsc                                # v4 = the working tree
```

Both scripts find the worktrees under `BENCH_WT_ROOT` (default `$TMPDIR/obc-bench`), so
matching that path is all it takes. To add a *new* build, add a `case` arm to `gen.zsh` and
`runctl.zsh`.

Tear down with `git worktree remove $SP/wt-v1 --force` when finished.

---

## Run the matrix

```sh
cd benchmarks/agentic-v3/harness

./run-matrix.zsh strict 3            # eval forbidden — isolates the snapshot pipeline
./run-matrix.zsh open   3            # everything available — real-world use
./run-matrix.zsh open   3 v2 v4      # only these builds
```

Arguments: `<arm> <repeats> [conditions…]`, conditions defaulting to `v1 v2 v4`.

Environment overrides:

| Variable | Default | Purpose |
|---|---|---|
| `BENCH_MODEL` | `sonnet` | any model string `claude --model` accepts |
| `BENCH_MAX_TURNS` | `40` | bounds a runaway cell |
| `BENCH_TASKS_FILE` | `harness/tasks.tsv` | point at a subset to smoke-test |

**Smoke-test first.** One cell proves the browser, the bridge and the driver all work:

```sh
head -1 tasks.tsv > /tmp/one.tsv
BENCH_TASKS_FILE=/tmp/one.tsv ./run-matrix.zsh open 1 v4
```

**Runs are resumable.** A cell whose result JSON already exists is skipped, so an
interrupted matrix continues where it stopped. To force a re-run, delete that JSON.

For a long matrix, detach it:

```sh
nohup ./run-matrix.zsh open 3 > /tmp/matrix.log 2>&1 &
tail -f /tmp/matrix.log
```

> **Do not touch the browser while a matrix is running.** Every cell drives the same browser
> through the same bridge and the same state directory. Any other CLI call — yours or another
> agent's — corrupts the run in progress.

---

## The two arms

The only difference is one clause in the agent prompt.

| Arm | `eval` | Measures |
|---|---|---|
| `strict` | forbidden | The snapshot pipeline. Without this, agents pull answers straight out of the DOM and never take a snapshot, so every build scores identically and the suite measures nothing. |
| `open` | allowed | What the tool actually costs in normal use, where an agent has every command available. |

Run both. `strict` tells you whether the compaction work is any good; `open` tells you
whether it matters. Publishing only one is how you end up with a number that doesn't
survive contact with reality.

---

## Output

```
results/<arm>/<cond>-<task>-r<n>.json    the claude -p envelope
logs/<cond>-t<N><tag><n>.tsv             one row per CLI invocation
logs/<cond>-t<N><tag><n>.out             each invocation's output, capped (OBC_TEE_CAP)
```

The result JSON carries `total_cost_usd`, `usage` (input / output / cache read / cache
write), `num_turns`, `is_error`, and `result` — the agent's final message, ending in the
`ANSWER:` and `CALLS:` lines the prompt demands.

The TSV is the independent instrument: `epoch · duration · exit code · stdout bytes ·
stderr bytes · argv`. It records what the **tool** emitted, which is not the same as what
reached the model — clients truncate oversized tool output. When the two disagree, bytes is
the number that generalises.

### Analysis

```sh
python3 analyze-matrix.py open              # one arm
python3 analyze-matrix.py open strict       # both, side by side
```

Prints per-condition suite totals with mean and standard deviation across repeats, per-task
means, and a feature-usage tally (which commands each build's agents actually reached for).

---

## Extending it

**Add a task** — append one tab-separated line to `harness/tasks.tsv`:

```
slug<TAB>The full instruction the agent receives.
```

Pick a task with a **verifiable answer that will not drift**. Pin the expected answer in
`suite.md` before running anything, and confirm it by hand first. A task whose answer
changes under you silently converts into noise.

**Add a build** — add a `case` arm naming its `dist/bin/opera-browser-cli.js` to both
`gen.zsh` and `runctl.zsh`, then pass the name on the command line.

**Change the model** — `BENCH_MODEL=haiku ./run-matrix.zsh strict 3`. Worth doing: the
build ranking is model-dependent, and a result from one model class does not transfer.

---

## How it works

For each `(condition, task, repeat)` cell the driver:

1. **Switches the bridge** to that condition's build (`runctl.zsh switch`) — kills any
   listener on the port, waits for it to clear, starts the build's own bridge, and verifies
   it serves a request before continuing. Retries three times.
2. **Generates a logging wrapper** (`gen.zsh`) — a tiny script that clears the four
   per-page state files on its first call, then executes the condition's binary through
   `_shim.zsh`, which records the invocation and tees the output.
3. **Runs one agent** with `claude -p --allowedTools Bash`, which structurally prevents
   `WebFetch`/`WebSearch` — the CLI is the only way to see the page.
4. **Saves the JSON envelope.**

Condition order rotates each pass (a Latin square), so no build always runs on a warm HTTP
cache.

### Why it must stay sequential

The CLI keeps per-page state — diff baseline, window cursor, URL map — in one directory,
and every condition drives the same browser. Two cells at once means one agent's diff is
computed against the other's page. The per-cell state reset handles *successive* cells; it
cannot help *concurrent* ones.

If you need throughput, the honest fix is isolation, not parallelism: give each cell its own
`OPERA_CLI_STATE_DIR` and `OPERA_CLI_PORT`, and its own browser. That is untested here.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `error: unauthorized` on every call | A dead bridge left the port bound without its credential file | `lsof -ti :9225 \| xargs kill`, then re-run. `runctl.zsh switch` does this for you |
| `FAILED to start <cond> bridge` | Port never cleared, or the build isn't compiled | Check `dist/bin/` exists in that worktree; check `~/.opera-browser-cli/bridge.log` |
| A cell's JSON is empty | `claude -p` errored | Read the sibling `.json.err` |
| Wildly inconsistent costs for one build | An agent found a pathological path (usually a full-page dump) | Expected — it is a real property of the build. Report the spread, don't discard the pass |
| Answers correct but cheap on every build | You are on the `open` arm and agents are scripting the page | Working as intended. Compare against `strict` |
| Cells return `$0.0000` / 1 turn, `result` says "session limit" | The account hit its usage limit; `claude -p` returns an error envelope rather than failing | Delete those result JSONs (otherwise the resume skips them as done) and re-run once the limit resets: `python3 -c "import json,glob,os; [os.remove(p) for p in glob.glob('results/<arm>/*.json') if json.load(open(p)).get('total_cost_usd',0)==0]"` |
| Disk fills mid-matrix | The shim tees each invocation's stdout; a `--full` on a large page is megabytes | Capped at `OBC_TEE_CAP` (4 KB) by default. Raise it deliberately, and watch `du -sh logs` |
| Disk drains ~80 MB/cell and `/tmp/puppeteer_dev_chrome_profile-*` piles up | Each bridge restart spawns a browser; `kill -9` on the bridge skips its cleanup handler, so the old browser survives holding its profile. A 90-cell matrix leaked 64 profiles / 5.5 GB / 388 processes | After a run: `pkill -f puppeteer_dev_chrome_profile && rm -rf /tmp/puppeteer_dev_chrome_profile-*`. Only delete profiles no live process holds |
| A task's numbers look merged with another task's | Two runs appended to one log file — cell names must be unique per (arm, task, repeat) | Cell identity comes from the canonical `tasks.tsv` position plus the arm tag (`e`/`s`). Never reuse a tag |
