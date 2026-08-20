import json, os, glob, collections

SESS = "/Users/ja/.claude/projects/-Users-ja-dev-opera-browser-cli/f844fcd5-f143-456f-b816-a4003a53d994/subagents"
LOGS = "/private/tmp/claude-501/-Users-ja-dev-opera-browser-cli/f844fcd5-f143-456f-b816-a4003a53d994/scratchpad/logs"

RUNS = {  # (task, cond) -> agent id
 ("t1","v1"):"aca642381ef78b530", ("t1","v2"):"a0809c5702d8074b6", ("t1","v3"):"a1e954c7abf626619",
 ("t2","v1"):"a8b8515dd58520ba7", ("t2","v2"):"ab90e04fd20bb9ec6", ("t2","v3"):"a0d9d19ef5e10fbcc",
 ("t3","v1"):"ab57602d4554d8f2e", ("t3","v2"):"a747753c6b1f6846f", ("t3","v3"):"abff34c155e9f26f7",
 ("t4","v1"):"ae85944fa1e7131a2", ("t4","v2"):"a553da1d5c56e8b5c", ("t4","v3"):"ae3eaa382e1344a5d",
 ("t5","v1"):"aae43b4eeeb52a121", ("t5","v2"):"a6357b1cc8db8eaa1", ("t5","v3"):"a2f9aa30a1d9c8938",
 ("t6","v1"):"a1e6e567a261c4276", ("t6","v2"):"a04c866eb6a47255a", ("t6","v3"):"a147608d72458764f",
}
# Haiku 4.5 rates, $/M tokens
RATE_IN, RATE_OUT, RATE_CW, RATE_CR = 1.00, 5.00, 1.25, 0.10

def usage_for(agent_id):
    path = os.path.join(SESS, f"agent-{agent_id}.jsonl")
    tot = collections.Counter()
    if not os.path.exists(path):
        return None
    for line in open(path):
        try: d = json.loads(line)
        except: continue
        if d.get("type") != "assistant": continue
        u = (d.get("message") or {}).get("usage") or {}
        tot["in"] += u.get("input_tokens", 0)
        tot["out"] += u.get("output_tokens", 0)
        tot["cw"] += u.get("cache_creation_input_tokens", 0)
        tot["cr"] += u.get("cache_read_input_tokens", 0)
        tot["turns"] += 1
    return tot

def cli_for(task, cond):
    p = os.path.join(LOGS, f"{cond}-{task}.tsv")
    calls, out_b, dur, fails = 0, 0, 0.0, 0
    cmds = []
    if os.path.exists(p):
        for line in open(p):
            f = line.rstrip("\n").split("\t")
            if len(f) < 6: continue
            calls += 1; dur += float(f[1]); out_b += int(f[3])
            if f[2] != "0": fails += 1
            cmds.append(f[5])
    return calls, out_b, dur, fails, cmds

rows = []
for (task, cond), aid in sorted(RUNS.items()):
    u = usage_for(aid)
    calls, out_b, dur, fails, cmds = cli_for(task, cond)
    cost = (u["in"]*RATE_IN + u["out"]*RATE_OUT + u["cw"]*RATE_CW + u["cr"]*RATE_CR)/1e6 if u else 0
    appended = (u["in"] + u["cw"]) if u else 0
    rows.append(dict(task=task, cond=cond, calls=calls, out_b=out_b, cli_s=dur, fails=fails,
                     appended=appended, cache_read=u["cr"] if u else 0, out_tok=u["out"] if u else 0,
                     turns=u["turns"] if u else 0, cost=cost, cmds=cmds))

print(f"{'task':5} {'cond':5} {'cli':>4} {'out_bytes':>10} {'cli_s':>7} {'appended':>9} {'cache_rd':>9} {'out_tok':>8} {'turns':>6} {'cost$':>8}")
for r in rows:
    print(f"{r['task']:5} {r['cond']:5} {r['calls']:4d} {r['out_b']:10d} {r['cli_s']:7.1f} {r['appended']:9d} {r['cache_read']:9d} {r['out_tok']:8d} {r['turns']:6d} {r['cost']:8.4f}")

print("\n--- totals by condition ---")
print(f"{'cond':5} {'cli':>4} {'out_bytes':>10} {'cli_s':>7} {'appended':>9} {'cache_rd':>10} {'out_tok':>8} {'turns':>6} {'cost$':>8}")
for cond in ("v1","v2","v3"):
    rs = [r for r in rows if r["cond"] == cond]
    print(f"{cond:5} {sum(r['calls'] for r in rs):4d} {sum(r['out_b'] for r in rs):10d} "
          f"{sum(r['cli_s'] for r in rs):7.1f} {sum(r['appended'] for r in rs):9d} "
          f"{sum(r['cache_read'] for r in rs):10d} {sum(r['out_tok'] for r in rs):8d} "
          f"{sum(r['turns'] for r in rs):6d} {sum(r['cost'] for r in rs):8.4f}")

json.dump(rows, open(os.path.join(LOGS, "rows.json"), "w"), indent=1)
