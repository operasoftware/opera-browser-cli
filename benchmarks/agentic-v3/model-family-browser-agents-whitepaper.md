# Browser-agent behavior under compact and baseline interfaces

## A balanced cross-model study of retrieval, SPAs, forms, tables, and navigation

**Research report — 2026-09-01**

## Abstract

This study compares upstream `main` with the experimental compact-v3 browser interface
across six model families and a balanced six-task browser suite. Unlike the discarded
reading-heavy experiment, this suite includes repeated SPA mutation, form completion,
large-table extraction, link-following across pages, category navigation, and deep
document retrieval. Each model ran both a strict arm, where page JavaScript evaluation was
forbidden, and an open arm, where the full CLI was available. Each condition used three
independent repeats: 432 runs in total.

Compact-v3 preserved strong task accuracy across all model families (106/108 strict,
108/108 open). Its strongest and most consistent effect was a dramatic reduction in
browser-output volume across all six families, cutting aggregate strict CLI stdout between
60.7% and 91.4% (unweighted mean 79.7%). This metric is the sum of stdout bytes over every
CLI call in a six-task repeat; it is not DOM size or model-context usage. Both interfaces
already limit ordinary snapshot views to 12,000 characters per call, while `--full` can bypass
that limit. The practical advantage of compact-v3 is therefore denser, structured output
within the per-call limit. The byte reduction does not mean that every saved byte would
otherwise have entered the model context.
For Sonnet 5, strict raw output fell 87.7% while cost remained near parity
and calls increased. GPT-5.6-Terra reduced strict output by 83.0% and cost by 16.7%. Gemini
achieved exact parity on strict calls (39.0 vs 39.0) and turns (45.0 vs 45.0) while cutting
output by 69.6%. GLM reduced output by 60.7% at near call parity (39.7 vs 39.0), with cost
higher on head due to deeper multi-turn exploration. DeepSeek reduced output by 91.4% while cutting calls by 29.8% and turns by 13.1%. Qwen
reduced output by 85.8%. The open arm frequently induced `eval`-based strategies, driving head
raw output down to ~106 KB across all models with 100% accuracy.

The central result is that output format changes how models use the CLI even without an
additional test-harness cap. When the CLI output is passed through unchanged, models can use
targeted reads and diffs to complete interactive tasks. Separate runs capped each tool result
at 8,000 characters. Several runs then entered repetitive re-query loops. Because these were
new runs rather than replays of the same responses, they do not show that the cap alone caused
the extra work. Interface evaluation therefore needs
model-family coverage, interactive tasks, and joint measurement of correctness, calls,
context traffic, and billed tokens.

## 1. Research question

The experiment asks whether the compact-v3 interface changes browser-agent effectiveness
and resource use relative to upstream `main` when agents must do more than read a page.
Compact-v3 includes bounded snapshots, targeted reads, continuation, post-action diffs,
per-session state, action chaining, and assertions. This study evaluates the full set. It
does not measure the effect of each feature separately.

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
72 runs per model and 432 total.

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
reads were measured through the supported first-party path. Direct-driver families used the
Responses API with a 50-turn ceiling and no additional harness cap (`TOOL_CAP=0`), passing
the browser CLI's formatted output contract directly to the models. The CLI's own
command-specific limits remained active. Therefore, the main comparison is `head` versus
`main` for the same model.
Absolute cross-model token and cost rankings are not fully controlled because context
handling varies across drivers. Qwen and DeepSeek dollar values are omitted rather than
described as free. Separate, earlier runs capped direct-driver tool results at 8,000
characters. They are reported separately from the main runs. Because they are new executions,
differences cannot be attributed to the cap alone.

### 2.4 Instruments and grading

The driver's JSON results record model identity, usage, turns, errors, and final answers. A
shim separately records every CLI invocation, duration, exit code, stdout bytes, stderr bytes,
and arguments. Answers are checked against task-specific expected text. Runs with errors fail.
Raw results and SHA-256 manifests are saved under `data/`.

## 3. Results

### 3.1 Strict arm

Mean values are suite totals per repeat. Accuracy is across 18 runs per condition.

