"""Turn a multi-thousand-line Actions step log into ~150 lines worth reading.

This is the highest-leverage code in the project. The model's diagnosis is only
as good as the window it is handed, and the failure mode is nasty: give it a
window with no error in it and it will produce a fluent, confident, completely
wrong answer, with nothing anywhere that looks like an error.

Three rules, each learned the hard way:

1. **Strip the noise first.** Actions prefixes every line with an ISO-8601
   timestamp and colours the interesting bits with ANSI escapes. Both eat
   context budget and both confuse the anchor patterns.

2. **Anchor on the first *real* error, in tiers.** `##[error]Process completed
   with exit code 1.` is appended to EVERY failed step. It is a trailer with
   zero information. Anchoring on it throws away the actual traceback, which is
   usually hundreds of lines earlier. So: tier 1 = test-framework/compiler
   output, tier 2 = a *meaningful* `##[error]` annotation, tier 3 = anything
   error-shaped. Never anchor on a known-noise line at any tier.

3. **Always also include the tail.** pytest's `=== 1 failed, 120 passed ===`
   only exists at the very bottom. Without it the model cannot tell "one test
   regressed" from "the whole suite is down", and that changes the diagnosis.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .redact import redact

# --------------------------------------------------------------------------
# cleaning
# --------------------------------------------------------------------------

_ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
# GitHub writes `2024-05-01T12:00:00.1234567Z ` at the start of every line.
_TS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?")
_WORKFLOW_CMD_DROP = re.compile(r"^##\[(group|endgroup|debug|command|section)\]")


def strip_ansi(text: str) -> str:
    """Remove ANSI colour/cursor escapes, including OSC hyperlinks."""
    return _ANSI.sub("", text.replace("\r\n", "\n").replace("\r", "\n"))


def clean_log(text: str, *, drop_workflow_commands: bool = True) -> list[str]:
    """ANSI-strip, de-timestamp, redact, and drop `##[group]` scaffolding.

    Redaction happens here because this is the single funnel every byte of log
    passes through: the window handed to the model, the slices `get_more_log`
    returns, the `log_tail` written to the checkpoint, and the evidence quoted
    back on screen. Filtering downstream would mean four places to remember.

    Worth doing even though Actions masks secrets as `***`: it only masks
    values *registered* as secrets. A token echoed from an ordinary variable,
    printed by a verbose HTTP client, or embedded in a URL in a stack trace is
    not masked, and would otherwise be quoted verbatim as evidence, persisted
    to the checkpoint, and sent to a third-party model provider.

    A credential is never the root cause of a build failure, so removing one
    costs no diagnostic value.
    """
    out: list[str] = []
    for raw in strip_ansi(text).split("\n"):
        line = redact(_TS.sub("", raw).rstrip())
        if drop_workflow_commands and _WORKFLOW_CMD_DROP.match(line):
            continue
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return out


# --------------------------------------------------------------------------
# anchoring
# --------------------------------------------------------------------------

# Lines that look like errors but carry no information whatsoever. Anchoring on
# any of these is the bug that produces confident-but-wrong diagnoses.
NOISE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^##\[error\]Process completed with exit code \d+\.?\s*$"),
    re.compile(r"^Error: Process completed with exit code \d+\.?\s*$"),
    re.compile(r"^##\[error\]The operation was canceled\.?\s*$"),
    re.compile(r"^##\[error\]The process '.*' failed with exit code \d+\.?\s*$"),
    re.compile(r"^##\[error\]Docker (build|run) failed with exit code \d+\.?\s*$"),
    re.compile(r"^##\[error\]Node run failed with exit code \d+\.?\s*$"),
    re.compile(r"^npm ERR! A complete log of this run can be found in", re.I),
    re.compile(r"^npm ERR!\s*$", re.I),
    re.compile(r"^\s*$"),
    re.compile(r"^ERROR: Job failed: exit code \d+\s*$"),
    re.compile(r"^make(\[\d+\])?: \*\*\* \[.*\] Error \d+\s*$"),
    re.compile(r"^Error: The process .* failed", re.I),
)

# Tier 1 -- unambiguous test-framework / compiler / runtime output. If one of
# these exists anywhere in the step log, it *is* the failure.
TIER1_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*Traceback \(most recent call last\)"),
    re.compile(r"^E\s{2,}\S"),                       # pytest assertion body
    re.compile(r"^_{5,}.*\b(test|Test)\w*.*_{5,}$"),  # pytest per-test banner
    re.compile(r"^=+ (FAILURES|ERRORS) =+$"),
    re.compile(r"^FAILED \S+::"),
    re.compile(r"^ERROR \S+::"),
    re.compile(r"\bModuleNotFoundError\b"),
    re.compile(r"\bImportError\b"),
    re.compile(r"\b(Assertion|Attribute|Type|Value|Key|Index|Name|Runtime|Syntax|Zero"
               r"Division|Permission|FileNotFound|Connection|Timeout)Error\b"),
    re.compile(r"^\s*panic:"),
    re.compile(r"^--- FAIL: "),
    re.compile(r"^npm ERR! code \S+", re.I),
    re.compile(r"^npm ERR! (ERESOLVE|404|Cannot|missing|peer dep)", re.I),
    re.compile(r"\berror TS\d+\b"),
    re.compile(r"^error\[E\d+\]:"),                   # rustc
    re.compile(r"^\S+\.\w+:\d+:\d+:\s+[A-Z]{1,4}\d{2,4}\b"),  # ruff / flake8
    re.compile(r"^\S+\.\w+\(\d+,\d+\): error\b"),     # msbuild / tsc pretty
    re.compile(r"^ERROR: Could not find a version that satisfies the requirement", re.I),
    re.compile(r"^ERROR: No matching distribution found for", re.I),
    re.compile(r"^ERROR: (Cannot install|ResolutionImpossible)", re.I),
    re.compile(r"^\s*File \"[^\"]+\", line \d+"),
    re.compile(r"^\s*at \S+ \(.*:\d+:\d+\)$"),        # node stack frame
)

# Tier 2 -- an `##[error]` annotation that actually says something.
TIER2 = re.compile(r"^##\[error\](.*\S.*)$")

# Tier 3 -- anything error-shaped at all.
TIER3 = re.compile(
    r"(?i)(^|\W)(error|errors|failed|failure|fatal|exception|cannot|unable to|"
    r"not found|no such file|denied|invalid)(\W|$)"
)

CONTEXT_BEFORE = 12
CONTEXT_AFTER = 70
TAIL_LINES = 35
MAX_CHARS = 14_000


def _is_noise(line: str) -> bool:
    return any(p.search(line) for p in NOISE_PATTERNS)


def find_anchor(lines: list[str]) -> tuple[int | None, int]:
    """Return `(index_of_first_real_error, tier)`; `(None, 0)` if nothing matched.

    Tiers are evaluated in order over the *whole* log, not interleaved: a tier-1
    hit on line 4000 still beats a tier-2 hit on line 3.
    """
    for idx, line in enumerate(lines):
        if _is_noise(line):
            continue
        if any(p.search(line) for p in TIER1_PATTERNS):
            return idx, 1

    for idx, line in enumerate(lines):
        if _is_noise(line):
            continue
        m = TIER2.match(line)
        if m and len(m.group(1).strip()) > 3:
            return idx, 2

    for idx, line in enumerate(lines):
        if _is_noise(line):
            continue
        if TIER3.search(line):
            return idx, 3

    return None, 0


@dataclass
class LogWindow:
    """What the model actually reads, plus enough metadata to fetch more."""

    text: str
    anchor_line: int | None          # 1-based line number in the cleaned log
    tier: int                        # 1/2/3, or 0 when no error was found
    total_lines: int
    cleaned: list[str] = field(default_factory=list, repr=False)

    @property
    def found_error(self) -> bool:
        return self.anchor_line is not None


def _clip(text: str, limit: int = MAX_CHARS) -> str:
    if len(text) <= limit:
        return text
    head = text[: int(limit * 0.6)]
    tail = text[-int(limit * 0.35) :]
    return f"{head}\n... [window truncated to fit the context budget] ...\n{tail}"


def build_log_window(
    step_log: str,
    *,
    context_before: int = CONTEXT_BEFORE,
    context_after: int = CONTEXT_AFTER,
    tail_lines: int = TAIL_LINES,
    max_chars: int = MAX_CHARS,
) -> LogWindow:
    """Extract the readable window: error region + always the tail.

    The contract we hold ourselves to: a human should be able to diagnose the
    failure from `window.text` alone in about fifteen seconds.

    `max_chars` shrinks for free-tier models with a tokens-per-minute cap. When
    it does, the *line* counts shrink with it rather than relying on the final
    character clip -- clipping the middle of an already-assembled window is a
    blunt instrument, and the thing it is most likely to cut in half is the
    traceback. Scaling the line counts keeps both the anchored region and the
    tail intact, which is the whole guarantee.
    """
    if max_chars < MAX_CHARS:
        scale = max_chars / MAX_CHARS
        context_before = max(6, int(context_before * scale))
        context_after = max(28, int(context_after * scale))
        tail_lines = max(16, int(tail_lines * scale))
    lines = clean_log(step_log)
    total = len(lines)
    if total == 0:
        return LogWindow(text="(step log was empty)", anchor_line=None, tier=0,
                         total_lines=0, cleaned=[])

    anchor, tier = find_anchor(lines)
    tail_start = max(0, total - tail_lines)

    if anchor is None:
        body = lines[tail_start:]
        text = "\n".join(
            [f"[no error-shaped line found; showing the last {len(body)} of {total} lines]",
             f"L{tail_start + 1}:", *body]
        )
        return LogWindow(text=_clip(text, max_chars), anchor_line=None, tier=0,
                         total_lines=total, cleaned=lines)

    start = max(0, anchor - context_before)
    end = min(total, anchor + context_after)

    parts: list[str] = [
        f"[step log: {total} lines. First real error at line {anchor + 1} "
        f"(tier {tier}). Showing lines {start + 1}-{end} plus the tail.]",
        "",
        f"----- lines {start + 1}-{end} (error region) -----",
        *lines[start:end],
    ]

    if end >= tail_start:
        # The error region already runs into the tail -- emit one contiguous
        # block instead of pretending there are two.
        parts = parts[:3] + [f"----- lines {start + 1}-{total} (error region -> end of log) -----"]
        parts += lines[start:total]
    else:
        omitted = tail_start - end
        parts += [
            "",
            f"----- {omitted} lines omitted -----",
            "",
            f"----- lines {tail_start + 1}-{total} (tail: summary / exit status) -----",
            *lines[tail_start:],
        ]

    return LogWindow(text=_clip("\n".join(parts), max_chars), anchor_line=anchor + 1,
                     tier=tier, total_lines=total, cleaned=lines)


def slice_log(lines: list[str], start: int, count: int) -> str:
    """1-based, inclusive slice used by the `get_more_log` tool."""
    if not lines:
        return "(no log available)"
    start = max(1, start)
    end = min(len(lines), start + count - 1)
    if start > len(lines):
        return f"(requested line {start} but the log is only {len(lines)} lines)"
    numbered = [f"{i:>6}| {lines[i - 1]}" for i in range(start, end + 1)]
    return "\n".join([f"----- lines {start}-{end} of {len(lines)} -----", *numbered])
