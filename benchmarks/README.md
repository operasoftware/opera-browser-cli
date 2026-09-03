# Benchmarks

Three benchmark suites measure token cost and agentic quality of `opera-browser-cli`
snapshot output. Legacy benchmark results are in the [main README](../README.md#benchmarks);
the current compact-v3 cross-model study has its own
[whitepaper](agentic-v3/model-family-browser-agents-whitepaper.md).

## Setup

```sh
cd benchmarks
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

Dev tools (linting, formatting, type checking):

```sh
pip install -r requirements-dev.txt
make check       # format-check + lint + typecheck
make format      # auto-format with black + isort
```

---

## `agentic-v3`

The current balanced study compares compact-v3 `head` with upstream `main` on six tasks,
two modes (`strict` and `open`), six model families, and three repeats (432 runs). Start with:

- [cross-model whitepaper](agentic-v3/model-family-browser-agents-whitepaper.md);
- [task suite](agentic-v3/suite.md);
- [run protocol](agentic-v3/COMPREHENSIVE-RUN.md);
- [retained data and manifests](agentic-v3/data/).

The main non-Anthropic runs pass CLI output through without an additional harness cap
(`TOOL_CAP=0`). Separate archived runs used an 8,000-character cap.

---

## `page-token-benchmark`

Runs `opera-browser-cli open` on 50 static pages and counts output tokens via tiktoken. No LLM involved.

### Run

```sh
# All conditions, all pages
python page-token-benchmark/src/run_benchmark.py

# Specific conditions
python page-token-benchmark/src/run_benchmark.py --conditions default,opera-compact

# Random sample of N URLs
python page-token-benchmark/src/run_benchmark.py --sample 5

# Report (defaults to latest run)
PYTHONPATH=. python page-token-benchmark/src/report.py

# Report for a specific run
PYTHONPATH=. python page-token-benchmark/src/report.py --run 2605221430
```

### Results layout

Each run writes to `page-token-benchmark/results/<YYMMDDHHMM>/`:

```
results/
  2605221430/
    default.jsonl       # one record per URL
    opera-compact.jsonl
    report.md           # written by report.py
```

### Conditions

Defined in `page-token-benchmark/config/conditions.yaml`. Each entry has `id`, `description`, and `flags` passed to the CLI. Add a condition there — no code changes needed.

### Key files

| File                      | Role                                                                      |
|---------------------------|---------------------------------------------------------------------------|
| `src/run_benchmark.py`    | Entry point — loads config, runs condition × URL loop, writes JSONL       |
| `src/cli_runner.py`       | `run_condition(url, condition)` — subprocess wrapper, returns `RunResult` |
| `src/report.py`           | Reads `results/<run>/*.jsonl`, prints and writes `report.md`              |
| `config/urls.yaml`        | 50 static page URLs (10 each across 5 domains)                            |
| `config/conditions.yaml`  | Conditions: `id`, `description`, `flags`                                  |
| `config/settings.yaml`    | `tiktoken_encoding` and `output_dir`                                      |
| `shared/token_counter.py` | `count_tokens(text, encoding)` — tiktoken wrapper                         |

---

## `snapshot-agentic-use`

An LLM agent completes 7 browser tasks across 4 conditions. Each run is graded pass/fail by an LLM judge. Requires `OPENAI_API_KEY`.

### Run

```sh
export OPENAI_API_KEY=sk-...

# All conditions, 5 repeats per task
python snapshot-agentic-use/src/run_benchmark.py --repeats 5

# Sanity check — one condition, one task, one repeat
python snapshot-agentic-use/src/run_benchmark.py --conditions opera-compact --tasks read_static_page --repeats 1

# Specific conditions and tasks
python snapshot-agentic-use/src/run_benchmark.py --conditions opera-compact,mcp-raw --tasks read_static_page,find_link

# Report (defaults to latest run)
python snapshot-agentic-use/src/report.py

# Report for a specific run
python snapshot-agentic-use/src/report.py --run 2605221430
```

### Results layout

Each run writes to `snapshot-agentic-use/results/<YYMMDDHHMM>/`:

```
results/
  2605221430/
    opera-compact.jsonl     # one record per task × repeat
    mcp-raw.jsonl
    opera-compact/          # per-run artifacts
      read_static_page/
        run0/
          agent_output.json
          grade.json
          result.json
    report.md               # written by report.py
```

### Conditions

Defined in `snapshot-agentic-use/config/conditions.yaml`. Each condition specifies tool mode (`cli` or `bridge`), CLI binary path, and optional `start`/`stop` commands for daemon-based conditions.

### Models

Agent and judge model defaults live in `config/models.yaml`. Override per-run with `--model`, `--reasoning-effort`, `--judge-model`, `--judge-reasoning-effort`.

### Key files

| File                     | Role                                                                                     |
|--------------------------|------------------------------------------------------------------------------------------|
| `src/run_benchmark.py`   | Entry point — loads configs, runs condition × task × repeat loop, writes JSONL           |
| `src/agent.py`           | `run_agent()` drives the LLM turn loop; `AgentResult` is the immutable output            |
| `src/judge.py`           | `grade(prompt, trajectory, ...)` returns `{"pass": bool, "reason": str}`                 |
| `src/tools.py`           | `ToolSet` base + `CLIToolSet`/`BridgeToolSet`; `make_tool_set(condition)` is the factory |
| `src/llm.py`             | Thin OpenAI Responses API wrapper; `Client.call()` returns a `Turn`                      |
| `src/report.py`          | Reads `results/<run>/*.jsonl`, prints and writes `report.md`                             |
| `src/utils.py`           | `snapshot_chars(text)` — counts chars in a snapshot result                               |
| `config/conditions.yaml` | Tool mode, CLI binary path, bridge URL                                                   |
| `config/tasks.yaml`      | Task prompts and grading hints                                                           |
| `config/models.yaml`     | Agent and judge model + reasoning effort defaults                                        |
