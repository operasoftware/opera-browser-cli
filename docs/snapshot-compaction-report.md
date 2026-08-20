# What snapshot compaction is actually worth

**opera-browser-cli — what shipped, how it was measured, and why the honest answer is
*it depends on how the agent is allowed to read the page*.**

6 real-world tasks · 3 builds · 2 conditions · up to 5 repeats · Claude Sonnet 5 · 2026-08-03

---

## The answer, up front

Shipping build (**v4**) against the baseline (**v1**), totalled over the whole task suite.

The answer depends on one thing: whether the agent is allowed to run JavaScript
against the page. Both arms were measured.

| | Snapshot-only | Everything available |
|---|---|---|
| Cost vs baseline | **−12.9%** | **−4.7%** *(not significant, p=0.15)* |
| Bytes emitted | **10.8× fewer** | on par with baseline |
| CLI calls | −16% | **−25%** |
| Interaction tasks | wins all | **wins all, by 31–33%** |
| Pure lookups | wins | **loses** |
| Answers correct | 54/54 | 89/89 |

The compaction work is decisively good when the text tree is the only way to read a
page, and worth much less when it isn't. Both facts are real; which one applies is a
property of the harness the agent runs in.

---

## What the tool does

An agent driving a browser can look at a page two ways: take a screenshot and read it as an image,
or read the page's accessibility tree as text. Screenshots answer spatial questions well — what the
layout is doing, where a control sits — and can be the efficient choice for *navigating*. For pulling
exact values out of a page they are expensive and unreliable, so the text tree is the working path for
*extraction*. **That text path is what this work optimizes**; nothing here changes how screenshots
behave.

Raw, that text tree is enormous: a Wikipedia article runs past a million characters, far more than
fits in a model's context and far more than anyone wants to pay for.

**Compaction** is the work of shrinking that text without losing what the agent needs: the labels it
reads and the reference handles (`@2.4`) it clicks. The builds below are successive attempts at that
problem — and, as it turned out, at a second problem nobody had named.

---

## What each build added

### v1 — the baseline

Basic hygiene on the raw tree.

- Shorter role names, cleaned URLs, de-duplicated repeated descriptions
- Adjacent text fragments merged into single lines
- Output capped, with a `--full` escape hatch to see everything

### v2 — the compaction push

The bulk of the engineering. Everything in v1, plus:

- **Collapse page chrome** — navigation, footers and sidebars fold to a single summary line each,
  so the output budget goes to actual content
- **Drop dead handles** — reference handles kept only on things an agent can act on, not on every
  paragraph and image
- **Windowing** — `snapshot --next` pages through a long document instead of demanding all or nothing
- **Post-action diffs** — after a click, report what changed rather than re-sending the whole page
- **Search the page** — `find "text"` returns matching lines with their location, instead of the
  agent reading a document to locate one string
- **Batch actions** — `chain` runs several interactions in one call with a single snapshot at the end
- **Zoom** — `snapshot @ref` expands one element's subtree in full detail

### v3 — recovery features that didn't earn their place

Three additions aimed at wasted work. Measurement did not support any of them:

- Skip re-printing a page that hasn't changed — fired once in 18 runs, and the agent responded by
  reaching for the most expensive command available
- Hint at the nearest match when a stale handle is reused — never fired at all
- Reworded the hint shown when output is truncated — did not change behaviour

Superseded by v4, which keeps the first feature but turns it off unless a caller explicitly
identifies itself, making the failure mode impossible.

### v4 — the shipping build

A full review of v1–v3 found 15 defects. All fixed, and the capability set completed:

- **Made the new commands visible.** The command list was hand-maintained and had drifted out of
  sync — `find` and `chain` existed but were never listed, so nothing used them. It is now generated
  from the command registry and cannot drift again.
- **Stopped corrupting table data.** Merged text fragments were joined with no separator, so a table
  row arrived as `...primordialsolid74W`. Column boundaries are now preserved.
