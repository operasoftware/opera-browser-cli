#!/usr/bin/env python3
"""
agent.py — a single-cell agent driver that talks DIRECTLY to the LiteLLM gateway.

Replaces `claude -p` for non-Anthropic models, where Claude Code's cost accounting
is not trustworthy. Computes cost from the gateway's own per-token prices for the
requested model (input / output / cache-read / cache-write), so the reported
total_cost_usd is the *gateway* figure, not claude's estimate.

It speaks the OpenAI **Responses API** (/v1/responses), which supports function
tool-calling for gpt-5.6-luna. The only tool provided is `bash`, which runs the
browser-CLI command the model asks for (through gen.zsh's per-cell wrapper so the
shim still logs every call).

Usage:
    agent.py --model MODEL --prompt FILE --wrapper WRAP [--max-turns N] \
             [--prices input,output,cache-read,cache-write]
        writes one JSON envelope to stdout. Prices are USD per token.

Env:
    LITELLM_BASE_URL / OPENAI_BASE_URL  gateway base (default https://litellm.ai-gateway...)
    LITELLM_API_KEY  gateway key
"""

import argparse
import json
import os
import socket
import ssl
import subprocess
import time
import urllib.request

BASE = (
    os.environ.get("OPENAI_BASE_URL") or os.environ.get("LITELLM_BASE_URL") or "https://litellm.ai-gateway.service.osa"
)
BASE = BASE.rstrip("/")
KEY = os.environ.get("LITELLM_API_KEY", "")
URL = BASE + "/v1/responses"
_CTX = ssl._create_unverified_context()  # internal gateway uses a private CA

# Default gateway prices (USD per token) for openai/gpt-5.6-luna:
# input, output, cache_read, cache_write.
PRICES = {
    "openai/gpt-5.6-luna": (2.0e-7, 1.2e-6, 2.0e-8, 2.5e-7),
    "openai/gpt-5.6-terra": (2.0e-6, 1.2e-5, 2.0e-7, 2.5e-6),
    "pc_browser/vertex_ai/claude-sonnet-5": (2.0e-6, 1.0e-5, 2.0e-7, 2.5e-6),
    "pc_browser/vertex_ai/gemini-3.5-flash": (1.35e-6, 8.1e-6, 1.35e-7, 0.0),
    "dashscope/glm-5.2": (1.4e-6, 4.4e-6, 2.8e-7, 0.0),
    # Billing data is unavailable for these routes. Zero is a reporting placeholder,
    # not evidence that the models are free; omit them from dollar comparisons.
    "opera-internal/deepseek-ai/DeepSeek-V4-Flash": (0.0, 0.0, 0.0, 0.0),
    "opera-internal/Qwen/Qwen3.8-27B": (0.0, 0.0, 0.0, 0.0),
}

# OpenAI's >272K rates apply to the whole request, not just tokens above the threshold.
PRICE_TIERS = {
    "openai/gpt-5.6-terra": (272_000, (4.0e-6, 1.8e-5, 4.0e-7, 5.0e-6)),
}

# No harness-level truncation by default. The browser CLI's command-specific output
# contract is the experimental interface and must reach the model unchanged. TOOL_CAP is
# retained only for explicitly labelled sensitivity runs (for example, the archived 8K run).
TOOL_CAP = int(os.environ.get("TOOL_CAP", "0"))


def http_post(body):
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    )
    # Retry transient transport-level failures (SSL timeout, connection reset, 5xx, 429)
    # with short backoff so a slow gateway round-trip on a heavy cell doesn't kill
    # the whole matrix. HTTP-level 4xx errors (bad request/auth) other than 429 are NOT retried.
    last = None
    for attempt in range(6):
        try:
            r = urllib.request.urlopen(req, timeout=300, context=_CTX)
            return json.load(r)
        except urllib.error.HTTPError as e:
            body_snippet = e.read().decode()[:600]
            if (e.code >= 500 or e.code == 429) and attempt < 5:
                last = (e.code, body_snippet)
                time.sleep(4 * (attempt + 1))
                continue
            return {"__http_error__": e.code, "__body__": body_snippet}
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, ssl.SSLError, OSError) as e:
            last = repr(e)
            if attempt < 5:
                time.sleep(4 * (attempt + 1))
                continue
    return {"__http_error__": "transport-after-retries", "__body__": repr(last)}


