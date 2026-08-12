"""Run the eval set against one or more models and report.

Deliberately drives the *whole* graph rather than just the diagnose node: the
thing being measured is not "can the model write JSON", it is "does the agent
decide correctly how much to read". Tool-call counts are half the signal, and
they only exist if the loop actually runs.

No checkpointer is attached. Evals should not accumulate state between runs,
and a shared SQLite file would make two concurrent invocations interfere.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from traceci.graph import analysis_config, build_graph, count_tool_calls, friendly_error
from traceci.tools import ToolSession

from .cases import CASES, EvalCase
from .scoring import CaseResult, Summary, score

RESULTS_DIR = Path(__file__).resolve().parent / "results"


def run_case(
    case: EvalCase,
    *,
    repo: str,
    model: str,
    api_key: str,
    github_token: str | None,
) -> CaseResult:
    result = CaseResult(case_id=case.id, model=model)
    started = time.monotonic()
    try:
        graph, _session = build_graph(ToolSession())
        config = analysis_config(
            f"eval-{case.id}",
            repo=repo,
            branch=case.branch,
            model=model,
            api_key=api_key,
            github_token=github_token,
        )
        state = graph.invoke({"messages": []}, config)
        diagnosis = state.get("diagnosis") or {}
        if not diagnosis:
            result.error = "the graph produced no diagnosis"
            return result

        result.tool_calls = count_tool_calls(state.get("messages") or [])
        result.category = str(diagnosis.get("category") or "")
        result.confidence = int(diagnosis.get("confidence") or 0)
        result.checks = score(case, diagnosis, result.tool_calls)
    except BaseException as exc:  # noqa: BLE001 -- one bad case must not kill the run
        result.error = friendly_error(exc)
    finally:
        result.elapsed_s = round(time.monotonic() - started, 1)
    return result


def run_model(
    *,
    repo: str,
    model: str,
    api_key: str,
    github_token: str | None,
    only: list[str] | None = None,
    verbose: bool = True,
) -> Summary:
    cases = [c for c in CASES if not only or c.id in only]
    results: list[CaseResult] = []
    for case in cases:
        if verbose:
            print(f"  {model:<26} {case.id:<12} ", end="", flush=True)
        res = run_case(
            case, repo=repo, model=model, api_key=api_key, github_token=github_token
        )
        results.append(res)
        if verbose:
            mark = (
                "SKIP" if res.skipped
                else "PASS" if res.passed
                else "ERROR" if res.error
                else "FAIL"
            )
            print(f"{mark:<6} {res.elapsed_s:>5.1f}s  {res.tool_calls} calls")
            for check in res.checks:
                if not check.passed:
                    print(f"       └ {check.name}: {check.detail}")
            if res.error:
                print(f"       └ {res.error}")
    return Summary(model=model, results=results)


def render_table(summaries: list[Summary]) -> str:
    head = (
        f"{'model':<28}{'cases':>8}{'checks':>9}{'conf-wrong':>12}"
        f"{'errors':>8}{'skipped':>9}{'avg tools':>11}"
    )
    lines = [head, "-" * len(head)]
    for s in summaries:
        attempted = len(s.attempted)
        lines.append(
            f"{s.model:<28}{f'{s.cases_passed}/{attempted}':>8}"
            f"{s.checks_score * 100:>8.0f}%"
            f"{s.confidently_wrong:>12}"
            f"{s.errored:>8}"
            f"{s.skipped:>9}"
            f"{s.mean_tool_calls:>11.1f}"
        )
    lines += [
        "",
        "cases       every check passed, out of the cases actually attempted",
        "checks      share of individual checks passed",
        "conf-wrong  wrong category at confidence >= 8 -- the number that must stay 0",
        "skipped     never ran (rate limit, quota, network). Excluded from every rate",
        "            above, because a score that moves with your provider quota is",
        "            not a measurement of the agent.",
    ]
    if any(not s.complete for s in summaries):
        lines += [
            "",
            "INCOMPLETE RUN -- some cases were skipped. Re-run them before quoting",
            "these numbers:  --case " + " --case ".join(
                r.case_id for s in summaries for r in s.results if r.skipped
            ),
        ]
    return "\n".join(lines)


def save(summaries: list[Summary], repo: str) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = RESULTS_DIR / f"{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "recorded_at": stamp,
                "repo": repo,
                "models": [
                    {
                        "model": s.model,
                        "cases_passed": s.cases_passed,
                        "checks_score": round(s.checks_score, 3),
                        "confidently_wrong": s.confidently_wrong,
                        "errored": s.errored,
                        "mean_tool_calls": round(s.mean_tool_calls, 2),
                        "cases": [
                            {
                                "case": r.case_id,
                                "passed": r.passed,
                                "category": r.category,
                                "confidence": r.confidence,
                                "tool_calls": r.tool_calls,
                                "elapsed_s": r.elapsed_s,
                                "error": r.error,
                                "failed_checks": [
                                    {"name": c.name, "detail": c.detail}
                                    for c in r.checks
                                    if not c.passed
                                ],
                            }
                            for r in s.results
                        ],
                    }
                    for s in summaries
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path