- **Made zoom reachable.** Handles were stripped from headings, tables and articles — exactly the
  things worth zooming into — so `find` → `snapshot @ref` was a dead end. Both halves now work.
- **Fixed two lockout bugs** that could leave every client unable to talk to a healthy browser
  connection, with an error message that pointed at the wrong fix.
- **Per-session state**, so two agents sharing the tool no longer corrupt each other's page history.
- **Hardened the new commands** — assertion timeouts, paging through search results, quoting fixes,
  and the first tests either command had ever had.

Test coverage grew by 64 tests (353 → 417) and the re-run confirmed the fixes cost nothing.

---

## The test suite

Six tasks on real, live sites. Correct answers were pinned **before** any run.

Every agent got the same instructions: drive the browser using only this CLI; no `WebFetch`, no
`curl`, no other source of page content; start by asking the tool for its own help; work efficiently.

**One rule matters more than the rest: JavaScript execution was forbidden.** The CLI offers an `eval`
command, and in early pilot runs agents used it to pull answers straight out of the DOM — never
taking a snapshot at all, and doing it more cheaply than any graded run. That is a real finding about
agent behaviour (see Limitations), but it meant the suite measured nothing about compaction. Graded
runs therefore treat `eval` as unavailable.

### `rfc-deep-read` — find a definition deep inside a 700 KB spec

> On RFC 9110, find the section that defines the 404 status code. Report its section number and its
> exact title.

- **Stresses:** content far past the first screen of output. The document is roughly 1 MB raw; the
  answer is nowhere near the top. Tests whether the agent can search or page through, or is forced
  to dump everything.
- **Correct answer:** section 15.5.5, "404 Not Found"

### `spa-todomvc` — drive a React app through eight interactions

> Add three todos named "alpha", "beta", "gamma" (type each name and press Enter); mark "beta"
> completed by clicking its checkbox; click the "Active" filter. Report the exact "items left"
> counter text and which todos are listed.

- **Stresses:** repeated mutation of a live single-page app. Handles must stay valid as the DOM
  changes underneath; post-action diffs and action batching either pay off here or nowhere.
- **Correct answer:** "2 items left"; alpha and gamma listed (beta hidden)

### `web-form` — fill a form and read the result page

> Fill the "Text input" field with "Jan Kowalski" and the "Password" field with "secret1", then click
> Submit. Report the heading and message shown on the page you land on.

- **Stresses:** targeting named fields, and a navigation that invalidates every handle at once.
  The shortest task in the suite — a control against over-reading complexity into the results.
- **Correct answer:** heading "Form submitted", message "Received!"

### `table-extract` — one row out of a very large table

> On the Wikipedia list of chemical elements, report the atomic number, chemical symbol and standard
> atomic weight of Tungsten.

- **Stresses:** locating one row among 118 in a ~90 KB compacted tree — and the fidelity of the
  compaction itself, since a mangled row is worse than a missing one.
- **Correct answer:** 74, W, 183.84

### `wiki-journey` — navigate between articles by following a link

> Starting from the Wikipedia "Moon" article, navigate to "Giant-impact hypothesis" by following a
> link on the page (do not type its URL), then report approximately how long ago the giant impact is
> estimated to have occurred.

- **Stresses:** finding one link among thousands, then crossing a page boundary — every handle from
  the first page becomes invalid at once.
- **Correct answer:** approximately 4.5 billion years ago (4.4–4.6 accepted)

### `shop-navigate` — browse a category and compare items

> Open books.toscrape.com, navigate to the "Travel" category by clicking its link, and report how
> many results the category shows and the title and price of the cheapest book in it.

- **Stresses:** click-through navigation plus extraction across a list — the agent must hold eleven
  prices at once and compare them, not just find a string.
