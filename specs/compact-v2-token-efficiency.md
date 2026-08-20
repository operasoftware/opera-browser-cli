# Compact v2 — further token-efficiency for snapshots

Status: **Partially implemented** — R1 (landmark collapse + `snapshot @ref`), S1 (refs
only on interactives), S2 (dominant-prefix factoring: `@8.324` → `@.324` with `snap:`
declared in page metadata), S3 (indent halving), S7 (URL v2), S8 (label hygiene),
D1 (`snapshot --next` windowing with a persisted cursor), D3 (post-action diffs
against the persisted last tree, with full-snapshot fallback on navigation or large
deltas), and D6 (help diet) are implemented; unit tests in
`test/snapshot-compact-v2.test.ts`, live test plan in `test/live-compact-v2-plan.md`.
Remaining items below are unscheduled. This document analyses the current
`opera-compact` pipeline (`src/snapshot.ts`) and proposes the next round of
token-efficiency work, ordered by expected payoff and risk. Estimates marked *(est.)*
are hypotheses to be validated with the existing benchmark harness before adoption.

## 1. Current pipeline recap

Three layers, applied in `formatPageOutput` (`src/cli.ts:1023`):

1. **Structural clean-up** (`compactSnapshot`, `src/snapshot.ts:156`) — per-line:
   ARIA-default stripping, role renames, URL cleaning (origin strip, tracking params,
   `javascript:`/`data:` drop), description dedup (≥3 repeats), echoed-StaticText drop,
   LineBreak/whitespace-node drop, `heading level=N` → markdown, numeric unquoting,
   `uid=X_Y` → `@X.Y`, consecutive-text-run collapse.
2. **Cap** (`truncateSnapshot`) — head-only truncation at 12,000 chars (16,000 raw).
3. **URL LUT** (`applyUrlLut`) — post-truncation `$uN` tokens for repeated (≥2×, ≥15
   chars) and whale (≥200 chars) URLs, with a trailer.

## 2. Key observations driving this plan

These four facts shape where the remaining wins are:

**O1 — The cap is in characters, so character savings compound.** Every char saved by
Layer 1 lets more page content fit under the 12k cap. Savings that are token-neutral in
isolation (e.g. halving indentation — space runs often tokenize to one token either way)
still buy more *visible content per snapshot*, which reduces `--full` requests and repeat
calls. Char-level shrink is worth pursuing even where the direct token delta is small.

**O2 — Head-only truncation keeps the least useful part of the page.** Real pages open
with banner + navigation + sidebars; `main` content starts thousands of chars in. The
current cap spends its budget on exactly that boilerplate and cuts the content. Worse:
the accessibility tree is **document-scoped, not viewport-scoped**, so `scroll down`
re-snapshots the same tree and the head-truncation returns *the same 12k chars again*
(`handleScroll`, `src/cli.ts:1255` → `formatPageOutput`). On a long static page the
agent's only way to reach deep content today is `--full` — the exact blowup compact
exists to avoid. Fixing what the cap *keeps* is worth more than shrinking what's inside it.

**O3 — Every action pays a full snapshot.** `click`, `fill`, `type`, `press`, `scroll`,
`back` each return a fresh full-page snapshot. On multi-step flows (the agentic
benchmark averages 1.4–2.1 tool calls; real tasks run longer) most of that re-sent
content is unchanged. Crucially, **refs from opera-devtools-mcp are stable across
snapshots** — a node keeps its uid for as long as it exists — so consecutive snapshots
are directly comparable by ref, and unchanged regions re-serialize byte-identically.
Diffs are therefore cheap to compute and are the biggest lever for trajectory-level cost.

**O4 — Refs are spent on nodes that can never be acted on.** Every `text` node carries
an `@X.Y` ref (~6–9 chars) although agents only ever act on interactive elements. On
text-heavy pages, text lines are the majority of lines.

## 3. Tier 1 — static improvements (low risk, do first)

### S1. Drop refs from non-interactive nodes
Emit `@X.Y` only for actionable roles (link, button, textbox/searchbox/combobox/
textarea/input, checkbox, radio, switch, slider, tab, menuitem, option, listbox, and
headings if we want scroll-to targets later). `text`, `image` (non-link), `paragraph`,
`list(item)`, containers lose the ref:

```
@8.330 text " radius1736.0 km(0.2731 of Earth's)"   →   text " radius1736.0 km(0.2731 of Earth's)"
```

