import json
import time
from dataclasses import dataclass, field

from llm import Client, Turn
from tools import ToolSet

SYSTEM_PROMPT = """You are a browser automation agent. Use the provided tools to navigate the web and answer questions.

Guidelines:
- Use `navigate` to open URLs
- Use `snapshot` to re-read the current page if needed
- Use `click` on element refs (e.g. @1.5) shown in snapshots to follow links
- Use `go_back` to return to the previous page
- When you have enough information, reply with your final answer directly (no tool call)
- Be concise and factual — only report what you observed in the page
"""

MAX_TURNS = 20
SNAPSHOT_TOOLS: frozenset[str] = frozenset({"navigate", "snapshot", "click", "go_back"})


@dataclass
class AgentResult:
    answer: str
    input_tokens: int
    output_tokens: int
    trajectory: list[dict]
    snapshot_chars: list[int]
    tool_call_count: int
    wall_clock_seconds: float
    error: str | None = None

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class AgentState:
    input_tokens: int = 0
    output_tokens: int = 0
    trajectory: list[dict] = field(default_factory=list)
    snapshot_chars: list[int] = field(default_factory=list)
    tool_call_count: int = 0
    start: float = field(default_factory=time.monotonic)
    error: str | None = None
    answer: str = ""

    def update(self, turn: Turn, turn_index: int, tool_results: dict | None = None) -> None:
        self.input_tokens += turn.input_tokens
        self.output_tokens += turn.output_tokens

        if tool_results is None:
            self.answer = turn.text
            self.trajectory.append({"turn": turn_index, "tool_calls": [], "text": turn.text})
            return

        self.tool_call_count += len(turn.tool_calls)
        for tc in turn.tool_calls:
            if tc.name in SNAPSHOT_TOOLS:
                self.snapshot_chars.append(len(tool_results[tc.call_id]))
        for tc in turn.tool_calls:
            self.trajectory.append(
                {
                    "turn": turn_index,
                    "tool_calls": [{"name": tc.name, "args": tc.arguments}],
                    "tool_result": tool_results.get(tc.call_id, ""),
                    "text": turn.text,
                }
            )

    def to_result(self) -> AgentResult:
        return AgentResult(
            answer=self.answer,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            trajectory=self.trajectory,
            snapshot_chars=self.snapshot_chars,
            tool_call_count=self.tool_call_count,
            wall_clock_seconds=round(time.monotonic() - self.start, 1),
            error=self.error,
        )


def run_agent(
    task_prompt: str,
    tool_set: ToolSet,
    model: str,
    reasoning_effort: str,
) -> AgentResult:
    client = Client(model, reasoning_effort)
    inputs: list = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": task_prompt},
    ]

    state = AgentState()

    try:
        for _turn in range(MAX_TURNS):
            turn = client.call(inputs, tools=tool_set.definitions)
            inputs.extend(turn.output_items)

            if not turn.tool_calls:
                state.update(turn, _turn)
                break

            tool_results = {}
            for tc in turn.tool_calls:
                args = json.loads(tc.arguments)
                tool_results[tc.call_id] = tool_set.dispatch(tc.name, args)
                inputs.append(
                    {
                        "type": "function_call_output",
                        "call_id": tc.call_id,
                        "output": tool_results[tc.call_id],
                    }
                )

            state.update(turn, _turn, tool_results)
        else:
            state.error = f"Reached max turns ({MAX_TURNS}) without final answer"

    except Exception as e:
        state.error = str(e)

    return state.to_result()
