#!/usr/bin/env python
"""A full rehearsal of an analysis, with NO credentials and NO network.

Why this exists: the first time you run TraceMe for real, two things are
unfamiliar at once -- the tool (did I set it up right?) and the output (is this
what a good answer looks like?). This separates them. It runs the *real* graph,
the *real* prefetch, the *real* five tools and the *real* terminal renderer
against the recorded GitHub fixtures and a scripted model, so you can see
exactly what your terminal will print before you spend a single token.

    python scripts/dry_run.py                 # the `subtle` case, 1 tool call
    python scripts/dry_run.py --case dependency   # 0 tool calls
    python scripts/dry_run.py --case lazy      # what a WRONG answer looks like

The only fake parts are the GitHub responses and the model's choices. Every
line of TraceMe's own code in the path is the code that ships.
"""

from __future__ import annotations

import argparse
import pathlib
import sqlite3
import sys
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from langgraph.checkpoint.sqlite import SqliteSaver  # noqa: E402

from traceme.cli_render import (  # noqa: E402
    BOLD,
    DIM,
    RESET,
    RULE,
    YELLOW,
    render_diagnosis,
    render_footer,
    render_updates,
)
from traceme.graph import analysis_config, build_graph  # noqa: E402
from traceme.tools import ToolSession  # noqa: E402

MODEL = "groq-llama-3.3-70b"

SUBTLE_DIAGNOSIS = {
    "category": "test_failure",
    "root_cause": (
        "app/auth.py:refresh() was changed to return a plain dict instead of the Token it "
        "is still annotated to return, so tests/unit/test_auth.py:47 raises AttributeError "
        "when it reads .expires_at. The token-bucket rewrite of app/rate_limit.py in the "
        "same commit is the largest hunk in the diff but nothing in the test suite imports "
        "it."
    ),
    "evidence": [
        "E       AttributeError: 'dict' object has no attribute 'expires_at'",
        "tests/unit/test_auth.py:47: AttributeError",
        "app/auth.py:18: return {'value': fresh.value, 'user': fresh.user, "
        "'expires_at': fresh.expires_at}",
        "1 failed, 402 passed in 12.41s",
    ],
    "confidence": 9,
    "suggested_fix": (
        "Return the Token from refresh() and move the dict conversion to the API "
        "serialisation layer."
    ),
    "fix_snippet": (
        " def refresh(token: Token, now: int) -> Token:\n"
        "-    fresh = issue_token(token.user, now)\n"
        '-    return {"value": fresh.value, "user": fresh.user, '
        '"expires_at": fresh.expires_at}\n'
        "+    return issue_token(token.user, now)\n"
    ),
}

DEPENDENCY_DIAGNOSIS = {
    "category": "dependency",
    "root_cause": (
        "requirements.txt pins requests==99.99.99, a version that does not exist on PyPI, "
        "so the `Install deps` step fails during resolution and the build never reaches "
        "the tests."
    ),
    "evidence": [
        "ERROR: Could not find a version that satisfies the requirement requests==99.99.99",
        "ERROR: No matching distribution found for requests==99.99.99",
    ],
    "confidence": 10,
    "suggested_fix": "Pin requests to a version that exists, e.g. requests==2.32.3.",
    "fix_snippet": "-requests==99.99.99\n+requests==2.32.3\n",
}

LAZY_DIAGNOSIS = {
    "category": "test_failure",
    "root_cause": (
        "The rate limiter was rewritten from a fixed window to a token bucket in this "
        "commit, which broke the test suite. This is the largest change in the diff and "
        "the commit message confirms it."
    ),
    "evidence": ["perf(rate-limit): replace fixed window with a token bucket"],
    "confidence": 9,
    "suggested_fix": "Revert the rate limiter rewrite.",
    "fix_snippet": "",
}

