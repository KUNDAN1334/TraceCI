"""A scripted chat model, so the graph can be tested without an API key.

It behaves like a real one in the ways that matter: `bind_tools` returns a new
model, an unbound model *cannot* emit tool calls (which is exactly how the
iteration cap is enforced in `investigate`), and `with_structured_output`
returns a validated pydantic object.
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks import CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda


class Script:
    """Shared, mutable state so every clone of the model records into one place."""

    def __init__(self, turns: list[Any], diagnosis: dict, repeat_last: bool = False):
        self.turns = list(turns)
        self.diagnosis = diagnosis
        self.repeat_last = repeat_last
        self.pos = 0
        self.invocations: list[dict] = []
        self.structured_calls = 0

    def next_turn(self) -> Any:
        if self.pos < len(self.turns):
            turn = self.turns[self.pos]
        elif self.repeat_last and self.turns:
            turn = self.turns[-1]
        else:
            turn = "No more tools needed; here is my reasoning."
        self.pos += 1
        return turn


class ScriptedModel(BaseChatModel):
    """`turns` entries are either a string (plain reply) or a list of
    `{"name": ..., "args": {...}}` dicts (tool calls)."""

    script: Any
    tools_bound: bool = False

    model_config = {"arbitrary_types_allowed": True}

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools: list, **kwargs: Any) -> ScriptedModel:
        return ScriptedModel(script=self.script, tools_bound=True)

    def with_structured_output(self, schema: Any, **kwargs: Any):
        def _emit(_messages: Any) -> Any:
            self.script.structured_calls += 1
            return schema(**self.script.diagnosis)

        return RunnableLambda(_emit)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        self.script.invocations.append(
            {"tools_bound": self.tools_bound, "n_messages": len(messages)}
        )
        turn = self.script.next_turn()

        # A turn may be {"text": ..., "calls": [...]} -- real models narrate and
        # call a tool in the same message, and the demo recording needs that.
        if isinstance(turn, dict):
            calls = turn.get("calls") or []
            if calls and self.tools_bound:
                msg = AIMessage(
                    content=turn.get("text", ""),
                    tool_calls=[
                        {"name": c["name"], "args": c.get("args", {}),
                         "id": f"call_{self.script.pos}_{i}", "type": "tool_call"}
                        for i, c in enumerate(calls)
                    ],
                )
            else:
                msg = AIMessage(content=turn.get("text", ""))
            return ChatResult(generations=[ChatGeneration(message=msg)])

        if isinstance(turn, list) and self.tools_bound:
            calls = [
                {"name": t["name"], "args": t.get("args", {}),
                 "id": f"call_{self.script.pos}_{i}", "type": "tool_call"}
                for i, t in enumerate(turn)
            ]
            msg = AIMessage(content="Checking one thing.", tool_calls=calls)
        elif isinstance(turn, list):
            # Unbound model: physically cannot request a tool. This is what the
            # iteration cap relies on.
            msg = AIMessage(content="I have used my budget; concluding from what I have.")
        else:
            msg = AIMessage(content=turn)
        return ChatResult(generations=[ChatGeneration(message=msg)])


GOOD_DIAGNOSIS = {
    "category": "test_failure",
    "root_cause": (
        "app/auth.py:refresh() was changed to return a plain dict instead of a Token, "
        "so tests/unit/test_auth.py:47 raises AttributeError when it reads "
        "renewed.expires_at. The rate limiter rewrite in the same commit is unrelated."
    ),
    "evidence": [
        "E       AttributeError: 'dict' object has no attribute 'expires_at'",
        "tests/unit/test_auth.py:47: AttributeError",
        "app/auth.py:18: return {'value': fresh.value, 'user': fresh.user, ...}",
    ],
    "confidence": 9,
    "suggested_fix": "Return the Token from refresh() and serialise at the API boundary.",
    "fix_snippet": "-    return {'value': ...}\n+    return fresh\n",
}


def make_provider(script: Script):
    """A `model_provider` for `build_graph` that ignores the (absent) API key."""

    def provider(cfg: dict) -> ScriptedModel:
        return ScriptedModel(script=script)

    return provider
