"""The guards that stop TraceCI answering a question it cannot answer.

The bug these lock in: a repository whose CI was green got a confident-looking
diagnosis, because the most recent *red* run was a Dependabot security update
whose log is runner-provisioning chatter with no error in it. The agent
correctly said it could not tell, and the structured-output schema then dressed
that up as a root cause at confidence 5 with a suggested fix.

Three separate things had to be wrong for that to reach a user, so there are
three sets of tests here.
"""

from __future__ import annotations

from traceci.github import GitHubClient, JobRef, StepRef, undiagnosable_reason
from traceci.graph import enforce_honesty
from traceci.log_window import build_log_window
from traceci.prefetch import why_inconclusive


# --------------------------------------------------------------------------
# 1. run selection
# --------------------------------------------------------------------------
def _run(**kw):
    base = {"id": 1, "run_number": 7, "event": "push", "name": "CI", "head_sha": "a" * 40}
    base.update(kw)
    return base


def test_a_dependabot_security_update_is_not_a_ci_failure():
    run = _run(event="dependabot_security_updates",
               name="npm_and_yarn in /web for nanoid - Update #1516931838")
    assert undiagnosable_reason(run) is not None


def test_a_dependabot_update_job_is_recognised_by_name_alone():
    """The event is not always set to the dependabot value on older runs."""
    run = _run(name="npm_and_yarn in /web for nanoid - Update #1516931838")
    assert "dependency-bump" in (undiagnosable_reason(run) or "")


def test_ordinary_ci_on_a_dependabot_pull_request_is_still_diagnosable():
    """The false negative worth guarding: a real CI workflow whose actor is
    dependabot is a genuine failure and must not be skipped."""
    run = _run(event="pull_request", name="CI",
               actor={"login": "dependabot[bot]"},
               triggering_actor={"login": "dependabot[bot]"})
    assert undiagnosable_reason(run) is None


def test_a_run_with_no_head_commit_has_nothing_to_diff():
    assert undiagnosable_reason(_run(head_sha="")) is not None


def test_a_normal_failed_run_is_diagnosable():
    assert undiagnosable_reason(_run()) is None


# --------------------------------------------------------------------------
# 2. "there is no error in this log"
# --------------------------------------------------------------------------
PROVISIONING_LOG = """\
Requested labels: ubuntu-latest
Job defined at: Agenta-AI/agenta/.github/workflows/dependabot.yml@refs/heads/main
Waiting for a runner to pick up this job...
Job is waiting for a hosted runner to come online.
Evaluating Dependabot.if
Evaluating: success()
"""

REAL_FAILURE_LOG = """\
Run pytest -q
tests/unit/test_auth.py:47: in test_session_refresh
E   AttributeError: 'dict' object has no attribute 'expires_at'
=== 1 failed, 402 passed in 12.41s ===
"""


def test_a_job_that_never_started_is_inconclusive():
    window = build_log_window(PROVISIONING_LOG)
    reason = why_inconclusive(window, None)
    assert reason
    assert "never started" in reason


def test_an_empty_step_log_is_inconclusive():
    window = build_log_window("")
    assert why_inconclusive(window, None)


def test_a_real_failure_is_not_inconclusive():
    window = build_log_window(REAL_FAILURE_LOG)
    assert window.found_error
    assert why_inconclusive(window, None) == ""


# --------------------------------------------------------------------------
# 2b. picking the job that actually failed
# --------------------------------------------------------------------------
def _step(n, name, conclusion):
    return StepRef(number=n, name=name, conclusion=conclusion)


def test_a_cancelled_sibling_job_never_wins_over_the_one_that_failed():
    """The bug this locks in: when one job fails GitHub cancels its siblings,
    and a cancelled job that never got a runner has a log made entirely of
    'Waiting for a runner to pick up this job...'. Diagnosing that instead of
    the real failure produced a confident 'nothing failed here'."""
    cancelled = JobRef(
        id=1, name="build", conclusion="cancelled",
        steps=[_step(1, "Set up job", "success"), _step(3, "Install deps", "cancelled")],
    )
    real = JobRef(
        id=2, name="test", conclusion="failure",
        steps=[_step(1, "Set up job", "success"), _step(3, "Install deps", "failure")],
    )
    job, step = GitHubClient.first_failing([cancelled, real])
    assert job.name == "test"
    assert step is not None and step.conclusion == "failure"


