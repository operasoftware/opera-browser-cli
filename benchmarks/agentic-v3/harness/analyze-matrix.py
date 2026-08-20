#!/usr/bin/env python3
"""Summarise one or more benchmark arms.

    python3 analyze-matrix.py open
    python3 analyze-matrix.py open strict

Joins the two independent instruments: the `claude -p` result envelopes under
results/<arm>/ (cost, tokens, turns, the agent's answer) and the shim TSVs under
logs/ (every CLI invocation and the bytes it emitted).
"""
import json
import re
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TASKS = [
    line.split("\t")[0]
    for line in (ROOT / "harness" / "tasks.tsv").read_text().splitlines()
    if line.strip()
]
TAG = {"open": "e", "strict": "s"}
# Commands worth tallying — the point is which affordances each build's agents reached for.
FEATURES = ["eval", "find", "chain", "snapshot --next", "snapshot --full",
            "snapshot @", "scroll", "screenshot", "open"]


def cli_stats(arm, cond, task_idx, rep):
    """calls, bytes and argv list for one cell, from the shim log."""
    p = ROOT / "logs" / f"{cond}-t{task_idx}{TAG[arm]}{rep}.tsv"
    if not p.exists():
        return 0, 0, []
    calls = nbytes = 0
    cmds = []
    for line in p.read_text().splitlines():
        f = line.split("\t")
        if len(f) < 6:
            continue
        calls += 1
        nbytes += int(f[3])
        cmds.append(f[5])
    return calls, nbytes, cmds


def load(arm):
    """One record per completed cell."""
    rows = []
    for p in sorted((ROOT / "results" / arm).glob("*.json")):
        m = re.fullmatch(r"(?P<cond>[^-]+)-(?P<task>.+)-r(?P<rep>\d+)\.json", p.name)
        if not m or m["task"] not in TASKS:
            continue
        try:
            d = json.loads(p.read_text())
        except json.JSONDecodeError:
            print(f"  ! unreadable: {p.name}", file=sys.stderr)
            continue
        idx = TASKS.index(m["task"]) + 1
        calls, nbytes, cmds = cli_stats(arm, m["cond"], idx, int(m["rep"]))
        u = d.get("usage", {}) or {}
        answer = next((l for l in (d.get("result") or "").splitlines()
                       if l.startswith("ANSWER:")), "")
        rows.append(dict(
            cond=m["cond"], task=m["task"], rep=int(m["rep"]),
            cost=d.get("total_cost_usd", 0.0), turns=d.get("num_turns", 0),
            error=bool(d.get("is_error")),
            appended=u.get("input_tokens", 0) + u.get("cache_creation_input_tokens", 0),
            cache_read=u.get("cache_read_input_tokens", 0),
            calls=calls, bytes=nbytes, cmds=cmds, answer=answer,
        ))
    return rows


def per_pass(rows, cond, key):
    """One suite total per repeat — only for passes that are complete."""
    out = []
    for rep in sorted({r["rep"] for r in rows if r["cond"] == cond}):
        cell = [r for r in rows if r["cond"] == cond and r["rep"] == rep]
        if len(cell) == len(TASKS):
            out.append(sum(r[key] for r in cell))
    return out


def report(arm):
    rows = load(arm)
    if not rows:
        print(f"\n### {arm}: no results yet\n")
        return {}
    conds = sorted({r["cond"] for r in rows})
    done = len(rows)
    print(f"\n{'=' * 74}\n### arm: {arm}   ({done} cells; "
          f"{sum(r['error'] for r in rows)} errored)\n{'=' * 74}")

    print(f"\n{'metric':16} {'cond':5} " + "".join(f"{'pass ' + str(i + 1):>11}" for i in range(3))
          + f"{'mean':>12}{'sd':>10}")
    for key, fmt in (("cost", "{:>11.3f}"), ("bytes", "{:>11.0f}"),
                     ("calls", "{:>11.0f}"), ("turns", "{:>11.0f}"),
                     ("appended", "{:>11.0f}")):
        for c in conds:
            v = per_pass(rows, c, key)
            if not v:
                continue
            sd = st.stdev(v) if len(v) > 1 else 0.0
            print(f"{key:16} {c:5} " + "".join(fmt.format(x) for x in v)
                  + " " * (11 * (3 - len(v))) + f"{st.mean(v):12.3f}{sd:10.3f}")
        print()

    print(f"{'task':16} " + "".join(f"{c:>10}" for c in conds) + "   best")
    for t in TASKS:
        means = {}
        for c in conds:
            v = [r["cost"] for r in rows if r["cond"] == c and r["task"] == t]
            if v:
                means[c] = st.mean(v)
        if not means:
            continue
        best = min(means, key=means.get)
        print(f"{t:16} " + "".join(f"{means.get(c, float('nan')):10.4f}" for c in conds)
              + f"   {best}")

    print("\nfeature usage (all cells per condition)")
    for c in conds:
        allc = [x for r in rows if r["cond"] == c for x in r["cmds"]]
        hits = {f: sum(1 for x in allc if x.startswith(f)) for f in FEATURES}
        print(f"  {c:5} " + "  ".join(f"{k}={v}" for k, v in hits.items() if v))
    return {c: st.mean(per_pass(rows, c, "cost") or [0]) for c in conds}


def main():
    arms = sys.argv[1:] or ["open"]
    means = {a: report(a) for a in arms}
    if len(arms) == 2:
        a, b = arms
        common = sorted(set(means[a]) & set(means[b]))
        if common:
            print(f"\n{'=' * 74}\n### {a} vs {b} — mean suite cost\n{'=' * 74}")
            print(f"{'cond':6}{a:>12}{b:>12}{'delta':>12}")
            for c in common:
                x, y = means[a][c], means[b][c]
                d = f"{100 * (x - y) / y:+.1f}%" if y else "—"
                print(f"{c:6}{x:12.3f}{y:12.3f}{d:>12}")


if __name__ == "__main__":
    main()
