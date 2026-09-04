# Test plan — `opera-browser-cli` vs `chrome-devtools-mcp` cost comparison

**Branch:** `bench/chrome-devtools-mcp-cost` (branched from `main` @ `ab5a717`,
opera-browser-cli v0.1.51, after fast-forwarding `main` to `origin/main`).

## 1. Objective

Measure the **agentic cost** of completing the same six browser tasks through two
browser-automation interfaces, and nothing else:

| Condition | Tool | Agent-facing interface |
|---|---|---|
| `obc` | `opera-browser-cli` @ `main` (this branch's `src/`) | a single CLI command the agent calls through the Bash tool |
| `cdt` | `chrome-devtools-mcp` @ pinned version | an MCP server the agent calls through MCP tools (`navigate_page`, `click`, `fill`, `take_snapshot`, `evaluate_script`, …) |

"Cost" here is the **provider-billed LLM token cost** of the agent solving the task,
including prompt-cache creation and cache-read buckets. Neither tool carries a usage fee
for this benchmark; `opera-browser-cli` is internal and `chrome-devtools-mcp` is Google's
open-source MCP server. The comparison is therefore about **which tool surface makes the
same agent burn more or fewer tokens to solve the same task**.

We deliberately compare a CLI shell command against an MCP tool surface: in real agentic
flows the agent does not care which transport a tool uses — it cares how many calls and how
much context each step costs.

## 2. Reused benchmark

Port of `benchmarks/agentic-v3/` from `feat/compact-v3`. The task set, pinned answers,
agent prompt, strict/open arms, and analysis tooling are unchanged so the existing
`main`-vs-`head` results remain comparable as a reference point.

- **Tasks:** `harness/tasks.tsv` — `rfc-deep-read`, `spa-todomvc`, `web-form`,
  `table-extract`, `wiki-journey`, `shop-navigate`.
- **Pinned answers:** `harness/grade.py` (`PINS`) and `suite.md`.
- **Arms:**
  - `strict` — page JavaScript execution is forbidden.
    - `obc`: forbid the CLI `eval` command.
    - `cdt`: forbid `evaluate_script` (and any other script-evaluation MCP tool).
  - `open` — the full tool surface is available.
- **Repeats:** 3 per cell, condition order rotated per repeat (as today).

The `strict` arm is what isolates the *inspection* interface (snapshot/accessibility tree
and action tools). Without it, capable agents `eval`/`evaluate_script` their way to every
answer and both interfaces collapse to the same result, which is exactly the P-1 finding
already documented in `suite.md`.

## 3. Model matrix

Use the **same six model families** as the branch's latest benchmark result
(`model-family-browser-agents-whitepaper.md`):

| Family | Route / reported model | Driver | Cost status |
|---|---|---|---|
| Anthropic | `claude-sonnet-5` (firstParty) | **Claude Code only** | cache-aware billed estimate |
| OpenAI | `openai/gpt-5.6-terra` | direct Responses API | gateway price snapshot |
| Google | `pc_browser/vertex_ai/gemini-3.5-flash` | direct Responses API | gateway price snapshot |
| Zhipu | `dashscope/glm-5.2` | direct Responses API | gateway price snapshot |
| Qwen | `opera-internal/Qwen/Qwen3.8-27B` | direct Responses API | billing data unavailable |
| DeepSeek | `opera-internal/deepseek-ai/DeepSeek-V4-Flash` | direct Responses API | billing data unavailable |

Do not import the dollar figures from the old study — those were `main` vs `head` on a
different branch. Only the **model identities/routes** transfer; every number in this
comparison is a fresh run under the protocol below.

## 4. Anthropic cost and caching — critical constraint

**For the Anthropic family, the run must go through Claude Code, not pi (or any other
driver/agent harness).**

Claude Code is the only driver in this setup that reports Anthropic's prompt-cache
**creation** and **read** token buckets and the resulting cache-aware billed cost in its
JSON output (`total_cost_usd`, `usage` with `cache_creation_input_tokens` and
`cache_read_input_tokens`). pi and direct API drivers do not surface those buckets
reliably, so an Anthropic run through pi would under-report both caching behaviour and the
true billed cost. Concretely:

- Operate Claude Code with `--output-format json` and capture the envelope, exactly as
  `run-matrix.zsh` already does.
- **Acceptance gate before the full matrix:** inspect one smoke cell and confirm the JSON
  identifies `claude-sonnet-5` and that the cache creation/read fields are populated; if
  they are missing or zero while the run clearly used a prompt, stop and fix the driver
  rather than continuing.

Non-Anthropic families keep the direct LiteLLM/Responses-API driver (`harness/agent.py`),
which prices tokens from the gateway's per-token rates and records them in the same JSON
shape. Qwen and DeepSeek remain **billing data unavailable**; report them by tokens, calls,
turns, output bytes, and accuracy — never impute a dollar figure.

## 5. Matrix and run protocol

2 conditions × 2 arms × 6 tasks × 3 repeats × 6 model families = **432 runs**, mirroring the
balanced study. Budget and wall-time scale accordingly (the previous 432-run study is the
reference; the `cdt` arm may be slower per cell depending on the MCP server).

1. **One browser for the whole suite.** Both conditions drive the same Chromium/Chrome
   instance via CDP (`chrome-devtools-mcp` connects with `--browser-url` to the same
   `--remote-debugging-port` the CLI attaches to). Do not switch browser engines between
   conditions.
2. **Sequential only.** Never run two cells concurrently; both interfaces share the browser,
   and concurrency corrupts diff baselines / page state (same invariant as the original
   suite).
3. **State reset per cell.** For `obc`, reset the CLI per-page state files and park on
   `about:blank` (the `gen.zsh` wrapper already does this). For `cdt`, reset equivalently:
   navigate to `about:blank`, close extra pages/targets, and clear any per-cell scratch.
4. **Prompt-cache warm-up** before every Anthropic cell, identical to `run-matrix.zsh`'s
   warm-up step.
5. **Condition isolation.** Give `obc` and `cdt` separate session identifiers and separate
   result/log directories so no log file is appended by two cells.
6. **Pin everything and record it** in the result report: repository HEAD and baseline
   commit, `chrome-devtools-mcp` version/SHA, Claude Code version, model identities, browser
   build, warm-up procedure, gateway price source.

## 6. Measurements

Per task, condition, arm, and repeat:

- pinned-answer accuracy and error/timeout status;
- model turns and tool-call count;
- tool-call duration and raw result bytes — for `obc` the existing `_shim.zsh` TSV records
  argv/exit/bytes/duration; for `cdt` build an equivalent MCP shim that records tool name,
  arguments, result byte size, duration, and error/isError flag (there is no exit code);
- fresh input, cache-write, cache-read, and output tokens, from the driver JSON;
- provider-reported cost, from the driver JSON;
- tool/command mix (`eval`/`evaluate_script`, snapshot reads, navigation, fills, etc.);
- mean, standard deviation, and failure tails.

The **primary comparison is `obc` vs `cdt` within a model**, never absolute cross-model
totals, because tokenization, caching, and context handling differ across drivers (this is
the same rule the existing whitepaper enforces).

Raw tool-output bytes remain a *secondary* signal: they are the causal driver of context
growth but are not the model's exact context, and each interface formats differently
(CLI text vs MCP accessibility snapshot). Treat cost/tokens as the headline metric and
bytes as the supporting explanation.

## 7. Implementation work required (this branch)

The suite currently only understands CLI conditions. Porting it to a second transport needs:

1. **`cdt` condition arm** — a `runctl.zsh`-style `switch cdt` that starts
   `chrome-devtools-mcp` (stdio MCP server) pointed at the shared browser's debug port, and
   a `reset cdt` that clears browser state. Pin the server version.
2. **MCP logging shim** — the `cdt` analogue of `_shim.zsh`/`gen.zsh`, recording each MCP
   tool call into a per-cell TSV (tool, arguments, result bytes, duration, error flag) so
   the two conditions produce comparable instrument logs.
3. **Claude Code MCP arm** — run the `cdt` Anthropic cells with
   `claude -p --mcp-config`/`.mcp.json` pointing at the pinned server, still with
   `--output-format json` and the same prompt/arms, so Claude Code's cache accounting is
   present for both conditions.
4. **Non-Anthropic MCP arm** — extend `harness/agent.py` so it can expose MCP tools to the
   model (MCP stdio client) as an alternative to the single `bash` tool, recording usage
   exactly as today.
5. **Grader/analyser** — extend `grade.py`/`analyze-matrix.py` to read the `cdt` log shape
   and the MCP tool-result byte counts.

## 8. Acceptance / definition of "done"

- All 432 cells completed and saved; smoke gate from §4 passed before the full matrix.
- Accuracy graded from pinned answers for both conditions.
- Cost table published as `obc` vs `cdt` per model, per arm, with cache breakdowns and the
  caveats above (`billing data unavailable` where applicable).
- A short result report records the versions, prices, warm-up procedure, and the
  per-condition mean/sd cost, calls, turns, and output bytes.
- If the Anthropic run was produced by anything other than Claude Code, the cost/caching
  columns are treated as invalid and the run is redone.

## 9. Risks and confounds

- **Tool granularity mismatch** — a CLI invocation is often a compound action (open page +
  snapshot), while MCP exposes finer tools, which can inflate `cdt` call counts without
  changing token cost. Keep call count as context, not the headline.
- **Default result-size mismatch** — the CLI applies its own per-call snapshot limits;
  `chrome-devtools-mcp`'s `take_snapshot` has its own size/format. This is part of the
  interface being measured; do not add a harness cap (`TOOL_CAP=0`) in the main runs.
- **`strict` semantics** — `eval` (one CLI command) and `evaluate_script` (one MCP tool)
  are the analogues, but chrome-devtools-mcp leans on scripting more than the CLI. Verify
  the `cdt` strict prompt visibly forbids it so the arm really measurs the inspection path.
- **Browser must be constant** — a different Chrome/Opera build or a different debug-port
  setup between conditions would confound timings and snapshots; use one browser and pin it.
- **Provider cache-reporting gaps** — Gemini/GLM/Qwen/DeepSeek routes may report cache reads
  but no cache-write bucket; record that as a provider difference, not a finding.