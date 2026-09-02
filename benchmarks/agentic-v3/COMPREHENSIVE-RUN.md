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

## Cross-family extension

After the cache-aware Sonnet run, the same matrix is run through `run-direct.py` for the
five non-Anthropic routes. The direct driver uses the Responses API, an 8,000-character
tool-result cap, and a 50-turn ceiling:

```sh
BENCH_MODEL=openai/gpt-5.6-terra BENCH_RUN_ID=terra-interactive-v1 \
  python3 run-direct.py strict 3 main head
BENCH_MODEL=openai/gpt-5.6-terra BENCH_RUN_ID=terra-interactive-v1 \
  python3 run-direct.py open 3 main head
```

Repeat with the route and run ID recorded in the whitepaper for Gemini, GLM, Qwen, and
DeepSeek. Do not combine their absolute totals with Claude Code Sonnet as though context
handling and caching were identical. The primary comparison is `head` versus `main` within
a model. Report cache support, price source, tool-result policy, turn ceiling, failures,
and anomalous tails. For routes whose gateway price fields are zero, state **billing data
unavailable**; do not infer that the model is free.
