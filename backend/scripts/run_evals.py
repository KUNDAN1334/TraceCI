"""Run the eval set.

    python scripts/run_evals.py --model groq-llama-3.3-70b
    python scripts/run_evals.py --model gpt-4o-mini --model claude-sonnet-4-5
    python scripts/run_evals.py --case subtle --case dependency

Needs a provider key (TRACECI_EVAL_KEY, or --key) and a GITHUB_TOKEN if the lab
repository is private. Each case is a full live run against a real failed
workflow, so a full sweep is four runs per model and costs real tokens.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv  # noqa: E402

from evals.cases import BY_ID  # noqa: E402
from evals.runner import render_table, run_model, save  # noqa: E402

DEFAULT_REPO = "KUNDAN1334/traceme-lab"


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description="Evaluate TraceCI's diagnoses.")
    parser.add_argument("--repo", default=os.getenv("TRACECI_EVAL_REPO", DEFAULT_REPO))
    parser.add_argument(
        "--model", action="append", default=[],
        help="repeatable; defaults to the free Groq model",
    )
    parser.add_argument(
        "--case", action="append", default=[],
        help=f"repeatable; one of {', '.join(BY_ID)}",
    )
    parser.add_argument("--key", default=os.getenv("TRACECI_EVAL_KEY", ""))
    parser.add_argument("--no-save", action="store_true")
    args = parser.parse_args()

    models = args.model or ["groq-llama-3.3-70b"]
    unknown = [c for c in args.case if c not in BY_ID]
    if unknown:
        parser.error(f"unknown case(s): {', '.join(unknown)}")

    if not args.key:
        print(
            "No provider key. Set TRACECI_EVAL_KEY in .env or pass --key.\n"
            "Evals make real model calls -- there is no offline mode, because a "
            "scripted model would only re-test the plumbing pytest already covers.",
            file=sys.stderr,
        )
        return 2

    print(f"repo: {args.repo}\n")
    summaries = []
    for model in models:
        summaries.append(
            run_model(
                repo=args.repo,
                model=model,
                api_key=args.key,
                github_token=os.getenv("GITHUB_TOKEN"),
                only=args.case or None,
            )
        )
        print()

    print(render_table(summaries))

    if not args.no_save:
        path = save(summaries, args.repo)
        print(f"\nsaved: {path.relative_to(Path.cwd()) if path.is_relative_to(Path.cwd()) else path}")

    # Distinct exit codes, because "the agent regressed" and "we could not
    # measure the agent" call for different reactions from whatever is running
    # this. Collapsing them into one non-zero means a rate limit looks like a
    # quality regression and someone spends an afternoon on it.
    if any(s.confidently_wrong for s in summaries):
        return 1   # a wrong answer was given confidently. Investigate.
    if any(not s.complete for s in summaries):
        return 2   # incomplete run. Re-run the skipped cases before trusting it.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
