"""The five tools: they work, they are read-only, they are pinned to the SHA,
and their docstrings are written as decision criteria."""

import pytest
from conftest import BASE_SHA, HEAD_SHA, SLUG

from traceci.prefetch import prefetch
from traceci.repo_input import parse_repo_input
from traceci.tools import ToolSession, build_tools, describe_tool_call

EXPECTED = {"read_file", "get_full_diff", "search_code", "list_directory", "get_more_log"}


@pytest.fixture
def bound(gh_api):
    session = ToolSession()
    tools = build_tools(session)
    ctx, gh = prefetch(parse_repo_input(SLUG), token="ghp_fake")
    session.bind(gh, ctx)
    yield {t.name: t for t in tools}, session
    gh.close()


def test_there_are_exactly_five_tools(gh_api):
    tools = build_tools(ToolSession())
    assert {t.name for t in tools} == EXPECTED


def test_tools_refuse_to_run_before_the_context_exists(gh_api):
    tools = {t.name: t for t in build_tools(ToolSession())}
    out = tools["read_file"].invoke({"path": "app/auth.py"})
    assert "before the failure context was fetched" in out


# -- behaviour --------------------------------------------------------------
def test_read_file_returns_numbered_source_at_the_failing_sha(bound):
    tools, session = bound
    out = tools["read_file"].invoke({"path": "app/auth.py"})
    assert "app/auth.py @ " + HEAD_SHA[:8] in out
    assert "def refresh" in out
    assert "    1| " in out, "line numbers matter: evidence is cited as file:line"
    assert session.gh  # still bound


def test_every_tool_reads_at_the_failing_sha_not_the_default_branch(bound, gh_api):
    """Reading `main` while diagnosing `break/subtle` returns the *fixed* file
    and produces a diagnosis that contradicts the log."""
    tools, _ = bound
    tools["read_file"].invoke({"path": "app/auth.py"})
    tools["list_directory"].invoke({"path": "app"})
    tools["search_code"].invoke({"query": "def refresh"})
    assert set(gh_api.content_refs) == {HEAD_SHA}
    assert set(gh_api.tree_refs) == {HEAD_SHA}


def test_read_file_on_a_missing_path_is_a_message_not_an_exception(bound):
    tools, _ = bound
    out = tools["read_file"].invoke({"path": "nope/missing.py"})
    assert "Could not read" in out and "Not found" in out


def test_get_full_diff_can_be_narrowed_to_one_file(bound):
    tools, _ = bound
    out = tools["get_full_diff"].invoke({"path": "app/auth.py"})
    assert "app/auth.py" in out
    assert "app/rate_limit.py" not in out
    assert "@@" in out, "this tool is the one that returns real hunks"


def test_get_full_diff_unchanged_file_lists_what_did_change(bound):
    tools, _ = bound
    out = tools["get_full_diff"].invoke({"path": "README.md"})
    assert "was not changed" in out
    assert "app/rate_limit.py" in out


def test_get_full_diff_without_a_path_returns_everything(bound):
    tools, _ = bound
    out = tools["get_full_diff"].invoke({"path": ""})
    assert "app/auth.py" in out and "app/rate_limit.py" in out
    assert f"{BASE_SHA[:8]}...{HEAD_SHA[:8]}" in out


def test_search_code_finds_a_definition_with_file_and_line(bound):
    tools, _ = bound
    out = tools["search_code"].invoke({"query": "def refresh"})
    assert "app/auth.py:" in out
    assert "def refresh" in out


def test_search_code_honours_a_path_filter_and_reports_misses(bound):
    tools, _ = bound
    assert "No match" in tools["search_code"].invoke({"query": "zzz-not-here"})
    out = tools["search_code"].invoke({"query": "refresh", "path_filter": "tests/"})
    assert "tests/test_auth.py" in out
    assert "app/auth.py" not in out


def test_list_directory_lists_the_repo_at_the_sha(bound):
    tools, _ = bound
    out = tools["list_directory"].invoke({"path": "app"})
    assert "auth.py" in out and "rate_limit.py" in out
    assert HEAD_SHA[:8] in out


def test_get_more_log_pages_the_cleaned_step_log(bound):
    tools, session = bound
    total = session.ctx.log_window.total_lines
    out = tools["get_more_log"].invoke({"start_line": 1, "num_lines": 20})
    assert f"lines 1-20 of {total}" in out
    assert "     1| " in out
    deep = tools["get_more_log"].invoke({"start_line": 200, "num_lines": 5})
    assert "lines 200-204" in deep


def test_get_more_log_never_redownloads(bound, gh_api):
    tools, _ = bound
    for start in (1, 100, 200, 300):
        tools["get_more_log"].invoke({"start_line": start, "num_lines": 10})
    assert gh_api.log_downloads == 1


def test_nothing_writes(bound, gh_api):
    """Read-only is a property of the code, so assert on the HTTP verbs used."""
    tools, _ = bound
    for name, args in [
        ("read_file", {"path": "app/auth.py"}),
        ("get_full_diff", {"path": ""}),
        ("search_code", {"query": "Token"}),
        ("list_directory", {"path": ""}),
        ("get_more_log", {"start_line": 1, "num_lines": 5}),
    ]:
        tools[name].invoke(args)
    calls = [c.request.method for c in gh_api.router.calls]
    assert set(calls) == {"GET"}, f"a non-GET slipped in: {set(calls)}"


# -- the docstrings ARE the interface ---------------------------------------
@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_docstrings_are_decision_criteria_not_descriptions(gh_api, name):
    tools = {t.name: t for t in build_tools(ToolSession())}
    doc = tools[name].description
    assert "USE THIS WHEN" in doc or "USE THIS" in doc, f"{name}: no positive criterion"
    assert "DO NOT USE IT" in doc, f"{name}: no negative criterion (this is what stops over-calling)"
    assert "Args:" in doc
    assert len(doc) > 400, f"{name}: too thin to steer a model"


# -- stream labels ----------------------------------------------------------
def test_tool_calls_render_as_human_step_labels():
    assert describe_tool_call("read_file", {"path": "app/auth.py"}) == ("check", "Opened app/auth.py")
    assert describe_tool_call("search_code", {"query": "def refresh"})[1].startswith("Searched")
    assert describe_tool_call("get_full_diff", {})[1] == "Read the full patch"
    assert describe_tool_call("list_directory", {"path": ""})[1] == "Listed /"
    assert describe_tool_call("get_more_log", {"start_line": 10, "num_lines": 20})[1] == (
        "Pulled log lines 10-29")
    assert describe_tool_call("mystery_tool", {})[1] == "Called mystery_tool"
