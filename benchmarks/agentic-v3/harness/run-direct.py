#!/usr/bin/env python3
"""
run-direct.py — run the balanced agentic-v3 matrix without Claude Code.

Same orchestration as run-matrix.zsh (one fresh agent per condition×task×repeat
cell, sequential — cells share one browser + machine-global state dir), but the
agent is driven by harness/agent.py directly against the LiteLLM gateway instead
of `claude -p`. Use for non-Anthropic models (e.g. openai/gpt-5.6-luna), where
claude's cost accounting is unreliable.

Usage:
    BENCH_MODEL=openai/gpt-5.6-luna python3 harness/run-direct.py <arm> <repeats> [conds...]

Env:
    BENCH_MODEL (default openai/gpt-5.6-luna)
    BENCH_MAX_TURNS (default 40)
    BENCH_TASKS_FILE (default harness/tasks.tsv — point at a subset to smoke-test)
    BENCH_RUN_ID (optional; writes isolated results/<id>/ and logs/<id>/ directories)
    BENCH_PRICES (optional USD/token input,output,cache-read,cache-write override)
"""

import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(ROOT))  # repo root

ARM = sys.argv[1]
REPS = int(sys.argv[2])
CONDS = sys.argv[3:] or ["head", "main"]
MODEL = os.environ.get("BENCH_MODEL", "openai/gpt-5.6-luna")
MAXTURNS = int(os.environ.get("BENCH_MAX_TURNS", "40"))
RUN_ID = os.environ.get("BENCH_RUN_ID", "").strip()
PRICES = os.environ.get("BENCH_PRICES", "").strip()
TAG = "s" if ARM != "open" else "e"
NO_EVAL = (
    ""
    if ARM == "open"
    else (
        "- Do not use the CLI's `eval` command (or any other JavaScript execution) to read "
        "page content. Treat JavaScript evaluation as unavailable: everything you learn about "
        "the page must come from the CLI's page-inspection commands. You may still use the "
        "interaction commands (click/fill/press/...) freely.\n"
    )
)

TASKS_FILE = os.environ.get("BENCH_TASKS_FILE", os.path.join(HERE, "tasks.tsv"))
tasks = []
for line in open(TASKS_FILE):
    line = line.rstrip("\n")
    if "\t" in line:
        slug, text = line.split("\t", 1)
        tasks.append((slug, text))
canon = {}
for i, line in enumerate(open(os.path.join(HERE, "tasks.tsv"))):
    if "\t" in line:
        canon[line.split("\t", 1)[0]] = i + 1

results_root = os.path.join(ROOT, "results", RUN_ID) if RUN_ID else os.path.join(ROOT, "results")
logs_root = os.path.join(ROOT, "logs", RUN_ID) if RUN_ID else os.path.join(ROOT, "logs")
os.makedirs(os.path.join(results_root, ARM), exist_ok=True)
os.makedirs(logs_root, exist_ok=True)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=ROOT).stdout.strip()


for r in range(1, REPS + 1):
    order = list(CONDS)
    for _ in range(1, r):
        order = order[1:] + order[:1]
    for cond in order:
        print(f"\n=== pass {r} · {cond} ===", flush=True)
        sw = subprocess.run(
            [os.path.join(HERE, "runctl.zsh"), "switch", cond], capture_output=True, text=True, cwd=ROOT
        )
        if sw.returncode != 0:
            print(f"bridge switch failed: {sw.stderr}", flush=True)
            sys.exit(1)
        for idx, (slug, text) in enumerate(tasks, start=1):
            cidx = canon[slug]
            cell = f"t{cidx}{TAG}{r}"
            outfile = os.path.join(results_root, ARM, f"{cond}-{slug}-r{r}.json")
            if os.path.exists(outfile):
                print(f"  {slug} — done, skipping", flush=True)
                continue
            wrapper_env = f"BENCH_LOG_DIR={logs_root} " if RUN_ID else ""
            wrapper = sh(f'{wrapper_env}{os.path.join(HERE, "gen.zsh")} {cond} {cell}')
            prompt = (
                "You are testing a browser-automation CLI. Drive the browser using ONLY "
                f"this exact command:\n\n{wrapper}\n\nHard rules:\n"
                "- Never use the bare `opera-browser-cli` command or any other path — "
                "only the path above.\n"
                "- Never use WebFetch, WebSearch, curl, or any other way of reading the "
                "page. The browser CLI is the only permitted source of page content.\n"
                + NO_EVAL
                + "- Do not edit files, do not run git.\n"
                f"- Start by running `{wrapper} --help` to see what commands exist, "
                "then use them.\n"
                "- Work efficiently: minimise both the number of CLI calls and the amount "
                "of output you pull into context. If output is truncated, use whatever "
                "the CLI offers for reading more rather than always asking for everything.\n\n"
                f"TASK: {text}\n\n"
                "Finish with exactly these two lines:\nANSWER: <one line>\n"
                "CALLS: <how many CLI invocations you made>\n"
            )
            with open("/tmp/agent_prompt.txt", "w") as f:
                f.write(prompt)
            print(f"  {slug} … ", end="", flush=True)
            env = dict(os.environ)
            env["BENCH_MAX_TURNS"] = str(MAXTURNS)
            command = [
                sys.executable,
                os.path.join(HERE, "agent.py"),
                "--model",
                MODEL,
                "--prompt",
                "/tmp/agent_prompt.txt",
                "--wrapper",
                wrapper,
                "--max-turns",
                str(MAXTURNS),
            ]
            if PRICES:
                command.extend(["--prices", PRICES])
            rp = subprocess.run(command, capture_output=True, text=True, env=env)
            if rp.returncode == 0 and rp.stdout.strip():
                env_ = json.loads(rp.stdout.strip())
                with open(outfile, "w") as f:
                    json.dump(env_, f, indent=1)
                print(
                    f"$ {env_.get('total_cost_usd', 0):.4f}  {env_.get('num_turns', 0)} turns  "
                    f"{env_.get('calls', 0)} calls",
                    flush=True,
                )
            else:
                # A crashed cell must not abort the whole matrix: record an
                # explicit error envelope and move on, so one transient driver
                # crash doesn't lose every remaining cell.
                print(f"CELL CRASHED (rc={rp.returncode}): " f"{rp.stderr[-200:]}", flush=True)
                with open(outfile, "w") as f:
                    json.dump(
                        {
                            "model": MODEL,
                            "driver": "agent.py",
                            "total_cost_usd": 0,
                            "num_turns": 0,
                            "calls": 0,
                            "is_error": True,
                            "result": "[cell crashed] " + rp.stderr[-200:],
                            "usage": {},
                        },
                        f,
                        indent=1,
                    )

print(f"\nmatrix complete → {os.path.join(results_root, ARM)}")
