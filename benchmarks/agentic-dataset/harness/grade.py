#!/usr/bin/env python3
"""
grade.py — pass/fail grading for the agentic-dataset suite.

Reads each cell's `claude -p` result JSON under results/<arm>/*.json, pulls the
agent's final ANSWER: line, and compares it (case-insensitive substring match)
against the pinned answers in pin/answers.json. Reports pass rate overall and
broken out by dataset category A-E.

Usage:
    python3 harness/grade.py [arm] [answers.json]

  arm          default "strict" — glob results/<arm>/*.json
  answers.json default pin/answers.json

A task with a null answer is reported as "ungraded" (not a pass or a fail) so a
partially-pinned first run still yields honest numbers for the tasks that are
verifiable.
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # benchmarks/agentic-dataset

ARM = sys.argv[1] if len(sys.argv) > 1 else "strict"
ANSWERS_PATH = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "pin", "answers.json")

# Dataset categories: task slug prefix → A..E. Kept explicit (not derived from
# the slug) because slugs are stable but arbitrary.
from collections import defaultdict
CATEGORY = {}
for c, slugs in {
    "A": ["rfc-deep-read", "rfc-header-semantics", "rfc-cache-conditions", "html-spec-dialog",
          "mdn-fetch-abort", "python-exception-chain", "kubernetes-probe-types",
          "postgres-index-types", "openssl-cipher-option", "wcag-focus-order"],
    "B": ["spa-todomvc", "spa-todo-edit-filter", "spa-kanban-move-card", "spa-shopping-cart",
          "spa-tabs-persistence", "spa-search-sort", "spa-pagination",
          "spa-notification-settings", "spa-modal-confirmation", "spa-validation-inline"],
    "C": ["web-form", "form-registration-success", "form-required-field-error",
          "form-address-select", "form-date-range", "form-upload-metadata",
          "form-password-confirmation", "form-multistep-checkout",
          "form-consent-checkboxes", "form-search-redirect"],
    "D": ["table-extract", "table-country-population", "table-currency-rates",
          "table-software-releases", "table-movie-ratings", "table-airport-codes",
          "table-nutrition-values", "table-financial-summary",
          "table-university-rankings", "table-train-timetable"],
    "E": ["wiki-journey", "shop-navigate", "wiki-science-chain", "docs-api-reference",
          "shop-category-product", "news-article-source", "knowledge-base-article",
          "repository-readme-guide", "travel-destination-details",
          "course-module-lesson", "government-service-procedure"],
}.items():
    for s in slugs:
        CATEGORY[s] = c

with open(ANSWERS_PATH) as f:
    ANSWERS = json.load(f)

ANSWER_RE = re.compile(r"ANSWER:\s*(.*)", re.IGNORECASE)


def answer_from(result: dict) -> str:
    text = result.get("result", "") or ""
    for line in text.splitlines():
        m = ANSWER_RE.match(line)
        if m:
            return m.group(1).strip()
    return ""


def main():
    results = sorted(glob.glob(os.path.join(ROOT, "results", ARM, "*.json")))
    if not results:
        sys.exit(f"no results under benchmark/agentic-dataset/results/{ARM}/ — run the matrix first")

    per_cat = defaultdict(lambda: {"pass": 0, "fail": 0, "ungraded": 0})
    rows = []
    for path in results:
        base = os.path.basename(path)[:-5]  # <cond>-<slug>-r<n>
        # <cond> is single-word; <slug> may contain dashes and ends in -r<n>.
        m = re.fullmatch(r"([^-]+)-(.*)-r\d+", base)
        if not m:
            continue
        cond = m.group(1)
        slug = m.group(2)
        answer = ANSWERS.get(slug)
        data = json.load(open(path))
        got = answer_from(data)
        if answer is None:
            status = "ungraded"
        elif answer.lower() in got.lower():
            status = "pass"
        else:
            status = "fail"
        per_cat[CATEGORY.get(slug, "?")][status] += 1
        rows.append((slug, cond, status, got))

    print(f"# Grade — {ARM} arm ({len(results)} cells)\n")
    print("| category | pass | fail | ungraded | pass% (of graded) |")
    print("|---|---|---|---|---|")
    tot = defaultdict(int)
    for c in "ABCDE":
        r = per_cat[c]
        graded = r["pass"] + r["fail"]
        pct = f"{100*r['pass']/graded:.0f}%" if graded else "-"
        print(f"| {c} | {r['pass']} | {r['fail']} | {r['ungraded']} | {pct} |")
        for k in ("pass", "fail", "ungraded"):
            tot[k] += per_cat[c][k]

    print("| **total** | **%d** | **%d** | **%d** | %d%% |" % (
        tot["pass"], tot["fail"], tot["ungraded"],
        (100 * tot["pass"] / (tot["pass"] + tot["fail"])) if (tot["pass"] + tot["fail"]) else 0,
    ))
    print("\nFails:")
    for slug, cond, status, got in rows:
        if status == "fail":
            print(f"  [{cond}] {slug}: got {got!r}")


if __name__ == "__main__":
    main()
