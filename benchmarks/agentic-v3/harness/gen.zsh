#!/bin/zsh
# gen.zsh <cond> <cell>  → prints the path to a per-cell logging wrapper.
#
# The wrapper clears the four per-page state files on its FIRST call, so every
# cell starts from a clean diff baseline and window cursor without needing a
# separate control step between runs.
#
# Env:
#   BENCH_WT_ROOT     where the condition worktrees live (default $TMPDIR/obc-bench)
#   BENCH_WRAPPER_DIR where generated wrappers go     (default $TMPDIR/obc-bench-bin)
#   BENCH_LOG_DIR     isolated log directory           (default <suite>/logs)
HERE=${0:A:h}                      # …/benchmarks/agentic-v3/harness
ROOT=${HERE:h}                     # …/benchmarks/agentic-v3
REPO=${ROOT:h:h}                   # repository root
: ${BENCH_WT_ROOT:=${TMPDIR:-/tmp}/obc-bench}
: ${BENCH_WRAPPER_DIR:=${TMPDIR:-/tmp}/obc-bench-bin}
: ${BENCH_LOG_DIR:=$ROOT/logs}
mkdir -p $BENCH_WRAPPER_DIR $BENCH_LOG_DIR

case $1 in
  v1) BIN=$BENCH_WT_ROOT/wt-v1/dist/bin/opera-browser-cli.js ;;
  v2) BIN=$BENCH_WT_ROOT/wt-v2/dist/bin/opera-browser-cli.js ;;
  main) BIN=$BENCH_WT_ROOT/wt-main/dist/bin/opera-browser-cli.js ;;
  head|v3|v4) BIN=$REPO/dist/bin/opera-browser-cli.js ;;
  *) print -u2 "gen.zsh: unknown condition '$1' — add a case arm here and in runctl.zsh"; exit 1 ;;
esac
[[ -f $BIN ]] || { print -u2 "gen.zsh: $1 is not built ($BIN missing) — run npx tsc in that worktree"; exit 1 }

W=$BENCH_WRAPPER_DIR/$1-$2
cat > $W <<WRAP
#!/bin/zsh
export OBC_BIN=$BIN
export OBC_LOG=$BENCH_LOG_DIR/$1-$2
export OPERA_CLI_SESSION=$1-$2
if [[ ! -f \$OBC_LOG.tsv ]]; then
  rm -f ~/.opera-browser-cli/last-tree.txt ~/.opera-browser-cli/prev-tree.txt \\
        ~/.opera-browser-cli/snapshot-state.json ~/.opera-browser-cli/last-url-map.json \\
        ~/.opera-browser-cli/find-state.json
fi
exec $HERE/_shim.zsh "\$@"
WRAP
chmod +x $W
echo $W
