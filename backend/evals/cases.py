"""The eval set.

Four deliberately-broken branches in the lab repository, each chosen because a
*correct* run behaves differently on it. That is the point: a single failure
class would tell you nothing about whether the agent is exercising judgement or
just pattern-matching one shape of log.

The expectations here are the contract. They are written as ranges rather than
exact values because the model is non-deterministic -- what is being asserted
is behaviour ("this case needs no tools", "this case needs to open a file"),
not a transcript.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class EvalCase:
    id: str
    branch: str
    why: str
    #: The one classification a correct run must reach.
    expect_category: str
    #: Substrings, at least one of which must appear somewhere in the evidence.
    expect_evidence_any: tuple[str, ...]
    #: Substrings the root cause must name. All of them.
    expect_root_cause_all: tuple[str, ...] = ()
    #: Inclusive bounds on tool calls. A correct run stays inside these.
    tool_calls: tuple[int, int] = (0, 6)
    #: Inclusive bounds on confidence, from the docs' calibration table.
    confidence: tuple[int, int] = (1, 10)
    tags: tuple[str, ...] = field(default_factory=tuple)


CASES: tuple[EvalCase, ...] = (
    EvalCase(
        id="subtle",
        branch="break/subtle",
        why=(
            "The traceback blames the test; the bug is a changed return type two files "
            "away, inside a commit whose message and largest hunk are about something "
            "else. A script cannot solve this -- everything in the log is true and none "
            "of it is the answer."
        ),
        expect_category="test_failure",
        expect_evidence_any=("AttributeError", "expires_at", "has no attribute"),
        expect_root_cause_all=("auth.py", "refresh"),
        # Needs at least one read. Burning five means it got lost and then guessed.
        tool_calls=(1, 3),
        confidence=(7, 10),
        tags=("flagship", "needs-source"),
    ),
    EvalCase(
        id="dependency",
        branch="break/dependency",
        why=(
            "The resolver already printed the conflicting constraints. The correct "
            "behaviour is restraint: reading a file to confirm what the log stated "
            "verbatim wastes a turn and adds nothing."
        ),
        expect_category="dependency",
        expect_evidence_any=(
            "ERROR: Cannot install",
            "No matching distribution",
            "Could not find a version",
            "ResolutionImpossible",
            "conflict",
        ),
        # Zero is the target. One is tolerable; more means it is browsing.
        tool_calls=(0, 1),
        confidence=(7, 10),
        tags=("restraint",),
    ),
    EvalCase(
        id="lint_type",
        branch="break/lint_type",
        why=(
            "A static check rejected the code before anything ran. Rule code, file and "
            "line are all printed together, so this is the case where the suggested fix "
            "should be most reliable."
        ),
        expect_category="lint_type",
        expect_evidence_any=(":", "error", "F8", "E7"),
        tool_calls=(0, 2),
        confidence=(7, 10),
        tags=("static",),
    ),
    EvalCase(
        id="config",
        branch="break/config",
        why=(
            "Fails at a setup step, before any application code executes. The trap is "
            "classifying by the failing step's job rather than by cause -- nothing is "
            "wrong with the source."
        ),
        expect_category="config",
        expect_evidence_any=("python-version", "Version", "not found", "setup-python"),
        tool_calls=(0, 2),
        confidence=(6, 10),
        tags=("classification",),
    ),
)

BY_ID = {c.id: c for c in CASES}
