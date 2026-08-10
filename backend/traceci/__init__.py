"""TraceCI -- an agent that diagnoses failed GitHub Actions runs."""

__version__ = "0.1.0"

from .graph import CIState, Diagnosis, analysis_config, build_graph  # noqa: F401
from .prefetch import FailureContext, prefetch  # noqa: F401
from .repo_input import RepoRef, parse_repo_input  # noqa: F401

__all__ = [
    "CIState",
    "Diagnosis",
    "FailureContext",
    "RepoRef",
    "analysis_config",
    "build_graph",
    "parse_repo_input",
    "prefetch",
]