| Model | Accuracy head / main | Cost head / main | Raw CLI output head / main | Calls head / main | Turns head / main |
|---|---:|---:|---:|---:|---:|
| Sonnet 5 | 18/18 / 17/18 | $0.690 / $0.705 | 205 / 1,666 KB | 36.3 / 29.7 | 33.3 / 28.0 |
| GPT-5.6-Terra | 17/18 / 18/18 | $0.165 / $0.198 | 145 / 852 KB | 40.3 / 38.7 | 27.0 / 25.3 |
| Gemini 3.5 Flash | 18/18 / 18/18 | $0.321 / $0.301 | 1,166 / 3,841 KB | 39.0 / 39.0 | 45.0 / 45.0 |
| GLM-5.2 | 18/18 / 18/18 | $0.228 / $0.187 | 898 / 2,288 KB | 39.7 / 39.0 | 43.3 / 42.3 |
| Qwen3.8-27B | 17/18 / 18/18 | unavailable | 452 / 3,173 KB | 43.0 / 37.7 | 41.3 / 39.0 |
| DeepSeek-V4-Flash | 18/18 / 18/18 | unavailable | 277 / 3,209 KB | 43.3 / 61.7 | 41.7 / 48.0 |

Compact-v3 reduced mean strict raw output for all six families. The reductions were
substantial across the board: 60.7% for GLM, 69.6% for Gemini, 83.0% for Terra, 85.8% for
Qwen, 87.7% for Sonnet, and 91.4% for DeepSeek (suite mean ~80%).

The byte column is measured by the shim at the CLI process boundary, after the CLI has formatted
and, where applicable, truncated each response. It sums stdout across all calls in one six-task
repeat. It therefore captures total CLI traffic generated by the combined interface and model
behavior, not the size of an underlying DOM serialization, and it does not directly measure
what entered the model context. Ordinary snapshot views are limited to 12,000 **characters** per call in both
conditions; agents can request complete output with `--full`. Compact-v3 can fit more useful
structure and continuation information within that limit. This test does not directly measure
how complete each response is.

Smaller output did not always require more calls. In the main runs, call counts were often
close: Gemini achieved exact call parity
(39.0 vs 39.0) and turn parity (45.0 vs 45.0); GLM maintained near parity on calls (39.7 vs
39.0) and turns (43.3 vs 42.3); Terra saw a minor call shift (40.3 vs 38.7); and DeepSeek
actually issued 29.8% fewer calls (43.3 vs 61.7) and 13.1% fewer turns (41.7 vs 48.0) on
head. Sonnet (+22.2%) and Qwen (+14.1%) made moderately more calls on head as they
issued targeted inspection requests.

Strict cost response among priced direct-driver models was favorable for Terra (-16.7%),
near parity for Sonnet (-2.1%), slightly higher for Gemini (+6.6%), and higher for GLM
(+21.9%, $0.228 vs $0.187), where head engaged in deeper multi-turn inspection on the RFC
task.

Accuracy was high across the suite: head passed 106/108 strict runs (98.1%) while baseline
passed 107/108 (99.1%). The baseline miss was Sonnet formatting `2items left` from the
raw TodoMVC text. The two head misses were isolated semantic slips: Terra left `alpha, beta`
instead of `alpha, gamma` on one TodoMVC repeat, and Qwen extracted Tantalum's atomic
weight (180.95) rather than Tungsten's (183.84) on one table-extract cell. Neither condition
experienced tool crashes, driver timeouts, or unhandled errors.

### 3.2 Open arm

| Model | Accuracy head / main | Cost head / main | Raw CLI output head / main | Calls head / main | Turns head / main |
|---|---:|---:|---:|---:|---:|
| Sonnet 5 | 18/18 / 18/18 | $0.622 / $0.708 | 106 / 102 KB | 30.0 / 33.3 | 29.0 / 33.7 |
| GPT-5.6-Terra | 18/18 / 18/18 | $0.134 / $0.152 | 106 / 135 KB | 39.3 / 38.0 | 27.0 / 24.7 |
| Gemini 3.5 Flash | 18/18 / 18/18 | $0.279 / $0.249 | 107 / 111 KB | 39.7 / 38.0 | 45.7 / 44.0 |
| GLM-5.2 | 18/18 / 18/18 | $0.122 / $0.122 | 108 / 117 KB | 34.7 / 33.0 | 38.7 / 34.7 |
| Qwen3.8-27B | 18/18 / 18/18 | unavailable | 104 / 927 KB | 29.3 / 35.0 | 30.7 / 36.3 |
| DeepSeek-V4-Flash | 18/18 / 18/18 | unavailable | 106 / 928 KB | 34.3 / 34.7 | 36.7 / 38.0 |

