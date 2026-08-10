#!/usr/bin/env python
"""Record `frontend/public/demo-stream.json` for the no-key demo button.

The recording is produced by driving the *real* FastAPI app against the *real*
synthetic GitHub and a scripted model. That matters: the demo therefore replays
the genuine event stream, with the genuine schema, through the genuine reducer
in the frontend. A hand-written JSON file would drift the first time an event
field changed, and the demo would quietly become a lie.

    python scripts/record_demo.py
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

OUT = ROOT.parent / "frontend" / "public" / "demo-stream.json"

# What a good `break/subtle` run looks like: narrate, open exactly one file,
# conclude. Not zero calls (lazy, wrong) and not five (browsing).
TURNS = [
    {
        "text": (
            "The failing step is `Run tests` and the traceback is an AttributeError: "
            "'dict' object has no attribute 'expires_at'. That names the caller, not the "
            "cause -- something `refresh()` returns changed shape. The diff's biggest hunk "
            "is a 95-line rewrite of app/rate_limit.py, but nothing in the test suite "
            "imports it, so I am ignoring the loud change and opening app/auth.py."
        ),
        "calls": [{"name": "read_file", "args": {"path": "app/auth.py"}}],
    },
    (
        "Confirmed. `refresh()` now builds a Token and then returns "
        "`{'value': ..., 'user': ..., 'expires_at': ...}` instead of the Token itself, "
        "while still annotated `-> Token`. The test reads `.expires_at` off the result, "
        "which a dict does not have. The rate limiter rewrite is unrelated."
    ),
]

DIAGNOSIS = {
    "category": "test_failure",
    "root_cause": (
        "app/auth.py:refresh() was changed to return a plain dict instead of the Token it "
        "is still annotated to return. tests/unit/test_auth.py:47 reads .expires_at off "
        "that result and raises AttributeError. The token-bucket rewrite of "
        "app/rate_limit.py in the same commit is the largest hunk in the diff but is not "
        "imported anywhere in the test suite."
    ),
    "evidence": [
        "E       AttributeError: 'dict' object has no attribute 'expires_at'",
        "tests/unit/test_auth.py:47: AttributeError",
        "app/auth.py:18: return {'value': fresh.value, 'user': fresh.user, "
        "'expires_at': fresh.expires_at}",
        "1 failed, 402 passed in 12.41s",
    ],
    "confidence": 9,
    "suggested_fix": (
        "Return the Token from refresh() and move the dict conversion to the API "
        "serialisation layer, or update every caller and the type annotation together."
    ),
    "fix_snippet": (
        " def refresh(token: Token, now: int) -> Token:\n"
        "     if is_expired(token, now):\n"
        '         raise AuthError("cannot refresh an expired token")\n'
        "-    fresh = issue_token(token.user, now)\n"
        '-    return {"value": fresh.value, "user": fresh.user, '
        '"expires_at": fresh.expires_at}\n'
        "+    return issue_token(token.user, now)\n"
    ),
}

# Delays make the replay feel like the real thing: the prefetch really does
# take ten-odd seconds, but nobody wants to watch that, so it is compressed.
DELAYS = {"step": 620, "token": 26, "result": 500, "done": 120, "error": 300}


def main() -> int:
    import conftest  # from tests/
    import respx
    from fake_model import Script, make_provider
    from fastapi.testclient import TestClient

    from traceme import api as api_mod

    with respx.mock(assert_all_called=False) as router:
        conftest.FakeGitHub(router)   # registers every route on the router
        router.route(host="testserver").pass_through()

        tmpdb = pathlib.Path(tempfile.mkdtemp()) / "demo.sqlite"
        api_mod.DB_PATH = str(tmpdb)
        api_mod.GITHUB_TOKEN = "ghp_recording"
        api_mod.app.state.model_provider = make_provider(Script(TURNS, DIAGNOSIS))

        frames: list[dict] = []
        with TestClient(api_mod.app) as client:
            with client.stream("POST", "/analyze", json={
                "repo": conftest.SLUG, "branch": "break/subtle",
                "model": "groq-llama-3.3-70b", "key": "gsk-recording-only",
            }) as resp:
                assert resp.status_code == 200
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    event = json.loads(line[6:])
                    frames.append({"delay_ms": DELAYS.get(event["type"], 200), "event": event})

        api_mod.app.state.model_provider = None

    blob = json.dumps(frames)
    assert "gsk-recording-only" not in blob, "the recording leaked the key"
    assert "ghp_recording" not in blob, "the recording leaked the GitHub token"

    # Split the long prose into token-sized chunks so the replay types it out
    # the way a live stream does.
    expanded: list[dict] = []
    for f in frames:
        if f["event"]["type"] != "token":
            expanded.append(f)
            continue
        words = f["event"]["text"].split(" ")
        for i in range(0, len(words), 3):
            expanded.append({
                "delay_ms": 34,
                "event": {"type": "token", "text": " ".join(words[i:i + 3]) + " "},
            })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(expanded, indent=1))
    kinds: dict[str, int] = {}
    for f in expanded:
        kinds[f["event"]["type"]] = kinds.get(f["event"]["type"], 0) + 1
    total = sum(f["delay_ms"] for f in expanded) / 1000
    print(f"wrote {OUT.relative_to(ROOT.parent)}")
    print(f"  {len(expanded)} frames, ~{total:.1f}s replay, event types: {kinds}")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("TRACEME_DB", ":memory:")
    raise SystemExit(main())
