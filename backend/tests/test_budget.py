"""Free-tier context budgets.

Groq's free plan caps *tokens per minute*, not just requests: 12K TPM on
`llama-3.3-70b-versatile`, 8K on the gpt-oss models. One TraceCI analysis is
three model calls inside about fifteen seconds and each call resends the whole
conversation, so the default budget blows the cap halfway through the
investigation and the run dies with a 429.

Shrinking the window is the fix, but it is only a fix if the window still
contains the evidence. These tests hold both ends of that: small enough to fit,
and still complete enough to diagnose from.
"""

import pathlib

import pytest
from conftest import SLUG

from traceci.log_window import build_log_window
from traceci.models import MODEL_CATALOG, NORMAL, TIGHT, budget_for, get_spec
from traceci.prefetch import prefetch
from traceci.repo_input import parse_repo_input
from traceci.tools import ToolSession, build_tools

FIX = pathlib.Path(__file__).parent / "fixtures"

# ~4 characters per token is close enough for a budget guard.
CHARS_PER_TOKEN = 4
# The free-tier floor we are designing against.
FREE_TPM_FLOOR = 8_000


def load(name):
    return (FIX / name).read_text(encoding="utf-8")


# -- the catalog ------------------------------------------------------------
def test_every_free_model_uses_the_tight_budget():
    for spec in MODEL_CATALOG:
        if spec.free_tier:
            assert spec.budget is TIGHT, f"{spec.id} is free-tier but not on a tight budget"
            assert spec.max_retries >= 5, f"{spec.id} needs retries: free tiers 429 routinely"


def test_the_default_model_is_free_so_a_first_run_costs_nothing():
    spec = get_spec("groq-llama-3.3-70b")
    assert spec.free_tier and spec.provider == "groq"
    assert spec.model == "llama-3.3-70b-versatile"


def test_unknown_models_fall_back_to_the_normal_budget():
    assert budget_for("something-nobody-added") is NORMAL
    assert budget_for("groq-gpt-oss-120b") is TIGHT


# -- the window still works when squeezed -----------------------------------
@pytest.mark.parametrize("name", [p.name for p in FIX.glob("log_*.txt")])
def test_a_tight_window_never_exceeds_its_budget(name):
    w = build_log_window(load(name), max_chars=TIGHT.log_window_chars)
    assert len(w.text) <= TIGHT.log_window_chars + 200


def test_a_tight_window_still_holds_the_traceback_and_the_summary():
    """The whole point. A budget that drops the evidence is not a budget, it is
    a silent downgrade to guessing."""
    w = build_log_window(load("log_early_error_late_summary.txt"),
                         max_chars=TIGHT.log_window_chars)
    assert "AttributeError: 'dict' object has no attribute 'expires_at'" in w.text
    assert "tests/unit/test_auth.py:47" in w.text
    assert "1 failed, 402 passed" in w.text
    # Scaled line counts, not a blunt character clip through the middle.
    assert "window truncated" not in w.text
    assert w.tier == 1


def test_a_tight_window_still_names_the_bad_pin():
    w = build_log_window(load("log_pip_resolution.txt"), max_chars=TIGHT.log_window_chars)
    assert "requests==99.99.99" in w.text
    assert "No matching distribution found" in w.text


def test_tight_is_meaningfully_smaller_than_normal():
    big = build_log_window(load("log_early_error_late_summary.txt"),
                           max_chars=NORMAL.log_window_chars)
    small = build_log_window(load("log_early_error_late_summary.txt"),
                             max_chars=TIGHT.log_window_chars)
    assert len(small.text) < len(big.text) * 0.6


# -- the whole prompt, end to end -------------------------------------------
def _estimated_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOKEN


