import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml
from cli_runner import run_condition

from shared.token_counter import count_tokens

CONFIG_DIR = Path(__file__).parent.parent / "config"


@dataclass
class BenchmarkRecord:
    url: str
    condition: str
    tokens: int
    chars: int
    returncode: int
    wall_seconds: float
    error: str | None


def load_config() -> tuple[dict[str, Any], list[dict[str, Any]], list[str]]:
    with open(CONFIG_DIR / "settings.yaml") as f:
        settings: dict[str, Any] = yaml.safe_load(f)
    with open(CONFIG_DIR / "conditions.yaml") as f:
        conditions: list[dict[str, Any]] = yaml.safe_load(f)
    with open(CONFIG_DIR / "urls.yaml") as f:
        raw_urls: dict[str, list[str]] = yaml.safe_load(f)
    urls = [url for group in raw_urls.values() for url in group]
    return settings, conditions, urls


def run_lifecycle(cmd: str, label: str, env: dict | None = None, timeout: int = 90) -> None:
    run_env = {**os.environ, **env} if env else None
    print(f"  [{label}] {cmd}")
    try:
        result = subprocess.run(shlex.split(cmd), capture_output=True, text=True, timeout=timeout, env=run_env)
        if result.returncode != 0:
            msg = (result.stdout or result.stderr or "").strip().splitlines()[0]
            print(f"  [warning] {label} exited {result.returncode}: {msg}", file=sys.stderr)
    except subprocess.TimeoutExpired:
        print(f"  [warning] {label} timed out after {timeout}s — continuing", file=sys.stderr)


def upsert_jsonl(results_dir: Path, record: BenchmarkRecord) -> None:
    results_dir.mkdir(parents=True, exist_ok=True)
    path = results_dir / f"{record.condition}.jsonl"
    with open(path, "a") as f:
        f.write(json.dumps(asdict(record)) + "\n")


def run_one(url: str, condition: dict[str, Any], tiktoken_encoding: str) -> BenchmarkRecord:
    result = run_condition(url, condition)
    if result.error:
        tokens, chars = 0, 0
    else:
        tokens = count_tokens(result.stdout, encoding=tiktoken_encoding) if result.stdout else 0
        chars = len(result.stdout)
    return BenchmarkRecord(
        url=url,
        condition=condition["id"],
        tokens=tokens,
        chars=chars,
        returncode=result.returncode,
        wall_seconds=round(result.wall_seconds, 3),
        error=result.error,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Page token benchmark")
    parser.add_argument("--conditions", help="Comma-separated condition IDs (default: all)")
    parser.add_argument("--sample", type=int, metavar="N", help="Run N randomly sampled URLs instead of all")
    parser.add_argument("--encoding", help="tiktoken encoding override")
    args = parser.parse_args()

    settings, all_conditions, all_urls = load_config()
    tiktoken_encoding: str = args.encoding or settings["tiktoken_encoding"]
    results_dir = Path(__file__).parent.parent / settings["output_dir"]

    if args.conditions:
        wanted = set(args.conditions.split(","))
        conditions = [c for c in all_conditions if c["id"] in wanted]
        missing = wanted - {c["id"] for c in conditions}
        if missing:
            print(f"Unknown conditions: {missing}", file=sys.stderr)
            sys.exit(1)
    else:
        conditions = all_conditions

    urls = random.sample(all_urls, args.sample) if args.sample is not None else all_urls

    total = len(conditions) * len(urls)
    done = 0

    for condition in conditions:
        cond_env = condition.get("env")
        if start_cmd := condition.get("start"):
            for cmd in ([start_cmd] if isinstance(start_cmd, str) else start_cmd):
                run_lifecycle(cmd, "start", env=cond_env)
        for url in urls:
            done += 1
            print(f"[{done}/{total}] {condition['id']} — {url}")
            record = run_one(url, condition, tiktoken_encoding)
            upsert_jsonl(results_dir, record)
            status = f"  {record.tokens} tokens, {record.chars} chars"
            if record.error:
                status += f", ERROR: {record.error}"
            print(status)
        if stop_cmd := condition.get("stop"):
            for cmd in ([stop_cmd] if isinstance(stop_cmd, str) else stop_cmd):
                run_lifecycle(cmd, "stop", env=cond_env)

    print(f"\nDone. Results in {results_dir}/")


if __name__ == "__main__":
    main()
