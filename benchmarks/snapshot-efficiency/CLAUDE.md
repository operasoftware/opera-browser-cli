# snapshot-efficiency benchmark — Claude guidance

## File roles

| File | Role |
|---|---|
| `src/run_benchmark.py` | Entry point. Loads all three config files, resolves CLI overrides, runs the outer condition × task × repeat loop, writes artifacts and JSONL. |
| `src/agent.py` | Browser agent loop. `run_agent()` drives the LLM turn loop; `AgentState` owns all mutable state accumulation; `AgentResult` is the immutable output. |
| `src/judge.py` | LLM-as-judge grading. `grade()` takes a trajectory and returns `{"pass": bool, "reason": str}`. |
| `src/tools.py` | `ToolSet` base class + `CLIToolSet` (subprocess) and `BridgeToolSet` (HTTP) subclasses. `make_tool_set(condition)` is the factory. |
| `src/llm.py` | Thin OpenAI Responses API wrapper. `Client.call()` returns a `Turn` dataclass. |
| `src/report.py` | Reads `results/*.jsonl`, prints and writes `results/report.md`. No external deps beyond stdlib + the results files. |
| `src/utils.py` | `snapshot_chars(text)` — counts characters in a snapshot result, returns 0 for empty/None. |
| `config/conditions.yaml` | Benchmark conditions: tool mode (`cli` or `bridge`), CLI binary path, bridge URL. |
| `config/tasks.yaml` | Task prompts and grading hints. |
| `config/models.yaml` | Agent and judge model names and reasoning effort. **The only place to change model defaults.** |

## Data flow

```
run_benchmark.py
  └── run_once()
        ├── make_tool_set(condition)      → ToolSet (CLIToolSet or BridgeToolSet)
        ├── run_agent(prompt, tool_set, model, reasoning_effort)
        │     └── loop:
        │           client.call()         → Turn
        │           tool_set.dispatch()   → result str (side effect: browser action)
        │           state.update(turn, turn_index, tool_results)
        │     └── state.to_result()       → AgentResult
        └── grade(prompt, trajectory, model, reasoning_effort, grading_hint)
              └── Client.call()           → {"pass": bool, "reason": str}
```

## Running checks

```sh
# Install dev dependencies (once)
pip install -r requirements-dev.txt

make format      # apply black + isort (modifies files)
make lint        # ruff + flake8 (read-only)
make typecheck   # mypy (read-only)
make check       # format-check + lint + typecheck — no modifications, matches CI
```

Config: `pyproject.toml` for black/isort/ruff/mypy; `.flake8` for flake8 (88-char line length throughout).

## Key design decisions

### No hardcoded model defaults
`run_agent()` and `grade()` require `model` and `reasoning_effort` as positional parameters — there are no defaults in the function signatures. All defaults live in `config/models.yaml`. CLI flags `--model`, `--reasoning-effort`, `--judge-model`, `--judge-reasoning-effort` override them for a single run.

### AgentState owns all state mutations
`AgentState.update(turn, turn_index, tool_results=None)` is the single place that mutates benchmark state:
- Always: accumulates `input_tokens` and `output_tokens` from the turn
- `tool_results=None` (final turn): sets `answer`, appends to `trajectory`
- `tool_results` provided (tool-call turn): increments `tool_call_count`, appends to `snapshot_chars` for snapshot tools, appends to `trajectory`

`run_agent()` only handles control flow and I/O (LLM calls, tool dispatch, `inputs` buffer).

### SNAPSHOT_TOOLS
`SNAPSHOT_TOOLS: frozenset[str]` in `agent.py` defines which tool names produce page snapshots worth measuring. Add a tool name here if it returns a snapshot.

### ToolSet dispatch
Both `CLIToolSet` and `BridgeToolSet` use `match/case` in `dispatch()`. The shared tool schema lives in `_CLI_SCHEMA` (module-level constant in `tools.py`), evaluated once at import time.
