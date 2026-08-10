"""Synthetic GitHub, good enough to exercise every code path without a token.

Everything here is recorded-by-hand but shaped exactly like the real API
responses, including the bits that bite: the log endpoint's 302 to a signed
blob URL, the `{job}/{step}_{name}.txt` layout inside the run zip, and a
`/compare` payload whose largest hunk is deliberately not the cause.
"""

from __future__ import annotations

import base64
import io
import pathlib
import zipfile

import httpx
import pytest
import respx

from traceme.github import GitHubClient

FIXTURES = pathlib.Path(__file__).parent / "fixtures"

OWNER, REPO = "kundan", "traceme-lab"
SLUG = f"{OWNER}/{REPO}"
HEAD_SHA = "c0ffee1234567890abcdef1234567890abcdef12"
BASE_SHA = "beef0009876543210fedcba9876543210fedcba9"
RUN_ID = 15938201234
BLOB_URL = "https://pipelines.actions.githubusercontent.com/serviceHosts/xyz/logs?sig=SIGNED"


def load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# response bodies
# --------------------------------------------------------------------------
def make_run(conclusion: str = "failure", run_id: int = RUN_ID, number: int = 42,
             sha: str = HEAD_SHA, branch: str = "break/subtle",
             created: str = "2026-08-04T09:00:00Z") -> dict:
    return {
        "id": run_id,
        "name": "CI",
        "run_number": number,
        "workflow_id": 77001,
        "head_branch": branch,
        "head_sha": sha,
        "status": "completed",
        "conclusion": conclusion,
        "created_at": created,
        "html_url": f"https://github.com/{SLUG}/actions/runs/{run_id}",
    }


GREEN_RUN = make_run(conclusion="success", run_id=RUN_ID - 3, number=41, sha=BASE_SHA,
                     branch="main", created="2026-08-04T08:00:00Z")

JOBS = {
    "total_count": 1,
    "jobs": [
        {
            "id": 44881122,
            "name": "build",
            "conclusion": "failure",
            "steps": [
                {"number": 1, "name": "Set up job", "conclusion": "success"},
                {"number": 2, "name": "Checkout", "conclusion": "success"},
                {"number": 3, "name": "Set up Python", "conclusion": "success"},
                {"number": 4, "name": "Install deps", "conclusion": "success"},
                {"number": 5, "name": "Lint", "conclusion": "success"},
                {"number": 6, "name": "Run tests", "conclusion": "failure"},
                {"number": 7, "name": "Post Checkout", "conclusion": "success"},
            ],
        }
    ],
}

# The `subtle` diff: a 60-line rewrite of a module nothing imports, advertised
# by the commit message, plus a 3-line change to the function the failing test
# actually depends on.
COMPARE = {
    "status": "ahead",
    "ahead_by": 1,
    "commits": [
        {"sha": HEAD_SHA, "commit": {"message":
            "perf(rate-limit): replace fixed window with a token bucket for burst traffic"}},
    ],
    "files": [
        {"filename": "app/rate_limit.py", "status": "modified",
         "additions": 61, "deletions": 34, "changes": 95,
         "patch": "@@ -1,34 +1,61 @@\n-class RateLimiter:\n+@dataclass\n+class RateLimiter:\n"},
        {"filename": "app/auth.py", "status": "modified",
         "additions": 3, "deletions": 1, "changes": 4,
         "patch": "@@ -60,4 +60,6 @@ def refresh(token, now):\n-    return issue_token(token.user, now)\n"
                  "+    fresh = issue_token(token.user, now)\n"
                  "+    return {\"value\": fresh.value, \"user\": fresh.user, "
                  "\"expires_at\": fresh.expires_at}\n"},
    ],
}

REPO_FILES: dict[str, str] = {
    "app/auth.py": (
        "from dataclasses import dataclass\n\n"
        "TOKEN_TTL_SECONDS = 3600\n\n\n"
        "@dataclass(frozen=True)\nclass Token:\n"
        "    value: str\n    user: str\n    expires_at: int\n\n\n"
        "def issue_token(user, now):\n"
        "    return Token(value='x', user=user, expires_at=now + TOKEN_TTL_SECONDS)\n\n\n"
        "def refresh(token, now):\n"
        "    fresh = issue_token(token.user, now)\n"
        "    return {'value': fresh.value, 'user': fresh.user, 'expires_at': fresh.expires_at}\n"
    ),
    "app/rate_limit.py": "class RateLimiter:\n    pass\n",
    "tests/test_auth.py": (
        "from app.auth import issue_token, refresh\n\n\n"
        "def test_refresh_extends_session():\n"
        "    token = issue_token('alice', now=1000)\n"
        "    renewed = refresh(token, now=2000)\n"
        "    assert renewed.user == 'alice'\n"
    ),
    "README.md": "# traceme-lab\n",
}


