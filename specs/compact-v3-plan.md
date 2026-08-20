# Compact v3 — implementation plan for the remaining wins

Status: plan. Successor to `specs/compact-v2-token-efficiency.md` (v2 shipped;
see `docs/compact-v2-results.md`). Governing rule, per project direction: **no
complicated or convoluted logic for small gains** — every item below states the
evidence that must exist before it gets built, and several are explicitly
rejected.

## 1. How LLM context caching changes the calculus

Provider prompt caching (Anthropic, OpenAI) is **prefix-based**: earlier
conversation turns are cached and re-read at ~0.1× the input price on each
subsequent turn. Two consequences matter for snapshot design:

1. **Caching does not deduplicate content.** A snapshot re-sent verbatim in a
   later tool result is *new* tokens at full price the first time it appears,
   every time it appears. Byte-identical output across turns buys nothing from
   the provider. So there is no reason to add complexity purely to keep
   snapshots byte-stable across captures — stability matters only for our own
   diff machinery (already true).
2. **Appended bytes are the whole game — and they compound.** Everything
   appended is then re-read (at cached rate) on every later turn, so a
   snapshot's trajectory cost is roughly `size × (1 + 0.1 × remaining_turns)`.
   A 12k-char snapshot in turn 2 of a 20-turn session costs ~3× its face value.
   This is why the v2 trajectory features (diffs, windows, `find`) are the
   right lever, and why the remaining format-level percentage points matter
   less than they look: **shrinking what gets appended per turn beats
   shrinking the page representation**.

Hygiene that follows directly (all already true in v2, keep it that way): no
timestamps or non-deterministic ordering in output; SKILL.md and help text
stable across releases so agent-side prefixes cache well.

## 2. Verdict per candidate

### Build next (small, evidenced, or directly cache-aligned)

**S5 — corpus analysis script + data-driven pruning.** A ~100-line script over
the 50-page corpus (raw snapshots already produced by the static benchmark)
reporting attribute/value and role frequencies, plus: share of bytes in
repeated sibling skeletons (feeds the R2 decision) and how often agents would
plausibly re-snapshot unchanged pages (feeds D7). Then prune only what the data
shows is both frequent and information-free. Effort S. **This is the
prerequisite that turns the other bets from guesses into decisions — do it
first.**

**D7 — unchanged-snapshot short-circuit.** When `snapshot` is requested and the
compacted tree signature equals the last *shown* one, return the `page:`
metadata plus `snapshot: unchanged since last shown` instead of re-printing
12k chars. Directly cache-aligned: identical re-prints are exactly the tokens
caching does *not* save. Risk: the agent may have lost the earlier snapshot to
its own context compaction — so the notice must include the escape
(`snapshot --force` reprints) and the ref count/title so the agent can tell
whether it still has what it needs. Effort S. Gate: bridge-log evidence from
the v2 benchmark runs that identical re-snapshots actually occur (S5 script
counts this); if they don't, skip.

**D2b — stale-ref nearest-match hint.** On `REF_NOT_FOUND`-class failures,
diff the requested ref's old line (from the persisted last tree) against the
current tree and suggest the closest match by label:
`@44 no longer exists; nearest: @212 button "Add to cart"`. Small, pure UX,
saves a full re-snapshot after every stale-ref miss. Effort S.

### Build only on evidence (the S5 script decides)

**R2 — repeated-subtree folding → tabular rows.** Highest theoretical upside on
list-shaped pages, highest complexity and accuracy risk in the whole plan.
Trigger to build: S5 shows ≥20% of compact bytes on app/list-class pages sit in
≥4-sibling identical skeletons. If built: behind `--fold`, prototype on
GitHub/Wikipedia-citation pages, promoted only after the agentic benchmark
shows no accuracy loss. If the trigger doesn't fire, **don't build it** — this
is the definition of complicated logic for uncertain gain.

**R3 — markdown-hybrid reader mode.** Experiment, not a feature: `--format md`
behind a flag, evaluated head-to-head on the agentic benchmark for accuracy as
much as tokens. Only worth running once the benchmark harness makes accuracy
measurement cheap. Never a default without decisive evidence.

### Rejected (for now)

**S9 — generalized string LUT.** Rejected: indirection hurts readability, the
biggest repeated strings (descriptions) are already deduped, and D3/D1 shrank
the surface it would apply to. Cache analysis makes it worse, not better — the
trailer is appended bytes too. Revisit only if S5 shows a surprising volume of
long repeated strings.

**Token-aware capping.** The char cap is predictable and cheap; a tokenizer in
the hot path is complexity for single-digit-percent budget accuracy. Rejected.

## 3. The benchmark before the features

Per the governing rule, R2/R3/D7 decisions need measurement, and the v2 results
doc showed the old task shapes can't measure trajectory features. So the
sequencing is:

1. Agentic benchmark v2 (`benchmarks/agentic-v2/` — tasks + interim subagent
   methodology; results in `results-*.md`). **Done first — see results file.**
2. S5 corpus analysis script (also answers the R2/D7 triggers).
3. D2b + (if triggered) D7 — small wins, one small release.
4. R2 prototype only if triggered; R3 experiment when idle capacity allows.

## 4. S5 results (2026-07-18) and gate decisions

`benchmarks/corpus-analyze.mjs` over 6 pages (Wikipedia Moon, Hacker News, GitHub
repo, MDN Array, Python functions, RFC 9110):

- **R2 gate: NOT met — R2 will not be built.** Bytes in runs of ≥4 identical
  sibling skeletons: **0.6% aggregate** (HN, the best-case list page, measured
  0% — row skeletons diverge after text-run collapsing, and its whole compact
  tree is only 15k). The metric is conservative (strict shape equality), but
  even a generous multiple leaves low-single-digit savings for the plan's most
  complex feature. Decision recorded per the governing rule.
- **No new pruning rules justified.** The remaining raw-attribute mass is
  `url=` (handled by cleaning + LUT) and `description=` (real content; heavy
  repeats already deduped at threshold 3). Long-tail candidates
  (`keyshortcuts=`, 18 occurrences across 6 pages) are not worth a rule.
- **D7 and D2b shipped** (unchanged-snapshot short-circuit with `--force`
  escape; stale-ref nearest-match hints backed by a rotated `prev-tree`
  baseline), plus the truncation help line now surfaces `find` at the moment
  of need — the v2 benchmark's integration recommendation.

## 5. Explicitly out of scope

Rewriting the harness in `snapshot-agentic-use` to OpenAI-independence, MCP
protocol changes upstream, and any transform that requires the agent to learn
new syntax without a measured payoff.
