# Agentic benchmark — Dataset suite (A–E), 51 tasks

A browser-agent benchmark derived from `Dataset benchmark for agents.md`: **51 tasks
across five categories** (A Deep Search & Document Reading, B SPA interaction,
C Forms & Post-Submit Navigation, D Tabular Data Extraction, E Cross-Page Link
Navigation), each run by a fresh agent against a build of `opera-browser-cli`.

This is the same pattern as `benchmarks/agentic-v3` (same harness, same controls, same
two measurement instruments) but with a much larger, categorised task corpus, so a
single suite can surface *which kind* of browsing task a build is good at (deep-reading
a 1 MB spec vs. driving a React SPA vs. reading one row out of a wide table) instead of
only an overall average.

Every agent gets an identical prompt except the path to the binary it must use; each
build's own `help` output is its only primer.

## Why a dataset, in tiers

Not every task is runnable in every environment. Some point at live third-party sites
(Wikipedia, RFC Editor, the HTML/MDN/Postgres/OpenSSL docs, the Selenium demo, the
Playwright TodoMVC demo, Books to Scrape); the rest are written as *"Local …"* /
*"Test …"* pages that need a local fixture app nobody ships. So the suite is **tiered**
rather than all-or-nothing:

| Tier | Meaning | # tasks |
|---|---|---|
| **T1** | Runnable as-is against live public sites (needs internet) | 18 |
| **T2** | Need a local/Playwright/Selenium fixture app (not yet shipped) | 33 |

The canonical `tasks.tsv` holds all 51 so cell identity is stable; `tasks-tier1.tsv` is
the same slugs but only the T1 rows, so a first clean run can target the runnable subset
via `BENCH_TASKS_FILE=tasks-tier1.tsv`. Adding fixtures later (a `fixtures/` app serving
the T2 pages) makes the rest runnable without touching the harness.

## Conditions

| Id | Build | How it's provided |
|---|---|---|
| `head` | working tree (`HEAD`) | `REPO/dist/bin/opera-browser-cli.js` — the compact-v3 feature branch |
| `main` | baseline | worktree at `origin/main` → `$BENCH_WT_ROOT/wt-main/dist/bin/opera-browser-cli.js` |

Default order is `head main`. The point is the same as agentic-v3's `v3 vs v1`: is the
feature branch actually cheaper/better than upstream at *solving the task*, not just at
making a snapshot smaller?

## Measurement — two instruments, no self-report

1. **CLI shim** (`harness/_shim.zsh`) — wraps the condition binary, logging every
   invocation: argv, exit code, stdout/stderr byte counts, wall time. This is the exact
   tool-output volume the agent pulled into context, plus a ground-truth call count.
2. **Agent transcripts** (`claude -p` JSON envelope) — input / output / cache-read /
   cache-write tokens converted to dollars, turn count, and the agent's final
   `ANSWER:`/`CALLS:` lines.