def test_a_whole_tight_analysis_fits_inside_a_free_tier_minute(gh_api):
    """Estimate the tokens one full analysis sends in ~15 seconds.

    Three model calls, each resending the conversation:
      1. system + brief
      2. system + brief + one file read
      3. system + brief + file read + reasoning  (the diagnose call)
    """
    from traceci.prompts import failure_brief, system_prompt

    session = ToolSession()
    tools = {t.name: t for t in build_tools(session)}
    ctx, gh = prefetch(parse_repo_input(SLUG), token="ghp_fake", budget=TIGHT)
    session.bind(gh, ctx, TIGHT)

    system = system_prompt(6)
    brief = failure_brief(
        repo=ctx.repo, run_number=ctx.run_number, workflow_name=ctx.workflow_name,
        branch=ctx.branch, job_name=ctx.job_name, failed_step=ctx.failed_step,
        head_sha=ctx.head_sha, log_window=ctx.log_window.text,
        diff_summary=ctx.diff_summary,
    )
    file_read = tools["read_file"].invoke({"path": "app/auth.py"})
    gh.close()

    call1 = _estimated_tokens(system + brief)
    call2 = call1 + _estimated_tokens(file_read)
    call3 = call2 + 400                       # the investigation's own prose
    total = call1 + call2 + call3

    assert total < FREE_TPM_FLOOR * 1.5, (
        f"~{total} tokens per analysis will 429 on an 8K TPM free tier; "
        "shrink TIGHT in traceci/models.py"
    )
    # And a sanity floor -- if this ever collapses, the window has stopped
    # containing anything and the diagnosis is a guess.
    assert call1 > 600, "the brief got so small it cannot contain evidence"


def test_the_normal_budget_would_not_have_fitted(gh_api):
    """Documents *why* the tight profile exists rather than asserting a vibe."""
    ctx, gh = prefetch(parse_repo_input(SLUG), token="ghp_fake", budget=NORMAL)
    gh.close()
    normal_window = _estimated_tokens(ctx.log_window.text)

    ctx2, gh2 = prefetch(parse_repo_input(SLUG), token="ghp_fake", budget=TIGHT)
    gh2.close()
    tight_window = _estimated_tokens(ctx2.log_window.text)

    assert normal_window > tight_window
    # Three calls resending the normal window alone would already be most of an
    # 8K minute, before the system prompt, the diff or any file read.
    assert normal_window * 3 > FREE_TPM_FLOOR * 0.6


# -- tools honour the session budget ----------------------------------------
def test_read_file_truncates_to_the_session_budget(gh_api, monkeypatch):
    import conftest

    monkeypatch.setitem(conftest.REPO_FILES, "app/big.py", "x = 1\n" * 4000)
    session = ToolSession()
    tools = {t.name: t for t in build_tools(session)}
    ctx, gh = prefetch(parse_repo_input(SLUG), token="ghp_fake", budget=TIGHT)
    session.bind(gh, ctx, TIGHT)

    out = tools["read_file"].invoke({"path": "app/big.py"})
    assert len(out) < TIGHT.file_chars + 300
    assert "truncated at" in out

    session.budget = NORMAL
    session.file_cache.clear()
    out_big = tools["read_file"].invoke({"path": "app/big.py"})
    gh.close()
    assert len(out_big) > len(out)


def test_the_diff_summary_lists_fewer_files_on_a_tight_budget():
    from traceci.prefetch import summarise_diff

    compare = {
        "ahead_by": 1,
        "commits": [],
        "files": [
            {"filename": f"pkg/mod_{i:03d}.py", "status": "modified",
             "additions": 100 - i, "deletions": 1, "changes": 101 - i}
            for i in range(30)
        ],
    }
    tight, _s, _n = summarise_diff(compare, max_files=TIGHT.diff_files)
    normal, _s, _n = summarise_diff(compare, max_files=NORMAL.diff_files)
    assert len(tight) < len(normal)
    assert "and 18 more files" in tight
    # The loudest hunk is still first -- the trap the subtle case sets must
    # survive the squeeze, or the tight profile changes the answer.
    assert tight.index("mod_000.py") < tight.index("mod_005.py")
