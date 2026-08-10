"""The recorded demo is a shipped artifact, so it is tested like one.

The demo button is the only thing most visitors will ever click. If the
recording drifts from the live event schema, the demo silently degrades and
the one path that has to work stops working.
"""

import json
import pathlib

import pytest

DEMO = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo-stream.json"
FIVE = {"step", "token", "result", "done", "error"}

pytestmark = pytest.mark.skipif(
    not DEMO.exists(), reason="run `python scripts/record_demo.py` first"
)


@pytest.fixture(scope="module")
def frames():
    return json.loads(DEMO.read_text())


def test_the_recording_uses_only_the_five_declared_event_types(frames):
    kinds = {f["event"]["type"] for f in frames}
    assert kinds <= FIVE, f"undeclared event type in the demo: {kinds - FIVE}"
    assert {"step", "token", "result", "done"} <= kinds


def test_every_frame_has_the_shape_the_frontend_reducer_expects(frames):
    for f in frames:
        assert isinstance(f["delay_ms"], int) and 0 <= f["delay_ms"] <= 5000
        ev = f["event"]
        if ev["type"] == "step":
            assert {"icon", "label"} <= set(ev)
        elif ev["type"] == "token":
            assert isinstance(ev["text"], str)
        elif ev["type"] == "result":
            assert {"diagnosis", "thread_id"} <= set(ev)


def test_the_demo_shows_the_subtle_case_being_solved_properly(frames):
    result = [f["event"] for f in frames if f["event"]["type"] == "result"][0]
    d = result["diagnosis"]
    assert d["category"] == "test_failure"
    assert "refresh" in d["root_cause"] and "dict" in d["root_cause"]
    # The point of the whole demo: the loud hunk is named and dismissed.
    assert "rate_limit" in d["root_cause"]
    assert d["confidence"] >= 8
    assert d["fix_snippet"].strip()


def test_the_demo_shows_exactly_one_tool_call(frames):
    """0 calls would mean the agent guessed; 5 would mean it was browsing."""
    opened = [f["event"]["label"] for f in frames
              if f["event"]["type"] == "step" and f["event"]["label"].startswith("Opened ")]
    assert opened == ["Opened app/auth.py"]


def test_the_demo_ends_cleanly_and_is_watchable(frames):
    assert frames[-1]["event"]["type"] == "done"
    assert not any(f["event"]["type"] == "error" for f in frames)
    seconds = sum(f["delay_ms"] for f in frames) / 1000
    assert 3 <= seconds <= 25, f"a {seconds:.0f}s demo will not get watched"


def test_the_recording_contains_no_secrets(frames):
    blob = json.dumps(frames)
    for needle in ["sk-", "ghp_", "api_key", "Authorization", "github_token"]:
        assert needle not in blob, f"the demo recording leaks `{needle}`"
