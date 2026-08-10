"""Deterministic pre-fetch: everything we *always* need, gathered without an LLM.

This is the `fetch_failure` node of the graph. It runs before the model wakes
up and it never makes a judgement call -- it just guarantees the agent starts
from: the right run, the right failing step, a readable log window, and a diff
of green -> red. The agent's job begins where certainty ends.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .github import GitHubClient, GitHubError, JobRef, StepRef
from .log_window import LogWindow, build_log_window
from .models import NORMAL, ContextBudget
from .repo_input import RepoRef

MAX_DIFF_FILES = 40


@dataclass
class FailureContext:
    """Everything the deterministic layer knows. Read-only from here on."""

    repo: str
    run_id: int
    run_number: int
    run_url: str
    workflow_name: str
    branch: str
    head_sha: str
    base_sha: str
    base_source: str
    job_name: str
    failed_step: str
    failed_step_number: int
    log_window: LogWindow
    log_path: str
    diff_summary: str
    commit_subjects: list[str] = field(default_factory=list)
    changed_files: list[str] = field(default_factory=list)

    @property
    def log_tail(self) -> str:
        return self.log_window.text

    def to_public_dict(self) -> dict[str, Any]:
        """Safe to serialise into graph state / SSE. No secrets live here."""
        return {
            "repo": self.repo,
            "run_id": self.run_id,
            "run_number": self.run_number,
            "run_url": self.run_url,
            "workflow_name": self.workflow_name,
            "branch": self.branch,
            "head_sha": self.head_sha,
            "base_sha": self.base_sha,
            "job_name": self.job_name,
            "failed_step": self.failed_step,
            "log_lines": self.log_window.total_lines,
            "anchor_line": self.log_window.anchor_line,
            "anchor_tier": self.log_window.tier,
        }


def summarise_diff(compare: dict, *, max_files: int = MAX_DIFF_FILES) -> tuple[str, list[str], list[str]]:
    """Render `/compare` as a compact file-level summary.

    Deliberately a *summary*, not the patch. The full patch is one of the five
    tools -- the agent should have to decide it is worth the tokens. Files are
    sorted by size of change so the model sees the loudest hunk first, which is
    also exactly the trap the `subtle` break sets.
    """
    files = list(compare.get("files") or [])
    commits = compare.get("commits") or []
    subjects = [
        (c.get("commit", {}).get("message") or "").split("\n")[0][:120] for c in commits
    ]
    subjects = [s for s in subjects if s]

    files.sort(key=lambda f: -(f.get("changes") or 0))
    names = [f.get("filename", "?") for f in files]

    lines: list[str] = []
    ahead = compare.get("ahead_by", len(commits))
    lines.append(f"{len(files)} file(s) changed across {ahead} commit(s), green -> red.")
    if subjects:
        lines.append("")
        lines.append("Commits (newest last):")
        lines += [f"  - {s}" for s in subjects[-8:]]
    lines.append("")
    lines.append("Files (largest change first):")
    for f in files[:max_files]:
        lines.append(
            f"  {f.get('status', '?'):<9} +{f.get('additions', 0):<5} "
            f"-{f.get('deletions', 0):<5} {f.get('filename')}"
        )
    if len(files) > max_files:
        lines.append(f"  ... and {len(files) - max_files} more files")
    if not files:
        lines.append("  (none -- base and head are the same commit, or the compare was empty)")
    return "\n".join(lines), subjects, names


def prefetch(
    ref: RepoRef,
    token: str | None = None,
    *,
    client: GitHubClient | None = None,
    budget: ContextBudget = NORMAL,
) -> tuple[FailureContext, GitHubClient]:
    """Gather the full failure context. Returns the context and the live client.

    The client is returned rather than closed because the agent's tools reuse
    it -- notably the in-memory log archive, so `get_more_log` never re-downloads.
    """
    gh = client or GitHubClient(ref.owner, ref.repo, token)

    run = gh.get_run(ref.run_id) if ref.run_id else gh.latest_failed_run(ref.branch)
    run_id = int(run["id"])

    if ref.run_id and run.get("conclusion") not in {"failure", "timed_out", "startup_failure"}:
        raise GitHubError(
            f"Run #{run.get('run_number')} concluded `{run.get('conclusion') or 'in progress'}`, "
            "not a failure. Pick a red run."
        )

    jobs: list[JobRef] = gh.jobs(run_id)
    job, step = GitHubClient.first_failing(jobs)

    archive = gh.download_run_log_archive(run_id)
    log_path, step_log = GitHubClient.pick_step_log(archive, job.name, step)
    window = build_log_window(step_log, max_chars=budget.log_window_chars)

    head_sha = run.get("head_sha") or ""
    base_sha, base_source = gh.last_green_sha(run)
    try:
        cmp_data = gh.compare(base_sha, head_sha)
        diff_summary, subjects, names = summarise_diff(
            cmp_data, max_files=budget.diff_files)
    except GitHubError as exc:
        diff_summary, subjects, names = (f"(diff unavailable: {exc})", [], [])

    diff_summary = f"Baseline: {base_sha[:8]} ({base_source})\n{diff_summary}"

    step_ref: StepRef | None = step
    ctx = FailureContext(
        repo=gh.slug,
        run_id=run_id,
        run_number=int(run.get("run_number") or 0),
        run_url=run.get("html_url") or "",
        workflow_name=run.get("name") or "workflow",
        branch=run.get("head_branch") or ref.branch or "",
        head_sha=head_sha,
        base_sha=base_sha,
        base_source=base_source,
        job_name=job.name,
        failed_step=(step_ref.name if step_ref else "(no failing step recorded)"),
        failed_step_number=(step_ref.number if step_ref else 0),
        log_window=window,
        log_path=log_path,
        diff_summary=diff_summary,
        commit_subjects=subjects,
        changed_files=names,
    )
    return ctx, gh
