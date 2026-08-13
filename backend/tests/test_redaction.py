"""Credentials must not survive a trip through an error message.

Written after a live leak. A GitHub token had been set in the deployment
environment with a trailing newline; httpx refused to build the request and
raised `LocalProtocolError: Illegal header value b'Bearer ghp_...'`. That text
went through `friendly_error()`, into an SSE `error` event, and onto the screen
of a public deployment.

Two bugs, and the tests are split accordingly: the newline that caused *this*
leak, and the missing redaction that would have let the next one through.
"""

from __future__ import annotations

import httpx

from traceci.github import _headers
from traceci.graph import friendly_error
from traceci.redact import clean_credential, redact

# Synthetic values. Never put a real credential in a test, even a revoked one:
# it trips secret scanning, it lands in the repository's history permanently,
# and anyone reading the file has to stop and work out whether it is live.
REAL_SHAPES = [
    "ghp_0000000000EXAMPLEONLY0000000000000000",
    "github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789ABCDEF",
    "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
    "gsk_abcdefghijklmnopqrstuvwxyz0123456789",
    "AIzaSyA1bcdefghijklmnopqrstuvwxyz0123456789",
]


# --------------------------------------------------------------------------
# the redaction itself
# --------------------------------------------------------------------------
def test_every_provider_token_shape_is_masked():
    for secret in REAL_SHAPES:
        out = redact(f"the provider rejected {secret} for this request")
        assert secret not in out, secret
        assert "[redacted]" in out


def test_the_exact_leak_that_happened_is_masked():
    leaked = (
        "Analysis failed (LocalProtocolError): Illegal header value "
        "b'Bearer ghp_0000000000EXAMPLEONLY0000000000000000\\n'"
    )
    out = redact(leaked)
    assert "ghp_" not in out
    # The label survives, because "Bearer [redacted]" is far more useful when
    # debugging than a bare mask.
    assert "Bearer" in out and "[redacted]" in out


def test_a_labelled_secret_is_masked_even_in_an_unknown_format():
    """Covers the provider we have not enumerated yet."""
    for text in [
        "Authorization: Bearer zzzzzzzzzzzzzzzzzzzz",
        'api_key="totally-not-a-known-prefix-12345"',
        "access_token=abcdefghijklmnop",
    ]:
        out = redact(text)
        assert "[redacted]" in out
        assert "zzzz" not in out and "12345" not in out and "abcdefghijklmnop" not in out


def test_ordinary_error_text_is_left_readable():
    """Over-redaction is cosmetic, but an unreadable error is a real cost."""
    msg = "No failed run found for owner/repo. The 30 most recent runs are green."
    assert redact(msg) == msg


# --------------------------------------------------------------------------
# friendly_error is the boundary that leaked
# --------------------------------------------------------------------------
def test_friendly_error_never_passes_a_token_through():
    exc = httpx.LocalProtocolError(
        "Illegal header value b'Bearer ghp_0000000000EXAMPLEONLY0000000000000000\\n'"
    )
    out = friendly_error(exc)
    assert "ghp_" not in out
    assert "[redacted]" in out


def test_friendly_error_redacts_our_own_exceptions_too():
    """GitHubError messages are sometimes built from a response body we did
    not write."""
    from traceci.github import GitHubError

    out = friendly_error(GitHubError("401 for token gsk_abcdefghijklmnopqrstuvwxyz01"))
    assert "gsk_" not in out


# --------------------------------------------------------------------------
# the newline that started it
# --------------------------------------------------------------------------
def test_a_token_with_a_trailing_newline_still_builds_a_valid_header():
    """The original failure: a value pasted into a hosting provider's env field
    arrives as "ghp_...\\n", and a header containing a newline is the shape of
    header injection -- so httpx refuses to send it at all."""
    headers = _headers("ghp_abcdefghijklmnopqrstuv\n")
    assert headers["Authorization"] == "Bearer ghp_abcdefghijklmnopqrstuv"
    # Proves the request can actually be constructed now.
    httpx.Request("GET", "https://api.github.com/", headers=headers)


def test_surrounding_whitespace_and_quotes_are_stripped():
    for raw in [" ghp_token ", "ghp_token\n", '"ghp_token"', "'ghp_token'\r\n"]:
        assert clean_credential(raw) == "ghp_token"


def test_an_empty_or_missing_token_stays_absent_rather_than_becoming_bearer_nothing():
    assert clean_credential(None) is None
    assert clean_credential("   \n") is None
    assert "Authorization" not in _headers(None)
    assert "Authorization" not in _headers("  ")


# --------------------------------------------------------------------------
# the other three egress paths, found by auditing after the incident
# --------------------------------------------------------------------------
def test_a_secret_in_a_ci_log_never_reaches_the_model_or_the_checkpoint():
    """Actions masks values *registered* as secrets. A token echoed from an
    ordinary variable, or printed by a verbose HTTP client, is not masked --
    and would otherwise be quoted as evidence and persisted."""
    from traceci.log_window import build_log_window

    log = (
        "Run deploy.sh\n"
        "+ curl -H 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz01'\n"
        "E   AssertionError: deploy failed\n"
    )
    window = build_log_window(log)
    assert "ghp_abcdefghijklmnopqrstuvwxyz01" not in window.text
    assert "\n".join(window.cleaned).count("ghp_") == 0
    # The actual failure is still legible -- redaction must not cost evidence.
    assert "AssertionError" in window.text


def test_a_committed_credential_in_a_repository_file_is_redacted_before_the_agent_sees_it():
    from traceci.log_window import clean_log

    contents = 'GROQ_KEY = "gsk_abcdefghijklmnopqrstuvwxyz0123"\nDEBUG = True\n'
    assert "gsk_" not in "\n".join(clean_log(contents))


def test_a_rate_limit_becomes_a_next_step_not_raw_provider_json():
    """Observed live: a 429 during an analysis produced the provider's raw JSON
    blob -- organisation id included, truncated mid-word -- because only key
    validation classified provider errors. The user is least able to act on a
    raw error at the moment it costs them the most."""

    class RateLimitError(Exception):
        pass

    out = friendly_error(RateLimitError(
        "Error code: 429 - {'error': {'message': 'Rate limit reached for model "
        "`llama-3.3-70b-versatile` in organization `org_01jknmh27gfara8c14gskrx0b3` "
        "service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 100000"
    ))
    assert "org_01" not in out
    assert "{" not in out
    assert "daily token allowance" in out


def test_a_per_minute_limit_is_distinguished_from_a_per_day_one():
    """The remedies are a minute and a day apart, so the message must differ."""

    class RateLimitError(Exception):
        pass

    per_minute = friendly_error(RateLimitError("429 rate limit on tokens per minute (TPM)"))
    assert "wait about a minute" in per_minute
    assert "daily" not in per_minute


def test_a_tokenised_clone_url_is_not_echoed_back_to_the_browser():
    """`https://ghp_xxx@github.com/owner/repo` is a normal thing to have on a
    clipboard. It used to be echoed into the first SSE step verbatim."""
    pasted = "https://ghp_abcdefghijklmnopqrstuv@github.com/owner/repo"
    out = redact(f"Looking up {pasted}")
    assert "ghp_" not in out
    assert "github.com/owner/repo" in out  # the useful part survives