- **Correct answer:** 11 results; "The Road to Little Dribbling: Adventures of an American in
  Britain (Notes From a Small Island #2)" at £23.21

---

## How it was measured

Each cell got a **fresh agent with no memory of the others**. Everything ran sequentially against one
live browser, with per-cell state resets so no run inherited another's page history, and a rotating
build order (a Latin square — each build occupies each position exactly once) so no version got an
unfair turn from browser caching.

### Two independent instruments

- **A logging shim** wrapped the CLI and recorded every invocation with its full output — the exact
  bytes the tool produced.
- **Agent transcripts** gave the true token bill.

Neither number is self-reported by the agent.

### Why both numbers matter

The test harness truncates very large tool outputs before the model sees them, which quietly
subsidises builds that dump whole pages. So **bytes is the metric that generalises** to other
clients; cost is the metric for this one. They are reported side by side and never blended.

---

## Results — snapshot-only arm

`eval` forbidden, so the compaction pipeline is the only way to read the page. Means of
three full passes.

| Metric (suite total) | v1 baseline | v2 | **v4 ships** | v4 vs v1 |
|---|---:|---:|---:|---:|
| Cost | $1.454 | $1.441 | **$1.266** | **−12.9%** |
| Bytes emitted | 1,624,738 | 1,560,483 | **150,878** | **−90.7%** |
| CLI calls | 35.3 | 38.3 | **29.7** | **−16%** |
| Tokens added to context | 224,754 | 210,696 | **180,068** | **−19.9%** |
| Agent turns | 71.0 | 72.7 | **67.0** | **−5.6%** |

### The three passes, individually

| Build | Pass 1 | Pass 2 | Pass 3 | Mean | Spread (sd) |
|---|---:|---:|---:|---:|---:|
| v1 | $1.441 | $1.332 | $1.589 | $1.454 | 0.129 |
| v2 | $1.556 | $1.389 | $1.379 | $1.441 | 0.099 |
| **v4** | $1.324 | $1.239 | $1.234 | **$1.266** | **0.051** |

**Every v4 pass beat every v1 and v2 pass** — v4's worst ($1.324) is below v1's best ($1.332) and
v2's best ($1.379). Bytes separate harder still: v4's worst pass is 5.5× below v1's best.

### Consistency is its own win

| Metric | v1 sd | v2 sd | v4 sd |
|---|---:|---:|---:|
| Cost | 0.129 | 0.099 | **0.051** |
| Bytes | 650,047 | 613,924 | **42,943** |
| Tokens added | 21,780 | 13,036 | **2,554** |
| Agent turns | 5.2 | 4.7 | **1.0** |

Inside an agent loop the worst case is what blows a context budget, and v4's worst case sits close to
its average. The older builds' spread comes down to whether the agent happened to reach for `--full`
on a big page.

---

## Results — everything available

The same suite with `eval` permitted, at five repeats with a prompt-cache warmup before
every cell so all runs share one overhead baseline. 89 of 90 cells (one lost to a usage
limit); **all 89 answers correct**.

| Build | mean | sd | range |
|---|---:|---:|---|
| v1 baseline | $0.864 | 0.044 | 0.808 – 0.908 |
| v2 | $0.884 | 0.026 | 0.855 – 0.919 |
| **v4** | **$0.824** | 0.041 | 0.779 – 0.885 |

| Comparison | delta | p |
|---|---:|---:|
| v4 vs v1 | −4.7% | 0.15 — not significant |
| v4 vs v2 | −6.8% | **0.006** — significant |
| v2 vs v1 | +2.2% | 0.43 — not significant |

**Given `eval`, the baseline build never takes a snapshot at all** — 30 `open`s and 31
`eval`s across the suite. The compaction pipeline is simply bypassed, which is why the
gap narrows so much.

Where v4 still separates is the *shape* of the work, not the price:

| | v1 | v2 | **v4** |
|---|---:|---:|---:|
| CLI calls | 38.0 | 38.8 | **29.0** |
| `eval` used | 31 | 22 | **11** |
| `chain` used | — | 0 | **28** |
| `find` used | — | 0 | **16** |

Two things fall out. **Better native tools displace DOM scripting** — v4's agents reached
for `eval` a third as often, because `find` and `chain` already answered the question. And
`chain` absorbs the navigation, dropping `open` from 30 to 17, which is the whole
call-count saving.

Per task, the split is clean: v4 wins the interaction-heavy tasks decisively (**−31%** on
the SPA, **−33%** on the form) and loses the pure lookups, where one DOM query beats any
amount of snapshot engineering. Over a suite that is half lookups, those cancel to ~5%.

## The finding that reframed the project

The same suite had been run earlier with a smaller, cheaper model. There, v2 looked like a triumph:
**53% cheaper than the baseline**. Re-run with a stronger model, that entire advantage vanished.

| Model driving the tool | v2 vs v1 |
|---|---:|
| Weak (Haiku) | **−53%** |
| Strong (Sonnet) | **−0.9%** — indistinguishable |

The reason is in the trajectories, not the byte counts. Given the baseline build, the weak model fell
into loops of scrolling and dumping whole pages, and v2's windowing rescued it. The strong model
never falls into that hole — so v2's smaller pages never convert into a smaller bill.

> **v2's measured win was a floor for weak models, not a ceiling gain for strong ones.** If you
> benchmark a developer tool with only one model class, you will draw the wrong conclusion about
> which of your features matter.

---

## Why v4 wins: the features existed, nothing could find them

v2 shipped `find` and `chain`. Across 18 runs, a capable model used them **zero times** — because the
help text had drifted and never listed them.

| Command used by the agent | v1 | v2 | v4 | What it does |
|---|---:|---:|---:|---|
| `find` | — | 0 | **12** | Search the page instead of reading it |
| `chain` | — | 0 | **13** | Run six actions in one call |
| `snapshot @ref` | — | 0 | **5** | Zoom into one element's subtree |
| `snapshot --next` | — | 3 | 0 | Page through a long document |
| `snapshot --full` | 8 | 9 | **2** | Dump everything — the expensive escape hatch |

After the fix the same model reaches for those commands **25 times**, and full-page dumps collapse
from 9 to 2. That is the entire v4 saving.

Two fixes had to land together for either to pay: `find` was invisible, *and* the handles it returned
had been stripped from headings and tables, so the follow-up zoom couldn't address what `find` had
just located. Fixing one alone would still have measured zero.

**One command needs a capable driver.** `chain` stayed at zero uses even *after* becoming visible —
when a small model drove it. A strong model used it 13 times, unprompted, collapsing six actions into
a single call. `find` answers a question the agent already has; `chain` requires planning several
steps ahead. Judge that feature against the model class that will actually drive your tool.

---

## Per-task results

Mean cost across three passes.

| Task | v1 | v2 | v4 | Best |
|---|---:|---:|---:|---|
| `rfc-deep-read` | $0.298 | $0.296 | **$0.214** | v4 |
| `spa-todomvc` | $0.211 | $0.238 | **$0.183** | v4 |
| `web-form` | $0.190 | $0.150 | **$0.134** | v4 |
| `table-extract` | **$0.220** | $0.273 | $0.278 | v1 |
| `wiki-journey` | $0.299 | $0.257 | **$0.223** | v4 |
| `shop-navigate` | $0.236 | **$0.228** | $0.234 | v2 |

**The table task is a real loss, and worth keeping.** On the baseline build the agents read the
mangled row — `...primordialsolid74W` — and pattern-matched it against chemistry they already knew,
in three calls. v4's agents used `find` and zoomed into the actual row: more calls, more cost, a
grounded answer. On a table where the model *doesn't* already know the answer, the cheap path is a
guess. `shop-navigate` is a tie within noise (0.6% across all three builds).

### Accuracy

All 54 runs answered the substantive question correctly. Three runs got a sub-part's exact wording
wrong, and only one is attributable to a build: on v2, the todo counter was reported as `"2items
left"` — the agent faithfully reporting the glued text the tool showed it. v4 reported `"2 items
left"` correctly in all three passes.

---

## Problems found and fixed

A line-by-line review preceded the final build. Every claim was reproduced on the live tool or traced
to a specific line.

| Severity | Problem | What it did to you |
|---|---|---|
| **High** | Starting a second browser connection while one was running deleted the running one's credentials | Every client locked out of a healthy connection — and the error message named a setup command that couldn't fix it |
| **High** | Connections on different ports overwrote each other's credentials; several commands ignored the port setting entirely | The same lockout, with no crash to explain it |
| Medium | The command list was hand-maintained and had drifted | `find` and `chain` were invisible; used 0 times in 18 runs |
| Medium | Merged text fragments joined with no separator | A table row became `...primordialsolid74W`; column boundaries unrecoverable |
| Medium | Handles stripped from headings, tables and articles | The advertised zoom command couldn't address the things worth zooming into |
| Medium | "Page unchanged" shortcut keyed to a file, not to who was asking | A fresh agent was told it had already seen a page it had never seen |
| Medium | Session state kept in one machine-global place | Two agents corrupt each other's page history; the benchmark was forced to run sequentially |
| Medium | The two newest commands had no tests at all | A quoting bug in `chain` shipped undetected |
| Low ×7 | Assertion command with no wait; search results capped with no paging; weak change detection; stale link lookup after an action; brittle dependence on an upstream error message | Individually minor — each a silent wrong answer or a dead end under the right conditions |

---

## Limitations

- **Three repeats is the resolution floor.** All three v4 passes beat all three v1 and v2 passes —
  complete separation — but at 3-vs-3 the strongest available statistical result is p = 0.10. The
  direction is solid; a confident effect *size* needs five or more.
- **Cost is specific to this harness.** It truncates oversized tool output, which subsidises the
  builds that dump whole pages. Elsewhere the gap would widen in v4's favour — the byte column is the
  one that travels.
- **The headline matrix is one model.** The v1-vs-v2 null result describes strong models. For weak
  ones, v2's windowing is still worth 53%.
- **The headline number is arm-dependent.** Blocking `eval` roughly triples v4's apparent
  advantage (−12.9% vs −4.7%). It does not invent it — v4 leads in both arms and wins every
  interaction task in both — but any single figure quoted without naming the arm is misleading.
- **Agents prefer scripting the page to reading it.** Given `eval`, the baseline build's agents
  took **no snapshots at all** across the whole suite. `eval` is advertised in the tool's own
  hints on every snapshot, so the tool is actively steering agents away from its most heavily
  engineered feature. Either document it as the intended fast path for extraction and scope the
  compaction work to interaction flows, or stop recommending it in snapshot output.
- **Two fixes are unit-tested but not agent-tested** — per-session state and stale-handle recovery
  need tasks the suite doesn't have yet.
- **Untested gaps remain**: a large page with a small mutation (where post-action diffs should
  shine), and two agents sharing one page.

---

## What to take away

**Ship v4.** It leads in both arms — 12.9% cheaper when the text tree is the only path,
~5% when it isn't — and it wins every interaction-heavy task by 31–33%. The durable
advantages are structural rather than headline cost: 25% fewer CLI calls, no byte
blow-ups, and it never loses except on pure lookups.

**Benchmark across model classes.** A single model class hid which features mattered. The same code
looked like a 53% win and a 0.9% win depending only on who drove it.

**Discoverability is a feature.** Two well-built commands returned nothing for an entire release
because a help string had drifted. Generate that surface; never hand-maintain it.

**Measure emitted bytes, not just tokens.** Harnesses that truncate large outputs will flatter a
wasteful tool. The two numbers disagreed here in both directions.

**Three repeats is not enough.** Two conclusions drawn at n=3 — that v2 beat the baseline
with `eval` available, and that v4 emitted a third of the bytes — both evaporated at n=5.
Each rested on a single unlucky pass.

---

*Full data, per-call logs and the reproduction harness: `benchmarks/agentic-v3/`.*
