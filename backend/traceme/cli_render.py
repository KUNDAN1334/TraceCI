"""Terminal rendering for a streamed analysis.

Shared by `scripts/run_agent.py` (the real thing) and `scripts/dry_run.py` (the
offline rehearsal). They must print byte-identically, otherwise the rehearsal
stops being a rehearsal and becomes a mock-up of one.
"""

from __future__ import annotations

import sys
import time
from collections.abc import Iterable
from typing import Any

from .graph import count_tool_calls, friendly_error
from .models import BY_ID
from .tools import describe_tool_call

DIM, BOLD, RESET = "\x1b[2m", "\x1b[1m", "\x1b[0m"
CYAN, GREEN, RED, YELLOW = "\x1b[36m", "\x1b[32m", "\x1b[31m", "\x1b[33m"
RULE = "=" * 72


def header(model_id: str, thread_id: str, *, note: str = "") -> None:
    print(f"{BOLD}TraceMe{RESET} {DIM}model={model_id} thread={thread_id}{RESET}")
    print(f"{DIM}{note or 'Prefetch takes 10-15s (list runs, download the log zip, diff).'}"
          f"{RESET}\n")


def render_updates(chunks: Iterable[dict]) -> dict:
    """Print the `updates` stream as it arrives; return the final diagnosis."""
    final: dict = {}
    for chunk in chunks:
        for node, update in (chunk or {}).items():
            if node == "fetch_failure":
                print(f"{CYAN}run{RESET}      #{update['run_id']} "
                      f"{update['workflow_name']} on {update['repo']}")
                print(f"{CYAN}step{RESET}     first failing: "
                      f"{BOLD}{update['failed_step']}{RESET}")
                print(f"{CYAN}window{RESET}   {update['log_tail'].split(chr(10))[0]}")
                print(f"{CYAN}diff{RESET}     {update['diff_summary'].split(chr(10))[1]}")
            elif node == "investigate":
                for m in update.get("messages") or []:
                    if getattr(m, "content", None):
                        print(f"\n{DIM}{str(m.content)[:600]}{RESET}")
                    for call in getattr(m, "tool_calls", None) or []:
                        _icon, label = describe_tool_call(call["name"], call.get("args") or {})
                        print(f"{YELLOW}tool{RESET}     {label}")
            elif node == "diagnose":
                final = update.get("diagnosis") or {}
    return final


def render_diagnosis(final: dict) -> None:
    print(f"\n{BOLD}{RULE}{RESET}")
    print(f"{BOLD}category{RESET}    {final['category']}")
    print(f"{BOLD}confidence{RESET}  {final['confidence']}/10")
    print(f"{BOLD}root cause{RESET}\n  {final['root_cause']}")
    print(f"\n{BOLD}evidence{RESET}")
    for e in final.get("evidence", []):
        print(f"  {DIM}|{RESET} {e}")
    print(f"\n{BOLD}fix{RESET}\n  {final['suggested_fix']}")
    if final.get("fix_snippet"):
        print(f"\n{BOLD}snippet{RESET}")
        for line in final["fix_snippet"].split("\n"):
            colour = GREEN if line.startswith("+") else RED if line.startswith("-") else DIM
            print(f"  {colour}{line}{RESET}")


def render_footer(model_id: str, messages: list, elapsed: float, thread_id: str) -> int:
    """Print the number that actually matters. Returns the tool-call count."""
    n_calls = count_tool_calls(messages or [])
    spec = BY_ID.get(model_id)
    tier = (f" {DIM}[free tier: {spec.budget.name} context budget]{RESET}"
            if spec and spec.free_tier else "")
    print(f"\n{BOLD}{RULE}{RESET}")
    print(f"{BOLD}TOOL CALLS: {n_calls}{RESET}   "
          f"{DIM}({elapsed:.1f}s, thread {thread_id}){RESET}{tier}")
    print(f"{DIM}Expected: dependency 0 | config 0-1 | lint_type 1 | test_failure 1 | "
          f"subtle 1-2{RESET}")
    return n_calls


def run_and_render(graph: Any, config: dict, model_id: str, thread_id: str) -> int:
    """Stream one analysis to the terminal. Returns a process exit code."""
    started = time.time()
    try:
        final = render_updates(graph.stream({"messages": []}, config, stream_mode="updates"))
    except Exception as exc:  # noqa: BLE001 - the CLI shows a sentence, not a trace
        print(f"\n{RED}error{RESET} {friendly_error(exc)}", file=sys.stderr)
        return 1

    if not final:
        print(f"\n{RED}No diagnosis was produced.{RESET}", file=sys.stderr)
        return 1

    render_diagnosis(final)
    state = graph.get_state(config)
    render_footer(model_id, state.values.get("messages") or [], time.time() - started, thread_id)
    return 0
