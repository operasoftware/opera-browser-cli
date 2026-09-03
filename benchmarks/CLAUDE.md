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

## `agentic-v3` — cross-version and cross-model agentic comparison

The directory contains the original three-build Haiku study, later Sonnet reruns, and the
current balanced cross-model experiment. The current experiment runs six real-world tasks
against `main` and compact-v3 `head`, in strict and open modes, with three repeats across six
model families (432 runs). Sonnet runs through Claude Code; the other families use the
Responses API driver in `harness/agent.py`. Results come from the driver's JSON output and an
independent CLI logging shim.

### File roles

| File | Role |
|---|---|
| `agentic-v3/suite.md` | Task set, pinned expected answers, agent prompt, controls. |
| `agentic-v3/results-2026-08-01.md` | v1/v2/v3 comparison: results tables and findings. |
| `agentic-v3/results-2026-08-02-postfix.md` | Post-fix re-run (v4) + the Sonnet chain addendum. |
| `agentic-v3/results-2026-08-02-n3-sonnet.md` | Original n=3 Sonnet report: v1 vs v2 vs v4 (54 runs). |
| `agentic-v3/model-family-browser-agents-whitepaper.md` | Current six-family balanced-study report. |
| `agentic-v3/COMPREHENSIVE-RUN.md` | Current run protocol and controls. |
| `agentic-v3/harness/_shim.zsh` | Wraps a condition binary; logs argv/exit/bytes/duration; `.out` is only a capped excerpt. |
| `agentic-v3/harness/gen.zsh` | `gen.zsh <cond> <task>` -> per-cell logging wrapper path. |
| `agentic-v3/harness/runctl.zsh` | `switch <cond>` (restart that build's bridge) / `reset <cond>` (clear state). |
| `agentic-v3/harness/run-direct.py` | Runs non-Anthropic matrices through the direct Responses API driver. |
| `agentic-v3/harness/agent.py` | Single-cell direct driver; `TOOL_CAP=0` means no extra harness cap. |
| `agentic-v3/harness/analyze-matrix.py` | Joins driver results with shim TSVs for current runs. |
| `agentic-v3/harness/analyze.py`, `analyze3.py` | Analyzers kept for the original studies. |
| `agentic-v3/data/` | Saved results, logs, and SHA-256 manifests. |

### Key design decisions

- **Two measurements, no self-report** — shim TSV bytes measure CLI stdout; driver results
  contain provider-reported usage. Neither is the same as DOM size or exact model context.
- **Sequential only** — runs share a browser; current runs isolate CLI state with per-run
  `OPERA_CLI_SESSION`, while the original study required explicit global-state resets.
- **Two modes** — strict forbids `eval` to test the snapshot/action interface; open permits
  it to test the full command set.
- **Capped comparison runs** — current direct-driver runs use `TOOL_CAP=0`; separate archived
  runs used an 8,000-character cap. They are not replays of the same model responses.

## `agentic-dataset` — 51-task category corpus (A–E)

Larger corpus derived from `Dataset benchmark for agents.md`: 51 tasks across five
categories (A deep search & doc reading, B SPA interaction, C forms & post-submit
navigation, D tabular extraction, E cross-page link navigation), each run by a fresh
agent. Same harness as `agentic-v3`; conditions are `head` (this branch) vs `main`
(upstream). Tasks are **tiered**: the 18 `tasks-tier1.tsv` tasks run against live public
sites; the 33 T2 tasks need local fixtures (not yet shipped).

| File | Role |
|---|---|
| `agentic-dataset/suite.md` | Category tables, tiering, pinned answers, controls, prompt. |
| `agentic-dataset/tasks.tsv` | All 51 tasks (slug<TAB>prompt) — canonical cell identity. |
| `agentic-dataset/tasks-tier1.tsv` | The 18 runnable-now (public site) tasks. |
| `agentic-dataset/pin/answers.json` | Pinned expected answers for grading (null = ungraded). |
| `agentic-dataset/harness/grade.py` | `grade.py <arm>` -> pass/fail broken out by category A–E. |
| `agentic-dataset/harness/*` | Same shim/gen/runctl/run-matrix/analyze as `agentic-v3`. |

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
