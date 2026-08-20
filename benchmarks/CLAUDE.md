# benchmarks — Claude guidance

Three benchmarks measure the cost and agentic quality of `opera-browser-cli` snapshot output.
All live under `benchmarks/` and share the dev-tooling setup at that level.

---

## `page-token-benchmark` — raw token cost

Runs `opera-browser-cli open` on 50 static pages and counts tokens via tiktoken. No LLM involved.

### File roles

| File | Role |
|---|---|
| `page-token-benchmark/src/run_benchmark.py` | Entry point. Loads config, runs condition × URL loop, writes JSONL. |
| `page-token-benchmark/src/cli_runner.py` | `run_open(url, flags)` — subprocess wrapper. Returns `RunResult`. |
| `page-token-benchmark/src/report.py` | Reads `results/*.jsonl`, prints and writes `results/report.md`. |
| `page-token-benchmark/config/urls.yaml` | 50 static page URLs (10 each across 5 domains). |
| `page-token-benchmark/config/conditions.yaml` | Conditions: each has `id`, `description`, `flags`. |
| `page-token-benchmark/config/settings.yaml` | `tiktoken_model` and `output_dir`. Only place to change tokenisation model. |
| `shared/token_counter.py` | `count_tokens(text, model)` — tiktoken wrapper, falls back to `o200k_base`. |

### Data flow

```
run_benchmark.py
  └── for each condition × url:
        cli_runner.run_open(url, flags)     → RunResult (stdout = CLI output)
        shared.token_counter.count_tokens() → int
        upsert_jsonl()                      → results/{condition}.jsonl
```

### Running

From `benchmarks/` with venv active:

```sh
# Sanity check
python page-token-benchmark/src/run_benchmark.py --conditions default --urls 0

# All conditions, all pages
python page-token-benchmark/src/run_benchmark.py

# Report
PYTHONPATH=. python page-token-benchmark/src/report.py
```

### Key design decisions

- **Import resolution** — `run_benchmark.py` inserts `benchmarks/` into `sys.path` via
  `Path(__file__).resolve().parents[2]`, so `from shared.token_counter import count_tokens` works
  regardless of working directory.
- **No LLM** — purely mechanical: CLI output → tiktoken → integer.
- **JSONL append mode** — results are appended, not overwritten. Delete `results/*.jsonl` to reset.

---

## `snapshot-agentic-use` — end-to-end agentic quality

LLM agent completes 7 browser tasks across 4 conditions, graded pass/fail by an LLM judge.
Captures input tokens, snapshot size, wall time, and tool call count.

### File roles

| File | Role |
|---|---|
| `snapshot-agentic-use/src/run_benchmark.py` | Entry point. Loads configs, runs condition × task × repeat loop, writes JSONL. |
| `snapshot-agentic-use/src/agent.py` | `run_agent()` drives the LLM turn loop. `AgentState` owns all mutable state. `AgentResult` is the immutable output. |
| `snapshot-agentic-use/src/judge.py` | `grade()` takes a trajectory and returns `{"pass": bool, "reason": str}`. |
| `snapshot-agentic-use/src/tools.py` | `ToolSet` base + `CLIToolSet`/`BridgeToolSet` subclasses. `make_tool_set(condition)` is the factory. |
| `snapshot-agentic-use/src/llm.py` | Thin OpenAI Responses API wrapper. `Client.call()` returns a `Turn`. |
| `snapshot-agentic-use/src/report.py` | Reads `results/*.jsonl`, prints and writes `results/report.md`. |
| `snapshot-agentic-use/src/utils.py` | `snapshot_chars(text)` — counts chars in a snapshot result, returns 0 for empty/None. |
| `snapshot-agentic-use/config/conditions.yaml` | Tool mode (`cli` or `bridge`), CLI binary path, bridge URL. |
| `snapshot-agentic-use/config/tasks.yaml` | Task prompts and grading hints. |
| `snapshot-agentic-use/config/models.yaml` | Agent and judge model + reasoning effort. Only place to change model defaults. |

### Data flow

