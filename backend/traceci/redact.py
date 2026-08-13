"""Strip credentials out of anything on its way to a user.

Written after a real leak. A GitHub token had been pasted into the deployment
environment with a trailing newline; `httpx` refused to build the request and
raised `LocalProtocolError: Illegal header value b'Bearer ghp_...'`. That
exception's text was passed to `friendly_error()`, which ends with a catch-all
that interpolates `str(exc)` -- so the token was streamed to the browser and
rendered on screen, on a public deployment.

Two lessons, and this module is the second one:

1. Exception messages are attacker-visible output. Anything that formats an
   arbitrary exception into a user-facing string is a potential credential
   disclosure, because the libraries underneath us put request headers into
   their error text and are entirely right to.
2. Fixing the newline would have fixed *that* leak and left the class of bug
   intact. The redaction has to sit at the boundary, so the next library that
   quotes a header back at us is already handled.

Deliberately matched by *shape* rather than by comparing against the known
secret: the process does not always have the value to compare with (a BYOK
model key belongs to the request, not the environment), and a comparison
misses the one that was truncated or re-encoded on the way through.
"""

from __future__ import annotations

import re

_MASK = "[redacted]"

# Secrets recognised by their own shape. Replaced whole.
_SHAPES: tuple[re.Pattern[str], ...] = (
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}"),          # GitHub classic / OAuth / app
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),        # GitHub fine-grained
    re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_\-]{16,}"),     # OpenAI, Anthropic
    re.compile(r"\bgsk_[A-Za-z0-9]{16,}"),                # Groq
    re.compile(r"\bAIza[A-Za-z0-9_\-]{30,}"),             # Google
)

# Secrets recognised by what introduces them. The label is kept -- "Bearer
# [redacted]" is far more useful when debugging than "[redacted]" alone -- and
# only the value is replaced.
_LABELLED: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\b(bearer|token|basic)\s+[A-Za-z0-9_\-\.=+/]{8,}"),
    re.compile(
        r"(?i)\b(authorization|api[_-]?key|secret|password|access[_-]?token)\b"
        r"\s*[:=]\s*['\"]?[^\s,;'\"}\)]+"
    ),
)


def redact(text: str) -> str:
    """Replace anything credential-shaped with `[redacted]`.

    Applied to every string that can reach a user: SSE error events, HTTP error
    bodies, log lines. Over-redacting a harmless value is a cosmetic bug;
    under-redacting is an incident, so this errs toward the former.
    """
    if not text:
        return text
    out = text
    for pattern in _LABELLED:
        out = pattern.sub(lambda m: f"{m.group(1)} {_MASK}", out)
    for pattern in _SHAPES:
        out = pattern.sub(_MASK, out)
    return out


def clean_credential(value: str | None) -> str | None:
    """Normalise a credential read from the environment or a request body.

    Surrounding whitespace is the specific thing that caused the leak: a token
    pasted into a hosting provider's environment field arrived as
    `"ghp_...\\n"`, and a header value containing a newline is not merely
    invalid, it is how header injection works -- so the HTTP library is right
    to refuse it. Strip at the boundary rather than trusting every caller.
    """
    if value is None:
        return None
    cleaned = value.strip().strip("\"'")
    return cleaned or None