def make_log_zip() -> bytes:
    """A run log zip with the real per-step layout."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("build/1_Set up job.txt", "2026-08-04T09:00:00.0000000Z Job set up\n")
        z.writestr("build/2_Checkout.txt", "2026-08-04T09:00:01.0000000Z Checked out\n")
        z.writestr("build/3_Set up Python.txt", load("log_setup_python.txt"))
        z.writestr("build/4_Install deps.txt", load("log_pip_resolution.txt"))
        z.writestr("build/5_Lint.txt", load("log_ruff.txt"))
        z.writestr("build/6_Run tests.txt", load("log_early_error_late_summary.txt"))
        z.writestr("0_build.txt", "whole-job log, useless for step attribution\n")
    return buf.getvalue()


# --------------------------------------------------------------------------
# the mock
# --------------------------------------------------------------------------
class FakeGitHub:
    """Registers every route GitHubClient touches. Records what it was asked."""

    def __init__(self, router: respx.Router):
        self.router = router
        self.blob_headers: dict[str, str] = {}
        self.content_refs: list[str] = []
        self.tree_refs: list[str] = []
        self.log_downloads = 0
        self.logs_status: int | None = None   # set to 410 to simulate expiry
        self.methods: list[str] = []
        self._install()

    def _install(self) -> None:
        r = self.router
        api = "https://api.github.com"

        def record(request):
            self.methods.append(request.method)

        r.get(f"{api}/repos/{SLUG}/actions/runs").mock(side_effect=self._runs)
        r.get(f"{api}/repos/{SLUG}/actions/runs/{RUN_ID}").mock(
            return_value=httpx.Response(200, json=make_run()))
        r.get(f"{api}/repos/{SLUG}/actions/runs/{RUN_ID}/jobs").mock(
            return_value=httpx.Response(200, json=JOBS))
        r.get(f"{api}/repos/{SLUG}/actions/runs/{RUN_ID}/logs").mock(side_effect=self._logs)
        r.get(url__startswith=BLOB_URL.split("?")[0]).mock(side_effect=self._blob)
        r.get(f"{api}/repos/{SLUG}/compare/{BASE_SHA}...{HEAD_SHA}").mock(
            return_value=httpx.Response(200, json=COMPARE))
        r.get(url__regex=rf"{api}/repos/{SLUG}/commits/.+").mock(
            return_value=httpx.Response(200, json={
                "sha": HEAD_SHA, "parents": [{"sha": BASE_SHA}]}))
        r.get(url__regex=rf"{api}/repos/{SLUG}/contents/.*").mock(side_effect=self._contents)
        r.get(url__regex=rf"{api}/repos/{SLUG}/git/trees/.*").mock(side_effect=self._tree)

    # -- handlers ---------------------------------------------------------
    def _runs(self, request: httpx.Request) -> httpx.Response:
        self.methods.append(request.method)
        status = request.url.params.get("status")
        branch = request.url.params.get("branch")
        if status == "success":
            return httpx.Response(200, json={"workflow_runs": [GREEN_RUN]})
        if branch == "no-such-branch":
            return httpx.Response(200, json={"workflow_runs": []})
        if branch == "all-green":
            return httpx.Response(200, json={"workflow_runs": [GREEN_RUN]})
        return httpx.Response(200, json={"workflow_runs": [make_run()]})

    def _logs(self, request: httpx.Request) -> httpx.Response:
        self.log_downloads += 1
        if self.logs_status:
            return httpx.Response(self.logs_status)
        return httpx.Response(302, headers={"Location": BLOB_URL})

    def _blob(self, request: httpx.Request) -> httpx.Response:
        self.blob_headers = dict(request.headers)
        return httpx.Response(200, content=make_log_zip())

    def _contents(self, request: httpx.Request) -> httpx.Response:
        path = str(request.url.path).split("/contents/", 1)[1]
        self.content_refs.append(request.url.params.get("ref", ""))
        if path in ("", "/"):
            path = ""
        if path in REPO_FILES:
            return httpx.Response(200, json={
                "name": path.split("/")[-1], "path": path, "type": "file",
                "encoding": "base64",
                "content": base64.b64encode(REPO_FILES[path].encode()).decode(),
            })
        # directory listing
        entries = []
        prefix = f"{path.rstrip('/')}/" if path else ""
        seen = set()
        for f in REPO_FILES:
            if not f.startswith(prefix):
                continue
            rest = f[len(prefix):]
            head = rest.split("/")[0]
            if head in seen:
                continue
            seen.add(head)
            entries.append({
                "name": head, "path": prefix + head,
                "type": "dir" if "/" in rest else "file",
                "size": 0 if "/" in rest else len(REPO_FILES[f]),
            })
        if not entries:
            return httpx.Response(404, json={"message": "Not Found"})
        return httpx.Response(200, json=entries)

    def _tree(self, request: httpx.Request) -> httpx.Response:
        self.tree_refs.append(str(request.url.path).rsplit("/", 1)[-1])
        return httpx.Response(200, json={"tree": [
            {"path": p, "type": "blob", "size": len(c)} for p, c in REPO_FILES.items()
        ]})


@pytest.fixture
def gh_api():
    """respx router with the whole synthetic GitHub mounted."""
    with respx.mock(assert_all_called=False) as router:
        yield FakeGitHub(router)


@pytest.fixture
def client(gh_api):
    c = GitHubClient(OWNER, REPO, token="ghp_faketoken")
    yield c
    c.close()
