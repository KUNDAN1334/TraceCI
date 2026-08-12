"""Evaluation harness for TraceCI.

`pytest` proves the plumbing works. This proves the agent is any good, which is
a different question and the one that actually matters.
"""

from .cases import CASES, EvalCase
from .scoring import CaseResult, Check, Summary, score

__all__ = ["CASES", "EvalCase", "CaseResult", "Check", "Summary", "score"]
