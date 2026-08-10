"""Parse whatever the user pasted into (owner, repo, run_id?, branch?).

People paste the URL that is in front of them. That is almost never
`owner/repo` -- it is the Actions run page they were just staring at. Accepting
that URL (and pulling the run_id straight out of it) removes the single most
annoying step from the demo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


class RepoInputError(ValueError):
    """The pasted text is not something we can turn into a repo reference."""


@dataclass(frozen=True)
class RepoRef:
    owner: str
    repo: str
    run_id: int | None = None
    branch: str | None = None

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"

    def __str__(self) -> str:  # pragma: no cover - convenience only
        return self.full_name


# GitHub names: alphanumerics, hyphen, underscore, dot. Owners cannot contain
# dots in practice but repos very much can (e.g. `foo.github.io`).
_NAME = r"[A-Za-z0-9_.-]+"

# NOTE: branch names contain slashes (`break/subtle`), so the tree/ pattern must
# capture `(.+)$` rather than `[^/]+`. Getting this wrong silently gives you
# branch="break" and an empty result set.
_RUN_URL = re.compile(rf"^({_NAME})/({_NAME})/actions/runs/(\d+)(?:/.*)?$")
_TREE_URL = re.compile(rf"^({_NAME})/({_NAME})/tree/(.+)$")
_PLAIN = re.compile(rf"^({_NAME})/({_NAME})$")


def _strip_host(text: str) -> str:
    """Reduce any GitHub URL/SSH form to its `owner/repo/...` remainder."""
    s = text.strip()
    s = re.sub(r"^git\+", "", s)
    s = re.sub(r"^(https?://|ssh://)?(www\.)?github\.com[:/]", "", s, flags=re.I)
    s = re.sub(r"^git@github\.com:", "", s, flags=re.I)
    return s.strip("/")


def parse_repo_input(text: str, *, branch: str | None = None) -> RepoRef:
    """Turn user input into a RepoRef.

    Accepts::

        owner/repo
        https://github.com/owner/repo
        https://github.com/owner/repo.git
        git@github.com:owner/repo.git
        https://github.com/owner/repo/tree/break/subtle
        https://github.com/owner/repo/actions/runs/1234567890
        https://github.com/owner/repo/actions/runs/1234567890/job/42

    An explicit `branch=` argument always wins over one found in the URL.
    """
    if not text or not text.strip():
        raise RepoInputError("Enter a repository, e.g. `owner/repo`.")

    s = _strip_host(text)
    # Drop a trailing `.git` only when it terminates the repo segment.
    s = re.sub(r"\.git($|/)", r"\1", s)
    s = s.strip("/")

    if m := _RUN_URL.match(s):
        owner, repo, run_id = m.group(1), m.group(2), int(m.group(3))
        return RepoRef(owner, repo, run_id=run_id, branch=branch)

    if m := _TREE_URL.match(s):
        owner, repo, url_branch = m.group(1), m.group(2), m.group(3)
        return RepoRef(owner, repo, branch=branch or url_branch.strip("/"))

    if m := _PLAIN.match(s):
        return RepoRef(m.group(1), m.group(2), branch=branch)

    # `owner/repo/anything-else` -> still usable, take the first two segments.
    parts = [p for p in s.split("/") if p]
    if len(parts) >= 2 and re.fullmatch(_NAME, parts[0]) and re.fullmatch(_NAME, parts[1]):
        return RepoRef(parts[0], parts[1], branch=branch)

    raise RepoInputError(
        f"Could not read a repository out of {text!r}. "
        "Try `owner/repo` or the URL of a GitHub Actions run."
    )
