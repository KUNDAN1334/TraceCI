import pytest

from traceme.repo_input import RepoInputError, parse_repo_input


@pytest.mark.parametrize(
    "text,owner,repo",
    [
        ("kundan/traceme-lab", "kundan", "traceme-lab"),
        ("  kundan/traceme-lab  ", "kundan", "traceme-lab"),
        ("https://github.com/kundan/traceme-lab", "kundan", "traceme-lab"),
        ("http://github.com/kundan/traceme-lab/", "kundan", "traceme-lab"),
        ("https://www.github.com/kundan/traceme-lab", "kundan", "traceme-lab"),
        ("https://github.com/kundan/traceme-lab.git", "kundan", "traceme-lab"),
        ("git@github.com:kundan/traceme-lab.git", "kundan", "traceme-lab"),
        ("ssh://github.com/kundan/traceme-lab", "kundan", "traceme-lab"),
        ("github.com/kundan/traceme-lab", "kundan", "traceme-lab"),
        ("kundan/my.site.io", "kundan", "my.site.io"),
    ],
)
def test_accepts_every_shape_people_actually_paste(text, owner, repo):
    ref = parse_repo_input(text)
    assert (ref.owner, ref.repo) == (owner, repo)
    assert ref.full_name == f"{owner}/{repo}"


def test_extracts_run_id_from_an_actions_url():
    ref = parse_repo_input("https://github.com/kundan/traceme-lab/actions/runs/15938201234")
    assert ref.run_id == 15938201234
    assert ref.repo == "traceme-lab"


def test_extracts_run_id_from_a_job_url_too():
    ref = parse_repo_input(
        "https://github.com/kundan/traceme-lab/actions/runs/15938201234/job/44881122"
    )
    assert ref.run_id == 15938201234


def test_branch_names_with_slashes_survive():
    # The bug this guards: a `tree/([^/]+)` pattern yields branch="break",
    # which matches nothing and returns an empty run list.
    ref = parse_repo_input("https://github.com/kundan/traceme-lab/tree/break/subtle")
    assert ref.branch == "break/subtle"


def test_explicit_branch_argument_beats_the_url():
    ref = parse_repo_input(
        "https://github.com/kundan/traceme-lab/tree/break/subtle", branch="break/dependency"
    )
    assert ref.branch == "break/dependency"


@pytest.mark.parametrize("bad", ["", "   ", "not-a-repo", "https://gitlab.com/a/b/c/d/e/f/g/h"])
def test_rubbish_gets_a_readable_error(bad):
    with pytest.raises(RepoInputError) as exc:
        parse_repo_input(bad)
    assert "owner/repo" in str(exc.value) or "Enter a repository" in str(exc.value)
