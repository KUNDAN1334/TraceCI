"""HTTP + SSE, exercised end to end with a scripted model and a fake GitHub."""

import json

import pytest
from conftest import SLUG
from fake_model import GOOD_DIAGNOSIS, Script, make_provider
from fastapi.testclient import TestClient

from traceci import api as api_mod

ALLOWED_EVENT_TYPES = {"step", "token", "result", "done", "error"}


@pytest.fixture
def app_client(gh_api, tmp_path, monkeypatch):
    """TestClient with a scripted model and a temp checkpoint DB.

    `respx` intercepts every httpx request, including the TestClient's own
    calls to the ASGI app, so `testserver` has to be passed through explicitly.
    """
    gh_api.router.route(host="testserver").pass_through()
    monkeypatch.setattr(api_mod, "DB_PATH", str(tmp_path / "cp.sqlite"))
    monkeypatch.setattr(api_mod, "GITHUB_TOKEN", "ghp_fake_from_env")

    def make(turns, repeat_last=False):
        script = Script(turns, GOOD_DIAGNOSIS, repeat_last=repeat_last)
        api_mod.app.state.model_provider = make_provider(script)
        client = TestClient(api_mod.app)
        return client, script

    yield make
    api_mod.app.state.model_provider = None


def events(client, **body):
    payload = {"repo": SLUG, "model": "gpt-4o-mini", "key": "sk-user-secret", **body}
    out = []
    with client.stream("POST", "/analyze", json=payload) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        for line in resp.iter_lines():
            if line.startswith("data: "):
                out.append(json.loads(line[6:]))
    return out


# -- plumbing ---------------------------------------------------------------
def test_health_and_catalog(app_client):
    client, _ = app_client(["done"])
    with client:
        assert client.get("/health").json()["ok"] is True
        cat = client.get("/models").json()
        # The default is a FREE model on purpose: the most common first run of
        # this project is somebody who has not got a paid key.
        assert cat["default"] == "groq-llama-3.3-70b"
        assert any(m["id"] == cat["default"] and m["free_tier"] for m in cat["models"])
        assert len(cat["models"]) >= 8
        # A curated dropdown, never free text: a model without tool calling
        # degrades silently into confident nonsense.
        assert all({"id", "label", "provider", "key_hint", "free_tier", "budget"} <= set(m)
                   for m in cat["models"])


def test_cors_headers_are_present_for_the_vercel_frontend(app_client):
    client, _ = app_client(["done"])
    with client:
        r = client.options("/analyze", headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        })
        assert r.headers["access-control-allow-origin"] == "http://localhost:3000"


# -- the stream -------------------------------------------------------------
def test_stream_emits_only_the_five_event_types(app_client):
    client, _ = app_client([
        [{"name": "read_file", "args": {"path": "app/auth.py"}}],
        "refresh() returns a dict now.",
    ])
    with client:
        evs = events(client)
    kinds = {e["type"] for e in evs}
    assert kinds <= ALLOWED_EVENT_TYPES, f"undeclared event type: {kinds - ALLOWED_EVENT_TYPES}"
    assert "step" in kinds and "result" in kinds and "done" in kinds
    assert evs[-1]["type"] == "done"
    assert "error" not in kinds


def test_step_labels_come_from_the_models_tool_calls(app_client):
    client, _ = app_client([
        [{"name": "read_file", "args": {"path": "app/auth.py"}}],
        [{"name": "search_code", "args": {"query": "def refresh"}}],
        "done",
    ])
    with client:
        evs = events(client)
    labels = [e["label"] for e in evs if e["type"] == "step"]
    assert "Opened app/auth.py" in labels
    assert "Searched the repo for 'def refresh'" in labels
    # ...and the deterministic prefetch narrates itself too, so the screen is
    # never blank during the slow 10-15s part.
    assert any("First failing step: Run tests" == ln for ln in labels)
    assert any(ln.startswith("Workflow `CI` failed") for ln in labels)


def test_result_event_carries_a_validated_diagnosis_and_a_thread_id(app_client):
    client, _ = app_client(["done"])
    with client:
        evs = events(client)
    result = [e for e in evs if e["type"] == "result"][0]
    assert result["thread_id"]
    d = result["diagnosis"]
    assert d["category"] == "test_failure"
    assert 1 <= d["confidence"] <= 10
    assert d["evidence"] and d["root_cause"] and d["suggested_fix"]


def test_token_events_exist_so_the_screen_is_not_blank(app_client):
    client, _ = app_client(["Reading the traceback: the caller is a test."])
    with client:
        evs = events(client)
    tokens = [e for e in evs if e["type"] == "token"]
    assert tokens, "no token events: a 15s blank screen reads as a hang"
    assert "".join(t["text"] for t in tokens).strip()


def test_the_users_api_key_never_appears_in_the_stream(app_client):
    client, _ = app_client([[{"name": "read_file", "args": {"path": "app/auth.py"}}], "done"])
    with client:
        evs = events(client)
    blob = json.dumps(evs)
    assert "sk-user-secret" not in blob
    assert "ghp_fake_from_env" not in blob


