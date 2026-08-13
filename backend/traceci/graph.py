"""The LangGraph agent.

    START -> fetch_failure -> investigate <-> tools -> diagnose -> END
              (no LLM)        (model)      (bounded)   (typed)

Four decisions worth explaining:

* **`fetch_failure` contains no LLM.** Everything it does is unconditional, so
  letting a model choose to do it would only add latency, cost and a way to
  fail. The agentic part starts where the certainty ends.
* **The loop is bounded twice.** An explicit `iterations` counter in state
  (checked before the model runs, so the cap is enforced even if the model
  ignores it) and LangGraph's own `recursion_limit` as a backstop against a
  routing bug turning into an infinite spend.
* **`diagnose` is a separate node with `with_structured_output`.** Asking the
  same call to both investigate and emit strict JSON degrades both. Splitting
  them means the loop can think in prose and the last step is a pure,
  schema-validated transform.
* **Secrets live in `config`, under `__`-prefixed keys, never in state.** The
  checkpointer serialises state and `GET /analysis/{thread_id}` reads it back
  out, so a key in state means every share link leaks somebody's key. Moving it
  to `config` is necessary but NOT sufficient: LangGraph copies every
  str/int/bool it finds in `configurable` into the checkpoint *metadata* -- see
  `get_checkpoint_metadata` in `langgraph.checkpoint.base` -- so a plain
  `api_key` key lands in the SQLite file anyway. The one thing it skips is keys
  beginning with `__`. Hence `__api_key` / `__github_token`. A test greps the
  raw .sqlite bytes for the key, because this is the kind of leak that is
  invisible until someone reads the file.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import replace
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from pydantic import BaseModel, Field

from .github import GitHubError
from .models import budget_for, build_model
from .prefetch import prefetch
from .prompts import DIAGNOSE_PROMPT, failure_brief, system_prompt
from .repo_input import parse_repo_input
from .tools import ToolSession, build_tools

MAX_ITERATIONS = 6
# Nodes visited per iteration is 2 (investigate + tools), plus fetch + diagnose,
# plus slack. A backstop, not the primary bound.
RECURSION_LIMIT = MAX_ITERATIONS * 2 + 6


# --------------------------------------------------------------------------
# state + output schema
# --------------------------------------------------------------------------
class CIState(TypedDict):
    """Everything the graph persists. Note what is NOT here: the API key."""

    messages: Annotated[list, add_messages]
    repo: str
    run_id: int
    workflow_name: str
    failed_step: str
    log_tail: str
    diff_summary: str
    iterations: int
    diagnosis: dict | None
    # Non-empty when the deterministic layer proved there is nothing to
    # diagnose. The model is never invoked in that case.
    inconclusive_reason: str
    # What run selection skipped, and whether newer runs are green. Shown to
    # the user so "it diagnosed the wrong run" is answerable at a glance.
    selection_notes: list[str]


class Diagnosis(BaseModel):
    """The typed contract the whole system exists to produce."""

    category: Literal[
        "test_failure", "dependency", "config", "infra", "lint_type", "flaky",
        "inconclusive", "unknown",
    ] = Field(
        description=(
            "What broke, classified by cause rather than by which step failed. Use "
            "`inconclusive` when the evidence does not support ANY cause -- that is a "
            "valid, useful answer, not a failure to try harder."
        )
    )
    root_cause: str = Field(
        description="2-3 specific sentences naming the file, function and value at fault."
    )
    evidence: list[str] = Field(
        description="2-5 exact log lines or file:line references. Quotes, never paraphrase."
    )
    # Deliberately `int | str`, and it costs a paragraph to explain why.
    #
    # Providers validate generated tool arguments against this schema before
    # the response ever reaches us. Groq is strict: a model that emits
    # `"confidence": "9"` -- which the smaller ones do routinely -- gets a 400
    # and the whole analysis dies after twenty seconds of real work, with a
    # provider error the user cannot act on.
    #
    # A schema is a wire contract with a non-deterministic producer, so it
    # should be liberal in what it accepts and strict about what it stores.
    # The widening is paid back immediately in `enforce_honesty`, which
    # coerces and clamps in exactly one place.
    confidence: int | str = Field(
        default=1,
        description=(
            "Integer from 1 to 10 -- emit a bare number, not a quoted string. "
            "8+ only when nothing is inferred."
        ),
    )
    suggested_fix: str = Field(
        default="",
        description=(
            "What to change, imperative, one or two sentences. Leave EMPTY when the "
            "category is `inconclusive` -- suggesting a fix for a cause you have not "
            "identified is a guess."
        ),
    )
    fix_snippet: str = Field(default="", description="Minimal patch, or empty string.")


ModelProvider = Callable[[dict[str, Any]], BaseChatModel]


# Phrases that mean "I did not find the cause". A diagnosis containing one of
# these is not a diagnosis, whatever confidence the model attached to it.
_HEDGES = re.compile(
    r"(not clear|unclear|cannot (be )?(determine|state|identify)|could not determine|"
    r"is unknown|requires further|further investigation|more information (is|would be) "
    r"(needed|required)|difficult to (say|determine|provide)|it seems that|might be "
    r"related to|no error message|insufficient (information|evidence)|without more)",
    re.I,
)


def _as_score(value: Any, *, default: int = 1) -> int:
    """Coerce whatever the model called a confidence into 1-10.

    Seen in the wild across providers: `9`, `"9"`, `9.0`, `"9/10"`, `"high"`.
    A bare `int()` raises on three of those, and a ValueError here would throw
    away a diagnosis that is otherwise complete -- so unparseable falls back to
    the *lowest* score rather than a middling one. If we cannot tell how sure
    the model was, we are not entitled to imply it was fairly sure.
    """
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return max(1, min(10, int(value)))
    text = str(value or "").strip()
    match = re.search(r"\d+", text)
    if not match:
        return default
    return max(1, min(10, int(match.group())))


def _strip_fence(value: Any) -> str:
    """Remove a wrapping markdown code fence from a snippet.

    ```` ```python ```` on the first line and ```` ``` ```` on the last is the
    shape models reach for when asked for code, regardless of the field being
    declared as a raw patch.
    """
    text = str(value or "").strip()
    if not text.startswith("```"):
        return text
    lines = text.split("\n")
    lines = lines[1:]                       # drop the opening fence + language
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip("\n")


def enforce_honesty(payload: dict) -> dict:
    """Make the returned confidence and category consistent with the prose.

    A structured-output schema guarantees the *shape* of an answer, not that
    there is an answer in it. Observed in the wild: a model that had found
    nothing returned a root cause reading "the cause is not clear... might be
    related to the configuration", category `unknown`, confidence 5, and a
    suggested fix of "investigate the configuration". Every field was
    well-formed and the whole thing was a guess wearing a diagnosis's clothes.

    Confidence is defined as a claim about sourcing, so hedged prose and a
    mid-range score are a contradiction. Rather than trusting the prompt to
    prevent it, the contradiction is resolved here: hedging demotes the
    category to `inconclusive`, caps confidence, and drops the suggested fix,
    because a fix for a cause you did not identify is the most costly part of
    a wrong answer.
    """
    root_cause = str(payload.get("root_cause") or "")
    category = payload.get("category") or "unknown"
    hedged = bool(_HEDGES.search(root_cause))

    if hedged or category in {"unknown", "inconclusive"}:
        payload["category"] = "inconclusive"
        payload["confidence"] = min(_as_score(payload.get("confidence")), 2)
        payload["suggested_fix"] = ""
        payload["fix_snippet"] = ""
    else:
        payload["confidence"] = _as_score(payload.get("confidence"))

    # Models routinely wrap `fix_snippet` in a markdown fence even though the
    # field is declared as a patch. The frontend renders it verbatim, so the
    # fence ends up on screen and splits the block in half.
    payload["fix_snippet"] = _strip_fence(payload.get("fix_snippet"))

    # Evidence that is only the universal exit-code trailer establishes
    # nothing, and a high score on top of it is unsupportable.
    evidence = [str(e) for e in (payload.get("evidence") or [])]
    if evidence and all(
        re.search(r"process completed with exit code|operation was canceled", e, re.I)
        for e in evidence
    ):
        payload["confidence"] = min(_as_score(payload["confidence"]), 3)

    return payload


# Keys whose names begin with `__` are the ONLY ones LangGraph refuses to copy
# into checkpoint metadata. Every secret must use this prefix.
KEY_API = "__api_key"
KEY_GH_TOKEN = "__github_token"


def _default_model_provider(cfg: dict[str, Any]) -> BaseChatModel:
    return build_model(cfg["model"], cfg[KEY_API])


# --------------------------------------------------------------------------
# graph
# --------------------------------------------------------------------------
def build_graph(
    session: ToolSession | None = None,
    *,
    checkpointer: Any = None,
    model_provider: ModelProvider | None = None,
    tools: list[BaseTool] | None = None,
    max_iterations: int = MAX_ITERATIONS,
):
    """Compile the graph. Returns `(compiled_graph, session)`.

    `model_provider` is injectable so tests can drive the whole graph with a
    scripted model -- routing, the iteration cap and the checkpointer are all
    exercised without an API key.
    """
    session = session or ToolSession()
    tools = tools if tools is not None else build_tools(session)
    provider = model_provider or _default_model_provider
    tool_node = ToolNode(tools)

    def _cfg(config: RunnableConfig | None) -> dict[str, Any]:
        return (config or {}).get("configurable", {}) or {}

    # -- node 1: deterministic, no LLM -----------------------------------
    def fetch_failure(state: CIState, config: RunnableConfig) -> dict:
        cfg = _cfg(config)
        ref = parse_repo_input(cfg.get("repo", ""), branch=cfg.get("branch"))
        if cfg.get("run_id"):
            ref = replace(ref, run_id=int(cfg["run_id"]))
        # The budget is a property of the chosen model, and the model is only
        # known at request time -- so it is resolved here, in the same node
        # that does the fetching, and handed to the tools through the session.
        budget = budget_for(cfg.get("model", ""))
        ctx, gh = prefetch(ref, cfg.get(KEY_GH_TOKEN), budget=budget)
        session.bind(gh, ctx, budget)

        brief = failure_brief(
            repo=ctx.repo,
            run_number=ctx.run_number,
            workflow_name=ctx.workflow_name,
            branch=ctx.branch,
            job_name=ctx.job_name,
            failed_step=ctx.failed_step,
            head_sha=ctx.head_sha,
            log_window=ctx.log_window.text,
            diff_summary=ctx.diff_summary,
        )
        return {
            "repo": ctx.repo,
            "run_id": ctx.run_id,
            "workflow_name": ctx.workflow_name,
            "failed_step": ctx.failed_step,
            "log_tail": ctx.log_window.text,
            "diff_summary": ctx.diff_summary,
            "iterations": 0,
            "diagnosis": None,
            "inconclusive_reason": ctx.inconclusive_reason,
            "selection_notes": ctx.selection_notes,
            "messages": [HumanMessage(content=brief)],
        }

    # -- node 1b: nothing to diagnose, decided without a model ------------
    def inconclusive(state: CIState) -> dict:
        """Emit an honest non-answer.

        There is no model call in this node, on purpose. Asking a model to
        explain a failure that is not in the log does not produce silence --
        it produces fluent hedging with a middling confidence score, which
        reads exactly like a real diagnosis to anyone skimming. The only
        reliable fix is to not ask the question.

        The evidence is the tail of the log, quoted, so the user can confirm
        for themselves that there is no error in it.
        """
        reason = state.get("inconclusive_reason") or "No failure could be located in this run."
        tail = [ln.strip() for ln in (state.get("log_tail") or "").split("\n") if ln.strip()]
        quoted = [ln for ln in tail if not ln.startswith(("[", "-----"))][-4:]
        return {
            "diagnosis": {
                "category": "inconclusive",
                "root_cause": reason,
                "evidence": quoted or ["(the failing step produced no log output)"],
                "confidence": 1,
                "suggested_fix": "",
                "fix_snippet": "",
            }
        }

    # -- node 2: the reasoning loop --------------------------------------
    def investigate(state: CIState, config: RunnableConfig) -> dict:
        cfg = _cfg(config)
        model = provider(cfg)
        used = int(state.get("iterations") or 0)
        msgs = [SystemMessage(content=system_prompt(max_iterations)), *state["messages"]]

        if used >= max_iterations:
            # Cap reached: call the model WITHOUT tools so it physically cannot
            # ask for another one. Enforcing the bound in code rather than
            # trusting the prompt is the difference between a cap and a wish.
            msgs.append(
                HumanMessage(
                    content=(
                        f"You have used all {max_iterations} tool calls. Stop "
                        "investigating and summarise your conclusion from the "
                        "evidence you already have."
                    )
                )
            )
            reply = model.invoke(msgs)
            return {"messages": [reply], "iterations": used}

        reply = model.bind_tools(tools).invoke(msgs)
        n_calls = len(getattr(reply, "tool_calls", None) or [])
        return {"messages": [reply], "iterations": used + n_calls}

    # -- conditional edge -------------------------------------------------
    def route(state: CIState) -> Literal["tools", "diagnose"]:
        last = state["messages"][-1] if state["messages"] else None
        if isinstance(last, AIMessage) and getattr(last, "tool_calls", None):
            if int(state.get("iterations") or 0) > max_iterations:
                return "diagnose"
            return "tools"
        return "diagnose"

    # -- node 4: typed output --------------------------------------------
    def diagnose(state: CIState, config: RunnableConfig) -> dict:
        cfg = _cfg(config)
        model = provider(cfg)
        structured = model.with_structured_output(Diagnosis)
        msgs = [
            SystemMessage(content=system_prompt(max_iterations)),
            *state["messages"],
            HumanMessage(content=DIAGNOSE_PROMPT),
        ]
        result = structured.invoke(msgs)
        payload = result.model_dump() if isinstance(result, BaseModel) else dict(result)
        return {"diagnosis": enforce_honesty(payload)}

    # -- gate: is there anything here to diagnose at all? -----------------
    def has_failure(state: CIState) -> Literal["investigate", "inconclusive"]:
        return "inconclusive" if state.get("inconclusive_reason") else "investigate"

    g = StateGraph(CIState)
    g.add_node("fetch_failure", fetch_failure)
    g.add_node("inconclusive", inconclusive)
    g.add_node("investigate", investigate)
    g.add_node("tools", tool_node)
    g.add_node("diagnose", diagnose)

    g.add_edge(START, "fetch_failure")
    g.add_conditional_edges(
        "fetch_failure",
        has_failure,
        {"investigate": "investigate", "inconclusive": "inconclusive"},
    )
    g.add_conditional_edges("investigate", route, {"tools": "tools", "diagnose": "diagnose"})
    g.add_edge("tools", "investigate")
    g.add_edge("inconclusive", END)
    g.add_edge("diagnose", END)

    return g.compile(checkpointer=checkpointer), session


def analysis_config(
    thread_id: str,
    *,
    repo: str,
    model: str,
    api_key: str,
    run_id: int | None = None,
    branch: str | None = None,
    github_token: str | None = None,
    recursion_limit: int = RECURSION_LIMIT,
) -> dict[str, Any]:
    """Build the runnable config.

    Secrets go here and *only* here, under `__`-prefixed names. Nothing in
    this dict reaches state, and the `__` prefix keeps it out of checkpoint
    metadata too, so `GET /analysis/{thread_id}` cannot hand somebody else's
    key back out.
    """
    return {
        "configurable": {
            "thread_id": thread_id,
            "repo": repo,
            "run_id": run_id,
            "branch": branch,
            "model": model,
            # `__` prefix: LangGraph's get_checkpoint_metadata() copies every
            # str/int/bool in `configurable` into checkpoint metadata *except*
            # keys starting with `__`. Rename these and the key lands in the
            # SQLite file and in every share link.
            KEY_API: api_key,
            KEY_GH_TOKEN: github_token,
        },
        "recursion_limit": recursion_limit,
    }


def count_tool_calls(messages: list) -> int:
    """How many tools the agent actually chose to call. The number to watch."""
    return sum(len(getattr(m, "tool_calls", None) or []) for m in messages)


def friendly_error(exc: BaseException) -> str:
    """One sentence a human can act on -- never a stack trace, never a key.

    Every return path is redacted, including the ones carrying our own
    exceptions, because a `GitHubError` message is sometimes built from a
    response body we did not write.

    The catch-all on the last line is what made this necessary. It interpolates
    an arbitrary exception, and libraries put request headers into their error
    text: a GitHub token with a stray trailing newline produced
    `LocalProtocolError: Illegal header value b'Bearer ghp_...'`, which this
    function then streamed to the browser and the UI rendered on screen.

    Fixing only the newline would have closed that one hole and left the class
    of bug open for the next library that quotes a header back at us.
    """
    from .github import LogsExpired, NoFailedRun
    from .models import ModelError, classify_provider_error
    from .redact import redact
    from .repo_input import RepoInputError

    if isinstance(exc, (RepoInputError, NoFailedRun, LogsExpired, ModelError, GitHubError)):
        return redact(str(exc))

    # Provider SDK failures -- 429, auth, quota -- reach here as their own
    # exception types, not as ModelError. Without this they fell through to
    # the catch-all and the user got raw provider JSON at the exact moment
    # they most needed a next step.
    if isinstance(exc, Exception):
        known = classify_provider_error(exc)
        if known:
            return known

    name = type(exc).__name__
    if "Recursion" in name or "GraphRecursion" in name:
        return ("The agent hit its step limit without reaching a conclusion. "
                "This usually means the model kept requesting tools; try another model.")
    return redact(f"Analysis failed ({name}): {str(exc)[:300]}")
