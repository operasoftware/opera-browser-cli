# Comprehensive compact-v3 evaluation

This is the primary suite for evaluating the branch. It covers six distinct browser task
shapes rather than only document retrieval:

| Task | Behavior under test |
|---|---|
| RFC deep read | long-document retrieval and truncation recovery |
| TodoMVC | repeated SPA mutation, ref stability, filtering, and final-state verification |
| Selenium form | multi-field input, submit navigation, and result verification |
| Elements table | structured extraction from a large table |
| Wikipedia journey | link discovery and cross-page navigation |
| Books to Scrape | site navigation and product comparison |

## Principal experiment

Compare the current branch (`head`) with upstream (`main`). Run both permission arms:

- `strict`: page JavaScript is unavailable; evaluates the snapshot/action interface.
- `open`: all commands are available; measures whether agents bypass snapshots with
  `eval`, at the cost of a wider page-execution permission.

Use three repeats for each arm. Sonnet must run through Claude Code so Anthropic cache
creation/read behavior is present in the result envelopes.

```sh
cd benchmarks/agentic-v3/harness

# Smoke test first.
head -1 tasks.tsv > /tmp/agentic-v3-smoke.tsv
BENCH_RUN_ID=sonnet-interactive-v1 \
BENCH_TASKS_FILE=/tmp/agentic-v3-smoke.tsv \
./run-matrix.zsh strict 1 head

# Verify the smoke envelope identifies Sonnet 5 and reports cache usage before continuing.

BENCH_RUN_ID=sonnet-interactive-v1 ./run-matrix.zsh strict 3 main head
BENCH_RUN_ID=sonnet-interactive-v1 ./run-matrix.zsh open 3 main head

BENCH_RUN_ID=sonnet-interactive-v1 python3 grade.py strict
BENCH_RUN_ID=sonnet-interactive-v1 python3 grade.py open
BENCH_RUN_ID=sonnet-interactive-v1 python3 analyze-matrix.py strict open
```

## Controls

- One fresh `claude -p` process per cell.
- Sequential execution; every cell shares the browser.
- Per-cell `OPERA_CLI_SESSION` and isolated result/log directories.
- Condition order rotates by repeat.
- The condition-specific bridge is restarted before each condition block.
- Identical task prompt and Claude Code invocation across conditions.
- Warm-up policy is symmetric and logged separately.
- Failed, capped, and anomalous cells remain part of the result.

Before accepting a run, verify all envelopes identify the expected canonical model and
that cache creation/read fields are populated. Record repository HEAD, baseline commit,
Claude Code version, model identity, and warm-up policy in the result report.

## Measurements

Report per task, condition, arm, and repeat:

- pinned-answer accuracy and error/timeout status;
- model turns and CLI calls;
- CLI duration and raw stdout/stderr bytes;
- fresh input, cache creation, cache reads, and output tokens;
- provider-reported cost;
- command mix (`eval`, `find`, subtree reads, continuation, chaining, scrolling);
- mean, standard deviation, and failure tails.

Raw CLI bytes are not a proxy for model context. The Claude Code driver may truncate or
compact tool results. Interpret cost using the envelope's actual cache/token accounting,
and describe truncation behavior as a separate experimental variable.

## Extension after Sonnet

Cross-family runs require equivalent coverage and explicit accounting differences. Do not
combine a direct-driver model with Claude Code Sonnet as though truncation and caching were
identical. Report each route's cache support and tool-result policy. The first objective is
a valid Sonnet `main`/`head` comparison over the full interactive suite; model-family
expansion follows only after that result is complete.