*(est.)* 6–10 chars on 40–60% of lines of documentation-class pages → 5–10% overall,
plus O1 compounding. **Touch points:** `countRefs`/`extractRefs` already tolerate
missing refs per-line; `page.refs` metadata stays a count of interactive refs (arguably
becomes *more* meaningful). Provide `--refs all` as an escape hatch. Risk: an agent
wanting to `hover` a plain text node — rare, and `eval` remains available.

### S2. Factor the dominant ref prefix out
Because refs are stable, the `X` in `uid=X_Y` marks the capture in which the node was
*first seen* — so a fresh page snapshot has one uniform prefix, while later snapshots
of a mutated page may mix prefixes (surviving nodes keep the old one, new nodes get a
new one). Factor out the **dominant** prefix rather than assuming uniformity: declare
it once, emit bare refs for nodes that share it, full refs for the rest:

```
page: {title: ..., snap: 8, refs: 104}
@324 link "[5]" url=$u7        ← means @8.324
@9.12 status "Item added"      ← minority prefix, written in full
```

CLI accepts bare `@324` and expands via the stored prefix (state dir already persists
`last-url-map.json`; add the prefix alongside). *(est.)* 2–4 chars × most ref lines;
on a 104-ref Moon snapshot ≈ 300–400 chars, and the saving grows over long sessions as
prefixes widen (`@124.5`). Verify prefix distribution empirically (including iframe
subtrees) before building; guard against stale stored prefixes.

### S3. One-space indentation (or depth cap)
Two spaces per level × 10+ levels deep on Wikipedia = 20+ chars/line of leading
whitespace. Halve it, or cap displayed indent at ~8 levels. Mostly char-neutral in
tokens (O1 applies) but directly buys content under the cap. Trivial to implement in
the output pass; keep relative nesting intact so structure stays readable.

### S4. Flatten single-child wrapper chains
Chains like `listitem > link`, `generic > text`, `paragraph > text`, `cell > text`,
and the presentational `LayoutTable`/`LayoutTableRow`/`LayoutTableCell` family add a
line + a level of indent without information. Hoist the only child into the wrapper's
position when the wrapper has no label and no attributes worth keeping; render
`list`/`listitem` as markdown bullets (`- link "Foo" url=…`) the way headings already
became markdown. *(est.)* 10–20% fewer lines on list/table-heavy pages.

### S5. Data-driven attribute/role pruning
Current stripping rules were hand-picked. Add a small analysis script (extend
`benchmarks/page-token-benchmark`) that reports attribute/value frequency across the
50-page corpus, then prune the verified-redundant tail: `focusable` on inherently
focusable roles, `multiline=false`, more PascalCase renames (`contentinfo`→`footer`,
`complementary`→`aside`, `banner`→`header`, `navigation`→`nav`). Don't rename common
roles that are already one BPE token (`button`, `link`) — no win, and out-of-vocab
names risk accuracy.

### S6. Generalise echo-dedup beyond StaticText
Today only a StaticText child echoing its parent's label is dropped. Extend to:
`image "Foo"` inside `link "Foo"` (alt duplicating link text — extremely common),
`description=` equal to the node's own label, and button aria-label echoing inner text.

### S7. URL cleaning v2
- **Same-path links → fragment only.** `cleanUrl` strips origin but not the current
  page's path; `/wiki/Moon#cite_note-7` on the Moon page should become `#cite_note-7`.
- **Path-prefix LUT.** When many links share a long prefix (`/questions/tagged/…`),
  declare it once in the trailer (`$p1 /questions/tagged/`) and emit `url=$p1:scala`.
  Only trigger above a savings threshold; measure — it may overlap heavily with $uN dedup.
- **Expanded tracking-param list:** `ref_src`, `si` (YouTube), `spm`, `mkt_tok`,
  `_hsenc`/`_hsmi`, `hsa_*`, `pk_*`/`mtm_*` (Matomo), `WT.*`, `cmpid`, `s_kwcid`, `vero_id`, `oly_*`.
- **Drop `url="#"`** and empty-fragment self-links entirely.

### S8. Label hygiene
Collapse internal whitespace runs / newlines inside quoted labels; hard-cap
pathological labels (multi-KB aria-labels exist in the wild) at ~300 chars with `…`.

### S9. Generalised string LUT *(measure first)*
Extend the `$uN` idea to any string ≥ ~20 chars repeated ≥3× (`"Archived from the
original on"`, repeated button labels in feeds). Same trailer mechanics as URLs.
Readability cost is real — labels become indirect — so gate on benchmark evidence that
the agentic pass rate holds.

