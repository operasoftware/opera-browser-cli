import json, os, collections, statistics as st

SESS = "/Users/ja/.claude/projects/-Users-ja-dev-opera-browser-cli/f844fcd5-f143-456f-b816-a4003a53d994/subagents"
LOGS = "/private/tmp/claude-501/-Users-ja-dev-opera-browser-cli/f844fcd5-f143-456f-b816-a4003a53d994/scratchpad/logs"

A = {
 ("v1","t1","r1"):"a01900d67d08b15fa",("v1","t2","r1"):"a11724e9d86d06d94",("v1","t3","r1"):"a749f533eda6f8205",
 ("v1","t4","r1"):"a4dac92c77aba9dcf",("v1","t5","r1"):"a57f85dca81e8da9d",("v1","t6","r1"):"a12150e6ad1d4900c",
 ("v2","t1","r1"):"af6dcfc7fa3e7ea2d",("v2","t2","r1"):"a46fe57d0e084a2ec",("v2","t3","r1"):"a4ab2c8d82fa5af0b",
 ("v2","t4","r1"):"ac9acb303f426fed8",("v2","t5","r1"):"ae83296bea7742a90",("v2","t6","r1"):"a01a08fcf52690182",
 ("v4","t1","r1"):"a2d5bfa2650347251",("v4","t2","r1"):"a9b205e651bc13e8d",("v4","t3","r1"):"afe3102ca3b45e90d",
 ("v4","t4","r1"):"a976f677ae816085f",("v4","t5","r1"):"acc865a5bc74cf8b8",("v4","t6","r1"):"a209f1ecff1fa6621",
 ("v4","t1","r2"):"a56984d83130b8cd8",("v4","t2","r2"):"a7d52ca5694ce5e02",("v4","t3","r2"):"a1fcb637e3e20e212",
 ("v4","t4","r2"):"a2db234f00a91b5f2",("v4","t5","r2"):"a6fc245b50dbe965a",("v4","t6","r2"):"aeda4f84e7af18ad9",
 ("v1","t1","r2"):"ad07850cee4eb8742",("v1","t2","r2"):"a6c0a3ab2038a9bff",("v1","t3","r2"):"a200810bbe4cf4ae5",
 ("v1","t4","r2"):"a5a9121efb44a3092",("v1","t5","r2"):"af99979826770378f",("v1","t6","r2"):"a2a1d65fe47b019a5",
 ("v2","t1","r2"):"ad009bcc59d9ce7f0",("v2","t2","r2"):"abd85102102cec690",("v2","t3","r2"):"aeeb8119a5f41f5b8",
 ("v2","t4","r2"):"af605ecfcab8eef96",("v2","t5","r2"):"ae9323967c49a983d",("v2","t6","r2"):"ad5d4fa18a5d574f8",
 ("v2","t1","r3"):"a1b3371c769709333",("v2","t2","r3"):"afd42fcb849309aca",("v2","t3","r3"):"a6b41fd8563f10320",
 ("v2","t4","r3"):"a4fa3875bec23385e",("v2","t5","r3"):"aa9695b68a846bb3f",("v2","t6","r3"):"aeec0cea6b7f34396",
 ("v4","t1","r3"):"a136b9e4f0076e846",("v4","t2","r3"):"a5805f1d6ee6ee6a2",("v4","t3","r3"):"ae1a37be1adbfa647",
 ("v4","t4","r3"):"acbccbb17aa1b1a43",("v4","t5","r3"):"a6c44617ac1918480",("v4","t6","r3"):"a5e2e301a0a74c71c",
 ("v1","t1","r3"):"ae9798c2823a560f2",("v1","t2","r3"):"a35bdd267b880b2a7",("v1","t3","r3"):"a230af40ad258cb19",
 ("v1","t4","r3"):"a70a25327588aac80",("v1","t5","r3"):"a9a6b4b5c0ef8f933",("v1","t6","r3"):"ae9fcdfbdf286a50e",
}
# Claude Sonnet 5, standard rates $/M: input, output, cache write (1.25x), cache read (0.1x)
R = (3.00, 15.00, 3.75, 0.30)

def usage(aid):
    t = collections.Counter()
    for line in open(os.path.join(SESS, f"agent-{aid}.jsonl")):
        try: d = json.loads(line)
        except: continue
        if d.get("type") != "assistant": continue
        u = (d.get("message") or {}).get("usage") or {}
        t["in"] += u.get("input_tokens", 0); t["out"] += u.get("output_tokens", 0)
        t["cw"] += u.get("cache_creation_input_tokens", 0); t["cr"] += u.get("cache_read_input_tokens", 0)
        t["turns"] += 1
    return t

def cli(c, t, r):
    p = os.path.join(LOGS, f"{c}-{t}{r}.tsv")
    calls = b = 0; cmds = []
    for line in open(p):
        f = line.rstrip("\n").split("\t")
        if len(f) < 6: continue
        calls += 1; b += int(f[3]); cmds.append(f[5])
    return calls, b, cmds

rows = []
for (c, t, r), aid in A.items():
    u = usage(aid); calls, b, cmds = cli(c, t, r)
    rows.append(dict(cond=c, task=t, rep=r, calls=calls, bytes=b, turns=u["turns"],
                     appended=u["in"]+u["cw"], cache_read=u["cr"], out=u["out"],
                     cost=(u["in"]*R[0]+u["out"]*R[1]+u["cw"]*R[2]+u["cr"]*R[3])/1e6, cmds=cmds))

def agg(c, key):
    per_rep = []
    for r in ("r1","r2","r3"):
        per_rep.append(sum(x[key] for x in rows if x["cond"]==c and x["rep"]==r))
    return per_rep

print("=== per-condition suite totals, one value per repeat (n=3) ===")
print(f"{'cond':5} {'metric':10} {'r1':>10} {'r2':>10} {'r3':>10} {'mean':>11} {'sd':>9}")
for key in ("calls","bytes","appended","cache_read","cost","turns"):
    for c in ("v1","v2","v4"):
        v = agg(c, key)
        m, sd = st.mean(v), st.stdev(v)
        fmt = "{:>10.3f}" if key=="cost" else "{:>10.0f}"
        print(f"{c:5} {key:10} " + " ".join(fmt.format(x) for x in v) + f" {m:11.3f} {sd:9.3f}")
    print()

print("=== per-task mean cost (n=3) ===")
print(f"{'task':6} {'v1':>9} {'v2':>9} {'v4':>9}   best")
for t in ("t1","t2","t3","t4","t5","t6"):
    ms = {c: st.mean([x["cost"] for x in rows if x["cond"]==c and x["task"]==t]) for c in ("v1","v2","v4")}
    best = min(ms, key=ms.get)
    print(f"{t:6} " + " ".join(f"{ms[c]:9.4f}" for c in ("v1","v2","v4")) + f"   {best}")

print("\n=== feature usage (all 18 runs per condition) ===")
for c in ("v1","v2","v4"):
    allc = [x for row in rows if row["cond"]==c for x in row["cmds"]]
    counts = {k: sum(1 for x in allc if x.startswith(k)) for k in
              ("find","chain","snapshot --next","snapshot --full","snapshot @","scroll","screenshot")}
    print(f"{c}: " + "  ".join(f"{k}={v}" for k,v in counts.items() if v))

json.dump(rows, open(os.path.join(LOGS,"rows-n3.json"),"w"), indent=1)
