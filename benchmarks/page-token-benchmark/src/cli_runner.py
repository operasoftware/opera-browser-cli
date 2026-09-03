import json
import os
import shlex
import subprocess
import time
from dataclasses import dataclass

import requests


@dataclass
class RunResult:
    stdout: str
    stderr: str
    returncode: int
    wall_seconds: float
    error: str | None = None


def _detect_error(stdout: str, returncode: int) -> str | None:
    """Return an error string if the output looks like a tool error, else None."""
    if returncode != 0:
        first_line = stdout.strip().splitlines()[0] if stdout.strip() else ""
        return first_line or f"exit {returncode}"
    if stdout.strip().lower().startswith("error:"):
        return stdout.strip().splitlines()[0]
    return None


def run_cli(
    url: str,
    cli_bin: str,
    nav_cmd: str,
    snapshot_cmd: str | None,
    raw: bool,
    full: bool,
    timeout: int,
    env: dict | None,
) -> RunResult:
    """
    Run the CLI tool to navigate and capture a snapshot.

    Single-step (snapshot_cmd is None): `<cli_bin> <nav_cmd> <url> [--raw] [--full]` — nav returns snapshot.
    Two-step (snapshot_cmd set): `<cli_bin> <nav_cmd> <url>` then `<cli_bin> <snapshot_cmd> [--raw] [--full]`.
    In two-step mode, if the nav step fails the snapshot step is skipped.
    """
    flags = (["--raw"] if raw else []) + (["--full"] if full else [])
    nav = [cli_bin, nav_cmd, url]
    run_env = {**os.environ, **env} if env else None
    start = time.monotonic()
    try:
        if snapshot_cmd is not None:
            nav_proc = subprocess.run(nav, capture_output=True, text=True, timeout=timeout, env=run_env)
            if nav_proc.returncode != 0:
                wall = time.monotonic() - start
                return RunResult(
                    stdout=nav_proc.stdout,
                    stderr=nav_proc.stderr,
                    returncode=nav_proc.returncode,
                    wall_seconds=wall,
                    error=_detect_error(nav_proc.stdout, nav_proc.returncode),
                )
            proc = subprocess.run(
                [cli_bin, snapshot_cmd] + flags, capture_output=True, text=True, timeout=timeout, env=run_env
            )
        else:
            proc = subprocess.run(nav + flags, capture_output=True, text=True, timeout=timeout, env=run_env)
        wall = time.monotonic() - start
        return RunResult(
            stdout=proc.stdout,
            stderr=proc.stderr,
            returncode=proc.returncode,
            wall_seconds=wall,
            error=_detect_error(proc.stdout, proc.returncode),
        )
    except subprocess.TimeoutExpired:
        wall = time.monotonic() - start
        return RunResult(
            stdout="",
            stderr="",
            returncode=-1,
            wall_seconds=wall,
            error=f"timeout after {timeout}s: {shlex.join(nav)}",
        )
    except Exception as exc:
        wall = time.monotonic() - start
        return RunResult(stdout="", stderr="", returncode=-1, wall_seconds=wall, error=str(exc))


def _bridge_call(session: "requests.Session", bridge_url: str, tool_name: str, args: dict, timeout: int) -> str:
    resp = session.post(f"{bridge_url}/call", json={"name": tool_name, "args": args}, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()
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
    return str(result)


def run_bridge(url: str, bridge_url: str, timeout: int) -> RunResult:
    """Navigate to URL via bridge, then take_snapshot to get the actual page content."""
    base = bridge_url.rstrip("/")
    session = requests.Session()
    start = time.monotonic()
    try:
        _bridge_call(session, base, "navigate_page", {"url": url}, timeout)
        stdout = _bridge_call(session, base, "take_snapshot", {}, timeout)
        wall = time.monotonic() - start
        return RunResult(stdout=stdout, stderr="", returncode=0, wall_seconds=wall)
    except requests.exceptions.ConnectionError:
        wall = time.monotonic() - start
        return RunResult(
            stdout="",
            stderr="",
            returncode=-1,
            wall_seconds=wall,
            error="bridge not running — start with: opera-browser-cli start",
        )
    except Exception as exc:
        wall = time.monotonic() - start
        return RunResult(stdout="", stderr="", returncode=-1, wall_seconds=wall, error=str(exc))


def run_lightpanda_fetch(
    url: str,
    cli_bin: str,
    dump: str,
    timeout: int,
) -> RunResult:
    """One-shot Lightpanda fetch: `lightpanda fetch --dump <fmt> --log-level error <url>`.

    Dump renders to stdout; logs go to stderr; no server/bridge/CDP involved.
    `dump` is one of `markdown | html | semantic_tree | semantic_tree_text`.

    Note: Lightpanda `fetch` exits 0 even when navigation fails (it prints
    ``# Navigation failed`` to stdout), so failure is detected separately.
    """
    cmd = [cli_bin, "fetch", "--dump", dump, "--log-level", "error", url]
    start = time.monotonic()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        wall = time.monotonic() - start
        error = _detect_error(proc.stdout, proc.returncode)
        if error is None:
            stripped = proc.stdout.lstrip()
            if stripped.startswith("# Navigation failed") or "CouldntConnect" in stripped:
                error = stripped.splitlines()[0] if stripped.splitlines() else "navigation failed"
        return RunResult(
            stdout=proc.stdout,
            stderr=proc.stderr,
            returncode=proc.returncode,
            wall_seconds=wall,
            error=error,
        )
    except subprocess.TimeoutExpired:
        wall = time.monotonic() - start
        return RunResult(stdout="", stderr="", returncode=-1, wall_seconds=wall,
                         error=f"timeout after {timeout}s: {shlex.join(cmd)}")
    except Exception as exc:
        wall = time.monotonic() - start
        return RunResult(stdout="", stderr="", returncode=-1, wall_seconds=wall, error=str(exc))


def run_condition(url: str, condition: dict, timeout: int = 60) -> RunResult:
    """Dispatch to the right runner based on condition tool_mode."""
    mode = condition["tool_mode"]
    if mode == "cli":
        return run_cli(
            url,
            cli_bin=condition["cli_bin"],
            nav_cmd=condition.get("nav_cmd", "snapshot"),
            snapshot_cmd=condition.get("snapshot_cmd"),
            raw=condition.get("raw", False),
            full=condition.get("full", False),
            timeout=timeout,
            env=condition.get("env"),
        )
    if mode == "bridge":
        return run_bridge(url, bridge_url=condition.get("bridge_url", "http://localhost:9224"), timeout=timeout)
    if mode == "lightpanda":
        return run_lightpanda_fetch(
            url,
            cli_bin=condition.get("cli_bin", "lightpanda"),
            dump=condition.get("dump", "markdown"),
            timeout=timeout,
        )

    raise ValueError(f"Unknown tool_mode: {mode}")
