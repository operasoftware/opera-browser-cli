# Snapshot Efficiency Benchmark

Measures the token cost and task-completion quality of `opera-browser-cli`'s compact snapshot output against raw MCP output and alternative browser CLI tools.

## What it measures

Every browser agent task requires sending the current page as context to the LLM. This benchmark answers:

- **Token savings** — how much does compact snapshot output reduce input token usage vs raw MCP output?
- **Quality** — does compression affect task-completion rate?
- **vs AXI** — how does `opera-browser-cli` compare to `chrome-devtools-axi`, an established browser CLI tool?

### Conditions

| ID              | Description                                                                             |
|-----------------|-----------------------------------------------------------------------------------------|
| `opera-compact` | `opera-browser-cli` default — compact snapshots with URL compression (our tool)         |
| `opera-raw`     | `opera-browser-cli --raw` — uncompressed MCP output piped through our CLI               |
| `mcp-raw`       | Raw `take_snapshot` via bridge HTTP API — no compression at all (chrome-mcp equivalent) |
| `axi`           | `chrome-devtools-axi` CLI — external comparison baseline                                |

### Tasks

7 browser tasks adapted from the [axi bench-browser benchmark](https://github.com/kunchenguid/axi/tree/main/bench-browser), covering single-step reads, multi-step navigation, and complex multi-page extraction:

| ID                           | Category      | Target                                   |
|------------------------------|---------------|------------------------------------------|
| `read_static_page`           | single-step   | example.com                              |
| `wikipedia_fact_lookup`      | single-step   | Wikipedia — Moon infobox                 |
| `github_repo_stars`          | single-step   | github.com/torvalds/linux                |
| `wikipedia_table_read`       | single-step   | Wikipedia — population table             |
| `wikipedia_link_follow`      | multi-step    | Wikipedia Ada Lovelace → Charles Babbage |
| `wikipedia_deep_extraction`  | investigation | Wikipedia Nobel Physics laureates        |
| `github_issue_investigation` | investigation | github.com/facebook/react/issues         |

### Model

Model defaults are set in [`config/models.yaml`](config/models.yaml):

```yaml
agent:
  model: gpt-5.5
  reasoning_effort: medium

judge:
  model: gpt-5.5
  reasoning_effort: low
```

Both use the OpenAI Responses API (`/v1/responses`). The judge runs at lower effort since pass/fail grading is simpler than browser navigation. To use a different model for a run, pass CLI flags (see [CLI reference](#cli-reference)) — these override the config file without changing it.

## Setup

Requirements: Python 3.11+, `opera-browser-cli` in PATH, Opera/Chrome browser open.

```sh
cd benchmarks/snapshot-efficiency
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

For the `axi` condition, also install:

```sh
npm install -g chrome-devtools-axi
```

## Running

All commands run from `benchmarks/snapshot-efficiency/` with the venv active.

### Sanity check (1 run, 1 task)

```sh
OPENAI_API_KEY=<key> python src/run_benchmark.py \
  --conditions opera-compact \
  --tasks read_static_page \
  --repeats 1
```

### Single condition

```sh
OPENAI_API_KEY=<key> python src/run_benchmark.py --conditions opera-compact --repeats 5
```

### All conditions (skipping axi if not installed)

```sh
OPENAI_API_KEY=<key> python src/run_benchmark.py \
  --conditions opera-compact,opera-raw,mcp-raw \
  --repeats 5
```

### Full matrix (requires chrome-devtools-axi)

```sh
OPENAI_API_KEY=<key> python src/run_benchmark.py --repeats 5
```

### Generate report

```sh
python src/report.py
# → results/report.md
```

## Linting & formatting

Install dev tools (separate from benchmark runtime deps):

```sh
pip install -r requirements-dev.txt
```

| Command | What it does |
|---|---|
| `make format` | Apply black + isort (local dev) |
| `make lint` | ruff + flake8 |
| `make typecheck` | mypy |
| `make check` | All of the above, read-only — same as CI |

Config lives in `pyproject.toml` (black, isort, ruff, mypy) and `.flake8`.
All tools are configured for 120-char line length.

## Source layout

```
src/
├── run_benchmark.py   # entry point — CLI arg parsing, outer loop, artifact writing
├── agent.py           # browser agent loop (AgentState, AgentResult, run_agent)
├── judge.py           # LLM-as-judge pass/fail grading (grade)
├── tools.py           # ToolSet subclasses (CLIToolSet, BridgeToolSet) + factory
├── llm.py             # thin OpenAI Responses API wrapper (Client, Turn)
├── report.py          # reads results/*.jsonl and writes results/report.md
└── utils.py           # shared utilities (snapshot_chars)

config/
├── conditions.yaml    # benchmark conditions (tool mode, CLI binary, bridge URL)
├── tasks.yaml         # task prompts and grading hints
└── models.yaml        # agent and judge model + reasoning_effort defaults
```

## CLI reference

```
python src/run_benchmark.py [options]

  --conditions             Comma-separated condition IDs (default: all four)
  --tasks                  Comma-separated task IDs (default: all seven)
  --repeats                Runs per condition × task (default: 5)
  --model                  Agent model — overrides config/models.yaml
  --reasoning-effort       Agent reasoning effort: low / medium / high — overrides config/models.yaml
  --judge-model            Judge model — overrides config/models.yaml
  --judge-reasoning-effort Judge reasoning effort: low / medium / high — overrides config/models.yaml
```

To permanently change the defaults, edit [`config/models.yaml`](config/models.yaml).

## Results layout

```
results/
├── opera-compact.jsonl      # one record per run
├── opera-raw.jsonl
├── mcp-raw.jsonl
├── axi.jsonl
├── report.md                # generated by report.py
└── {condition}/{task}/run{N}/
    ├── agent_output.json    # full trajectory + per-turn token usage
    ├── grade.json           # pass/fail verdict + reason
    └── result.json          # merged record (same shape as the .jsonl row)
```

## Attribution

This benchmark is based on the [axi browser benchmark](https://github.com/kunchenguid/axi/tree/main/bench-browser) by [@kunchenguid](https://github.com/kunchenguid):

- **Task definitions** (`config/tasks.yaml`) — adapted directly from [`bench-browser/config/tasks.yaml`](https://github.com/kunchenguid/axi/blob/main/bench-browser/config/tasks.yaml)
- **LLM-as-judge grading approach** — adapted from [`bench-browser/src/grader.ts`](https://github.com/kunchenguid/axi/blob/main/bench-browser/src/grader.ts)
- **Benchmark methodology** (per-condition JSONL results, trajectory capture, usage metrics) — adapted from [`bench-browser/src/runner.ts`](https://github.com/kunchenguid/axi/blob/main/bench-browser/src/runner.ts)
- **`axi` condition** — uses [`chrome-devtools-axi`](https://github.com/kunchenguid/axi), the browser CLI tool the axi project benchmarks

The original benchmark uses TypeScript + Claude Sonnet. This port uses Python + OpenAI GPT-5.5 with the Responses API.