## 4. Tier 2 — representation changes (bigger wins, more design)

### R1. Landmark-aware rendering + budget allocation ⭐ *highest expected value*
Fixes O2. Identify landmark subtrees (`banner`, `navigation`, `contentinfo`,
`complementary`, cookie banners by heuristic) and render each as a **one-line summary
by default**, spending the cap budget on `main`:

```
nav "Site navigation" [collapsed: 47 links — expand: opera-browser-cli snapshot @1.4]
main
  # Moon
  …full detail…
footer [collapsed: 31 links]
```

Pair with a new **`snapshot @ref`** subtree command that returns full detail for one
collapsed region (or any node). This converts head-truncation from "whatever came
first" to "the content, plus a table of contents of the chrome." *(est.)* On
documentation-class pages nav+footer are commonly 30–60% of the tree; this both saves
tokens *and* surfaces the content the task actually needs — should improve accuracy,
not merely hold it. Keep `--full` semantics unchanged.

### R2. Repeated-subtree folding → tabular rows
List-shaped pages (search results, issue lists, product cards, citation lists) repeat
one subtree skeleton dozens of times. Detect ≥4 structurally identical siblings
(hash of the role-skeleton), print the skeleton once, then one row per item carrying
only refs + varying text — TOON-style:

```
list [25× {link(title) · text(date) · link(author)}]:
  @512 "Fix crash on startup" "2d ago" @514:alice
  @520 "Add dark mode"        "3d ago" @522:bob
```

*(est.)* 40–70% reduction on such sections. This is the hardest item in the doc
(skeleton matching, tolerating minor shape variance, keeping every actionable cell's
ref) — prototype behind a flag and measure on GitHub/Wikipedia-citation pages before
committing. Failure mode to guard: near-identical-but-not-identical rows silently
losing a distinguishing attribute.

### R3. Markdown-hybrid "reader mode" *(exploratory)*
The logical endpoint of "headings became markdown": render *all* non-interactive
content as plain markdown (prose, bullets, tables) and keep tree/inline syntax only
for actionables — `[Learn more](@23)` for links, `[input @7 "Search"]` for fields.
Models are massively pretrained on markdown; the a11y-tree dialect is
out-of-distribution. Potential double win (tokens *and* comprehension), but it's a
different format contract — ship behind `--format md`, run the full agentic benchmark
head-to-head, only consider as default with clear evidence.

## 5. Tier 3 — interaction-model changes (trajectory-level savings)

### D1. Snapshot windowing — make `scroll` mean something under the cap
Cheapest fix for O2's scroll problem: the bridge keeps a per-page **cursor** into the
compacted tree; `scroll down` (and a new `snapshot --next` / `--from @ref`) returns the
*next* 12k-char window instead of re-truncating the head. Combined with R1 this gives
the agent cheap sequential access to arbitrarily long pages without `--full`.

### D2. Exploit ref stability — document it and lean on it
Refs are already stable across snapshots (see O3) — a property the CLI currently
neither documents to the agent nor exploits. Two free wins:
- **State the contract in output/SKILL.md**: *"a ref stays valid until the element
  disappears."* An agent that knows this can keep acting on known refs after minor page
  changes instead of defensively re-snapshotting — fewer snapshots taken at all.
- The bridge keeps the last compacted tree per page (needed by D3 anyway) so stale-ref
  errors can answer helpfully: `@44 no longer exists; nearest match: @212 button "Add to cart"`.

### D3. Diff snapshots after actions ⭐ *biggest trajectory-level lever*
Since refs are stable, two consecutive snapshots are directly comparable: key each
line by ref (position for ref-less lines after S1), then emit added/removed/changed
hunks. Post-action output becomes a delta by default:

```
page: {title: …, refs: +2 -1, base: snap 8}
~ @44 button "Add to cart" → "Added ✓"
+ under main:
  @112 status "Item added to cart"
- dialog "Choose size" (@98-@104 gone)
```

The bridge stores the last compacted tree per page and diffs bridge-side. Rules: full
snapshot when navigation happened (URL change / new document — refs reset with the
document), when the diff exceeds ~40% of full size, or on explicit `snapshot`.
Fill/toggle/typing interactions on SPAs produce near-empty diffs — *(est.)* this
converts the O3 cost (full snapshot per action) into tens of tokens per action for
most steps. One design question to settle: what the diff means when the *previous*
snapshot was truncated — diff against the full compacted tree (not the capped view),
so changes outside the last visible window still surface.

