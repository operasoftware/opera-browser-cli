# Browser-agent behavior under compact and baseline interfaces

## A balanced cross-model study of retrieval, SPAs, forms, tables, and navigation

**Research artifact — 2026-09-01**

## Abstract

This study compares upstream `main` with the experimental compact-v3 browser interface
across six model families and a balanced six-task browser suite. Unlike the discarded
reading-heavy experiment, this suite includes repeated SPA mutation, form completion,
large-table extraction, link-following across pages, category navigation, and deep
document retrieval. Each model ran both a strict arm, where page JavaScript evaluation was
forbidden, and an open arm, where the full CLI was available. Each condition used three
independent repeats: 432 cells in total.

Compact-v3 preserved or improved strict-arm answer accuracy in every model family. Its
strongest consistent effect was lower browser-output volume, but the magnitude depended on
how each model used the interface. For Sonnet 5, strict raw output fell 87.7% while cost
remained near parity and calls increased. GPT-5.6-Terra reduced strict output, calls, and
cost. Gemini and GLM reduced strict output but showed different call and cost responses.
Qwen and DeepSeek also reduced output, while dollar comparisons are unavailable because
the gateway supplied no billing data for those routes. The open arm frequently induced
`eval`-based strategies and therefore does not isolate snapshot compaction.

The central result is not that smaller snapshots universally make agents cheaper. It is
that representation changes alter model policy: some models trade bytes for targeted
queries, some exploit the compact affordances efficiently, and others enter costly search
loops. Interface evaluation therefore needs model-family coverage, interactive tasks, and
joint measurement of correctness, calls, context traffic, and billed tokens.

## 1. Research question

The experiment asks whether the compact-v3 interface changes browser-agent effectiveness
and resource use relative to upstream `main` when agents must do more than read a page.
Compact-v3 is a bundle: bounded snapshots, targeted reads, continuation, post-action diffs,
per-session state, action chaining, and assertions. This study evaluates the bundle. It
does not identify the causal contribution of an individual feature.

## 2. Experimental design

### 2.1 Tasks

The same six tasks were used in every cell:

1. locate the exact 404 section and title in RFC 9110;
2. mutate and filter a TodoMVC SPA;
3. complete and submit Selenium's web form;
4. extract Tungsten fields from Wikipedia's elements table;
5. follow a link from Moon to Giant-impact hypothesis and extract an estimate;
6. navigate Books to Scrape by category and identify the cheapest Travel book.

These tasks cover deep retrieval, repeated interaction, form state, submit navigation,
table lookup, cross-page navigation, and category/product comparison.

### 2.2 Conditions and arms

`head` is compact-v3 at `19801e7`; `main` is upstream at `827cfed`. The condition order was
rotated by repeat. Each cell used a fresh agent process and isolated browser-CLI session.

- **Strict:** `eval` and other page JavaScript execution were forbidden. Page knowledge had
  to come from browser inspection commands.
- **Open:** the full CLI, including `eval`, was available.

Three repeats of 6 tasks × 2 conditions × 2 arms were run for each of 6 models, yielding
72 cells per model and 432 total.

### 2.3 Models and drivers

| Family | Route / reported model | Driver | Cost status |
|---|---|---|---|
| Anthropic | `claude-sonnet-5`, firstParty | Claude Code 2.1.251 | Cache-aware billed estimate |
| OpenAI | `openai/gpt-5.6-terra` | direct Responses API | Gateway price snapshot |
| Google | `pc_browser/vertex_ai/gemini-3.5-flash` | direct Responses API | Gateway price snapshot |
| Zhipu | `dashscope/glm-5.2` | direct Responses API | Gateway price snapshot |
| Qwen | `opera-internal/Qwen/Qwen3.8-27B` | direct Responses API | Billing data unavailable |
| DeepSeek | `opera-internal/deepseek-ai/DeepSeek-V4-Flash` | direct Responses API | Billing data unavailable |

Sonnet was intentionally run through Claude Code so Anthropic prompt-cache creation and
reads were measured through the supported first-party path. Other families used one direct
driver with an 8,000-character tool-result cap and a 50-turn ceiling. Consequently,
within-model `head`/`main` comparisons are the primary estimand. Absolute cross-model token
and cost rankings are not fully controlled because the Sonnet driver has different context
handling. Qwen and DeepSeek dollar values are omitted rather than described as free.

### 2.4 Instruments and grading

