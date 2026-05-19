import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import yaml

from agent import run_agent
from judge import grade
from tools import make_tool_set

ROOT = Path(__file__).parent.parent  # benchmarks/snapshot-efficiency/
RESULTS_DIR = ROOT / "results"


def load_config() -> tuple[dict, dict, dict]:
    config = ROOT / "config"
    with open(config / "tasks.yaml") as f:
        tasks = yaml.safe_load(f)["tasks"]
    with open(config / "conditions.yaml") as f:
        conditions = {c["id"]: c for c in yaml.safe_load(f)["conditions"]}
    with open(config / "models.yaml") as f:
        models = yaml.safe_load(f)
    return tasks, conditions, models


def artifact_dir(condition_id: str, task_id: str, run_n: int) -> Path:
    d = RESULTS_DIR / condition_id / task_id / f"run{run_n}"
    d.mkdir(parents=True, exist_ok=True)
    return d


def next_run_index(condition_id: str, task_id: str) -> int:
    base = RESULTS_DIR / condition_id / task_id
    if not base.exists():
        return 0
    existing = [d for d in base.iterdir() if d.is_dir() and d.name.startswith("run")]
    return len(existing)


def upsert_jsonl(condition_id: str, record: dict) -> None:
    path = RESULTS_DIR / f"{condition_id}.jsonl"
    with open(path, "a") as f:
        f.write(json.dumps(record) + "\n")


def start_daemon(condition: dict) -> subprocess.Popen | None:
    start_cmd = condition.get("start")
    if not start_cmd:
        return None
    print(f"  Starting daemon: {start_cmd}")
    proc = subprocess.Popen(start_cmd, shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2)
    return proc


def stop_daemon(condition: dict, proc: subprocess.Popen | None) -> None:
    stop_cmd = condition.get("stop")
    if stop_cmd:
        subprocess.run(stop_cmd, shell=True, capture_output=True)
    if proc:
        proc.terminate()


def run_once(
    condition: dict,
    task_id: str,
    task: dict,
    run_n: int,
    model: str,
    reasoning_effort: str,
    judge_model: str,
    judge_reasoning_effort: str,
) -> dict:
    tool_set = make_tool_set(condition)
    result = run_agent(
        task_prompt=task["prompt"],
        tool_set=tool_set,
        model=model,
        reasoning_effort=reasoning_effort,
    )
    grading_hint = task.get("grading", {}).get("grading_hint")
    if tool_set.all_errored:
        verdict = {"pass": False, "reason": "all tool calls errored — tool not installed or not running"}
    else:
        verdict = grade(task["prompt"], result.trajectory, judge_model, judge_reasoning_effort,
                        grading_hint=grading_hint)

    # per-snapshot stats
    sc = result.snapshot_chars
    snapshot_stats = {
        "count": len(sc),
        "total_chars": sum(sc),
        "avg_chars": int(sum(sc) / len(sc)) if sc else 0,
        "max_chars": max(sc) if sc else 0,
    }

    record = {
        "condition": condition["id"],
        "task": task_id,
        "run": run_n,
        "pass": verdict.get("pass", False),
        "grade_reason": verdict.get("reason", ""),
        "answer": result.answer,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "total_tokens": result.total_tokens,
        "tool_call_count": result.tool_call_count,
        "wall_clock_seconds": round(result.wall_clock_seconds, 1),
        "snapshot": snapshot_stats,
        "error": result.error,
    }

    adir = artifact_dir(condition["id"], task_id, run_n)
    (adir / "agent_output.json").write_text(json.dumps({
        "trajectory": result.trajectory,
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
        "snapshot_chars": result.snapshot_chars,
    }, indent=2))
    (adir / "grade.json").write_text(json.dumps(verdict, indent=2))
    (adir / "result.json").write_text(json.dumps(record, indent=2))

    return record


def main() -> None:
    parser = argparse.ArgumentParser(description="Run snapshot benchmark")
    parser.add_argument("--conditions", default=None, help="Comma-separated condition IDs (default: all)")
    parser.add_argument("--tasks", default=None, help="Comma-separated task IDs (default: all)")
    parser.add_argument("--repeats", type=int, default=5, help="Runs per condition×task")
    parser.add_argument("--model", default=None, help="Agent model (overrides config/models.yaml)")
    parser.add_argument("--reasoning-effort", default=None, dest="reasoning_effort",
                        help="Agent reasoning effort low/medium/high (overrides config/models.yaml)")
    parser.add_argument("--judge-model", default=None, dest="judge_model",
                        help="Judge model (overrides config/models.yaml)")
    parser.add_argument("--judge-reasoning-effort", default=None, dest="judge_reasoning_effort",
                        help="Judge reasoning effort low/medium/high (overrides config/models.yaml)")
    args = parser.parse_args()

    if not os.environ.get("OPENAI_API_KEY"):
        sys.exit("Error: OPENAI_API_KEY environment variable not set")

    all_tasks, all_conditions, models_cfg = load_config()

    agent_model = args.model or models_cfg["agent"]["model"]
    agent_effort = args.reasoning_effort or models_cfg["agent"]["reasoning_effort"]
    judge_model = args.judge_model or models_cfg["judge"]["model"]
    judge_effort = args.judge_reasoning_effort or models_cfg["judge"]["reasoning_effort"]

    selected_conditions = args.conditions.split(",") if args.conditions else list(all_conditions.keys())
    selected_tasks = args.tasks.split(",") if args.tasks else list(all_tasks.keys())

    # validate
    for cid in selected_conditions:
        if cid not in all_conditions:
            sys.exit(f"Unknown condition: {cid}. Available: {', '.join(all_conditions)}")
    for tid in selected_tasks:
        if tid not in all_tasks:
            sys.exit(f"Unknown task: {tid}. Available: {', '.join(all_tasks)}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    total = len(selected_conditions) * len(selected_tasks) * args.repeats
    done = 0

    for cid in selected_conditions:
        condition = all_conditions[cid]
        print(f"\n{'='*60}")
        print(f"Condition: {cid}")
        print(f"{'='*60}")

        daemon = start_daemon(condition)
        try:
            for tid in selected_tasks:
                task = all_tasks[tid]
                for repeat in range(args.repeats):
                    run_n = next_run_index(cid, tid)
                    done += 1
                    print(f"\n[{done}/{total}] {cid} / {tid} / run{run_n}")
                    try:
                        record = run_once(
                            condition=condition,
                            task_id=tid,
                            task=task,
                            run_n=run_n,
                            model=agent_model,
                            reasoning_effort=agent_effort,
                            judge_model=judge_model,
                            judge_reasoning_effort=judge_effort,
                        )
                        status = "PASS" if record["pass"] else "FAIL"
                        tokens = record["total_tokens"]
                        avg_snap = record["snapshot"]["avg_chars"]
                        elapsed = record["wall_clock_seconds"]
                        print(f"  {status} | {tokens} tokens | {avg_snap} avg snap chars | {elapsed}s")
                        if record["error"]:
                            print(f"  Error: {record['error']}")
                        upsert_jsonl(cid, record)
                    except KeyboardInterrupt:
                        print("\nInterrupted.")
                        stop_daemon(condition, daemon)
                        sys.exit(0)
                    except Exception as e:
                        print(f"  Run failed: {e}")
        finally:
            stop_daemon(condition, daemon)

    print(f"\nDone. Results in {RESULTS_DIR}/")
    print("Run: python report.py")


if __name__ == "__main__":
    main()
