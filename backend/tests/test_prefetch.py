"""End-to-end prefetch against the synthetic API: the whole no-LLM layer."""

import pytest
from conftest import BASE_SHA, HEAD_SHA, RUN_ID, SLUG

from traceci.github import GitHubError
from traceci.prefetch import prefetch, summarise_diff
from traceci.repo_input import parse_repo_input


def run_prefetch(**kw):
    ref = parse_repo_input(SLUG, **kw)
    return prefetch(ref, token="ghp_fake")


def test_prefetch_assembles_the_whole_context(gh_api):
    ctx, gh = run_prefetch()
    assert ctx.repo == SLUG
    assert ctx.run_id == RUN_ID
    assert ctx.workflow_name == "CI"
    assert ctx.job_name == "build"
    # The point of the whole exercise: the *first failing step*, by name.
    assert ctx.failed_step == "Run tests"
    assert ctx.failed_step_number == 6
    assert ctx.head_sha == HEAD_SHA
    assert ctx.base_sha == BASE_SHA
    gh.close()


def test_prefetch_hands_over_a_readable_window(gh_api):
    ctx, gh = run_prefetch()
    text = ctx.log_window.text
    assert "AttributeError: 'dict' object has no attribute 'expires_at'" in text
    assert "1 failed, 402 passed" in text
    assert ctx.log_window.tier == 1
    assert ctx.log_window.total_lines > 400
    gh.close()


def test_prefetch_diff_summary_is_a_summary_not_a_patch(gh_api):
    ctx, gh = run_prefetch()
    d = ctx.diff_summary
    assert "app/rate_limit.py" in d and "app/auth.py" in d
    assert "2 file(s) changed" in d
    assert "Baseline: " in d
    # The commit message that lies about what changed is visible -- on purpose.
    assert "token bucket" in d
    # ...but no patch hunks. Reading those is a tool call the agent must choose.
    assert "@@" not in d
    gh.close()


def test_diff_summary_sorts_the_loudest_hunk_first():
    """The trap the `subtle` case sets: rate_limit.py changed 95 lines and is
    irrelevant; auth.py changed 4 and is the cause."""
    summary, subjects, names = summarise_diff({
        "ahead_by": 1,
        "commits": [{"commit": {"message": "perf: token bucket\n\nlong body"}}],
        "files": [
            {"filename": "small.py", "status": "modified", "additions": 1,
             "deletions": 1, "changes": 2},
            {"filename": "huge.py", "status": "modified", "additions": 90,
             "deletions": 40, "changes": 130},
        ],
    })
    assert names == ["huge.py", "small.py"]
    assert summary.index("huge.py") < summary.index("small.py")
    assert subjects == ["perf: token bucket"]


def test_empty_compare_is_reported_not_hidden():
    summary, _s, names = summarise_diff({"ahead_by": 0, "commits": [], "files": []})
    assert names == []
    assert "base and head are the same commit" in summary


def test_asking_for_a_green_run_by_id_is_refused(gh_api, monkeypatch):
    """You cannot diagnose a passing run; say so instead of producing fiction."""
    import conftest

    ref = parse_repo_input(f"https://github.com/{SLUG}/actions/runs/{RUN_ID}")

    class FakeClient:
        slug = SLUG

        def get_run(self, run_id):
            return conftest.make_run(conclusion="success")

    with pytest.raises(GitHubError) as exc:
        prefetch(ref, token="x", client=FakeClient())
    assert "not a failure" in str(exc.value)


def test_public_dict_carries_no_secrets(gh_api):
    ctx, gh = run_prefetch()
    payload = ctx.to_public_dict()
    blob = repr(payload).lower()
    assert "ghp_" not in blob and "token" not in blob and "api_key" not in blob
    assert payload["failed_step"] == "Run tests"
    gh.close()
