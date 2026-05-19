import json
import statistics
from pathlib import Path

ROOT = Path(__file__).parent.parent  # benchmarks/snapshot-efficiency/
RESULTS_DIR = ROOT / "results"
REPORT_PATH = RESULTS_DIR / "report.md"

CONDITION_ORDER = ["opera-compact", "opera-raw", "mcp-raw", "axi"]


def load_results() -> dict[str, list[dict]]:
    results: dict[str, list[dict]] = {}
    for f in sorted(RESULTS_DIR.glob("*.jsonl")):
        cid = f.stem
        records = []
        for line in f.read_text().splitlines():
            line = line.strip()
            if line:
                records.append(json.loads(line))
        results[cid] = records
    return results


def summarize(records: list[dict]) -> dict:
    if not records:
        return {}
    tasks = set(r["task"] for r in records)
    passes = [r for r in records if r.get("pass")]
    pass_rate = len(passes) / len(records) * 100 if records else 0
    input_tokens = [r["input_tokens"] for r in records]
    output_tokens = [r["output_tokens"] for r in records]
    total_tokens = [r["total_tokens"] for r in records]
    snap_avg = [r["snapshot"]["avg_chars"] for r in records if r.get("snapshot", {}).get("avg_chars")]
    snap_total = [r["snapshot"]["total_chars"] for r in records if r.get("snapshot", {}).get("total_chars")]
    wall = [r["wall_clock_seconds"] for r in records]
    tool_calls = [r["tool_call_count"] for r in records]

    def avg(xs: list) -> float:
        return statistics.mean(xs) if xs else 0.0

    return {
        "runs": len(records),
        "tasks": len(tasks),
        "pass_rate": pass_rate,
        "avg_input_tokens": avg(input_tokens),
        "avg_output_tokens": avg(output_tokens),
        "avg_total_tokens": avg(total_tokens),
        "avg_snap_chars": avg(snap_avg),
        "avg_snap_total_chars": avg(snap_total),
        "avg_wall_seconds": avg(wall),
        "avg_tool_calls": avg(tool_calls),
    }


def per_task_summary(records: list[dict]) -> dict[str, dict]:
    by_task: dict[str, list[dict]] = {}
    for r in records:
        by_task.setdefault(r["task"], []).append(r)
    return {tid: summarize(recs) for tid, recs in sorted(by_task.items())}


def fmt_int(x: float) -> str:
    return f"{int(x):,}"


def fmt_pct(x: float) -> str:
    return f"{x:.0f}%"


def fmt_chars(x: float) -> str:
    if x >= 1000:
        return f"{x/1000:.1f}k"
    return str(int(x))


def main() -> None:
    results = load_results()
    if not results:
        print(f"No results found in {RESULTS_DIR}/ — run run_benchmark.py first")
        return

    lines: list[str] = ["# Snapshot Token Efficiency Benchmark\n"]

    # --- Summary table ---
    lines.append("## Summary\n")
    header = "| Condition | Runs | Pass% | Avg input tok | Avg total tok | Avg snap chars | Avg wall (s) | Avg tool calls |"
    sep    = "|-----------|------|-------|---------------|---------------|----------------|--------------|----------------|"
    lines += [header, sep]

    ordered_cids = [c for c in CONDITION_ORDER if c in results] + [c for c in results if c not in CONDITION_ORDER]
    summaries: dict[str, dict] = {}
    for cid in ordered_cids:
        s = summarize(results[cid])
        summaries[cid] = s
        row = (
            f"| {cid} "
            f"| {s['runs']} "
            f"| {fmt_pct(s['pass_rate'])} "
            f"| {fmt_int(s['avg_input_tokens'])} "
            f"| {fmt_int(s['avg_total_tokens'])} "
            f"| {fmt_chars(s['avg_snap_chars'])} "
            f"| {s['avg_wall_seconds']:.1f} "
            f"| {s['avg_tool_calls']:.1f} |"
        )
        lines.append(row)
    lines.append("")

    # --- Token savings vs mcp-raw ---
    if "mcp-raw" in summaries and "opera-compact" in summaries:
        baseline = summaries["mcp-raw"]["avg_total_tokens"]
        compact = summaries["opera-compact"]["avg_total_tokens"]
        if baseline > 0:
            pct_saved = (baseline - compact) / baseline * 100
            lines.append(f"> opera-compact saves **{pct_saved:.0f}%** total tokens vs mcp-raw baseline.\n")

    # --- Per-task breakdown ---
    all_tasks = sorted({r["task"] for records in results.values() for r in records})
    lines.append("## Per-task breakdown\n")

    for tid in all_tasks:
        lines.append(f"### {tid}\n")
        th = "| Condition | Pass% | Avg input tok | Avg snap chars |"
        ts = "|-----------|-------|---------------|----------------|"
        lines += [th, ts]
        for cid in ordered_cids:
            task_recs = [r for r in results[cid] if r["task"] == tid]
            if not task_recs:
                continue
            s = summarize(task_recs)
            row = (
                f"| {cid} "
                f"| {fmt_pct(s['pass_rate'])} "
                f"| {fmt_int(s['avg_input_tokens'])} "
                f"| {fmt_chars(s['avg_snap_chars'])} |"
            )
            lines.append(row)
        lines.append("")

    # --- Snapshot size distribution ---
    lines.append("## Snapshot size distribution (avg chars per snapshot call)\n")
    dist_header = "| Condition | Min | Median | Max |"
    dist_sep    = "|-----------|-----|--------|-----|"
    lines += [dist_header, dist_sep]
    for cid in ordered_cids:
        all_snap = []
        for r in results[cid]:
            snap = r.get("snapshot", {})
            # reconstruct per-call from avg×count (rough; exact per-call in agent_output.json)
            if snap.get("avg_chars") and snap.get("count"):
                all_snap.append(snap["avg_chars"])
        if all_snap:
            row = (
                f"| {cid} "
                f"| {fmt_chars(min(all_snap))} "
                f"| {fmt_chars(statistics.median(all_snap))} "
                f"| {fmt_chars(max(all_snap))} |"
            )
            lines.append(row)
    lines.append("")

    # --- Failures ---
    lines.append("## Failures\n")
    for cid in ordered_cids:
        fails = [r for r in results[cid] if not r.get("pass")]
        if fails:
            lines.append(f"### {cid} ({len(fails)} failures)\n")
            for r in fails:
                lines.append(f"- **{r['task']}** run{r['run']}: {r.get('grade_reason', '')}")
            lines.append("")

    report = "\n".join(lines)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report)
    print(report)
    print(f"\nReport written to {REPORT_PATH}")


if __name__ == "__main__":
    main()
