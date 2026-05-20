# page-token-benchmark — Claude guidance

## File roles

| File | Role |
|---|---|
| `src/run_benchmark.py` | Entry point. Loads config, runs the condition × URL loop, writes JSONL records. |
| `src/cli_runner.py` | `run_open(url, flags)` — subprocess wrapper for `opera-browser-cli open`. Returns `RunResult` with stdout, stderr, returncode, wall_seconds, error. |
| `src/report.py` | Reads `results/*.jsonl`, prints and writes `results/report.md`. No external deps beyond stdlib. |
| `config/urls.yaml` | 50 static page URLs across five domains (10 each), keyed by domain group. |
| `config/conditions.yaml` | List of conditions; each has `id`, `description`, `flags` (list of CLI flags). |
| `config/settings.yaml` | `tiktoken_model` and `output_dir`. **The only place to change the default tokenisation model.** |
| `shared/token_counter.py` | `count_tokens(text, model)` — tiktoken wrapper at `benchmarks/shared/`. Falls back to `o200k_base` for unknown models. |

## Data flow

```
run_benchmark.py
  └── for each condition × url:
        cli_runner.run_open(url, flags)     → RunResult (stdout = CLI output)
        shared.token_counter.count_tokens() → int
        upsert_jsonl()                      → results/{condition}.jsonl
```

## Running checks

Dev tooling is at the `benchmarks/` level. From `benchmarks/`:

```sh
pip install -r requirements-dev.txt
make format      # apply black + isort
make lint        # ruff + flake8
make typecheck   # mypy
make check       # format-check + lint + typecheck — no modifications, matches CI
```

## Running the benchmark

From `benchmarks/` with the venv active:

```sh
# Sanity check
python page-token-benchmark/src/run_benchmark.py --conditions default --urls 0

# All conditions, all pages
python page-token-benchmark/src/run_benchmark.py
```

## Key design decisions

### Import resolution
`run_benchmark.py` inserts `benchmarks/` into `sys.path` at startup via `Path(__file__).resolve().parents[2]`, so `from shared.token_counter import count_tokens` works regardless of working directory. `cli_runner` is imported without a package prefix because Python always adds the script's own directory to `sys.path`.

### No LLM involvement
This benchmark is purely mechanical: CLI output → tiktoken → integer. No OpenAI API key required.

### JSONL append mode
Results are appended to JSONL files, not overwritten. Delete `results/*.jsonl` to start fresh.
