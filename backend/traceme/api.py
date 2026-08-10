"""FastAPI + Server-Sent Events.

Why SSE and not "POST, wait, render": the deterministic prefetch alone takes
10-15 seconds (list runs, list jobs, download and unzip a multi-megabyte log
archive, resolve the baseline, fetch the compare). Fifteen seconds of blank
screen reads as a hang, and the reader's first assumption is that the app is
broken, not that it is working. So the stream starts emitting the moment the
first API call returns.

Exactly five event types, because the frontend should never have to guess:

    {"type":"step","icon":"check","label":"Opened app/auth.py","detail":"..."}
    {"type":"token","text":"..."}
    {"type":"result","diagnosis":{...},"thread_id":"..."}
    {"type":"done"}
    {"type":"error","message":"..."}

`step` events are derived from the AIMessage's `tool_calls`, so the timeline
the user watches is literally the agent's decisions -- not a fake progress bar.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel, Field

from .graph import analysis_config, build_graph, count_tool_calls, friendly_error
from .models import DEFAULT_MODEL_ID, catalog_payload, validate_key
from .tools import ToolSession, describe_tool_call

# Unlike scripts/run_agent.py (which loads this itself), nothing loaded .env
# before this import until now -- uvicorn just runs `traceme.api:app`. Without
# this call GITHUB_TOKEN is only ever a real OS env var, never a `.env` value,
# no matter which directory uvicorn is started from.
load_dotenv()

DB_PATH = os.getenv("TRACEME_DB", "./traceme_checkpoints.sqlite")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",") if o.strip()
]


# --------------------------------------------------------------------------
# request models
# --------------------------------------------------------------------------
class AnalyzeRequest(BaseModel):
    repo: str = Field(description="owner/repo, a GitHub URL, or an Actions run URL")
    run_id: int | None = None
    branch: str | None = None
    model: str = DEFAULT_MODEL_ID
    key: str = Field(default="", description="BYOK: used for this request only, never stored")


class ValidateRequest(BaseModel):
    model: str = DEFAULT_MODEL_ID
    key: str = ""


# --------------------------------------------------------------------------
# app
# --------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = await aiosqlite.connect(DB_PATH)
    saver = AsyncSqliteSaver(conn)
    await saver.setup()
    app.state.saver = saver
    # Injection point: tests set this to a scripted model so the whole HTTP +
    # SSE surface can be exercised without an API key. None => the real thing.
    if not hasattr(app.state, "model_provider"):
        app.state.model_provider = None
    # A graph with no live session, used only to read checkpoints back.
    app.state.reader, _ = build_graph(ToolSession(), checkpointer=saver)
    try:
        yield
    finally:
        await conn.close()


app = FastAPI(title="TraceMe", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, default=str)}\n\n"


def step(icon: str, label: str, detail: str = "") -> str:
    return sse({"type": "step", "icon": icon, "label": label, "detail": detail})


# --------------------------------------------------------------------------
# simple endpoints
# --------------------------------------------------------------------------
@app.get("/health")
async def health() -> dict:
    return {"ok": True, "version": app.version, "github_token": bool(GITHUB_TOKEN)}


@app.get("/models")
async def models() -> dict:
    """The curated catalog. Free-text model names are not accepted anywhere:
    a model without tool calling degrades silently into confident nonsense."""
    return {"models": catalog_payload(), "default": DEFAULT_MODEL_ID}


@app.post("/validate")
async def validate(req: ValidateRequest) -> JSONResponse:
    ok, message = await asyncio.to_thread(validate_key, req.model, req.key)
    return JSONResponse({"ok": ok, "message": message}, status_code=200 if ok else 400)


@app.get("/analysis/{thread_id}")
async def get_analysis(thread_id: str) -> JSONResponse:
    """Re-open a finished analysis. This is why the graph has a checkpointer.

    Note what is NOT in the response: no api_key, no github_token. They were
    never in state and never in checkpoint metadata, so there is nothing to
    filter out here -- which is the only kind of secret handling that survives
    a refactor.
    """
    snapshot = await app.state.reader.aget_state({"configurable": {"thread_id": thread_id}})
    values = getattr(snapshot, "values", None) or {}
    if not values:
        return JSONResponse({"error": f"No analysis found for thread {thread_id}."}, 404)
    return JSONResponse({
        "thread_id": thread_id,
        "repo": values.get("repo"),
        "run_id": values.get("run_id"),
        "workflow_name": values.get("workflow_name"),
        "failed_step": values.get("failed_step"),
        "log_tail": values.get("log_tail"),
        "diff_summary": values.get("diff_summary"),
        "tool_calls": count_tool_calls(values.get("messages") or []),
        "diagnosis": values.get("diagnosis"),
    })


# --------------------------------------------------------------------------
# the stream
# --------------------------------------------------------------------------
async def analyze_stream(req: AnalyzeRequest, saver: Any,
                         model_provider: Any = None) -> AsyncIterator[str]:
    thread_id = uuid.uuid4().hex[:16]
    graph, _session = build_graph(ToolSession(), checkpointer=saver,
                                  model_provider=model_provider)
    config = analysis_config(
        thread_id,
        repo=req.repo,
        run_id=req.run_id,
        branch=req.branch,
        model=req.model,
        api_key=req.key,
        github_token=GITHUB_TOKEN,
    )

    yield step("search", f"Looking up {req.repo}", "finding the most recent failed run")

    emitted_prefetch = False
    try:
        async for mode, chunk in graph.astream(
            {"messages": []}, config, stream_mode=["updates", "messages"]
        ):
            if mode == "messages":
                msg, meta = chunk
                # Only stream the investigation's prose. The diagnose node emits
                # structured-output JSON fragments, which are not for humans.
                if (meta or {}).get("langgraph_node") != "investigate":
                    continue
                text = getattr(msg, "content", "")
                if isinstance(text, list):  # Anthropic-style content blocks
                    text = "".join(b.get("text", "") for b in text if isinstance(b, dict))
                if text:
                    yield sse({"type": "token", "text": text})
                continue

            # mode == "updates"
            for node, update in (chunk or {}).items():
                if node == "fetch_failure" and not emitted_prefetch:
                    emitted_prefetch = True
                    yield step(
                        "run",
                        f"Workflow `{update.get('workflow_name')}` failed",
                        f"{update.get('repo')} - run {update.get('run_id')}",
                    )
                    yield step(
                        "target",
                        f"First failing step: {update.get('failed_step')}",
                        "log window anchored on the first real error",
                    )
                    first_line = (update.get("diff_summary") or "").split("\n")[1:2]
                    yield step("diff", "Diffed the last green commit against the failing one",
                               first_line[0].strip() if first_line else "")

                elif node == "investigate":
                    for m in update.get("messages") or []:
                        for call in getattr(m, "tool_calls", None) or []:
                            icon, label = describe_tool_call(call.get("name", ""),
                                                             call.get("args") or {})
                            yield step(icon, label, "the agent chose this")

                elif node == "tools":
                    yield step("ok", "Evidence collected", "")

                elif node == "diagnose":
                    diagnosis = update.get("diagnosis")
                    if diagnosis:
                        yield sse({"type": "result", "diagnosis": diagnosis,
                                   "thread_id": thread_id})

        yield sse({"type": "done"})

    except asyncio.CancelledError:  # client closed the tab
        raise
    except BaseException as exc:  # noqa: BLE001 -- the stream must never 500 mid-flight
        yield sse({"type": "error", "message": friendly_error(exc)})
        yield sse({"type": "done"})


@app.post("/analyze")
async def analyze(req: AnalyzeRequest) -> StreamingResponse:
    return StreamingResponse(
        analyze_stream(req, app.state.saver,
                       getattr(app.state, "model_provider", None)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # nginx (and Render's proxy) buffer by default, which defeats SSE.
            "X-Accel-Buffering": "no",
        },
    )