Raw agent envelopes record model identity, usage, turns, errors, and final answers. A shim
independently records every CLI invocation, duration, exit code, stdout bytes, stderr bytes,
and arguments. Answers are graded against task-specific pinned fragments. Errored cells
fail. Raw artifacts and SHA-256 manifests are retained under `data/`.

## 3. Results

### 3.1 Strict arm

Mean values are suite totals per repeat. Accuracy is across 18 cells per condition.

| Model | Accuracy head / main | Cost head / main | Raw CLI output head / main | Calls head / main | Turns head / main |
|---|---:|---:|---:|---:|---:|
| Sonnet 5 | 18/18 / 17/18 | $0.690 / $0.705 | 205 / 1,666 KB | 36.3 / 29.7 | 33.3 / 28.0 |
| GPT-5.6-Terra | 18/18 / 18/18 | $0.136 / $0.165 | 175 / 376 KB | 48.0 / 51.3 | 30.3 / 30.7 |
| Gemini 3.5 Flash | 18/18 / 17/18 | $0.403 / $0.705 | 2,029 / 2,734 KB | 77.0 / 62.7 | 58.0 / 71.0 |
| GLM-5.2 | 18/18 / 18/18 | $0.441 / $0.454 | 830 / 2,269 KB | 104.7 / 69.0 | 78.3 / 67.0 |
| Qwen3.8-27B | 18/18 / 18/18 | unavailable | 2,390 / 2,551 KB | 50.3 / 43.0 | 49.7 / 44.0 |
| DeepSeek-V4-Flash | 18/18 / 17/18 | unavailable | 2,102 / 3,514 KB | 223.0 / 58.0 | 70.0 / 51.7 |

Compact-v3 reduced mean strict raw output for all six families. The reductions ranged from
6.3% for Qwen to 87.7% for Sonnet. This did not imply fewer calls. Calls increased for
Sonnet, Gemini, GLM, Qwen, and especially DeepSeek; Terra was the exception. The strict
cost response among priced direct-driver models was favorable for Terra (-17.6%), strongly
favorable but high-variance for Gemini (-42.9%), and near parity for GLM (-2.9%). Sonnet
was also near parity (-2.1%).

Gemini's `main` strict mean includes a 50-turn failed RFC cell costing $0.958, so its large
aggregate cost difference is not a stable estimate. DeepSeek's 223-call head mean is
similarly dominated by a pathological repeat: model turns stayed capped near 70 suite-wide
while one interaction emitted hundreds of CLI calls. These are real policy failures, not
reasons to silently discard cells, but they make means volatile at n=3.

The three baseline accuracy misses were exact-output or completion failures: Sonnet and
DeepSeek reproduced `2items left` from the baseline TodoMVC text run, and Gemini hit the
turn ceiling on one RFC cell. Compact-v3 passed all 108 strict cells across model families.

### 3.2 Open arm

| Model | Accuracy head / main | Cost head / main | Raw CLI output head / main | Calls head / main | Turns head / main |
|---|---:|---:|---:|---:|---:|
| Sonnet 5 | 18/18 / 18/18 | $0.622 / $0.708 | 106 / 102 KB | 30.0 / 33.3 | 29.0 / 33.7 |
| GPT-5.6-Terra | 15/18 / 18/18 | $0.108 / $0.117 | 108 / 163 KB | 37.3 / 40.0 | 27.0 / 26.3 |
| Gemini 3.5 Flash | 18/18 / 18/18 | $0.283 / $0.247 | 387 / 133 KB | 46.7 / 41.3 | 53.0 / 47.0 |
| GLM-5.2 | 18/18 / 18/18 | $0.120 / $0.124 | 106 / 113 KB | 37.3 / 39.0 | 41.7 / 43.0 |
| Qwen3.8-27B | 18/18 / 18/18 | unavailable | 367 / 391 KB | 38.3 / 33.7 | 39.0 / 34.3 |
| DeepSeek-V4-Flash | 18/18 / 18/18 | unavailable | 161 / 282 KB | 44.7 / 50.7 | 44.0 / 39.3 |

Open-arm results are less attributable to the snapshot interface because models can query
the DOM directly. Sonnet and GLM favored head; Gemini and Qwen used more calls and context
on head; DeepSeek reduced bytes and calls but increased turns. Terra's head failures were
stale-reference failures in form/shop interactions, while two baseline answers previously
flagged by an overly narrow grader (`Not Found` without `404`, and 4.4–4.45 billion years)
are semantically correct under the corrected pins.

### 3.3 Cache and context behavior

