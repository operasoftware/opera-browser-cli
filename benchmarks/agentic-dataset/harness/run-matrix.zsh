#!/bin/zsh
# run-matrix.zsh <arm> <repeats> [conditions...]
#
# Drives the whole benchmark headlessly with `claude -p`. One fresh agent per
# (condition, task, repeat) cell, strictly sequential — the CLI shares one
# browser and one state directory, so parallel cells corrupt each other.
#
#   arm        strict = agent may not use `eval` (isolates the snapshot pipeline)
#              open   = every command available (measures real-world use)
#   repeats    passes over the whole suite
#   conditions default "v1 v2 v4"
#
# Env: BENCH_MODEL (default sonnet), BENCH_MAX_TURNS (40),
#      BENCH_TASKS_FILE (default harness/tasks.tsv — point at a subset to smoke-test)
#      BENCH_WARM=0 to skip the per-cell prompt-cache warmup (default on)
#
# Writes  results/<arm>/<cond>-<task>-r<n>.json   (claude -p envelope: cost, usage, answer)
#         logs/<cond>-<task><arm-tag><n>.tsv      (one row per CLI invocation)
set -u
HERE=${0:A:h}
ROOT=${HERE:h}                      # benchmarks/agentic-dataset
ARM=${1:?arm: strict|open}
REPS=${2:?repeats}
shift 2
CONDS=(${@:-head main})
MODEL=${BENCH_MODEL:-sonnet}
MAXTURNS=${BENCH_MAX_TURNS:-40}
# Tag distinguishes arms in log filenames. Historical manual-run logs used
# "r", so strict uses "s" — two runs must never append to one log file.
TAG=$([[ $ARM == open ]] && echo e || echo s)

mkdir -p $ROOT/results/$ARM $ROOT/logs
typeset -a SLUGS TEXTS
TASKS_FILE=${BENCH_TASKS_FILE:-$HERE/tasks.tsv}
while IFS=$'\t' read -r slug text; do SLUGS+=$slug; TEXTS+=$text; done < $TASKS_FILE
# Cell identity comes from the position in the CANONICAL task list, never from
# the (possibly filtered) file being run — otherwise re-running one task writes
# into another task's log.
typeset -A CANON
ci=0
while IFS=$'\t' read -r s _rest; do (( ci++ )); CANON[$s]=$ci; done < $HERE/tasks.tsv

# The `eval` clause is the only difference between arms.
NO_EVAL='- Do not use the CLI'"'"'s `eval` command (or any other JavaScript execution) to read page content. Treat JavaScript evaluation as unavailable: everything you learn about the page must come from the CLI'"'"'s page-inspection commands. You may still use the interaction commands (click/fill/press/...) freely.
'
[[ $ARM == open ]] && NO_EVAL=''

for r in $(seq 1 $REPS); do
  # Rotate condition order each pass so no build always runs on a warm cache.
  local -a ORDER; ORDER=(${CONDS[@]})
  for ((i=1; i<r; i++)); do ORDER=(${ORDER[2,-1]} ${ORDER[1]}); done

  for cond in $ORDER; do
    print -u2 "\n=== pass $r · $cond ==="
    $HERE/runctl.zsh switch $cond || { print -u2 "bridge switch failed"; exit 1 }

    for idx in {1..$#SLUGS}; do
      slug=$SLUGS[$idx]; text=$TEXTS[$idx]
      cidx=${CANON[$slug]}
      [[ -n $cidx ]] || { print -u2 "unknown task '$slug' — add it to harness/tasks.tsv"; exit 1 }
      cell="t${cidx}${TAG}${r}"
      wrapper=$($HERE/gen.zsh $cond $cell)
      out=$ROOT/results/$ARM/$cond-$slug-r$r.json
      [[ -f $out ]] && { print -u2 "  $slug — done, skipping"; continue }

      prompt="You are testing a browser-automation CLI. Drive the browser using ONLY this exact command:

$wrapper

Hard rules:
- Never use the bare \`opera-browser-cli\` command or any other path — only the path above.
- Never use WebFetch, WebSearch, curl, or any other way of reading the page. The browser CLI is the only permitted source of page content.
${NO_EVAL}- Do not edit files, do not run git.
- Start by running \`<the path above> help\` to see what commands exist, then use them.
- Work efficiently: minimise both the number of CLI calls and the amount of output you pull into context. If output is truncated, use whatever the CLI offers for reading more rather than always asking for everything.

TASK: $text

Finish with exactly these two lines:
ANSWER: <one line>
CALLS: <how many CLI invocations you made>"

      # Warm the prompt cache immediately before the cell so every cell starts
      # from the same session-overhead baseline. A cold first call costs ~7x a
      # warm one, which would otherwise tax whichever cell happens to run first.
      if [[ ${BENCH_WARM:-1} == 1 ]]; then
        ( cd ${TMPDIR:-/tmp} && claude -p "Reply with exactly: READY" --model $MODEL \
            --allowedTools Bash --permission-mode acceptEdits --max-turns 1 \
            --output-format json ) 2>/dev/null \
          | python3 -c "import json,sys;print(json.load(sys.stdin).get('total_cost_usd',0))" \
          >> $ROOT/results/$ARM/_warmup_costs.txt 2>/dev/null
      fi

      print -u2 -n "  $slug … "
      ( cd ${TMPDIR:-/tmp} && claude -p "$prompt" --model $MODEL \
          --allowedTools Bash --permission-mode acceptEdits \
          --max-turns $MAXTURNS --output-format json ) > $out 2>$out.err
      if [[ -s $out ]]; then
        print -u2 "$(python3 -c "import json,sys;d=json.load(open('$out'));print(f\"\$ {d.get('total_cost_usd',0):.4f}  {d.get('num_turns',0)} turns\")" 2>/dev/null || echo "written")"
      else
        print -u2 "FAILED (see $out.err)"
      fi
    done
  done
done
print -u2 "\nmatrix complete → $ROOT/results/$ARM"
