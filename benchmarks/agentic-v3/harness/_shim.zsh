#!/bin/zsh
zmodload zsh/datetime
# Logging shim: records every CLI invocation (argv, exit code, output size,
# duration), then replays stdout/stderr to the caller unchanged.
# Env baked in by the generated per-cell wrapper: OBC_BIN, OBC_LOG.
#
# The .out tee is capped: a single `snapshot --full` on a large document emits
# megabytes, and across a matrix that fills the disk. The .tsv row carries the
# true byte count, so the tee only needs to be big enough to eyeball.
: ${OBC_TEE_CAP:=4096}
outf=$(mktemp); errf=$(mktemp)
t0=$EPOCHREALTIME
node "$OBC_BIN" "$@" >"$outf" 2>"$errf"; rc=$?
t1=$EPOCHREALTIME
ob=$(wc -c <"$outf" | tr -d ' '); eb=$(wc -c <"$errf" | tr -d ' ')
dur=$(( t1 - t0 ))
args=$(printf '%s' "$*" | tr '\n\t' '  ')
printf '%s\t%.2f\t%d\t%d\t%d\t%s\n' "$t0" "$dur" "$rc" "$ob" "$eb" "$args" >> "$OBC_LOG.tsv"
{
  printf '\n===== CALL rc=%d out=%dB args=%s =====\n' "$rc" "$ob" "$args"
  head -c $OBC_TEE_CAP "$outf"
  (( ob > OBC_TEE_CAP )) && printf '\n... [tee capped at %d of %d bytes]\n' $OBC_TEE_CAP $ob
  if [[ $eb -gt 0 ]]; then printf -- '----- stderr -----\n'; head -c $OBC_TEE_CAP "$errf"; fi
} >> "$OBC_LOG.out"
cat "$outf"; cat "$errf" >&2
rm -f "$outf" "$errf"
exit $rc
