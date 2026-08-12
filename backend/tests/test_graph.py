"""The graph: routing, the bound, structured output, and the checkpointer.

All of it is exercised with a scripted model, so none of these tests need an
API key -- which is the point: the parts that are cheap to get wrong (routing,
the cap, secret handling) are the parts that must be testable offline.
"""

import json
import sqlite3

import pytest
from conftest import RUN_ID, SLUG
from fake_model import GOOD_DIAGNOSIS, Script, make_provider
from langgraph.checkpoint.sqlite import SqliteSaver

from traceci.graph import (
    MAX_ITERATIONS,
    Diagnosis,
    analysis_config,
    build_graph,
    count_tool_calls,
    enforce_honesty,
    friendly_error,
)
from traceci.tools import ToolSession


def run(turns, *, repeat_last=False, max_iterations=MAX_ITERATIONS, checkpointer=None,
        thread="t1", **cfg_kw):
    script = Script(turns, GOOD_DIAGNOSIS, repeat_last=repeat_last)
    graph, session = build_graph(
        ToolSession(), model_provider=make_provider(script),
        checkpointer=checkpointer, max_iterations=max_iterations,
    )
    config = analysis_config(
        thread, repo=SLUG, model="gpt-4o-mini", api_key="sk-secret-do-not-leak",
        github_token="ghp_secret_too", **cfg_kw,
    )
    state = graph.invoke({"messages": []}, config)
    return graph, session, script, state, config


# -- routing ---------------------------------------------------------------
def test_zero_tool_calls_goes_straight_to_diagnose(gh_api):
    """`break/dependency` should look like this: the log is enough."""
    _g, _s, script, state, _c = run(["The log states the cause outright."])
    assert count_tool_calls(state["messages"]) == 0
    assert script.structured_calls == 1
    assert state["diagnosis"]["category"] == "test_failure"


def test_one_tool_call_runs_the_real_tool_then_diagnoses(gh_api):
    """`break/subtle` should look like this: exactly one file opened."""
    _g, _s, _script, state, _c = run([
        [{"name": "read_file", "args": {"path": "app/auth.py"}}],
        "Found it: refresh() returns a dict.",
    ])
    assert count_tool_calls(state["messages"]) == 1
    tool_msgs = [m for m in state["messages"] if m.type == "tool"]
    assert len(tool_msgs) == 1
    assert "def refresh" in tool_msgs[0].content, "the real tool actually ran"
    assert state["iterations"] == 1


def test_prefetch_populates_state_before_the_model_ever_runs(gh_api):
    _g, _s, script, state, _c = run(["done"])
    assert state["repo"] == SLUG
    assert state["run_id"] == RUN_ID
    assert state["failed_step"] == "Run tests"
    assert "1 failed, 402 passed" in state["log_tail"]
    assert "app/rate_limit.py" in state["diff_summary"]
    # The very first model call already had the whole brief in front of it.
    assert script.invocations[0]["n_messages"] == 2  # system + brief


def test_parallel_tool_calls_in_one_turn_all_execute(gh_api):
    _g, _s, _script, state, _c = run([
        [{"name": "read_file", "args": {"path": "app/auth.py"}},
         {"name": "list_directory", "args": {"path": "app"}}],
        "Both read.",
    ])
    assert count_tool_calls(state["messages"]) == 2
    assert len([m for m in state["messages"] if m.type == "tool"]) == 2


# -- the bound -------------------------------------------------------------
@pytest.mark.parametrize("cap", [1, 2, 6])
def test_the_iteration_cap_is_enforced_in_code_not_in_the_prompt(gh_api, cap):
    """A model that never stops asking for tools must still terminate, and must
    still produce a diagnosis rather than a recursion error."""
    _g, _s, script, state, _c = run(
        [[{"name": "read_file", "args": {"path": "app/auth.py"}}]],
        repeat_last=True, max_iterations=cap,
    )
    assert count_tool_calls(state["messages"]) == cap
    assert state["iterations"] == cap
    assert state["diagnosis"] is not None
    # The final investigate call was made WITHOUT tools bound -- that is the
    # mechanism, not a hope that the model reads the prompt.
    assert script.invocations[-1]["tools_bound"] is False


def test_recursion_limit_is_a_backstop_with_a_readable_message(gh_api):
    from langgraph.errors import GraphRecursionError

    script = Script([[{"name": "read_file", "args": {"path": "app/auth.py"}}]],
                    GOOD_DIAGNOSIS, repeat_last=True)
    graph, _ = build_graph(ToolSession(), model_provider=make_provider(script),
                           max_iterations=99)
    config = analysis_config("t-rec", repo=SLUG, model="gpt-4o-mini", api_key="sk-x",
                             recursion_limit=6)
    with pytest.raises(GraphRecursionError) as exc:
        graph.invoke({"messages": []}, config)
    assert "step limit" in friendly_error(exc.value)


# -- typed output ----------------------------------------------------------
def test_diagnose_returns_a_validated_diagnosis(gh_api):
    _g, _s, _script, state, _c = run(["done"])
    d = Diagnosis(**state["diagnosis"])
    assert d.category == "test_failure"
    assert 1 <= d.confidence <= 10
    assert len(d.evidence) >= 2
    assert d.root_cause and d.suggested_fix


def test_the_schema_rejects_a_category_outside_the_literal():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Diagnosis(category="vibes", root_cause="x", evidence=[], confidence=5,
                  suggested_fix="y")