def run_bash(command: str) -> str:
    """Run the per-cell wrapper command, applying TOOL_CAP only when configured."""
    try:
        p = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=300)
        out = (p.stdout or "") + ("\n[stderr]\n" + p.stderr if p.stderr else "")
    except subprocess.TimeoutExpired:
        out = "[bash timed out after 300s]"
    except Exception as e:  # noqa: BLE001
        out = f"[bash error] {e}"
    if TOOL_CAP > 0 and len(out) > TOOL_CAP:
        out = out[:TOOL_CAP] + f"\n... [harness capped at {TOOL_CAP} chars]"
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--prompt", required=True, help="path to a file with the task prompt")
    ap.add_argument("--wrapper", required=True, help="per-cell CLI wrapper path")
    ap.add_argument("--max-turns", type=int, default=40)
    ap.add_argument(
        "--prices",
        help="USD/token rates: input,output,cache-read,cache-write; required for unknown models",
    )
    args = ap.parse_args()

    content = open(args.prompt).read()
    if "\x00" in content:
        system, task = content.split("\x00", 1)
    else:
        system, task = content, "Begin."

    tools = [
        {
            "type": "function",
            "name": "bash",
            "description": "Run a shell command against the browser CLI (or any command). "
            "Returns stdout and stderr.",
            "parameters": {"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]},
        }
    ]

    inp = [{"role": "system", "content": system}, {"role": "user", "content": task}]

    # Model identity + prices. Never silently assign another model's price sheet.
    model = args.model
    if args.prices:
        try:
            prices = tuple(float(value) for value in args.prices.split(","))
        except ValueError as exc:
            ap.error(f"invalid --prices: {exc}")
        if len(prices) != 4:
            ap.error("--prices requires input,output,cache-read,cache-write")
        price_source = "--prices"
    elif model in PRICES:
        prices = PRICES[model]
        price_source = "built-in gateway price snapshot"
    else:
        ap.error(f"no price sheet for {model}; pass --prices")
    pin, pout, pcr, pcw = prices

    reasoning_effort = os.environ.get("BENCH_REASONING_EFFORT", "none").strip()

    def step(inp_):
        body = {"model": model, "input": inp_, "tools": tools}
        if reasoning_effort:
            body["reasoning"] = {"effort": reasoning_effort}
        return http_post(body)

    total_in = total_out = total_cr = total_cw = 0
    cost_parts = {"fresh_input": 0.0, "out": 0.0, "cache_read": 0.0, "cache_write": 0.0}
    turns = 0
    final_text = ""
    is_error = False
    calls = 0
    for turns in range(1, args.max_turns + 1):
        d = step(inp)
        if "__http_error__" in d or not d.get("status"):
            is_error = True
            final_text = (final_text or "") + f"\n[agent error] {d.get('__body__', d)}"
            # record what we can from partial usage
            break
        u = d.get("usage") or {}
        turn_in = u.get("input_tokens", 0)
        turn_out = u.get("output_tokens", 0)
        det = u.get("input_tokens_details") or {}
        turn_cr = det.get("cached_tokens", 0)
        turn_cw = det.get("cache_write_tokens", 0)
        total_in += turn_in
        total_out += turn_out
        total_cr += turn_cr
        total_cw += turn_cw

        turn_prices = prices
        tier = PRICE_TIERS.get(model)
        if not args.prices and tier and turn_in > tier[0]:
            turn_prices = tier[1]
        turn_pin, turn_pout, turn_pcr, turn_pcw = turn_prices
        turn_fresh = max(0, turn_in - turn_cr - turn_cw)
        cost_parts["fresh_input"] += turn_fresh * turn_pin
        cost_parts["out"] += turn_out * turn_pout
        cost_parts["cache_read"] += turn_cr * turn_pcr
        cost_parts["cache_write"] += turn_cw * turn_pcw

        fcs = [it for it in d.get("output", []) if it.get("type") == "function_call"]
        for it in d.get("output", []):
            if it.get("type") == "message":
                txt = "".join((c.get("text") or "") for c in it.get("content", []) if c.get("type") == "output_text")
                final_text = txt
                inp.append(it)  # carry the assistant message into the next turn
            elif it.get("type") == "function_call":
                cmd = it.get("arguments") or ""
                # arguments come back as a JSON string like {"command":"..."}
                try:
                    cmd = (json.loads(cmd) or {}).get("command", cmd)
                except (ValueError, TypeError):
                    pass
                calls += 1
                out = run_bash(cmd)
                inp.append(it)
                inp.append({"type": "function_call_output", "call_id": it["call_id"], "output": out})
            else:
                inp.append(it)  # reasoning, etc. — pass through
        if not fcs:
            break
    else:
        is_error = True  # hit max turns

    # Responses API input_tokens includes cached and cache-created tokens. Those buckets
    # use their own rates instead of also being charged as fresh input.
    cost = sum(cost_parts.values())
    envelope = {
        "model": model,
        "driver": "agent.py (direct gateway, Responses API)",
        "run_config": {
            "tool_cap_chars": TOOL_CAP or None,
            "max_turns": args.max_turns,
            "reasoning_effort": reasoning_effort or None,
            "prices_usd_per_token": {
                "input": pin,
                "output": pout,
                "cache_read": pcr,
                "cache_write": pcw,
            },
            "price_source": price_source,
        },
        "total_cost_usd": cost,
        "num_turns": turns,
        "calls": calls,
        "is_error": bool(is_error),
        "result": final_text,
        "usage": {
            "input_tokens": total_in,
            "output_tokens": total_out,
            "cache_read_input_tokens": total_cr,
            "cache_creation_input_tokens": total_cw,
        },
        "cost_breakdown": cost_parts,
    }
    print(json.dumps(envelope))


if __name__ == "__main__":
    main()