Cache traffic cannot be interpreted as a simple proxy for efficiency. Sonnet strict head
created 16.2% fewer cache tokens but read 23.2% more, consistent with more targeted turns
against an accumulating transcript. Direct routes reported cache reads but no cache-write
bucket for Gemini, GLM, Qwen, or DeepSeek; that is a provider-reporting difference, not
proof that cache creation was absent. Terra reported both read and write buckets.

Raw CLI bytes are measured before driver truncation and remain directly comparable within
each model. They show what the browser interface emitted, not necessarily what survived in
the model context. Token usage reflects the latter and also includes prompts, assistant
messages, and repeated transcript material.

## 4. Model-family behavior

### Sonnet 5

Sonnet made compact-v3 genuinely compact at the interface boundary: an 88% strict byte
reduction. It reinvested that saving in additional targeted calls and turns, leaving cost
near parity. This is the clearest example of a model converting a smaller observation into
a longer search policy rather than terminating earlier.

### GPT-5.6-Terra

Terra was the strongest balanced strict result: full accuracy, 53% fewer raw bytes, 6.5%
fewer calls, and 17.6% lower cost on head. Its model-turn count was nearly unchanged. For
this family the compact interface reduced both observation size and aggregate work rather
than merely shifting between them. Open-arm stale references show that the richer command
set can still induce brittle action policies.

### Gemini 3.5 Flash

Gemini reduced strict bytes and model turns on head but increased CLI calls. The apparent
43% cost reduction is dominated by one baseline runaway and should not be generalized.
In open mode it favored the baseline on cost, calls, turns, and bytes. Gemini therefore
shows strong sensitivity to both outliers and the permitted tool surface.

### GLM-5.2

GLM reduced strict bytes by 63% with full accuracy, but used 52% more calls and 17% more
turns. Cost remained near parity. When `eval` was available, both conditions converged to
roughly 0.12 dollars and similar traffic. GLM most clearly illustrates targeted-read
amplification: compaction works at the output layer while model policy expands the number
of inspections.

### Qwen3.8-27B

Qwen was fully accurate throughout. Strict output fell only 6%, while calls and turns rose
on head. Open results were also close and noisy. Billing data is unavailable, so the study
cannot translate its token traffic into dollars. The modest byte response suggests this
model often requested broad observations despite the new affordances.

### DeepSeek-V4-Flash

DeepSeek reduced strict bytes by 40% and corrected the baseline TodoMVC exact-text miss,
but head generated a severe multi-call loop in one repeat. Open head reduced bytes and
calls with equal accuracy. The family is a warning against relying on output volume alone:
an interface can emit less data while triggering substantially more tool activity.
Billing data is unavailable for this route.

## 5. Conclusions

Five conclusions survive across the balanced suite:

1. **Compact-v3 did not reduce strict correctness.** Head passed 108/108 strict cells;
   baseline passed 105/108.
2. **Output reduction is broad but not uniform.** Every family emitted fewer strict bytes
   on head, from 6% to 88%.
3. **Fewer bytes do not imply fewer calls or lower cost.** Most families issued more
   strict calls; priced costs ranged from meaningful improvement to near parity, with one
   outlier-driven result.
4. **Model policy is part of the interface outcome.** Families use continuation, targeted
   retrieval, broad snapshots, and action commands differently.
5. **The open arm is an operational comparison, not a compaction ablation.** `eval` changes
   the information channel and often dominates snapshot strategy.

The bundle is promising for correctness and transport reduction, but these results do not
justify adopting every compact-v3 mechanism. The next research step is feature-level
ablation: independently vary snapshot bounds, find/subtree reads, continuation, diffs,
and chaining while preserving tasks, model routes, driver, cache policy, and stopping
rules. Larger n is particularly important for detecting runaway tool policies.

## 6. Reproducibility and artifacts

- Protocol: [`COMPREHENSIVE-RUN.md`](COMPREHENSIVE-RUN.md)
- Task definitions: [`harness/tasks.tsv`](harness/tasks.tsv)
- Grader: [`harness/grade.py`](harness/grade.py)
- Sonnet run report: [`results-2026-09-01-comprehensive-sonnet.md`](results-2026-09-01-comprehensive-sonnet.md)
- Raw runs: [`data/`](data/)

Each model directory retains 72 JSON envelopes, per-cell CLI logs, and `SHA256SUMS`.
Gateway prices are snapshots recorded in the envelopes and harness, not claims about
future pricing. Qwen and DeepSeek are explicitly marked **billing data unavailable**.