```
run_benchmark.py
  └── run_once()
        ├── make_tool_set(condition)      → ToolSet (CLIToolSet or BridgeToolSet)
        ├── run_agent(prompt, tool_set, model, reasoning_effort)
        │     └── loop:
        │           client.call()         → Turn
        │           tool_set.dispatch()   → result str
        │           state.update(turn, turn_index, tool_results)
        │     └── state.to_result()       → AgentResult
        └── grade(prompt, trajectory, model, reasoning_effort, grading_hint)
              └── Client.call()           → {"pass": bool, "reason": str}
```

### Running

From `benchmarks/` with venv active and `OPENAI_API_KEY` set:

```sh
# Sanity check
python snapshot-agentic-use/src/run_benchmark.py --conditions opera-compact --tasks read_static_page --repeats 1

# All conditions
python snapshot-agentic-use/src/run_benchmark.py --repeats 5

# Report
python snapshot-agentic-use/src/report.py
```

### Key design decisions

- **No hardcoded model defaults** — `run_agent()` and `grade()` require `model` and
  `reasoning_effort` as positional params. All defaults live in `config/models.yaml`.
- **`AgentState` owns all state mutations** — `AgentState.update(turn, turn_index, tool_results)`
  is the single place that mutates benchmark state (token accumulation, tool call count,
  snapshot char tracking, trajectory).
- **`SNAPSHOT_TOOLS`** — `frozenset[str]` in `agent.py` defines which tool names produce
  snapshots worth measuring. Add a tool name here to track it.
- **ToolSet dispatch** — both subclasses use `match/case` in `dispatch()`. Shared tool schema
  lives in `_CLI_SCHEMA` (module-level constant in `tools.py`), evaluated once at import.

---

## `agentic-v3` — cross-version agentic comparison (Claude Code subagents)

Six real-world tasks x three builds (`main`, `d9a1f4f`, `HEAD`) x one fresh Haiku agent
each, run sequentially against a live browser; plus a post-fix `v4` re-run and a two-task
Sonnet addendum. Unlike `snapshot-agentic-use` this suite
uses no Python driver and no OpenAI key: the agents are Claude Code subagents, and
measurement comes from a logging shim plus the subagent transcripts.

### File roles

| File | Role |
|---|---|
| `agentic-v3/suite.md` | Task set, pinned expected answers, agent prompt, controls. |
| `agentic-v3/results-2026-08-01.md` | v1/v2/v3 comparison: results tables and findings. |
| `agentic-v3/results-2026-08-02-postfix.md` | Post-fix re-run (v4) + the Sonnet chain addendum. |
| `agentic-v3/results-2026-08-02-n3-sonnet.md` | **Definitive**: n=3 Sonnet, v1 vs v2 vs v4 (54 runs). |
| `agentic-v3/harness/_shim.zsh` | Wraps a condition binary; logs argv/exit/bytes/duration + full output. |
| `agentic-v3/harness/gen.zsh` | `gen.zsh <cond> <task>` -> per-cell logging wrapper path. |
| `agentic-v3/harness/runctl.zsh` | `switch <cond>` (restart that build's bridge) / `reset <cond>` (clear state). |
| `agentic-v3/harness/analyze.py` | Joins shim TSVs with subagent transcripts -> cost tables. |
| `agentic-v3/harness/analyze3.py` | Same, for the n=3 matrix: per-repeat totals, sd, per-task means. |
| `agentic-v3/logs/*.tsv` | One row per CLI call, per (condition, task) cell. |

### Key design decisions

- **Two instruments, no self-report** - shim bytes measure what the CLI emitted; the
  transcripts measure what actually entered the agent's context. They disagree when the
  client truncates oversized tool output, and that disagreement is itself a finding.
- **Sequential only** - CLI session state is one machine-global directory, so parallel
  agents corrupt each other's diff baselines (see `docs/compact-v3-review.md`, B-3).
- **`eval` is forbidden in graded runs** - otherwise agents skip snapshots entirely and
  the suite measures nothing (finding A-1).

## Shared dev tooling

From `benchmarks/`:

```sh
pip install -r requirements-dev.txt
make format      # black + isort (modifies files)
make lint        # ruff + flake8
make typecheck   # mypy
make check       # format-check + lint + typecheck — matches CI
```

Config: `benchmarks/pyproject.toml` (black, isort, ruff, mypy); `benchmarks/.flake8` (120-char
line length). The `shared/` directory (`shared/token_counter.py`) is imported by
`page-token-benchmark`; `snapshot-agentic-use` does not use it.
