"""BYOK: the model catalog and key validation.

Why bring-your-own-key at all: this is a public portfolio demo. If it ran on my
key, the first person to find it would run my balance to zero. BYOK also means
no key is ever stored -- it arrives in a request body, lives in a `config` dict
for the duration of one analysis, and is gone.

Why a curated dropdown instead of a free-text model field: a model without
tool-calling support degrades *silently*. It never emits a tool call, the graph
walks straight to `diagnose`, and you get a fluent paragraph of garbage with no
error anywhere. A dropdown of models known to support tool calling turns that
class of bug into something that cannot be typed in.
"""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import tool


@dataclass(frozen=True)
class ContextBudget:
    """How much text we are allowed to put in front of the model.

    This exists because of free tiers. Groq's free plan caps *tokens per
    minute*, not just requests: 12K TPM on `llama-3.3-70b-versatile`, 8K on the
    gpt-oss models. A single TraceMe analysis is three model calls in about
    fifteen seconds, and each one resends the whole conversation -- so the
    default budget (a 14K-character log window plus a 12K-character file read)
    burns roughly 24K tokens in under a minute and gets a `429` halfway through
    the investigation.

    Shrinking the window is not free: cut it too far and the traceback falls
    out and the diagnosis becomes a guess. The `tight` profile is tuned so the
    *anchored* region and the tail both still fit -- which is exactly what the
    windowing code was built to guarantee.
    """

    name: str
    log_window_chars: int
    file_chars: int
    diff_chars: int
    diff_files: int


# Roughly 5-6K tokens per analysis, three calls, comfortably inside 12K TPM.
TIGHT = ContextBudget(name="tight", log_window_chars=4_500, file_chars=4_000,
                      diff_chars=3_500, diff_files=12)
NORMAL = ContextBudget(name="normal", log_window_chars=14_000, file_chars=12_000,
                       diff_chars=12_000, diff_files=40)


@dataclass(frozen=True)
class ModelSpec:
    id: str            # what the UI sends
    label: str         # what the UI shows
    provider: str      # init_chat_model's `model_provider`
    model: str         # the provider's model string
    key_hint: str      # placeholder text for the key field
    key_url: str       # where to get one
    notes: str = ""
    budget: ContextBudget = NORMAL
    free_tier: bool = False
    max_retries: int = 2


# Every entry here is known to support tool calling. That is the entry
# requirement, not a nice-to-have.
MODEL_CATALOG: tuple[ModelSpec, ...] = (
    # -- Groq: the free option, and therefore the one most people will use ---
    # Model IDs verified against console.groq.com/docs/models. Groq retires
    # models fast, so if one 404s check that page before debugging anything
    # else -- `curl https://api.groq.com/openai/v1/models` lists what is live.
    ModelSpec(
        id="groq-llama-3.3-70b",
        label="Groq - Llama 3.3 70B (FREE, best free-tier pick)",
        provider="groq",
        model="llama-3.3-70b-versatile",
        key_hint="gsk_...",
        key_url="https://console.groq.com/keys",
        notes="Free plan: 30 RPM, 1K RPD, 12K TPM - the highest token budget "
              "of the free models, and reliable at tool calling.",
        budget=TIGHT,
        free_tier=True,
        max_retries=5,
    ),
    ModelSpec(
        id="groq-gpt-oss-120b",
        label="Groq - GPT-OSS 120B (FREE, strongest reasoning)",
        provider="groq",
        model="openai/gpt-oss-120b",
        key_hint="gsk_...",
        key_url="https://console.groq.com/keys",
        notes="Free plan: 8K TPM - tighter than Llama 3.3, so expect the odd "
              "429 if you re-run within the same minute.",
        budget=TIGHT,
        free_tier=True,
        max_retries=5,
    ),
    ModelSpec(
        id="groq-gpt-oss-20b",
        label="Groq - GPT-OSS 20B (FREE, fastest)",
        provider="groq",
        model="openai/gpt-oss-20b",
        key_hint="gsk_...",
        key_url="https://console.groq.com/keys",
        notes="~1000 tok/s. Free plan: 8K TPM. Smallest model here; most "
              "likely to under-call tools on the subtle case.",
        budget=TIGHT,
        free_tier=True,
        max_retries=5,
    ),
    ModelSpec(
        id="groq-llama-3.1-8b",
        label="Groq - Llama 3.1 8B (FREE, cheapest limits)",
        provider="groq",
        model="llama-3.1-8b-instant",
        key_hint="gsk_...",
        key_url="https://console.groq.com/keys",
        notes="Free plan: only 6K TPM. Use it to smoke-test the plumbing, not "
              "to judge diagnosis quality.",
        budget=TIGHT,
        free_tier=True,
        max_retries=5,
    ),
    ModelSpec(
        id="gpt-4o-mini",
        label="OpenAI - GPT-4o mini (cheapest, good default)",
        provider="openai",
        model="gpt-4o-mini",
        key_hint="sk-...",
        key_url="https://platform.openai.com/api-keys",
        notes="Fastest and cheapest of the lot; occasionally under-calls tools.",
    ),
    ModelSpec(
        id="gpt-4o",
        label="OpenAI - GPT-4o",
        provider="openai",
        model="gpt-4o",
        key_hint="sk-...",
        key_url="https://platform.openai.com/api-keys",
    ),
    ModelSpec(
        id="gpt-4.1-mini",
        label="OpenAI - GPT-4.1 mini",
        provider="openai",
        model="gpt-4.1-mini",
        key_hint="sk-...",
        key_url="https://platform.openai.com/api-keys",
    ),
    ModelSpec(
        id="claude-sonnet-4-5",
        label="Anthropic - Claude Sonnet 4.5 (best on the subtle case)",
        provider="anthropic",
        model="claude-sonnet-4-5",
        key_hint="sk-ant-...",
        key_url="https://console.anthropic.com/settings/keys",
        notes="Most reliable at deciding to open a file rather than guessing.",
    ),
    ModelSpec(
        id="claude-haiku-4-5",
        label="Anthropic - Claude Haiku 4.5 (fast)",
        provider="anthropic",
        model="claude-haiku-4-5",
        key_hint="sk-ant-...",
        key_url="https://console.anthropic.com/settings/keys",
    ),
    ModelSpec(
        id="gemini-2.0-flash",
        label="Google - Gemini 2.0 Flash",
        provider="google_genai",
        model="gemini-2.0-flash",
        key_hint="AIza...",
        key_url="https://aistudio.google.com/app/apikey",
    ),
)

