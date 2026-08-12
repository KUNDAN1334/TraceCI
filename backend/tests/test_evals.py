"""The scorer is code, so it gets tested like code.

An eval harness whose scoring is wrong is worse than no harness: it produces a
number, the number gets quoted, and nobody re-derives it.
"""

from __future__ import annotations

from evals.cases import BY_ID, CASES
from evals.scoring import CaseResult, Summary, score

SUBTLE = BY_ID["subtle"]

GOOD = {
    "category": "test_failure",
    "root_cause": "app/auth.py:refresh() returns a dict where a Token is annotated.",
    "evidence": ["E   AttributeError: 'dict' object has no attribute 'expires_at'"],
    "confidence": 9,
    "suggested_fix": "Return the Token.",
    "fix_snippet": "",
}


def test_the_eval_set_covers_distinct_behaviours_not_just_distinct_repos():
    """Four cases whose *correct* behaviour differs, otherwise the set only
    proves the agent can pattern-match one shape of log."""
    assert {c.expect_category for c in CASES} == {
        "test_failure", "dependency", "lint_type", "config"
    }
    # The restraint case must demand fewer tools than the source-reading one.
    assert BY_ID["dependency"].tool_calls[1] < BY_ID["subtle"].tool_calls[1]


def test_a_correct_diagnosis_passes_every_check():
    checks = score(SUBTLE, GOOD, tool_calls=1)
    assert all(c.passed for c in checks), [(c.name, c.detail) for c in checks]


def test_the_right_answer_reached_by_browsing_still_fails_on_effort():
    """Six tool calls on a one-file case means it got lost and then guessed."""
    checks = score(SUBTLE, GOOD, tool_calls=6)
    failed = [c.name for c in checks if not c.passed]
    assert failed == ["tool_calls"]


def test_a_root_cause_that_names_nothing_fails():
    vague = {**GOOD, "root_cause": "A recent change to the authentication logic."}
    checks = score(SUBTLE, vague, tool_calls=1)
    assert "root_cause" in [c.name for c in checks if not c.passed]


def test_paraphrased_evidence_fails():
    weak = {**GOOD, "evidence": ["The test failed with an attribute error."]}
    checks = score(SUBTLE, weak, tool_calls=1)
    assert "evidence" in [c.name for c in checks if not c.passed]


def test_confidently_wrong_is_tracked_apart_from_the_pass_rate():
    """The metric that matters: wrong about the cause AND sure about it. A wrong
    answer at low confidence is the system working as designed."""
    wrong_and_sure = {**GOOD, "category": "infra", "confidence": 9}
    wrong_but_honest = {**GOOD, "category": "infra", "confidence": 2}

    sure = CaseResult("subtle", "m", score(SUBTLE, wrong_and_sure, 1), 1, 9)
    honest = CaseResult("subtle", "m", score(SUBTLE, wrong_but_honest, 1), 1, 2)

    assert sure.confidently_wrong is True
    assert honest.confidently_wrong is False
    # Both are failures; only one is dangerous.
    assert not sure.passed and not honest.passed


def test_summary_aggregates_without_hiding_the_dangerous_number():
    results = [
        CaseResult("a", "m", score(SUBTLE, GOOD, 1), 1, 9),
        CaseResult("b", "m", score(SUBTLE, {**GOOD, "category": "infra"}, 1), 1, 9),
    ]
    s = Summary(model="m", results=results)
    assert s.cases_passed == 1
    assert s.confidently_wrong == 1
    assert 0 < s.checks_score < 1


def test_a_rate_limited_case_is_skipped_not_counted_as_a_wrong_answer():
    """Found by running the harness into Groq's daily token cap: two cases
    never ran and the summary reported 50%, which reads as 'the agent got half
    of them wrong'. A score that moves with your provider quota is not a
    measurement of the agent."""
    good = CaseResult("a", "m", score(SUBTLE, GOOD, 1), 1, 9)
    limited = CaseResult("b", "m", [], error="Error code: 429 - Rate limit reached")

    assert limited.skipped is True
    s = Summary(model="m", results=[good, limited])
    assert s.cases_passed == 1
    assert len(s.attempted) == 1          # the skip is excluded from the denominator
    assert s.checks_score == 1.0          # not 0.5
    assert s.skipped == 1 and s.errored == 0
    assert s.complete is False


def test_a_genuine_failure_to_diagnose_is_an_error_not_a_skip():
    r = CaseResult("a", "m", [], error="the graph produced no diagnosis")
    assert r.skipped is False
    assert r.score == 0.0 and not r.passed
    assert Summary("m", [r]).errored == 1
