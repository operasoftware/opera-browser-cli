import json
import subprocess
from dataclasses import dataclass, field

import requests
from utils import snapshot_chars


@dataclass
class ToolCallRecord:
    tool_name: str
    args: dict
    result: str
    snapshot_chars: int = 0
    error: str | None = None


@dataclass
class ToolSet:
    condition_id: str
    definitions: list[dict]  # OpenAI tool schemas
    records: list[ToolCallRecord] = field(default_factory=list)

    def dispatch(self, name: str, args: dict) -> str:
        raise NotImplementedError

    @property
    def all_errored(self) -> bool:
        """True if every tool call returned an error — indicates the tool is not installed/running."""
        return bool(self.records) and all(r.result.startswith("[error:") for r in self.records)


# ---------------------------------------------------------------------------
# CLI-mode tool set (opera-compact, opera-raw, axi)
# ---------------------------------------------------------------------------


class CLIToolSet(ToolSet):
    def __init__(self, condition_id: str, cli_bin: str, raw: bool = False):
        self.cli_bin = cli_bin
        self.raw = raw
        super().__init__(condition_id=condition_id, definitions=_CLI_SCHEMA)

    def _run(self, *args: str, timeout: int = 60) -> str:
        cmd = [self.cli_bin, *args]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            output = result.stdout
            if result.returncode != 0 and not output:
                output = result.stderr or f"[exit {result.returncode}]"
            return output.strip()
        except subprocess.TimeoutExpired:
            return f"[timeout after {timeout}s]"
        except FileNotFoundError:
            return f"[error: {self.cli_bin} not found in PATH]"

    def dispatch(self, name: str, args: dict) -> str:
        extra = (["--raw"] if self.raw and name in ("navigate", "snapshot", "click", "go_back") else []) + (
            ["--full"] if args.get("full") and name in ("navigate", "snapshot") else []
        )

        match name:
            case "navigate":
                result = self._run("open", args.get("url", ""), *extra)
            case "snapshot":
                result = self._run("snapshot", *extra)
            case "click":
                result = self._run("click", args.get("ref", ""), *extra)
            case "go_back":
                result = self._run("back", *extra)
            case _:
                result = f"[unknown tool: {name}]"

        record = ToolCallRecord(
            tool_name=name,
            args=args,
            result=result,
            snapshot_chars=(snapshot_chars(result) if name in ("navigate", "snapshot", "click", "go_back") else 0),
        )
        self.records.append(record)
        return result


# ---------------------------------------------------------------------------
# Bridge-mode tool set (mcp-raw)
# ---------------------------------------------------------------------------

# Default bridge URL — matches opera-browser-cli's default port (OPERA_CLI_PORT).
# Override via bridge_url in conditions.yaml.
DEFAULT_BRIDGE_URL = "http://localhost:9224"


class BridgeToolSet(ToolSet):
    def __init__(self, condition_id: str, bridge_url: str = DEFAULT_BRIDGE_URL):
        self.bridge_url = bridge_url.rstrip("/")
        self.session = requests.Session()
        super().__init__(condition_id=condition_id, definitions=_CLI_SCHEMA)

    def _call(self, tool_name: str, tool_args: dict) -> str:
        try:
            resp = self.session.post(
                f"{self.bridge_url}/call",
                json={"name": tool_name, "args": tool_args},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            # MCP result: {"result": [...content items...]}
            result = data.get("result", data)
            if isinstance(result, list):
                parts = []
                for item in result:
                    if isinstance(item, dict) and item.get("type") == "text":
                        parts.append(item["text"])
                    elif isinstance(item, dict):
                        parts.append(json.dumps(item))
                    else:
                        parts.append(str(item))
                return "\n".join(parts)
            return json.dumps(result)
        except requests.exceptions.ConnectionError:
            return "[error: bridge not running — start with: opera-browser-cli start]"
        except Exception as e:
            return f"[error: {e}]"

    def dispatch(self, name: str, args: dict) -> str:
        match name:
            case "navigate":
                result = self._call(
                    "navigate_page",
                    {"url": args.get("url", ""), "includeSnapshot": True},
                )
            case "snapshot":
                result = self._call("take_snapshot", {})
            case "click":
                result = self._call("click", {"uid": args.get("ref", ""), "includeSnapshot": True})
            case "go_back":
                result = self._call("navigate_page", {"url": "back", "includeSnapshot": True})
            case _:
                result = f"[unknown tool: {name}]"

        record = ToolCallRecord(
            tool_name=name,
            args=args,
            result=result,
            snapshot_chars=snapshot_chars(result),
        )
        self.records.append(record)
        return result


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def make_tool_set(condition: dict) -> ToolSet:
    mode = condition["tool_mode"]
    cid = condition["id"]
    if mode == "cli":
        return CLIToolSet(
            condition_id=cid,
            cli_bin=condition["cli_bin"],
            raw=condition.get("raw", False),
        )
    elif mode == "bridge":
        return BridgeToolSet(
            condition_id=cid,
            bridge_url=condition.get("bridge_url", DEFAULT_BRIDGE_URL),
        )
    else:
        raise ValueError(f"Unknown tool_mode: {mode}")


# ---------------------------------------------------------------------------
# OpenAI tool schemas (same for all conditions)
# Responses API (/v1/responses) uses flat tool format — no nested "function" key
# ---------------------------------------------------------------------------

_CLI_SCHEMA: list[dict] = [
    {
        "type": "function",
        "name": "navigate",
        "description": "Navigate the browser to a URL and return the page snapshot.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL to navigate to."},
                "full": {
                    "type": "boolean",
                    "description": "Return the full page snapshot instead of above-the-fold only.",
                },  # noqa: E501
            },
            "required": ["url"],
        },
    },
    {
        "type": "function",
        "name": "snapshot",
        "description": "Return the current page's accessibility snapshot without navigating.",
        "parameters": {
            "type": "object",
            "properties": {
                "full": {
                    "type": "boolean",
                    "description": "Return the full page snapshot instead of above-the-fold only.",
                },  # noqa: E501
            },
            "required": [],
        },
    },
    {
        "type": "function",
        "name": "click",
        "description": "Click an element on the current page by its reference ID (e.g. @1.5) and return the updated snapshot.",  # noqa: E501
        "parameters": {
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "Element reference such as @1.5",
                }
            },
            "required": ["ref"],
        },
    },
    {
        "type": "function",
        "name": "go_back",
        "description": "Navigate back to the previous page and return the snapshot.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
]
