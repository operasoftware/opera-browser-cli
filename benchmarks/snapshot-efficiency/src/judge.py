import json

from llm import Client

SYSTEM_PROMPT = "You are a benchmark grader evaluating whether an AI agent completed a browser automation task."

RULES = """
- PASS if the agent navigated to the correct pages AND produced a correct, complete answer
- FAIL if the agent hallucinated data without actually browsing to the page
- FAIL if the agent browsed but misinterpreted the page content
- FAIL if the agent gave a partial answer when a complete one was requested
- For error recovery tasks, PASS if the agent correctly identified the error and then recovered
- For multi-step tasks, PASS only if all steps were completed

Respond with exactly: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}
"""

TOOL_OUTPUT_CAP = 30_000


def _format_trajectory(trajectory: list[dict]) -> str:
    lines = []
    for turn in trajectory:
        for tc in turn.get("tool_calls", []):
            args = tc.get("args", "")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    pass
            lines.append(f"[tool] {tc['name']}({json.dumps(args)})")
        result = turn.get("tool_result", "")
        if result:
            if len(result) > TOOL_OUTPUT_CAP:
                result = result[:TOOL_OUTPUT_CAP] + f"\n... (truncated, {len(result)} chars total)"
            lines.append(f"[result] {result}")
        if turn.get("text"):
            lines.append(f"[agent] {turn['text']}")
    return "\n".join(lines)


def _build_prompt(task_prompt: str, trajectory: list[dict], grading_hint: str | None) -> str:
    parts = [f"TASK:\n{task_prompt.strip()}"]
    if trajectory:
        parts.append(f"AGENT TRAJECTORY:\n{_format_trajectory(trajectory)}")
    if grading_hint:
        parts.append(f"KNOWN FACTS:\n{grading_hint}")
    parts.append(f"GRADING RULES:{RULES}")
    return "\n\n".join(parts)


def grade(
    task_prompt: str,
    trajectory: list[dict],
    model: str,
    reasoning_effort: str,
    grading_hint: str | None = None,
) -> dict:
    prompt = _build_prompt(task_prompt, trajectory, grading_hint)
    client = Client(model, reasoning_effort=reasoning_effort)
    try:
        turn = client.call([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ])
        raw = turn.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].removeprefix("json")
        return json.loads(raw)
    except json.JSONDecodeError as e:
        return {"pass": False, "reason": f"judge parse error: {e}"}
    except Exception as e:
        return {"pass": False, "reason": f"judge error: {e}"}
