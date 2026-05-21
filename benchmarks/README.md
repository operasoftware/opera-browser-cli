# Benchmarks

Two benchmarks quantify the token cost of `opera-browser-cli` compact snapshot output and verify it does not degrade task-completion quality.

Both benchmarks test the same four conditions against the same baselines:

| Condition       | What it runs                                                        |
|-----------------|---------------------------------------------------------------------|
| `opera-compact` | `opera-browser-cli` default — compact snapshots with URL LUT        |
| `opera-raw`     | `opera-browser-cli --raw` — uncompressed MCP output via our CLI     |
| `mcp-raw`       | Raw `take_snapshot` via bridge HTTP API — no processing (baseline)  |
| `axi`           | `chrome-devtools-axi` — external tool for comparison                |

---

## `page-token-benchmark`

Runs `opera-browser-cli open` on 50 static pages (Wikipedia, GitHub, MDN, Python docs, RFC Editor) and counts output tokens via tiktoken. No LLM involved — purely mechanical measurement.

**Results (50 runs each, above-the-fold conditions):**

| Condition       | Avg tokens | Median | p95     |
|-----------------|------------|--------|---------|
| `opera-compact` | 3,729      | 3,682  | 4,732   |
| `opera-raw`     | 4,931      | 4,920  | 5,810   |
| `axi`           | 4,986      | 4,908  | 5,736   |
| `mcp-raw`       | 94,652     | 44,962 | 391,250 |

`--full` variants (no char limit) are also measured; see the [detailed README](page-token-benchmark/README.md) and [results report](page-token-benchmark/results/report.md).

---

## `snapshot-agentic-use`

An LLM agent completes 7 browser tasks (adapted from the [axi bench-browser benchmark](https://github.com/kunchenguid/axi/tree/main/bench-browser)) across 4 conditions. Each run is graded pass/fail by an LLM judge. Captures input tokens, snapshot size, wall time, and tool call count.

**Results (21 runs each, 3 repeats × 7 tasks):**

| Condition       | Pass% | Avg input tok | Avg snap chars | Avg wall (s) |
|-----------------|-------|---------------|----------------|--------------|
| `opera-compact` | 100%  | 41,572        | 76.5k          | 7.4          |
| `opera-raw`     | 100%  | 90,808        | 186.3k         | 8.0          |
| `axi`           | 100%  | 97,036        | 187.4k         | 9.9          |
| `mcp-raw`       | 100%  | 199,015       | 213.0k         | 9.9          |

> `opera-compact` saves **79%** total tokens vs `mcp-raw` at identical 100% pass rate.

See the [detailed README](snapshot-agentic-use/README.md) and [results report](snapshot-agentic-use/results/report.md).

---

## Setup

Requirements: Python 3.11+, `opera-browser-cli` in PATH, browser open.

```sh
cd benchmarks
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Dev tools (linting, formatting, type checking) are shared at this level — see `CLAUDE.md` for details.
