# Comprehensive compact-v3 benchmark — Sonnet 5 (2026-09-01)

Comparison of upstream `main` and this branch (`head`) on the six-task balanced suite:
deep document retrieval, SPA mutation, form submission, table extraction, cross-page
navigation, and shop navigation.

- Model: `claude-sonnet-5`, first-party Anthropic, confirmed in all 72 envelopes.
- Driver: Claude Code 2.1.251 (`claude -p`), one fresh process per cell.
- Conditions: `main` at `827cfed`, `head` at `19801e7`.
- Repeats: strict n=3 and open n=3; 72 cells total.
- Run ID: `sonnet-interactive-v1`.
- All cells reported non-zero cache creation/read usage.
- Symmetric per-cell warm-up cost, reported separately: strict $0.688, open $0.451.

## Results

| arm | metric | head mean (sd) | main mean (sd) | head vs main |
|---|---|---:|---:|---:|
| strict | accuracy | 18/18 | 17/18 | +1 pass* |
| strict | cost | $0.690 ($0.105) | $0.705 ($0.119) | -2.1% |
| strict | raw CLI bytes | 205 KB (9 KB) | 1,666 KB (8 KB) | -87.7% |
| strict | CLI calls | 36.3 (7.5) | 29.7 (1.2) | +22.5% |
| strict | model turns | 33.3 (4.2) | 28.0 (1.0) | +19.0% |
| strict | cache creation | 136K (22K) | 163K (47K) | -16.2% |
| strict | cache reads | 1,445K (196K) | 1,173K (28K) | +23.2% |
| open | accuracy | 18/18 | 18/18 | equal |
| open | cost | $0.622 ($0.065) | $0.708 ($0.111) | -12.2% |
| open | raw CLI bytes | 106 KB (2 KB) | 102 KB (<1 KB) | +3.4% |
| open | CLI calls | 30.0 (1.7) | 33.3 (0.6) | -10.0% |
| open | model turns | 29.0 (2.0) | 33.7 (1.2) | -13.9% |
| open | cache creation | 134K (18K) | 147K (50K) | -8.8% |
| open | cache reads | 1,215K (76K) | 1,434K (93K) | -15.3% |

*The strict `main` SPA answer contained `"2items left"`, reproducing the baseline's
missing-space text-run corruption. It otherwise completed the interaction and identified
alpha/gamma correctly. The pin requires the exact `"2 items left"` text.

## Strict by task

| task | head cost | main cost | cheaper |
|---|---:|---:|---|
| RFC deep read | $0.1020 | $0.1617 | head |
| TodoMVC SPA | $0.1034 | $0.1038 | head |
| Web form | $0.1293 | $0.1141 | main |
| Table extraction | $0.1392 | $0.1037 | main |
| Wikipedia journey | $0.1153 | $0.1245 | head |
| Shop navigation | $0.1009 | $0.0971 | main |

The aggregate strict cost is effectively near parity at this sample size. Head trades a
large raw-output reduction for about 20% more calls/turns. It writes fewer cache tokens but
rereads more accumulated context. The direction varies by task: compact retrieval helps
the long RFC and cross-page journey, while the form and table paths cost more.

## Open arm

With `eval` available, head used it 6 times and main 19 times across 18 cells. Both reached
100% accuracy. Head made fewer calls/turns and cost 12% less, while raw CLI bytes were
nearly equal. This is not evidence for snapshot compaction by itself: the permission change
alters agent strategy and largely bypasses the snapshot representation.

## Interpretation

The balanced suite changes the conclusion from the discarded reading-only study. On
interactive and navigation tasks, compact-v3 is not uniformly penalized by targeted read
loops. The cache-aware Sonnet result is:

- strict: equal-to-slightly-better accuracy, 88% fewer raw bytes, approximately equal cost,
  but more calls and cache reads;
- open: equal accuracy and lower cost/calls, driven partly by different use of `eval`;
- task-level effects are mixed, so the bundle still does not identify which individual
  feature causes an improvement.

Further decisions require feature-level A/B tests, particularly for `find`/subtree reads,
windowing, post-action diffs, and action chaining.
