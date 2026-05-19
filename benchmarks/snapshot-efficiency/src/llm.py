from dataclasses import dataclass

import openai


@dataclass
class Turn:
    text: str
    tool_calls: list  # raw function_call items from response.output
    output_items: list  # model_dump'd, ready to extend next input
    input_tokens: int
    output_tokens: int


def _to_input_item(item) -> dict:
    # status is an output-only field; the API rejects it when fed back as input
    d = item.model_dump()
    d.pop("status", None)
    return d


class Client:
    def __init__(self, model: str, reasoning_effort: str = "medium"):
        self._api = openai.OpenAI()
        self._model = model
        self._reasoning_effort = reasoning_effort

    def call(self, input_items: list, tools: list | None = None) -> Turn:
        response = self._api.responses.create(  # type: ignore[call-overload]
            model=self._model,
            reasoning={"effort": self._reasoning_effort},
            input=input_items,
            tools=tools or [],
        )

        text_parts: list[str] = []
        tool_calls: list = []
        for item in response.output:
            if item.type == "function_call":
                tool_calls.append(item)
            elif item.type == "message":
                for block in item.content:
                    if hasattr(block, "text"):
                        text_parts.append(block.text)

        return Turn(
            text=" ".join(text_parts),
            tool_calls=tool_calls,
            output_items=[_to_input_item(item) for item in response.output],
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )
