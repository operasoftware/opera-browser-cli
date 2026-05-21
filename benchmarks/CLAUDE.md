# benchmarks — Claude guidance

Two benchmarks measure the token cost of `opera-browser-cli` snapshot output. Both live under
`benchmarks/` and share the dev-tooling setup at that level.

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
