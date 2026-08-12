"""A thin, deliberately un-clever GitHub REST client.

No LangChain in this file. Everything here is deterministic: given a repo we
*always* want the failed run, the first failing step, the step log, the last
green commit and the diff. Handing that to an LLM as "tools it might call"
would just burn tokens and add failure modes. The agent's judgement starts
*after* this file has done its job.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

import httpx

API = "https://api.github.com"
UA = "TraceCI/0.1 (+https://github.com/)"


class GitHubError(RuntimeError):
    """Something went wrong talking to GitHub, with a message fit for a human."""


class LogsExpired(GitHubError):
    """Actions logs are deleted after ~90 days; the API then returns 410."""


class NoFailedRun(GitHubError):
    """We looked and there is no failed run to diagnose."""


# Conclusions that represent a real red build. `cancelled`, `skipped`,
# `neutral`, `stale` and `action_required` are red-ish in the UI but describe
# something that never produced a failure to explain.
FAILED_CONCLUSIONS = frozenset({"failure", "timed_out", "startup_failure"})

# Events that are bot maintenance rather than somebody's code change. Their
# logs are runner chatter and a diff against "last green" is meaningless,
# because the run is not about a commit at all.
_BOT_EVENTS = frozenset({"dependabot_security_updates", "dependabot_alerts"})

# Dependabot names its own update jobs after the ecosystem and directory, e.g.
# `npm_and_yarn in /web for nanoid - Update #1516931838`. Matching the name is
# what separates those from an ordinary CI workflow that merely happens to be
# running on a Dependabot pull request -- the latter is a genuine CI failure
# and must NOT be skipped, which is why the run's actor is deliberately not
# part of this test.
_BOT_RUN_NAME = re.compile(
    r"^(npm_and_yarn|pip|go_modules|github_actions|docker|bundler|cargo|composer|"
    r"gradle|maven|nuget|terraform|submodules)\b.*\bUpdate #\d+",
    re.I,
)


def undiagnosable_reason(run: dict) -> str | None:
    """Why this red run is not worth diagnosing, or `None` if it is.

    A pure function over the run payload, so the decision is testable without a
    network call and the interface can quote the reason back to the user
    instead of silently choosing something else.
    """
    event = (run.get("event") or "").lower()
    name = run.get("name") or ""

    if event in _BOT_EVENTS:
        return "a Dependabot security-update run, not a CI run"
    if _BOT_RUN_NAME.match(name.strip()):
        return "a dependency-bump run, not a CI run"
    if not run.get("head_sha"):
        return "no head commit, so there is nothing to diff against"
    return None


@dataclass
class StepRef:
    number: int
    name: str
    conclusion: str


@dataclass
class JobRef:
    id: int
    name: str
    conclusion: str
    steps: list[StepRef] = field(default_factory=list)


def _headers(token: str | None) -> dict[str, str]:
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": UA,
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


class GitHubClient:
    """Synchronous GitHub client scoped to one repository.

    A single `httpx.Client` is reused so that connection setup does not
    dominate the ~10 API calls a prefetch makes.
    """

    def __init__(self, owner: str, repo: str, token: str | None = None,
                 client: httpx.Client | None = None, timeout: float = 30.0):
        self.owner = owner
        self.repo = repo
        self.token = token
        self._client = client or httpx.Client(timeout=timeout, follow_redirects=True)
        self._owns_client = client is None
        # The run log zip is downloaded exactly once and kept in memory, so
        # `get_more_log` is free no matter how many times the agent calls it.
        self._log_archive: dict[str, str] | None = None

    # -- plumbing ---------------------------------------------------------
    @property
    def slug(self) -> str:
        return f"{self.owner}/{self.repo}"

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> GitHubClient:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _get(self, path: str, **params: Any) -> Any:
        url = path if path.startswith("http") else f"{API}{path}"
        r = self._client.get(url, headers=_headers(self.token), params=params or None)
        if r.status_code == 404:
            raise GitHubError(
                f"Not found: {url.replace(API, '')}. Check the repo name, and note "
                "that private repos need a token with access to them."
            )
        if r.status_code == 410:
            raise LogsExpired(
                "GitHub deleted these logs (Actions logs expire after ~90 days). "
                "Re-run the workflow to get a fresh log."
            )
        if r.status_code in (401, 403):
            remaining = r.headers.get("x-ratelimit-remaining")
            if remaining == "0":
                raise GitHubError(
                    "GitHub rate limit exhausted. Unauthenticated requests are capped "
                    "at 60/hour; set GITHUB_TOKEN to a classic PAT with `public_repo`."
                )
            raise GitHubError(
                "GitHub rejected the request (401/403). The token is missing, expired, "
                "or lacks the `public_repo` scope needed to download Actions logs."
            )
        if r.status_code >= 400:
            raise GitHubError(f"GitHub returned {r.status_code} for {url.replace(API, '')}.")
        return r.json()

    # -- runs / jobs ------------------------------------------------------
    def latest_failed_run(self, branch: str | None = None) -> dict:
        """Most recent *diagnosable* failed run, optionally on `branch`."""
        return self.select_failed_run(branch)[0]

    def select_failed_run(self, branch: str | None = None) -> tuple[dict, list[str]]:
        """`(run, notes)` -- the run to diagnose, and what was skipped to get it.

        Not every red run is a CI failure worth diagnosing. Dependabot's
        security-update runs are the common trap: they show as red on the
        Actions tab, their logs contain runner-provisioning chatter and no
        error at all, and picking one means diagnosing infrastructure instead
        of the user's code. Repositories whose actual CI is green routinely
        have several of these sitting at the top of the list, so "the most
        recent failed run" quietly becomes "a Dependabot job that never ran".

        `notes` exists so the interface can say which run was chosen and why,
        rather than silently diagnosing something the user was not asking
        about.
        """
        params: dict[str, Any] = {"per_page": 30}
        if branch:
            params["branch"] = branch
        data = self._get(f"/repos/{self.slug}/actions/runs", **params)
        runs = data.get("workflow_runs", [])
        failed = [r for r in runs if r.get("conclusion") in FAILED_CONCLUSIONS]

        notes: list[str] = []
        skipped = 0
        chosen: dict | None = None
        for run in failed:
            reason = undiagnosable_reason(run)
            if reason is None:
                chosen = run
                break
            skipped += 1
            if skipped <= 3:
                notes.append(f"skipped run #{run.get('run_number')}: {reason}")

        where = f" on branch `{branch}`" if branch else ""

        if chosen is not None:
            newer_green = [
                r for r in runs
                if r.get("conclusion") == "success"
                and (r.get("created_at") or "") > (chosen.get("created_at") or "")
            ]
            if newer_green:
                notes.append(
                    f"{len(newer_green)} newer run(s) succeeded; this failure is not the "
                    "latest state of the repository"
                )
            return chosen, notes

        if not runs:
            raise NoFailedRun(f"No workflow runs found for {self.slug}{where}.")

        if failed:
            # Everything red was infrastructure noise. Saying "no failed run"
            # here would contradict the red badges the user can see.
            detail = "; ".join(notes) or "they are not diagnosable CI failures"
            raise NoFailedRun(
                f"{self.slug}{where} has {len(failed)} failed run(s), but none of them are "
                f"CI failures TraceCI can diagnose ({detail}). "
                "If you meant one of them, paste its run URL directly."
            )

        raise NoFailedRun(
            f"No failed run found for {self.slug}{where}. "
            f"The {len(runs)} most recent runs are all green or still in progress."
        )

    def get_run(self, run_id: int) -> dict:
        return self._get(f"/repos/{self.slug}/actions/runs/{run_id}")

    def jobs(self, run_id: int) -> list[JobRef]:
        data = self._get(f"/repos/{self.slug}/actions/runs/{run_id}/jobs", per_page=100)
        out: list[JobRef] = []
        for j in data.get("jobs", []):
            steps = [
                StepRef(number=s.get("number", 0), name=s.get("name", ""),
                        conclusion=s.get("conclusion") or "")
                for s in j.get("steps", []) or []
            ]
            out.append(JobRef(id=j["id"], name=j.get("name", ""),
                              conclusion=j.get("conclusion") or "", steps=steps))
        return out

    @staticmethod
    def first_failing(jobs: list[JobRef]) -> tuple[JobRef, StepRef | None]:
        """The job that actually failed, and the first step in it that failed.

        "First failing step" is the whole game: it is what separates
        "dependency resolution blew up" from "a test regressed", and the log
        for that one step is a hundredth the size of the job log.

        Cancelled is ranked below failed, and that ordering is the point. When
        one job fails, GitHub cancels its siblings -- and a cancelled job that
        never got a runner has a log consisting entirely of "Waiting for a
        runner to pick up this job...". Treating cancelled and failed as one
        bucket and taking the first match therefore picks the collateral damage
        over the cause whenever the cancelled job happens to sort first, and
        hands the agent eight lines of provisioning output with no error in
        them. A cancelled job is only ever the answer when nothing else failed.
        """
        hard = {"failure", "timed_out"}
        soft = {"cancelled"}

        def first_step(job: JobRef, pool: set[str]) -> StepRef | None:
            failing = sorted(
                (s for s in job.steps if s.conclusion in pool), key=lambda s: s.number
            )
            return failing[0] if failing else None

        for job in jobs:
            if job.conclusion in hard:
                # Within a failed job, later steps are usually cancelled as a
                # consequence; the failed one is the cause.
                return job, (first_step(job, hard) or first_step(job, soft))

        for job in jobs:
            if job.conclusion in soft:
                return job, first_step(job, soft)

        if not jobs:
            raise GitHubError("This run has no jobs -- nothing to diagnose.")
        return jobs[0], None

    @staticmethod
    def pick_job_log(archive: dict[str, str], job_name: str) -> tuple[str, str]:
        """The whole-job log, used as a fallback when a step log has no error.

        The per-step split is a convenience, not a guarantee: step numbering in
        the zip can diverge from the API's, and some actions write their real
        output into a neighbouring step's file. When the step log turns out to
        contain no error, the job log certainly does, and reading it is far
        better than reporting that nothing failed.
        """
        def norm(s: str) -> str:
            return re.sub(r"[^a-z0-9]+", "", s.lower())

        key = norm(job_name)
        # Top-level entries (no directory part) are the whole-job transcripts.
        for path in sorted(p for p in archive if "/" not in p):
            if key and key in norm(path):
                return path, archive[path]

        steps = sorted(
            (p for p in archive if "/" in p and norm(p.split("/", 1)[0]) == key)
        )
        if steps:
            return f"{job_name} (all steps)", "\n".join(archive[p] for p in steps)
        return "", ""

    # -- logs -------------------------------------------------------------
    def download_run_log_archive(self, run_id: int) -> dict[str, str]:
        """Download the run's log **zip** and index every file inside it.

        Two traps here, both already paid for:

        * The endpoint 302s to a signed blob URL. Forwarding the
          `Authorization` header to that URL makes the storage backend reject
          the request, so: `follow_redirects=False`, read `Location`, re-issue
          on a clean client with no auth header.
        * Use the *run* zip, not the job-level log endpoint. The zip contains
          per-step files (`{job}/{step_number}_{step_name}.txt`), and per-step
          separation is exactly what tells "Install deps" from "Run tests".
        """
        if self._log_archive is not None:
            return self._log_archive

        url = f"{API}/repos/{self.slug}/actions/runs/{run_id}/logs"
        with httpx.Client(timeout=60.0, follow_redirects=False) as c:
            r = c.get(url, headers=_headers(self.token))

        if r.status_code == 410:
            raise LogsExpired(
                "GitHub has already deleted the logs for this run (they expire after "
                "~90 days). Re-run the workflow and try again."
            )
        if r.status_code in (401, 403):
            raise GitHubError(
                "GitHub refused to serve the logs. Downloading Actions logs requires a "
                "token -- an unauthenticated client cannot do it at all. Use a classic "
                "PAT with the `public_repo` scope."
            )

        if r.status_code in (301, 302, 307, 308):
            location = r.headers.get("location")
            if not location:
                raise GitHubError("GitHub redirected the log download without a Location.")
            # Clean client: no Authorization header, or the blob store 400s.
            with httpx.Client(timeout=120.0, follow_redirects=True) as blob:
                r = blob.get(location, headers={"User-Agent": UA})
        if r.status_code >= 400:
            raise GitHubError(f"Log download failed with HTTP {r.status_code}.")

        self._log_archive = self.index_log_zip(r.content)
        return self._log_archive

    @staticmethod
    def index_log_zip(data: bytes) -> dict[str, str]:
        """`{archive path: text}` for every log file in the run zip."""
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as exc:  # pragma: no cover - network weirdness
            raise GitHubError("The downloaded log archive was not a valid zip.") from exc
        out: dict[str, str] = {}
        for name in zf.namelist():
            if name.endswith("/"):
                continue
            with zf.open(name) as fh:
                out[name] = fh.read().decode("utf-8", errors="replace")
        return out

    @staticmethod
    def pick_step_log(archive: dict[str, str], job_name: str,
                      step: StepRef | None) -> tuple[str, str]:
        """Find the per-step file for `job_name`/`step`. Returns `(path, text)`.

        Zip layout is `{job_name}/{step_number}_{step_name}.txt`, with a
        top-level `{n}_{job_name}.txt` holding the whole job. Job and step names
        get sanitised inside the zip, so match loosely and fall back gracefully.
        """
        def norm(s: str) -> str:
            return re.sub(r"[^a-z0-9]+", "", s.lower())

        job_key = norm(job_name)
        in_job = {p: t for p, t in archive.items()
                  if "/" in p and norm(p.split("/", 1)[0]) == job_key}
        if not in_job:
            in_job = {p: t for p, t in archive.items() if "/" in p}

        if step is not None and in_job:
            want_num = f"{step.number}_"
            exact = [p for p in in_job if p.split("/", 1)[1].startswith(want_num)]
            if exact:
                p = sorted(exact)[0]
                return p, in_job[p]
            by_name = [p for p in in_job if norm(step.name) and norm(step.name) in norm(p)]
            if by_name:
                p = sorted(by_name)[0]
                return p, in_job[p]

        if in_job:
            p = sorted(in_job)[-1]
            return p, in_job[p]
        if archive:
            p = sorted(archive)[-1]
            return p, archive[p]
        raise GitHubError("The log archive was empty.")

    # -- commits / diff ---------------------------------------------------
    def last_green_sha(self, failing_run: dict) -> tuple[str, str]:
        """`(sha, how_we_found_it)` for the baseline to diff against.

        Preferred: the head SHA of the most recent *successful* run of the same
        workflow. Fallback: the failing commit's first parent -- which is what
        you get on a brand-new branch that has never been green.
        """
        workflow_id = failing_run.get("workflow_id")
        created = failing_run.get("created_at") or ""
        try:
            data = self._get(f"/repos/{self.slug}/actions/runs",
                             status="success", per_page=30)
            for run in data.get("workflow_runs", []):
                if workflow_id and run.get("workflow_id") != workflow_id:
                    continue
                if created and (run.get("created_at") or "") >= created:
                    continue
                sha = run.get("head_sha")
                if sha and sha != failing_run.get("head_sha"):
                    return sha, f"last successful run #{run.get('run_number')}"
        except GitHubError:
            pass  # fall through to the parent commit

        head = failing_run.get("head_sha")
        commit = self._get(f"/repos/{self.slug}/commits/{head}")
        parents = commit.get("parents") or []
        if not parents:
            raise GitHubError("The failing commit has no parent to diff against.")
        return parents[0]["sha"], "parent of the failing commit (no green run found)"

    def compare(self, base: str, head: str) -> dict:
        return self._get(f"/repos/{self.slug}/compare/{base}...{head}")

    # -- read-only repo access used by the agent's tools ------------------
    def get_file(self, path: str, ref: str) -> str:
        import base64

        data = self._get(f"/repos/{self.slug}/contents/{path.lstrip('/')}", ref=ref)
        if isinstance(data, list):
            raise GitHubError(f"`{path}` is a directory, not a file.")
        if data.get("encoding") != "base64":
            raise GitHubError(f"`{path}` is not a text file we can read.")
        raw = base64.b64decode(data["content"])
        return raw.decode("utf-8", errors="replace")

    def list_dir(self, path: str, ref: str) -> list[dict]:
        data = self._get(f"/repos/{self.slug}/contents/{path.strip('/')}", ref=ref)
        if isinstance(data, dict):
            return [data]
        return data

    def tree(self, ref: str) -> list[dict]:
        """Full recursive tree at an exact ref -- the basis for `search_code`.

        Deliberately NOT `GET /search/code`: that endpoint needs the repo to be
        indexed, silently ignores `ref` (so it searches the default branch, not
        the failing commit), and rate-limits at 10/min. The tree API takes one
        call and is exact.
        """
        data = self._get(f"/repos/{self.slug}/git/trees/{ref}", recursive="1")
        return [e for e in data.get("tree", []) if e.get("type") == "blob"]
