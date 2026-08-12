"""Scoring. Pure functions over a diagnosis dict, so the scorer itself is
unit-testable without a network call or an API key.

Five checks, and they are not equally weighted by accident:

    category      did it classify by cause
    evidence      did it quote the line that proves it
    root_cause    did it name the file and function
    tool_calls    did it spend the right amount of effort
    confidence    is the score consistent with the sourcing

`confidently_wrong` is tracked separately from all of them, because it is the
only failure that actively costs the user time. A wrong answer at confidence 3
is the system working; a wrong answer at confidence 9 is the system lying. Any
aggregate that averages those two together is hiding the number that matters.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .cases import EvalCase

CONFIDENTLY = 8


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class CaseResult:
    case_id: str
    model: str
    checks: list[Check] = field(default_factory=list)
    tool_calls: int = 0
    confidence: int = 0
    category: str = ""
    elapsed_s: float = 0.0
    error: str = ""

    @property
    def skipped(self) -> bool:
        """Never actually ran -- a rate limit, a quota, a dropped connection.

        Kept distinct from a failure because scoring them together is a lie:
        a run where two cases were rate-limited reported 50%, which reads as
        "the agent got half of them wrong" when the agent was never asked.
        An eval number that moves with your provider quota is worse than no
        number, because it still gets quoted.
        """
        if not self.error:
            return False
        low = self.error.lower()
        return any(
            marker in low
            for marker in ("rate limit", "429", "quota", "insufficient_quota",
                           "timed out", "connection", "temporarily unavailable")
        )

    @property
    def passed(self) -> bool:
        return not self.error and all(c.passed for c in self.checks)

    @property
    def score(self) -> float:
        if self.error or not self.checks:
            return 0.0
        return sum(1 for c in self.checks if c.passed) / len(self.checks)

    @property
    def confidently_wrong(self) -> bool:
        """Wrong about the cause, and sure about it."""
        wrong = any(c.name == "category" and not c.passed for c in self.checks)
        return wrong and self.confidence >= CONFIDENTLY


def _contains_any(haystack: str, needles: tuple[str, ...]) -> str | None:
    low = haystack.lower()
    for n in needles:
        if n.lower() in low:
            return n
    return None


def score(case: EvalCase, diagnosis: dict[str, Any], tool_calls: int) -> list[Check]:
    checks: list[Check] = []

    category = str(diagnosis.get("category") or "")
    checks.append(
        Check(
            "category",
            category == case.expect_category,
            f"got {category!r}, want {case.expect_category!r}",
        )
    )

    evidence = "\n".join(str(e) for e in (diagnosis.get("evidence") or []))
    hit = _contains_any(evidence, case.expect_evidence_any)
    checks.append(
        Check(
            "evidence",
            hit is not None,
            f"matched {hit!r}" if hit else f"none of {list(case.expect_evidence_any)}",
        )
    )

    root_cause = str(diagnosis.get("root_cause") or "").lower()
    missing = [t for t in case.expect_root_cause_all if t.lower() not in root_cause]
    checks.append(
        Check("root_cause", not missing, f"missing {missing}" if missing else "names the source")
    )

    lo, hi = case.tool_calls
    checks.append(
        Check("tool_calls", lo <= tool_calls <= hi, f"used {tool_calls}, want {lo}-{hi}")
    )

    clo, chi = case.confidence
    confidence = int(diagnosis.get("confidence") or 0)
    checks.append(
        Check("confidence", clo <= confidence <= chi, f"got {confidence}, want {clo}-{chi}")
    )

    return checks


@dataclass
class Summary:
    model: str
    results: list[CaseResult]

    @property
    def attempted(self) -> list[CaseResult]:
        """Cases the agent actually got to answer. Skipped ones are excluded
        from every rate, so a provider quota cannot flatter or damage a score."""
        return [r for r in self.results if not r.skipped]

    @property
    def cases_passed(self) -> int:
        return sum(1 for r in self.attempted if r.passed)

    @property
    def checks_score(self) -> float:
        attempted = self.attempted
        if not attempted:
            return 0.0
        return sum(r.score for r in attempted) / len(attempted)

    @property
    def confidently_wrong(self) -> int:
        return sum(1 for r in self.results if r.confidently_wrong)

    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.skipped)

    @property
    def errored(self) -> int:
        """Genuine failures to produce a diagnosis, excluding skips."""
        return sum(1 for r in self.attempted if r.error)

    @property
    def complete(self) -> bool:
        return self.skipped == 0

    @property
    def mean_tool_calls(self) -> float:
        usable = [r for r in self.attempted if not r.error]
        return sum(r.tool_calls for r in usable) / len(usable) if usable else 0.0