In the open arm, every model family achieved 100% accuracy (18/18) on both conditions: 108/108
head versus 108/108 main across 216 total open runs. In the main runs, GPT-5.6-Terra
maintained complete reliability across all interactive tasks, free of the stale-reference
failures that occur when element references are severed by arbitrary truncation.

Raw CLI output on head converged tightly across all six model families to ~106 KB (104–108 KB),
demonstrating that models readily combine compact snapshots with targeted `eval` queries. On
main, Qwen and DeepSeek emitted over 920 KB because their policies routinely interleaved full
baseline DOM dumps with JavaScript evaluation.

Open cost favored head for Sonnet (-12.1%, $0.622 vs $0.708) and Terra (-11.8%, $0.134 vs
$0.152), converged to exact parity for GLM ($0.122 vs $0.122), and slightly favored main for
Gemini (+12.0%, $0.279 vs $0.249).

### 3.3 Cache and context behavior

Cache traffic cannot be interpreted as a simple proxy for efficiency. Sonnet strict head
created 16.2% fewer cache tokens (136k vs 163k) but read 23.2% more (1,445k vs 1,173k),
consistent with more targeted turns against an accumulating transcript. Terra reported both
read and write buckets: cache writes dropped 21.2% on head (49.2k vs 62.4k) and cache reads
dropped 5.1% (50.0k vs 52.7k), matching its overall reduction in billed cost. Direct routes
reported cache reads but no cache-write bucket for Gemini, GLM, Qwen, or DeepSeek; that is a
provider-reporting difference, not proof that cache creation was absent.

The stdout measurement is useful because it can be checked directly from the shim logs and
does not depend on provider billing. It still combines output size with model behavior: a model
that makes more calls can emit more total bytes even if each response is smaller. The reported
column also excludes stderr and cannot show how a provider tokenized, cached, or shortened the
returned text. Those details come from the driver's JSON results.

The separate 8,000-character runs produced large re-query loops for some GLM and DeepSeek
runs. This shows that mid-result truncation can work poorly with some model behavior in this
setup. Because these were separate executions rather than replays, they do not measure the
effect of the cap alone.

## 4. Model-family behavior

### Sonnet 5

Sonnet made compact-v3 genuinely compact at the interface boundary: an 87.7% strict byte
reduction (205 KB vs 1,666 KB). It reinvested that saving in additional targeted calls
(36.3 vs 29.7) and turns (33.3 vs 28.0), leaving strict cost near parity ($0.690 vs $0.705).
In the open arm, head was both faster and cheaper (-12.1% cost, $0.622 vs $0.708; 30.0 vs
33.3 calls).

### GPT-5.6-Terra

Terra delivered strong strict performance: 83.0% fewer raw bytes (145 KB vs 852 KB), 16.7%
lower strict cost ($0.165 vs $0.198), and near call parity (40.3 vs 38.7). In the open arm,
Terra achieved 100% accuracy (18/18 on both conditions) and reduced cost by 11.8% ($0.134 vs
$0.152), operating with complete reliability and avoiding the stale-reference failures that
arise when element lists are truncated mid-view.

### Gemini 3.5 Flash

Gemini achieved 100% accuracy (18/18 on both head and main across both arms) with exact
call parity (39.0 vs 39.0) and exact turn parity (45.0 vs 45.0) in the strict arm, while
slashing raw CLI output by 69.6% (1,166 KB vs 3,841 KB). Strict cost was stable at $0.321 vs
$0.301 (+6.6%). The separate 8,000-character runs included several 50-turn baseline runs; the main runs had
stable turn and call counts across both conditions. In open mode, Gemini
achieved 18/18 at $0.279 vs $0.249.

### GLM-5.2