**Accuracy is graded pass/fail** against answers pinned in [suite.md](#task-tables-with-pinned-answers)
**before** any agent runs (see the pin column). Bytes measure the *cause*; accuracy
measures the *outcome*; cost measures the *price*. A build that is smaller but wrong is
not a win.

## Controls (identical to agentic-v3)

- **Sequential only.** The CLI keeps per-page state in one machine-global directory
  (`~/.opera-browser-cli/`: last-tree, prev-tree, snapshot-state, url map, find cursor),
  and every condition shares one browser. Parallel cells corrupt each other's baselines.
- **State reset between runs** — the per-cell wrapper clears the four state files on its
  first call, and the browser is parked on `about:blank`, so no cell inherits another's
  diff baseline or window cursor.
- **Condition-appropriate bridge** — `runctl.zsh switch` kills and restarts the bridge
  from the condition's own build before its runs.
- **Rotated condition order per pass** so HTTP-cache warming doesn't favour either build.
- **Two arms** — see below. `strict` forbids `eval` so the snapshot/compaction pipeline is
  what gets measured; `open` allows everything to measure real-world cost.

### The two arms

| Arm | `eval` | Measures |
|---|---|---|
| `strict` | forbidden | The snapshot pipeline. Without this, agents pull answers straight out of the DOM and never take a snapshot, so every build scores identically and the suite measures nothing |
| `open` | allowed | What the tool actually costs in normal use |

Run both. `strict` tells you whether compaction is any good; `open` tells you whether it
matters. Publishing only one is how you end up with a number that doesn't survive contact
with reality.

## Dataset categories

The 51 tasks fall into five categories. The category of a task tells you *which failure
mode* a build's snapshot is stressed by:

| Cat | Theme | Failure mode a build must handle |
|---|---|---|
| **A** | Deep search & document reading | Truncation recovery (`--next` / `find` / `--full`) on very long documents; `find`-ability of deep content |
| **B** | SPA interaction | Post-action diff vs full snapshot; ref stability across DOM mutations; `chain`; `fill`, toggles, modals |
| **C** | Forms & post-submit navigation | Navigation that invalidates old handles → full-snapshot fallback; `--expect`; validation error → recovery |
| **D** | Tabular data extraction | Table fidelity after compression (separators preserved); `find` on a ~90 KB tree; one-row reads from wide tables |
| **E** | Cross-page link navigation | Link discovery on huge pages; URL LUT; cross-page ref invalidation; multi-hop browse |

A build that is great at A but collapses on B is a real, reportable signal — that is the
reason to run a categorised corpus rather than six unrelated tasks.

## Agent prompt (identical across conditions and arms bar the path)

```
You are testing a browser-automation CLI. Drive the browser using ONLY this exact command:
<BIN>

Hard rules:
- Never use the bare `opera-browser-cli` command or any other path — only the path above.
- Never use WebFetch, WebSearch, curl, or any other way of reading the page. The browser
  CLI is the only permitted source of page content.
- Do not use the CLI's `eval` command (or any other JavaScript execution) to read page
  content. Treat JavaScript evaluation as unavailable: everything you learn about the page
  must come from the CLI's page-inspection commands. You may still use the interaction
  commands (click/fill/press/...) freely.            [omitted on the `open` arm]
- Do not edit files, do not run git.
- Start by running `<BIN> help` to see what commands exist, then use them.
- Work efficiently: minimise both the number of CLI calls and the amount of output you
  pull into context. If output is truncated, use whatever the CLI offers for reading more
  rather than always asking for everything.

TASK: <task text>

Finish with exactly these two lines:
ANSWER: <one line>
CALLS: <how many CLI invocations you made>
```

## Task tables (with pinned answers)

> **Pin column:** `doc` = answer is in the source dataset doc; `known` = answer pinned from
> the spec/reference itself by the author; `verify` = answer is provisional and **must be
> re-confirmed by hand before it is trusted for grading**. Expected answers are never shown
> to agents.

### A — Deep search & document reading (all T1, live docs)

| ID | Page | Prompt (abridged — full in `tasks.tsv`) | Expected | Pin |
|---|---|---|---|---|
| `rfc-deep-read` | RFC 9110 | Section defining HTTP status 404: number + exact title | § 15.5.5 · "404 Not Found" | doc |
| `rfc-header-semantics` | RFC 9110 | Find the Accept header: section number + its function | § 12.5.1 · "Accept" — media types a sender is willing to accept | known |
| `rfc-cache-conditions` | RFC 9111 | Cache-Control: no-store operating rule | "…must not store any part of either this request or any response to it" (directive = no-store) | known |
| `html-spec-dialog` | HTML Standard | Effect of calling `showModal()` on a `<dialog>` | makes the dialog modal: top layer, inert rest, `open` set; blocks interaction outside | known |
| `mdn-fetch-abort` | MDN Fetch/AbortController | How to cancel a `fetch()`, and the mechanism | pass an `AbortSignal` (from `AbortController`) in the `signal` option; `abort()` it | known |
| `python-exception-chain` | Python `raise` | `raise ... from ...` syntax + purpose | chains the exception: sets the original as `__cause__` | known |
| `kubernetes-probe-types` | K8s probes | The three probe types | liveness, readiness, startup | known |
| `postgres-index-types` | Postgres indexes | List index types + the one for full-text search | B-tree, Hash, GiST, SP-GiST, GIN, BRIN; GIN (for full-text) | known |
| `openssl-cipher-option` | OpenSSL `enc` | Meaning of the `-cipher` option | selects the cipher algorithm for encryption | known |
| `wcag-focus-order` | WCAG 2.2 | Criterion number + conformance level | 2.4.3 "Focus Order" · Level A | known |

### B — SPA interaction

| ID | Page | Expected | Pin |
|---|---|---|---|
| `spa-todomvc` (T1) | demo.playwright.dev/todomvc | "2 items left"; Active shows **alpha and gamma** | doc |
| `spa-todo-edit-filter` (T2) | Local TodoMVC | rename one, complete two, active list correct | verify |
| `spa-kanban-move-card` (T2) | Local kanban | card created in To Do, moved to In Progress, high priority | verify |
| `spa-shopping-cart` (T2) | Local shop | qty 3 on one, other removed, total correct | verify |
| `spa-tabs-persistence` (T2) | Local settings | Notifications → two channels → back to Profile, state retained | verify |
| `spa-search-sort` (T2) | Local catalogue | search, sort asc by price, first result | verify |
| `spa-pagination` (T2) | Local paginated | page 3, open detail, return to list | verify |
| `spa-notification-settings` (T2) | Local settings | email off, push on, save, confirmation read | verify |
| `spa-modal-confirmation` (T2) | Local PM app | cancel then confirm deletion of specified project | verify |
| `spa-validation-inline` (T2) | Local React/Vue form | invalid email → error → correct → submit success | verify |

### C — Forms & post-submit navigation

| ID | Page | Expected | Pin |
|---|---|---|---|
| `web-form` (T1) | selenium.dev/web/web-form.html | heading **"Form submitted"**, message **"Received!"** | doc |
| `form-registration-success` (T2) | Local/selenium | read the success message | verify |
| `form-required-field-error` (T2) | Local contact form | subject error → complete → resubmit | verify |
| `form-address-select` (T2) | Local delivery | address, region, courier selected | verify |
| `form-date-range` (T2) | Local booking | dates set, number of days reported | verify |
| `form-upload-metadata` (T2) | Local app | file attached, title set, submitted | verify |
| `form-password-confirmation` (T2) | Local | mismatch error → correct → change succeeds | verify |
| `form-multistep-checkout` (T2) | Local checkout | summary reported (no real payment) | verify |
| `form-consent-checkboxes` (T2) | Local | terms on, marketing off, submit | verify |
| `form-search-redirect` (T2) | Local/demo search | results count + first result | verify |

### D — Tabular data extraction

| ID | Page | Expected | Pin |
|---|---|---|---|
| `table-extract` (T1) | Wikipedia "List of chemical elements" | 74 · W · 183.84 | doc |
| `table-country-population` (T2) | Wikipedia country table | Japan: population, capital, ISO | verify |
| `table-currency-rates` (T2) | Local exchange table | EUR/USD/CHF vs PLN | verify |
| `table-software-releases` (T2) | Docs releases table | date + support status for given version | verify |
| `table-movie-ratings` (T2) | Local/public | 2019 top film: title, rating, director | verify |
| `table-airport-codes` (T1) | Wikipedia airports | Keflavík: IATA, city, country | verify |
| `table-nutrition-values` (T2) | Test nutrition table | oatmeal: kcal/protein/fibre per serving | verify |
| `table-financial-summary` (T2) | Local quarterly results | Q2: revenue, cost, margin | verify |
| `table-university-rankings` (T2) | Public/local ranking | rank, country, score for named uni | verify |
| `table-train-timetable` (T2) | Local timetable | dept/arrival/platform for given train | verify |

### E — Cross-page link navigation

| ID | Page | Expected | Pin |
|---|---|---|---|
| `wiki-journey` (T1) | Wikipedia Moon → Giant-impact hypothesis | ~4.5 billion years ago (4.4–4.6 Gya) | doc |
| `shop-navigate` (T1) | Books to Scrape → Travel | 11 results; cheapest "The Road to Little Dribbling…" · £23.21 | doc |
| `wiki-science-chain` (T1) | Wikipedia Photosynthesis → Calvin cycle | main product of the Calvin cycle | known (G3P, or "glyceraldehyde 3-phosphate") |
| `docs-api-reference` (T2) | Selected API docs | required parameter for method | verify |
| `shop-category-product` (T1) | Books to Scrape | price + availability of a product | verify |
| `news-article-source` (T2) | Test news site | open article, click a cited source | verify |
| `knowledge-base-article` (T2) | Test help centre | password-reset: first step | verify |
| `repository-readme-guide` (T2) | Test docs repo | install system requirements | verify |
| `travel-destination-details` (T2) | Test travel site | attraction opening hours | verify |
| `course-module-lesson` (T2) | Test learning platform | lesson duration + topic | verify |
| `government-service-procedure` (T2) | Test services portal | required document for procedure | verify |

## Grading rubric

A cell **passes** if the agent's `ANSWER:` line is factually the pinned expected value
(whitespace/case-insensitive, tolerating the documented ranges such as "4.4–4.6 Gya").
A cell **fails** if it is wrong, empty, or the agent gave up. Grading is applied to the
`ANSWER:` line only; the `CALLS:` line is for the byte/cost analysis, not accuracy.

Report per category as well as overall: a build's pass rate broken out by A/B/C/D/E is the
headline output of this suite.

## Finding the answers / extending

- **Add a task** — append one tab-separated row to `tasks.tsv` and mirror it in the
  category table above with a pinned answer and `tier`. Keep the canonical order stable —
  cell identity comes from the row position.
- **Add a build** — add a `case` arm naming its `dist/bin/opera-browser-cli.js` to
  `harness/gen.zsh` and `harness/runctl.zsh`, then pass the name on the command line.
- **Ship T2 fixtures** — put a local app under `fixtures/` serving the "Local/Test" pages,
  move those rows into the T1 file, and pin their answers.
