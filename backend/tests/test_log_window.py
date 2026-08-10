"""The window is the product. These are the tests that matter most.

The bar we assert against: a human should be able to diagnose the failure from
`window.text` alone in about fifteen seconds. Concretely that means the window
must contain (a) the actual error line and (b) the summary line, with the noise
in between removed and clearly marked as removed.
"""

import pathlib
import re

import pytest

from traceci.log_window import (
    build_log_window,
    clean_log,
    find_anchor,
    slice_log,
    strip_ansi,
)

FIX = pathlib.Path(__file__).parent / "fixtures"
ANSI_LEFTOVER = re.compile(r"\x1b\[")
TIMESTAMP_LEFTOVER = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z", re.M)


def load(name):
    return (FIX / name).read_text(encoding="utf-8")


# -- cleaning --------------------------------------------------------------
def test_strip_ansi_removes_colour_and_osc():
    assert strip_ansi("\x1b[31mred\x1b[0m") == "red"
    assert strip_ansi("\x1b]8;;http://x\x07link\x1b]8;;\x07") == "link"


def test_clean_log_removes_timestamps_and_group_markers():
    raw = load("log_ruff.txt")
    lines = clean_log(raw)
    joined = "\n".join(lines)
    assert not TIMESTAMP_LEFTOVER.search(joined), "ISO timestamps survived"
    assert not ANSI_LEFTOVER.search(joined), "ANSI escapes survived"
    assert not any(ln.startswith("##[group]") for ln in lines)
    assert any("F401" in ln for ln in lines), "we deleted the actual content"


# -- anchoring -------------------------------------------------------------
def test_the_trailer_is_never_the_anchor():
    """`##[error]Process completed with exit code 1.` is appended to EVERY failed
    step. Anchoring on it throws away the real traceback hundreds of lines
    earlier and yields a confident, fluent, wrong diagnosis."""
    lines = clean_log(load("log_early_error_late_summary.txt"))
    idx, tier = find_anchor(lines)
    assert idx is not None
    assert "Process completed with exit code" not in lines[idx]
    assert tier == 1


def test_only_trailer_present_means_no_anchor_not_a_false_one():
    lines = clean_log(load("log_only_trailer.txt"))
    idx, tier = find_anchor(lines)
    assert (idx, tier) == (None, 0)

    w = build_log_window(load("log_only_trailer.txt"))
    assert w.found_error is False
    assert "no error-shaped line found" in w.text
    # We still show the tail so the reader can see *something*.
    assert "step output line 299" in w.text


def test_tier_two_is_used_when_there_is_no_framework_output():
    """setup-python prints a meaningful ##[error] and nothing else."""
    lines = clean_log(load("log_setup_python.txt"))
    idx, tier = find_anchor(lines)
    assert tier == 2
    assert "was not found for Ubuntu" in lines[idx]


# -- the headline assertion ------------------------------------------------
def test_window_holds_both_the_traceback_and_the_summary():
    """The 15-second test.

    The failure is at line ~30 of 446; the summary is at the very bottom. A
    head-only window loses "1 failed, 402 passed"; a tail-only window loses the
    traceback. Both have to be there.
    """
    w = build_log_window(load("log_early_error_late_summary.txt"))
    text = w.text

    # (a) the error itself, with its type and the offending attribute
    assert "AttributeError: 'dict' object has no attribute 'expires_at'" in text
    assert "tests/unit/test_auth.py:47" in text
    assert "renewed = refresh(token, now=2_000)" in text

    # (b) the summary that only exists at the bottom
    assert "1 failed, 402 passed" in text

    # (c) the middle was dropped, and says so
    assert re.search(r"----- \d+ lines omitted -----", text)

    # (d) nothing dirty survived
    assert not ANSI_LEFTOVER.search(text)
    assert not TIMESTAMP_LEFTOVER.search(text)

    # (e) and it is small enough to actually read
    assert len(text.splitlines()) < 160, "window is too big to be useful"


def test_window_for_a_dependency_failure_names_the_bad_pin():
    w = build_log_window(load("log_pip_resolution.txt"))
    assert w.tier == 1
    assert "requests==99.99.99" in w.text
    assert "No matching distribution found" in w.text
    # 461 lines of pip chatter collapsed to something readable
    assert w.total_lines > 400
    assert len(w.text.splitlines()) < 120


def test_window_for_a_lint_failure_keeps_the_rule_code_and_line():
    w = build_log_window(load("log_ruff.txt"))
    assert "app/auth.py:5:8: F401" in w.text
    assert "F821" in w.text
    assert "Found 2 errors." in w.text


def test_window_merges_instead_of_pretending_there_are_two_blocks():
    """When the error region already runs into the tail, emit one block."""
    w = build_log_window(load("log_pip_resolution.txt"))
    assert "lines omitted" not in w.text
    assert "error region -> end of log" in w.text


def test_empty_log_does_not_explode():
    w = build_log_window("")
    assert w.total_lines == 0
    assert "empty" in w.text


# -- get_more_log backing ---------------------------------------------------
def test_slice_log_is_one_based_and_clamped():
    lines = [f"line {i}" for i in range(1, 11)]
    out = slice_log(lines, 3, 4)
    assert "line 3" in out and "line 6" in out
    assert "line 2" not in out and "line 7" not in out
    assert slice_log(lines, 9, 100).count("\n") == 2  # header + 2 lines
    assert "only 10 lines" in slice_log(lines, 99, 5)


@pytest.mark.parametrize("name", [p.name for p in FIX.glob("log_*.txt")])
def test_every_fixture_produces_a_bounded_window(name):
    w = build_log_window(load(name))
    assert len(w.text) <= 14_200
    assert w.text.strip()