In the main runs, GLM reduced strict bytes by 60.7% (898 KB vs 2,288 KB)
with full accuracy (18/18 on both conditions). Tool calls remained at parity (39.7 head vs
39.0 main), and turns were similarly aligned (43.3 vs 42.3). Head cost was $0.228 vs $0.187
(+21.9%), driven primarily by deeper multi-turn exploration on the RFC task. In open mode,
both conditions converged to exact cost parity ($0.122 vs $0.122) with 34.7 vs 33.0 calls.

In the separate 8,000-character runs, GLM head averaged 104.7 calls, 78.3 turns, and $0.441.
The logs show repeated re-queries. Because these were new executions rather than replays of
the main runs, the cap cannot be identified as the only cause.

### Qwen3.8-27B

Qwen achieved 100% accuracy in the open arm (18/18) and 17/18 in the strict arm (one
column-offset slip on the Tungsten table extraction). Strict output fell by 85.8% (452 KB vs
3,173 KB) while calls rose moderately (43.0 vs 37.7). In the open arm, head reduced calls
from 35.0 to 29.3 and cut raw bytes from 927 KB to 104 KB (-88.8%). Billing data is
unavailable for this route.

### DeepSeek-V4-Flash

DeepSeek demonstrates the critical balance between capping and context. In the strict arm,
it achieved 100% accuracy (18/18 head and main), cut raw output by 91.4% (277 KB vs
3,209 KB), and issued 29.8% fewer calls (43.3 vs 61.7) and 13.1% fewer turns (41.7 vs 48.0)
on head. In the open arm, it achieved 18/18 while cutting raw output from 928 KB to 106 KB
(-88.6%) with 34.3 vs 34.7 calls.

The separate 8,000-character runs averaged 223 calls for DeepSeek head and included an
extreme re-query loop. The main runs averaged 43.3 calls. This large difference should be
checked with a test that changes only the cap; it does not prove that the cap caused the
difference. Billing data is unavailable for this route.

## 5. Conclusions

Five conclusions survive across the balanced primary suite:

1. **Compact-v3 retains high interactive correctness.** Head passed 106/108 strict runs
   (98.1%) versus baseline's 107/108 (99.1%), and both passed 108/108 open runs. With only
   three repeats per task, these counts do not support a reliability ranking.
2. **Aggregate CLI stdout falls substantially.** Strict stdout dropped between 60.7% and
   91.4% across all six families (unweighted mean 79.7%). The metric is post-formatting,
   post-CLI-truncation traffic summed across calls—not DOM size, provider context, or
   serialization overhead. Ordinary snapshots have a 12,000-character per-call limit.
3. **Call counts vary by model.** In the main runs, calls were near parity for Gemini, GLM,
   and Terra, lower on head for DeepSeek, and higher on head for Sonnet and Qwen. The separate
   8,000-character runs should be followed by a test that changes only the cap.
4. **Models use the compact interface differently.** Terra and DeepSeek turned smaller output
   into lower call counts or cost; Sonnet and Qwen made more targeted inspection calls; Gemini
   and GLM stayed at or near call parity.
5. **Open-mode output was consistent on head.** With JavaScript available, all models achieved
   100% accuracy, and head CLI stdout averaged about 106 KB per six-task repeat.

The full feature set substantially reduced CLI output while keeping task completion high.
Future tests should change one feature at a time to measure bounded snapshots, continuation,
targeted find, and post-action diffs separately.

## 6. Reproducing the results

- Protocol: [`COMPREHENSIVE-RUN.md`](COMPREHENSIVE-RUN.md)
- Task definitions: [`harness/tasks.tsv`](harness/tasks.tsv)
- Grader: [`harness/grade.py`](harness/grade.py)
- Sonnet run report: [`results-2026-09-01-comprehensive-sonnet.md`](results-2026-09-01-comprehensive-sonnet.md)
- Raw runs: [`data/`](data/)

Each model directory under `data/` contains 72 JSON results, per-run CLI logs, and
`SHA256SUMS` for both the main runs (`*-interactive-nocap-v1`, plus
`sonnet-interactive-v1`) and the separate 8,000-character runs (`*-interactive-v1`).
Gateway prices are snapshots recorded in the JSON results and test harness,
not claims about future pricing. Qwen and DeepSeek are explicitly marked **billing data unavailable**.
