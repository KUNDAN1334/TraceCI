"""GitHub client tests, driven entirely by the synthetic API in conftest."""

import httpx
import pytest
import respx
from conftest import BASE_SHA, HEAD_SHA, OWNER, REPO, RUN_ID, SLUG, make_run

from traceci.github import GitHubClient, GitHubError, JobRef, LogsExpired, NoFailedRun, StepRef


def test_finds_the_latest_failed_run(client):
    run = client.latest_failed_run()
    assert run["id"] == RUN_ID
    assert run["conclusion"] == "failure"


def test_no_failed_run_is_a_message_not_a_crash(client):
    with pytest.raises(NoFailedRun) as exc:
        client.latest_failed_run(branch="all-green")
    assert "all green or still in progress" in str(exc.value)


def test_first_failing_job_then_first_failing_step(client):
    jobs = client.jobs(RUN_ID)
    job, step = GitHubClient.first_failing(jobs)
    assert job.name == "build"
    assert step is not None
    # Step 6, not step 7 -- "first failing", and definitely not the last step.
    assert (step.number, step.name) == (6, "Run tests")


def test_first_failing_picks_the_lowest_numbered_failing_step():
    jobs = [JobRef(id=1, name="b", conclusion="failure", steps=[
        StepRef(5, "Late", "failure"), StepRef(2, "Early", "failure"),
        StepRef(1, "Fine", "success")])]
    _job, step = GitHubClient.first_failing(jobs)
    assert step.number == 2


# -- the log download, which is where the traps are ------------------------
def test_log_download_follows_the_302_without_leaking_the_auth_header(client, gh_api):
    """The signed blob URL rejects requests that carry an unexpected
    Authorization header. `follow_redirects=False` + a clean re-issue is the
    only thing that works."""
    archive = client.download_run_log_archive(RUN_ID)
    assert gh_api.log_downloads == 1
    assert "authorization" not in {k.lower() for k in gh_api.blob_headers}
    assert "build/6_Run tests.txt" in archive


def test_the_archive_is_downloaded_once_and_cached(client, gh_api):
    client.download_run_log_archive(RUN_ID)
    client.download_run_log_archive(RUN_ID)
    client.download_run_log_archive(RUN_ID)
    assert gh_api.log_downloads == 1, "get_more_log must never re-download"


def test_expired_logs_get_an_explicit_message():
    with respx.mock:
        respx.get(f"https://api.github.com/repos/{SLUG}/actions/runs/{RUN_ID}/logs").mock(
            return_value=httpx.Response(410))
        c = GitHubClient(OWNER, REPO, token="x")
        with pytest.raises(LogsExpired) as exc:
            c.download_run_log_archive(RUN_ID)
    assert "90 days" in str(exc.value)


def test_unauthenticated_log_download_explains_the_token_requirement():
    with respx.mock:
        respx.get(f"https://api.github.com/repos/{SLUG}/actions/runs/{RUN_ID}/logs").mock(
            return_value=httpx.Response(403))
        c = GitHubClient(OWNER, REPO, token=None)
        with pytest.raises(GitHubError) as exc:
            c.download_run_log_archive(RUN_ID)
    assert "public_repo" in str(exc.value)


def test_rate_limit_exhaustion_says_so():
    with respx.mock:
        respx.get(f"https://api.github.com/repos/{SLUG}/actions/runs").mock(
            return_value=httpx.Response(403, headers={"x-ratelimit-remaining": "0"}))
        c = GitHubClient(OWNER, REPO, token=None)
        with pytest.raises(GitHubError) as exc:
            c.latest_failed_run()
    assert "60/hour" in str(exc.value)


# -- step selection ---------------------------------------------------------
def test_pick_step_log_returns_the_step_not_the_whole_job(client):
    archive = client.download_run_log_archive(RUN_ID)
    step = StepRef(number=6, name="Run tests", conclusion="failure")
    path, text = GitHubClient.pick_step_log(archive, "build", step)
    assert path == "build/6_Run tests.txt"
    assert "AttributeError" in text
    assert "useless for step attribution" not in text


def test_pick_step_log_distinguishes_install_from_tests(client):
    archive = client.download_run_log_archive(RUN_ID)
    install = StepRef(4, "Install deps", "failure")
    path, text = GitHubClient.pick_step_log(archive, "build", install)
    assert path == "build/4_Install deps.txt"
    assert "No matching distribution" in text
    assert "AttributeError" not in text


def test_pick_step_log_falls_back_when_the_step_is_unknown(client):
    archive = client.download_run_log_archive(RUN_ID)
    path, text = GitHubClient.pick_step_log(archive, "build", None)
    assert path.startswith("build/")
    assert text


# -- baseline / diff --------------------------------------------------------
def test_last_green_sha_prefers_the_last_successful_run(client):
    sha, how = client.last_green_sha(make_run())
    assert sha == BASE_SHA
    assert "last successful run" in how


def test_last_green_sha_falls_back_to_the_parent_commit():
    """A brand-new break/* branch has never been green, so there is no
    successful run of that workflow to diff against."""
    with respx.mock(assert_all_called=False) as r:
        r.get(f"https://api.github.com/repos/{SLUG}/actions/runs").mock(
            return_value=httpx.Response(200, json={"workflow_runs": []}))
        r.get(url__regex=r".*/commits/.+").mock(
            return_value=httpx.Response(200, json={"parents": [{"sha": "dead" * 10}]}))
        c = GitHubClient(OWNER, REPO, token="x")
        sha, how = c.last_green_sha(make_run())
    assert sha == "dead" * 10
    assert "parent of the failing commit" in how


def test_compare_and_tree_are_pinned_to_the_sha_we_asked_for(client, gh_api):
    data = client.compare(BASE_SHA, HEAD_SHA)
    assert data["files"][0]["filename"] == "app/rate_limit.py"
    client.tree(HEAD_SHA)
    assert gh_api.tree_refs == [HEAD_SHA]


def test_get_file_decodes_base64_at_a_ref(client, gh_api):
    text = client.get_file("app/auth.py", HEAD_SHA)
    assert "def refresh" in text
    assert gh_api.content_refs == [HEAD_SHA]


def test_404_mentions_the_repo_name_and_private_repos(client):
    with pytest.raises(GitHubError) as exc:
        client.get_file("does/not/exist.py", HEAD_SHA)
    assert "Not found" in str(exc.value)
