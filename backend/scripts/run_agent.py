#!/usr/bin/env python
"""Run one analysis from the terminal, and print the number that matters.

Prompt iteration through a browser is miserable: you click, you wait fifteen
seconds for the prefetch, you squint at a card. This does the same thing in one
command and prints the tool-call count, which is the metric you are actually
tuning. Expected counts:

    break/dependency  -> 0   the log is sufficient
    break/config      -> 0-1
    break/lint_type   -> 1
    break/test_failure-> 1
    break/subtle      -> 1-2  and the cause must be the return-type change

5-6 calls everywhere means the prompt is causing over-calling. 0 on `subtle`
means the agent is lazy and its answer is wrong even if it sounds right.

    python scripts/run_agent.py kundan/traceme-lab --branch break/subtle
    python scripts/run_agent.py https://github.com/kundan/traceme-lab/actions/runs/123
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv  # noqa: E402
from langgraph.checkpoint.sqlite import SqliteSaver  # noqa: E402

# Rendering lives in traceme.cli_render so that `scripts/dry_run.py` prints
# byte-identically. A rehearsal that renders differently is not a rehearsal.
from traceme.cli_render import DIM, RED, RESET, header, run_and_render  # noqa: E402
from traceme.graph import analysis_config, build_graph  # noqa: E402
from traceme.models import BY_ID, DEFAULT_MODEL_ID, looks_like_a_placeholder  # noqa: E402
from traceme.tools import ToolSession  # noqa: E402


def main() -> int:
    load_dotenv()
    ap = argparse.ArgumentParser(description="Diagnose a failed GitHub Actions run.")
    ap.add_argument("repo", help="owner/repo, a GitHub URL, or an Actions run URL")
    ap.add_argument("--branch", default=None, help="e.g. break/subtle")
    ap.add_argument("--run-id", type=int, default=None)
    ap.add_argument("--model", default=os.getenv("TRACEME_MODEL", DEFAULT_MODEL_ID),
                    choices=sorted(BY_ID))
    ap.add_argument("--db", default=os.getenv("TRACEME_DB", "./traceme_checkpoints.sqlite"))
    ap.add_argument("--thread", default=None, help="reuse a thread id to inspect it later")
    args = ap.parse_args()

    # The provider-specific fallbacks are ordered with Groq first because it is
    # the free one and therefore the default model.
    api_key = (
        os.getenv("TRACEME_API_KEY")
        or os.getenv("GROQ_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("ANTHROPIC_API_KEY")
        or os.getenv("GOOGLE_API_KEY")
        or ""
    )
    if not api_key:
        print(f"{RED}No API key.{RESET} Set TRACEME_API_KEY (or GROQ_API_KEY / "
              "OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY) in .env.\n"
              "A free Groq key works: https://console.groq.com/keys", file=sys.stderr)
        return 2
    if looks_like_a_placeholder(api_key):
        print(f"{RED}TRACEME_API_KEY is still the placeholder value.{RESET} "
              "Paste a real key into backend/.env. Free Groq key: "
              "https://console.groq.com/keys", file=sys.stderr)
        return 2

    gh_token = os.getenv("GITHUB_TOKEN")
    if looks_like_a_placeholder(gh_token):
        # Fail loudly here rather than letting GitHub answer `401 Bad
        # Credentials` later, which reads like an expired token and sends you
        # off regenerating a good one.
        print(f"{RED}GITHUB_TOKEN is missing or still the placeholder value.{RESET} "
              "TraceMe cannot download Actions logs without a real classic PAT "
              "(`public_repo` scope): https://github.com/settings/tokens", file=sys.stderr)
        return 2

    conn = sqlite3.connect(args.db, check_same_thread=False)
    graph, _session = build_graph(ToolSession(), checkpointer=SqliteSaver(conn))
    thread_id = args.thread or uuid.uuid4().hex[:16]
    config = analysis_config(
        thread_id, repo=args.repo, run_id=args.run_id, branch=args.branch,
        model=args.model, api_key=api_key, github_token=gh_token,
    )

    header(args.model, thread_id)
    code = run_and_render(graph, config, args.model, thread_id)
    if code == 0:
        print(f"{DIM}Re-open this analysis any time: "
              f"python scripts/run_agent.py --thread {thread_id} ...{RESET}")
    conn.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