CASES = {
    # what a GOOD subtle run looks like: narrate, open exactly one file, conclude
    "subtle": {
        "turns": [
            {
                "text": (
                    "The failing step is `Run tests` and the error is "
                    "AttributeError: 'dict' object has no attribute 'expires_at'. That "
                    "names the caller, not the cause -- something refresh() returns "
                    "changed shape. The diff's biggest hunk is a 95-line rewrite of "
                    "app/rate_limit.py, but nothing in the test suite imports it, so I am "
                    "ignoring the loud change and opening app/auth.py."
                ),
                "calls": [{"name": "read_file", "args": {"path": "app/auth.py"}}],
            },
            "Confirmed: refresh() builds a Token and then returns a dict of its fields, "
            "while still annotated `-> Token`.",
        ],
        "diagnosis": SUBTLE_DIAGNOSIS,
        "expect_calls": 1,
        "why": "the cause is only reachable by choosing to open a file",
    },
    # what a GOOD dependency run looks like: the log is sufficient, so no tools
    "dependency": {
        "turns": [
            "The log states the cause outright: pip cannot resolve requests==99.99.99, and "
            "prints the list of versions that do exist. Opening a file would only confirm "
            "a line I have already been shown, so I am not spending a tool call."
        ],
        "diagnosis": DEPENDENCY_DIAGNOSIS,
        "expect_calls": 0,
        "why": "the log already contains the answer verbatim",
    },
    # what a BAD run looks like, so you can recognise it instantly
    "lazy": {
        "turns": [
            "Something in this commit broke the tests. The biggest change by far is the "
            "rate limiter rewrite, and the commit message says so, so that must be it."
        ],
        "diagnosis": LAZY_DIAGNOSIS,
        "expect_calls": 0,
        "why": "FAILURE MODE: 0 calls on `subtle` means the agent guessed. Note how "
               "fluent and confident the wrong answer is -- there is no error anywhere",
    },
}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--case", choices=sorted(CASES), default="subtle")
    args = ap.parse_args()
    case = CASES[args.case]

    import conftest
    import respx
    from fake_model import Script, make_provider

    print(f"{BOLD}DRY RUN{RESET} {DIM}-- recorded GitHub, scripted model, no credentials, "
          f"no network.{RESET}")
    print(f"{DIM}case: {args.case}  |  expecting {case['expect_calls']} tool call(s) "
          f"({case['why']}){RESET}\n")

    thread_id = uuid.uuid4().hex[:16]
    db = pathlib.Path(tempfile.mkdtemp()) / "dry_run.sqlite"
    conn = sqlite3.connect(db, check_same_thread=False)

    with respx.mock(assert_all_called=False) as router:
        conftest.FakeGitHub(router)
        script = Script(case["turns"], case["diagnosis"])
        graph, _ = build_graph(
            ToolSession(), checkpointer=SqliteSaver(conn),
            model_provider=make_provider(script),
        )
        config = analysis_config(
            thread_id, repo=conftest.SLUG, branch="break/subtle", model=MODEL,
            api_key="gsk-not-a-real-key", github_token="ghp-not-a-real-token",
        )
        started = time.time()
        final = render_updates(graph.stream({"messages": []}, config, stream_mode="updates"))
        render_diagnosis(final)
        state = graph.get_state(config)
        n_calls = render_footer(MODEL, state.values.get("messages") or [],
                                time.time() - started, thread_id)

    # The share link: prove the checkpoint round-trips, and that it is clean.
    snapshot = graph.get_state({"configurable": {"thread_id": thread_id}})
    leaked = [s for s in ("gsk-not-a-real-key", "ghp-not-a-real-token")
              if s in repr(snapshot.values) or s in db.read_bytes().decode("utf-8", "replace")]
    conn.close()

    print(f"\n{BOLD}{RULE}{RESET}")
    print(f"{BOLD}share link{RESET}  GET /analysis/{thread_id}")
    print(f"  category   {snapshot.values['diagnosis']['category']}   "
          f"{DIM}(read back out of SQLite, not recomputed){RESET}")
    print(f"  secrets    {'LEAKED: ' + ', '.join(leaked) if leaked else 'none in state or on disk'}")

    ok = n_calls == case["expect_calls"] and not leaked
    verdict = "as expected" if ok else "NOT what was expected"
    print(f"\n{YELLOW if not ok else DIM}{n_calls} tool call(s), "
          f"{'no ' if not leaked else ''}secrets leaked -- {verdict}.{RESET}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