BY_ID = {m.id: m for m in MODEL_CATALOG}
# The default is the free one on purpose: the most common first run of this
# project is somebody who has not got a paid key.
DEFAULT_MODEL_ID = "groq-llama-3.3-70b"


class ModelError(RuntimeError):
    """Something is wrong with the chosen model or the supplied key."""


def get_spec(model_id: str) -> ModelSpec:
    spec = BY_ID.get(model_id)
    if spec is None:
        raise ModelError(
            f"Unknown model `{model_id}`. Pick one of: {', '.join(BY_ID)}."
        )
    return spec


def budget_for(model_id: str) -> ContextBudget:
    """The context budget for a model id, defaulting to NORMAL for unknown ids."""
    spec = BY_ID.get(model_id)
    return spec.budget if spec else NORMAL


def build_model(model_id: str, api_key: str, *, temperature: float = 0.0) -> BaseChatModel:
    """Instantiate a chat model from the catalog with an explicit key.

    `api_key` is passed as a constructor argument on purpose. Mutating
    `os.environ` would leak one user's key into every other concurrent request
    in the same process -- a real bug, not a stylistic preference.
    """
    from langchain.chat_models import init_chat_model

    spec = get_spec(model_id)
    if not api_key or not api_key.strip():
        raise ModelError("An API key is required. Keys are used for this request only.")
    try:
        return init_chat_model(
            spec.model,
            model_provider=spec.provider,
            api_key=api_key.strip(),
            temperature=temperature,
            # Free tiers answer 429 with a `retry-after`; the provider SDKs
            # honour it, so a few extra retries turn "rate limited" from a
            # failed analysis into a slower one.
            max_retries=spec.max_retries,
        )
    except ImportError as exc:
        raise ModelError(
            f"The provider package for `{spec.provider}` is not installed: {exc}"
        ) from exc
    except Exception as exc:  # provider constructors raise all sorts
        raise ModelError(f"Could not initialise `{spec.label}`: {exc}") from exc


def _explain(exc: Exception) -> str:
    """Turn a provider SDK exception into one sentence a human can act on."""
    msg = str(exc)
    low = msg.lower()
    if "authentication" in low or "incorrect api key" in low or "invalid api key" in low \
            or "401" in low or "unauthorized" in low:
        return "That API key was rejected by the provider."
    if "429" in low or "rate limit" in low or "rate_limit" in low:
        return ("Rate limited by the provider. On a free tier this usually means "
                "tokens-per-minute, not requests -- wait about a minute and retry, "
                "or pick a model with a higher TPM limit.")
    if "quota" in low or "insufficient_quota" in low or "billing" in low:
        return "The key is valid but the account has no quota or credit left."
    if "model" in low and ("not found" in low or "does not exist" in low):
        return "The provider does not recognise that model for this key."
    return f"The provider rejected the request: {msg[:300]}"


@tool
def _probe(city: str) -> str:
    """Look up the current weather in a city. Call this for any weather question."""
    return f"It is 21C in {city}."


def validate_key(model_id: str, api_key: str) -> tuple[bool, str]:
    """Check the key **and** that the model actually emits a tool call.

    Validating the key alone is not enough. A key can be perfectly valid on a
    model that cannot call tools, and that failure is invisible: no exception,
    no empty response, just a graph that skips every tool and produces
    plausible nonsense. So the probe asks a question that can only be answered
    by calling a tool, and requires `tool_calls` to come back non-empty.
    """
    try:
        model = build_model(model_id, api_key)
    except ModelError as exc:
        return False, str(exc)
    except Exception as exc:  # a provider SDK can raise literally anything
        return False, _explain(exc)

    try:
        bound = model.bind_tools([_probe])
        reply = bound.invoke("What is the weather in Pune right now?")
    except Exception as exc:
        return False, _explain(exc)

    calls = getattr(reply, "tool_calls", None) or []
    if not calls:
        return False, (
            f"`{get_spec(model_id).label}` answered without calling the tool it was "
            "given. TraceMe needs tool calling; pick another model."
        )
    return True, "Key is valid and the model calls tools."


def catalog_payload() -> list[dict]:
    """What `GET /models` hands the frontend to build its dropdown."""
    return [
        {
            "id": m.id,
            "label": m.label,
            "provider": m.provider,
            "key_hint": m.key_hint,
            "key_url": m.key_url,
            "notes": m.notes,
            "free_tier": m.free_tier,
            "budget": m.budget.name,
        }
        for m in MODEL_CATALOG
    ]