### D4. Compound actions with one final snapshot
`run` (`src/run.ts`) already executes multi-step scripts with **zero** intermediate
snapshot cost — it's underused. Two additions:
- A lightweight chain syntax for the common case, no JS required:
  `opera-browser-cli chain 'click @3; fill @7 "x"; press Enter'` — per-step one-line
  ok/error, a single snapshot (or D3 diff) at the end. N actions, 1 snapshot.
- Per-command `--quiet` (ack only, no snapshot) and `--expect "text"` (returns just
  the matched line or a structured failure) for verify-style steps.
- Promote `run`/`chain` in the SKILL.md and `help[]` hints so agents actually reach for it.

### D5. Query commands — don't snapshot to answer a question
`find <text|regex> [--role link]` greps the tree bridge-side and returns matching
nodes with an ancestor breadcrumb (~5 lines instead of 12k chars). Companions:
`links`, `headings`, `forms` structured extracts. Many benchmark-style tasks
("what's the heading?", "find the sign-in") become ~100-token interactions.

### D6. Help-block diet
The eval-syntax tip (`src/suggestions.ts:74`) is appended to **every** page response;
after the first time it's pure overhead. The bridge is persistent — track shown hints
per session and emit each once. Also suppress `scroll down` suggestion when the
snapshot wasn't truncated. Small, free, every call benefits.

## 6. Cross-cutting

- **Token-aware cap.** 12k chars ≠ stable token count (URLs tokenize ~2× denser than
  prose). Consider budgeting in estimated tokens (chars/4 heuristic per line class, or
  a small embedded tokenizer) so worst-case cost is predictable.
- **Byte-stability for prompt caching.** Stable refs mean an unchanged page already
  re-snapshots to byte-identical text — keep every new transform deterministic (no
  content-dependent counters that reset per call) so this property survives compaction
  and provider-side prompt caching gets maximal prefix hits.
- **Invariant tests.** Property test over corpus fixtures: every interactive node in
  the raw tree appears in the compact output with the same role, same label, and a
  resolvable ref. Any Tier-1/2 transform must keep this green.

## 7. Measurement plan

1. **Attribute/role frequency script** over the 50-page corpus → grounds S5, sizes S1–S4.
2. **Extend the static corpus** with app-class pages (GitHub issues UI, a dashboard, an
   SPA) — the whitepaper itself flags the documentation-class bias; R2/D3 wins live there.
3. **Harden the agentic suite.** All conditions pass 100% today, so the benchmark
   cannot detect accuracy regressions from more aggressive compression. Add tasks that
   require deep-page content (past the cap), disambiguating similar nav links, and
   ≥5-step interactions (where D3/D4 shine and where lossy compression would bite).
4. Every proposal ships behind a flag, is measured on both benchmarks, and only then
   becomes default — same discipline the whitepaper used.

## 8. Suggested order of attack

| # | Item | Impact *(est.)* | Effort | Risk |
|---|------|-----------------|--------|------|
| 1 | R1 landmark collapse + `snapshot @ref` | very high (tokens **and** accuracy) | M | L |
| 2 | S1 refs only on interactives | high | S | L |
| 3 | D6 help diet + S3 indent + S7 URL v2 + S8 labels | medium (cheap bundle) | S | L |
| 4 | D1 snapshot windowing (fix `scroll`) | high on long pages | S–M | L |
| 5 | S2 snapshot-prefix factoring | medium | S | L (verify prefix invariant) |
| 6 | S4 wrapper flattening + S5 data-driven pruning | medium | M | L–M |
| 7 | D3 diffs after actions (+ D2 contract) | very high on trajectories | M | L–M |
| 8 | D4 chain/`--quiet`/`--expect` | high on multi-step flows | M | L |
| 9 | D5 `find`/extracts | medium-high | S–M | L |
| 10 | R2 subtree folding | high on list pages | L | M–H |
| 11 | S9 string LUT, R3 markdown mode | unknown — measure | M/L | M |

Items 1–5 are essentially independent and could land in one milestone. With refs
already stable upstream, 7 (diffs) is no longer a research bet — it's a
medium-effort feature that changes the cost model from per-snapshot to per-change,
and is the strongest candidate for the milestone after that.