def test_confidence_is_normalised_by_the_pipeline_not_rejected_by_the_schema():
    """This guarantee deliberately moved, and the move is the interesting part.

    `confidence` used to carry `ge=1, le=10`, so an out-of-range value raised.
    That looked stricter and was in fact worse: providers validate generated
    tool arguments against this schema *server-side*, so a model emitting
    `"9"` as a string got the whole analysis rejected with a 400 after twenty
    seconds of real work -- an error the user can do nothing with.

    A schema shared with a non-deterministic producer should be liberal in
    what it accepts and strict about what it stores. So the schema now accepts
    the range of junk models actually emit, and `enforce_honesty` clamps it in
    exactly one place. The guarantee is unchanged from the caller's side: the
    number reaching the UI is always an int in 1..10.
    """
    assert Diagnosis(category="flaky", root_cause="x", evidence=[], confidence=42,
                     suggested_fix="y").confidence == 42

    for raw in (42, "9", 9.0, "high", -3):
        out = enforce_honesty({
            "category": "flaky",
            "root_cause": "A shared fixture leaks state between tests.",
            "evidence": ["FAILED tests/test_a.py::test_one"],
            "confidence": raw,
            "suggested_fix": "Reset the fixture.",
            "fix_snippet": "",
        })
        assert isinstance(out["confidence"], int)
        assert 1 <= out["confidence"] <= 10, f"{raw!r} -> {out['confidence']}"


# -- checkpointer ----------------------------------------------------------
def test_checkpointer_round_trips_the_thread(gh_api, tmp_path):
    db = tmp_path / "checkpoints.sqlite"
    conn = sqlite3.connect(db, check_same_thread=False)
    saver = SqliteSaver(conn)
    graph, _s, _script, state, config = run(
        [[{"name": "read_file", "args": {"path": "app/auth.py"}}], "done"],
        checkpointer=saver, thread="share-me",
    )
    # Re-read the thread the way GET /analysis/{thread_id} does.
    snapshot = graph.get_state({"configurable": {"thread_id": "share-me"}})
    assert snapshot.values["diagnosis"] == state["diagnosis"]
    assert snapshot.values["failed_step"] == "Run tests"
    assert count_tool_calls(snapshot.values["messages"]) == 1
    conn.close()


def test_no_api_key_is_ever_written_to_the_checkpoint(gh_api, tmp_path):
    """The checkpointer serialises state and the share link reads it back out.
    A key in state means every share link leaks somebody's key."""
    db = tmp_path / "checkpoints.sqlite"
    conn = sqlite3.connect(db, check_same_thread=False)
    graph, _s, _script, state, _c = run(
        ["done"], checkpointer=SqliteSaver(conn), thread="leaky",
    )
    conn.close()

    blob = db.read_bytes()
    assert b"sk-secret-do-not-leak" not in blob
    assert b"ghp_secret_too" not in blob
    assert b"api_key" not in blob
    # ...and it is not in the in-memory state either.
    assert "sk-secret" not in json.dumps(
        {k: str(v) for k, v in state.items()}
    )


def test_analysis_config_keeps_secrets_out_of_state_by_construction():
    from traceci.graph import KEY_API, KEY_GH_TOKEN, CIState

    cfg = analysis_config("t", repo="a/b", model="gpt-4o-mini", api_key="sk-1",
                          github_token="ghp_1")
    assert cfg["configurable"][KEY_API] == "sk-1"
    assert cfg["configurable"][KEY_GH_TOKEN] == "ghp_1"
    # The `__` prefix is load-bearing, not decoration: it is the only thing
    # LangGraph's get_checkpoint_metadata() honours.
    assert KEY_API.startswith("__") and KEY_GH_TOKEN.startswith("__")
    assert "api_key" not in CIState.__annotations__
    assert "github_token" not in CIState.__annotations__


def test_no_plain_named_secret_key_survives_into_metadata(gh_api, tmp_path):
    """Regression guard for the leak this project actually hit: putting the key
    in `config["configurable"]["api_key"]` is NOT enough -- LangGraph copies
    every str/int/bool in `configurable` into checkpoint metadata."""
    from langgraph.checkpoint.base import get_checkpoint_metadata

    from traceci.graph import KEY_API

    cfg = analysis_config("t", repo="a/b", model="gpt-4o-mini",
                          api_key="sk-leak-me", github_token="ghp_leak_me")
    meta = get_checkpoint_metadata(cfg, {"source": "loop", "step": 1})
    assert "sk-leak-me" not in repr(meta)
    assert "ghp_leak_me" not in repr(meta)
    assert meta.get("repo") == "a/b"          # non-secrets still travel
    assert KEY_API not in meta


# -- error surface ---------------------------------------------------------
def test_friendly_error_never_returns_a_stack_trace(gh_api):
    from traceci.github import GitHubError, LogsExpired, NoFailedRun
    from traceci.models import ModelError
    from traceci.repo_input import RepoInputError

    for exc in [RepoInputError("Enter a repository, e.g. `owner/repo`."),
                NoFailedRun("No failed run found for a/b."),
                LogsExpired("GitHub deleted these logs."),
                ModelError("That API key was rejected."),
                GitHubError("GitHub returned 500."),
                ValueError("some internal thing")]:
        msg = friendly_error(exc)
        assert msg and "Traceback" not in msg and len(msg) < 400


def test_a_bad_repo_fails_before_any_model_call(gh_api):
    from traceci.repo_input import RepoInputError

    script = Script(["never reached"], GOOD_DIAGNOSIS)
    graph, _ = build_graph(ToolSession(), model_provider=make_provider(script))
    config = analysis_config("t-bad", repo="!!!not a repo!!!", model="gpt-4o-mini",
                             api_key="sk-x")
    with pytest.raises(RepoInputError):
        graph.invoke({"messages": []}, config)
    assert script.invocations == []
