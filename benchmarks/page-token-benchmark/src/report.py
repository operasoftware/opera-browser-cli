import json
import statistics
import sys
from pathlib import Path
from typing import Any

RESULTS_DIR = Path(__file__).parent.parent / "results"


def load_results() -> dict[str, list[dict[str, Any]]]:
    results: dict[str, list[dict[str, Any]]] = {}
    for path in sorted(RESULTS_DIR.glob("*.jsonl")):
        condition_id = path.stem
        records: list[dict[str, Any]] = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        results[condition_id] = records
    return results


def summarize(records: list[dict[str, Any]]) -> dict[str, Any]:
    token_vals = [r["tokens"] for r in records if r["error"] is None]
    char_vals = [r["chars"] for r in records if r["error"] is None]
    errors = sum(1 for r in records if r["error"] is not None)
    if not token_vals:
        return {"runs": len(records), "errors": errors}
    return {
        "runs": len(records),
        "errors": errors,
        "avg_tokens": round(statistics.mean(token_vals)),
        "median_tokens": round(statistics.median(token_vals)),
        "p95_tokens": round(sorted(token_vals)[int(len(token_vals) * 0.95)]),
        "avg_chars": round(statistics.mean(char_vals)),
    }


def fmt_int(x: Any) -> str:
    if x is None:
        return "—"
    return f"{int(x):,}"


def fmt_pct(x: float) -> str:
    return f"{x:+.1f}%"


def main() -> None:
    all_results = load_results()
    if not all_results:
        print("No results found. Run run_benchmark.py first.", file=sys.stderr)
        sys.exit(1)

    summaries = {cid: summarize(records) for cid, records in all_results.items()}
    baseline_id = "default"
    baseline_avg = summaries.get(baseline_id, {}).get("avg_tokens")

    lines: list[str] = ["# Page Token Benchmark Report\n"]

    # Summary table
    lines.append("## Summary\n")
    lines.append("| Condition | Runs | Errors | Avg tokens | Median tokens | p95 tokens | vs default |")
    lines.append("|-----------|------|--------|------------|---------------|------------|------------|")
    for cid, s in summaries.items():
        avg = s.get("avg_tokens")
        median = s.get("median_tokens")
        p95 = s.get("p95_tokens")
        savings = ""
        if baseline_avg and avg and cid != baseline_id:
            pct = (avg - baseline_avg) / baseline_avg * 100
            savings = fmt_pct(pct)
        lines.append(
            f"| `{cid}` | {s['runs']} | {s['errors']} | "
            f"{fmt_int(avg)} | {fmt_int(median)} | {fmt_int(p95)} | {savings} |"
        )

    # Per-URL breakdown for default condition
    if baseline_id in all_results:
        lines.append(f"\n## Per-URL breakdown (`{baseline_id}`)\n")
        lines.append("| URL | Tokens | Chars |")
        lines.append("|-----|--------|-------|")
        for r in all_results[baseline_id]:
            url_short = r["url"].replace("https://", "")
            err = f" ⚠ {r['error']}" if r["error"] else ""
            lines.append(f"| {url_short} | {fmt_int(r.get('tokens'))} | {fmt_int(r.get('chars'))} |{err}")

    # Errors
    errors_by_cond = {
        cid: [r for r in records if r["error"]]
        for cid, records in all_results.items()
        if any(r["error"] for r in records)
    }
    if errors_by_cond:
        lines.append("\n## Errors\n")
        for cid, err_records in errors_by_cond.items():
            for r in err_records:
                lines.append(f"- `{cid}` / {r['url']}: {r['error']}")

    report = "\n".join(lines) + "\n"
    out_path = RESULTS_DIR / "report.md"
    out_path.write_text(report)
    print(report)
    print(f"Report written to {out_path}")


if __name__ == "__main__":
    main()
