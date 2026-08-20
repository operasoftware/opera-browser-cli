#!/bin/zsh
# runctl.zsh switch <cond> | reset <cond>
#
#   switch  kill any bridge, start the condition's own bridge, verify it serves
#   reset   clear per-page CLI state (cells do this themselves; kept for manual use)
#
# Never lets two bridges race: a loser that fails to bind used to delete the
# winner's PID file, 401-ing every client against a healthy bridge.
HERE=${0:A:h}
ROOT=${HERE:h}
REPO=${ROOT:h:h}
: ${BENCH_WT_ROOT:=${TMPDIR:-/tmp}/obc-bench}
: ${OPERA_CLI_PORT:=9225}
STATE=~/.opera-browser-cli

binfor() {
  case $1 in
    head) echo $REPO/dist/bin/opera-browser-cli.js ;;
    main) echo $BENCH_WT_ROOT/wt-main/dist/bin/opera-browser-cli.js ;;
    *) print -u2 "runctl: unknown condition '$1'"; exit 1 ;;
  esac
}
clearstate() {
  rm -f $STATE/last-tree.txt $STATE/prev-tree.txt $STATE/snapshot-state.json \
        $STATE/last-url-map.json $STATE/find-state.json
}

case $1 in
  switch)
    BIN=$(binfor $2); BR=${BIN:h}/opera-browser-cli-bridge.js
    [[ -f $BR ]] || { print -u2 "runctl: $2 is not built ($BR missing)"; exit 1 }
    for attempt in 1 2 3; do
      lsof -ti :$OPERA_CLI_PORT 2>/dev/null | xargs kill -9 2>/dev/null
      for i in $(seq 1 20); do sleep 1; lsof -ti :$OPERA_CLI_PORT >/dev/null 2>&1 || break; done
      rm -f $STATE/bridge.pid $STATE/bridge-$OPERA_CLI_PORT.pid; clearstate
      nohup node $BR >> $STATE/bridge.log 2>&1 &
      disown
      for i in $(seq 1 40); do
        sleep 1
        [[ -f $STATE/bridge.pid || -f $STATE/bridge-$OPERA_CLI_PORT.pid ]] && break
      done
      if node $BIN open about:blank >/dev/null 2>&1; then
        clearstate; echo "switched to $2 (attempt $attempt)"; exit 0
      fi
      print -u2 "runctl: attempt $attempt failed, retrying"
    done
    print -u2 "FAILED to start $2 bridge"; exit 1
    ;;
  reset)
    clearstate; node $(binfor $2) open about:blank >/dev/null 2>&1; clearstate; echo "reset ok"
    ;;
  *) print -u2 "usage: runctl.zsh switch|reset <cond>"; exit 1 ;;
esac