# -- the share link ---------------------------------------------------------
def test_get_analysis_round_trips_and_leaks_nothing(app_client):
    client, _ = app_client([[{"name": "read_file", "args": {"path": "app/auth.py"}}], "done"])
    with client:
        evs = events(client)
        thread_id = [e for e in evs if e["type"] == "result"][0]["thread_id"]
        got = client.get(f"/analysis/{thread_id}")
        assert got.status_code == 200
        body = got.json()

    assert body["repo"] == SLUG
    assert body["failed_step"] == "Run tests"
    assert body["tool_calls"] == 1
    assert body["diagnosis"]["category"] == "test_failure"
    raw = json.dumps(body)
    assert "sk-user-secret" not in raw and "ghp_" not in raw
    assert "api_key" not in raw


def test_unknown_thread_is_a_404_not_a_crash(app_client):
    client, _ = app_client(["done"])
    with client:
        r = client.get("/analysis/does-not-exist")
    assert r.status_code == 404
    assert "No analysis found" in r.json()["error"]


# -- the four edge cases, all friendly ---------------------------------------
def test_bad_repo_input_is_a_friendly_error_event(app_client):
    client, _ = app_client(["never reached"])
    with client:
        evs = events(client, repo="!!! not a repo !!!")
    err = [e for e in evs if e["type"] == "error"]
    assert err and "owner/repo" in err[0]["message"]
    assert "Traceback" not in err[0]["message"]
    assert evs[-1]["type"] == "done", "the stream must always terminate cleanly"


def test_no_failed_run_is_a_friendly_error_event(app_client):
    client, _ = app_client(["never reached"])
    with client:
        evs = events(client, branch="all-green")
    err = [e for e in evs if e["type"] == "error"]
    assert err and "No failed run" in err[0]["message"]
    assert evs[-1]["type"] == "done"


def test_expired_logs_are_a_friendly_error_event(app_client, gh_api):
    client, _ = app_client(["never reached"])
    gh_api.logs_status = 410   # GitHub deletes Actions logs after ~90 days
    with client:
        evs = events(client)
    err = [e for e in evs if e["type"] == "error"]
    assert err and "90 days" in err[0]["message"]


def test_an_unknown_model_id_is_rejected_before_anything_expensive(app_client):
    client, script = app_client(["never reached"])
    api_mod.app.state.model_provider = None  # use the real provider
    with client:
        evs = events(client, model="totally-made-up-model")
    err = [e for e in evs if e["type"] == "error"]
    assert err and "Unknown model" in err[0]["message"]


def test_missing_key_is_rejected_with_a_readable_message(app_client):
    client, _ = app_client(["never reached"])
    api_mod.app.state.model_provider = None
    with client:
        evs = events(client, key="")
    err = [e for e in evs if e["type"] == "error"]
    assert err and "API key is required" in err[0]["message"]


# -- /validate --------------------------------------------------------------
def test_validate_reports_a_model_that_does_not_call_tools(app_client, monkeypatch):
    """The silent killer: a valid key on a model with no tool calling. The
    graph skips every tool and produces fluent nonsense with no error anywhere."""
    from langchain_core.messages import AIMessage

    class NoToolsModel:
        def bind_tools(self, tools, **kw):
            return self

        def invoke(self, _msgs):
            return AIMessage(content="It is sunny in Pune.")  # no tool_calls

    monkeypatch.setattr("traceci.models.build_model", lambda *a, **k: NoToolsModel())
    client, _ = app_client(["x"])
    with client:
        r = client.post("/validate", json={"model": "gpt-4o-mini", "key": "sk-whatever"})
    assert r.status_code == 400
    assert "without calling the tool" in r.json()["message"]


def test_validate_accepts_a_model_that_does_call_tools(app_client, monkeypatch):
    from langchain_core.messages import AIMessage

    class GoodModel:
        def bind_tools(self, tools, **kw):
            return self

        def invoke(self, _msgs):
            return AIMessage(content="", tool_calls=[
                {"name": "_probe", "args": {"city": "Pune"}, "id": "1", "type": "tool_call"}])

    monkeypatch.setattr("traceci.models.build_model", lambda *a, **k: GoodModel())
    client, _ = app_client(["x"])
    with client:
        r = client.post("/validate", json={"model": "gpt-4o-mini", "key": "sk-good"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_validate_rejects_a_bad_key(app_client, monkeypatch):
    def boom(*a, **k):
        # Provider SDKs raise their own exception classes, not ours.
        raise RuntimeError("Error code: 401 - Incorrect API key provided")

    monkeypatch.setattr("traceci.models.build_model", boom)
    client, _ = app_client(["x"])
    with client:
        r = client.post("/validate", json={"model": "gpt-4o-mini", "key": "sk-bad"})
    assert r.status_code == 400
    assert "rejected" in r.json()["message"].lower()