def test_within_a_failed_job_the_failed_step_beats_a_cancelled_one():
    job = JobRef(
        id=1, name="test", conclusion="failure",
        steps=[
            _step(2, "Install deps", "failure"),
            _step(3, "Run tests", "cancelled"),
        ],
    )
    _, step = GitHubClient.first_failing([job])
    assert step is not None and step.name == "Install deps"


def test_a_cancelled_job_is_still_used_when_nothing_else_failed():
    job = JobRef(id=1, name="build", conclusion="cancelled",
                 steps=[_step(2, "Install deps", "cancelled")])
    picked, step = GitHubClient.first_failing([job])
    assert picked.name == "build" and step is not None


# --------------------------------------------------------------------------
# 2c. falling back to the job log
# --------------------------------------------------------------------------
def test_the_job_log_is_found_when_the_step_log_is_the_wrong_file():
    archive = {
        "1_test.txt": "Run pytest\nE   AssertionError: boom\n",
        "test/1_Set up job.txt": "Waiting for a runner to pick up this job...\n",
        "test/3_Install deps.txt": "Waiting for a runner...\n",
    }
    path, text = GitHubClient.pick_job_log(archive, "test")
    assert path == "1_test.txt"
    assert "AssertionError" in text


def test_the_job_log_falls_back_to_concatenated_step_files():
    archive = {
        "test/1_Set up job.txt": "Requested labels: ubuntu-latest\n",
        "test/3_Install deps.txt": "ERROR: Cannot install app==1.4.0\n",
    }
    _, text = GitHubClient.pick_job_log(archive, "test")
    assert "Cannot install" in text


# --------------------------------------------------------------------------
# 3. the model hedged anyway
# --------------------------------------------------------------------------
HEDGED = {
    "category": "unknown",
    "root_cause": (
        "The root cause of the failure is not clear from the provided log and changed "
        "files. The issue might be related to the Dependabot configuration."
    ),
    "evidence": ["Job is waiting for a hosted runner to come online."],
    "confidence": 5,
    "suggested_fix": "Investigate the Dependabot configuration and the repository's setup.",
    "fix_snippet": "",
}


def test_hedged_prose_cannot_keep_a_mid_range_confidence():
    out = enforce_honesty(dict(HEDGED))
    assert out["category"] == "inconclusive"
    assert out["confidence"] <= 2


def test_a_result_with_no_cause_carries_no_suggested_fix():
    """The most costly part of a wrong answer is the fix somebody acts on."""
    out = enforce_honesty(dict(HEDGED))
    assert out["suggested_fix"] == ""
    assert out["fix_snippet"] == ""


def test_a_well_sourced_diagnosis_is_left_alone():
    good = {
        "category": "test_failure",
        "root_cause": "app/auth.py:refresh() returns a dict where a Token is annotated.",
        "evidence": ["E   AttributeError: 'dict' object has no attribute 'expires_at'"],
        "confidence": 9,
        "suggested_fix": "Return the Token from refresh().",
        "fix_snippet": "+    return issue_token(token.user, now)",
    }
    out = enforce_honesty(dict(good))
    assert out == good


def test_a_fenced_snippet_is_unwrapped_before_it_reaches_the_ui():
    """Models wrap `fix_snippet` in a markdown fence even though the field is
    declared as a patch; rendered verbatim, the fence splits the block."""
    out = enforce_honesty({
        "category": "test_failure",
        "root_cause": "refresh() returns a dict where a Token is annotated.",
        "evidence": ["AttributeError: 'dict' object has no attribute 'user'"],
        "confidence": 9,
        "suggested_fix": "Return the Token.",
        "fix_snippet": "```python\ndef refresh(t: Token) -> Token:\n    return fresh\n```",
    })
    assert not out["fix_snippet"].startswith("```")
    assert "```" not in out["fix_snippet"]
    assert out["fix_snippet"].startswith("def refresh")


def test_exit_code_trailers_alone_cannot_support_a_high_score():
    """`Process completed with exit code 1` is appended to every failed step
    and establishes nothing."""
    out = enforce_honesty({
        "category": "test_failure",
        "root_cause": "A test in the suite regressed after the latest commit.",
        "evidence": ["##[error]Process completed with exit code 1."],
        "confidence": 9,
        "suggested_fix": "Fix the test.",
        "fix_snippet": "",
    })
    assert out["confidence"] <= 3
