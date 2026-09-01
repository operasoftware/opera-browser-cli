#!/usr/bin/env python3
"""Grade the six-task interactive benchmark from pinned answer fragments."""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_ID = os.environ.get("BENCH_RUN_ID", "").strip()
RESULT_ROOT = ROOT / "results" / RUN_ID if RUN_ID else ROOT / "results"
ARM = sys.argv[1] if len(sys.argv) > 1 else "strict"

PINS = {
    "rfc-deep-read": ["15.5.5", "404 not found"],
    "spa-todomvc": ["2 items left", "alpha", "gamma"],
    "web-form": ["form submitted", "received"],
    "table-extract": ["74", "w", "183.84"],
    "wiki-journey": ["4.5"],
    "shop-navigate": ["11", "23.21", "road to little dribbling"],
}
ANSWER_RE = re.compile(r"^\**ANSWER:\**\s*(.*)$", re.IGNORECASE | re.MULTILINE)
NAME_RE = re.compile(r"(?P<cond>[^-]+)-(?P<task>.+)-r(?P<rep>\d+)\.json")


def main() -> None:
    paths = sorted((RESULT_ROOT / ARM).glob("*.json"))
    rows = []
    for path in paths:
        match = NAME_RE.fullmatch(path.name)
        if not match or match["task"] not in PINS:
            continue
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            rows.append((match["cond"], match["task"], int(match["rep"]), False, "invalid JSON"))
            continue
        answer_match = ANSWER_RE.search(data.get("result") or "")
        answer = answer_match.group(1).strip() if answer_match else ""
        normalized = answer.lower().replace("≈", "").replace("~", "")
        passed = not data.get("is_error") and all(pin in normalized for pin in PINS[match["task"]])
        rows.append((match["cond"], match["task"], int(match["rep"]), passed, answer))

    if not rows:
        sys.exit(f"no results under {RESULT_ROOT / ARM}")

    conditions = sorted({row[0] for row in rows})
    print(f"# Grade — {ARM} ({len(rows)} cells)\n")
    print("| task | " + " | ".join(conditions) + " |")
    print("|---|" + "---|" * len(conditions))
    for task in PINS:
        cells = []
        for condition in conditions:
            matches = [row for row in rows if row[0] == condition and row[1] == task]
            cells.append(f"{sum(row[3] for row in matches)}/{len(matches)}" if matches else "-")
        print(f"| {task} | " + " | ".join(cells) + " |")

    print("\nTotals:")
    for condition in conditions:
        matches = [row for row in rows if row[0] == condition]
        print(f"  {condition}: {sum(row[3] for row in matches)}/{len(matches)}")
    failures = [row for row in rows if not row[3]]
    if failures:
        print("\nFailures:")
        for condition, task, rep, _, answer in failures:
            print(f"  {condition}/{task}/r{rep}: {answer!r}")


if __name__ == "__main__":
    main()
