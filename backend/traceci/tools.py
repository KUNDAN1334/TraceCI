"""The five read-only tools the agent may reach for.

Design notes worth defending in an interview:

* **Read-only, always.** Nothing here writes, comments, re-runs or pushes. The
  blast radius of a wrong diagnosis is a paragraph of text.
* **Everything is pinned to the failing commit SHA.** Reading `main` while
  diagnosing `break/subtle` gives you the *fixed* file and a diagnosis that
  contradicts the log. The SHA comes from the session, not from the model.
* **The docstring is the whole interface.** It is the only thing the model sees
  when deciding what to do next, so these are written as *decision criteria*
  ("use this when X, do NOT use it when Y"), not as descriptions of behaviour.
  This is where over-calling and under-calling actually get tuned.
"""

from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import BaseTool, tool

from .github import GitHubClient, GitHubError
from .log_window import clean_log, slice_log
from .models import NORMAL, ContextBudget
from .prefetch import FailureContext
from .redact import redact

MAX_FILE_CHARS = 12_000
MAX_DIFF_CHARS = 12_000
MAX_SEARCH_FILES = 60
SKIP_DIRS = re.compile(r"(^|/)(\.git|node_modules|dist|build|vendor|\.venv|__pycache__)/")
BINARYISH = re.compile(
    r"\.(png|jpe?g|gif|ico|pdf|zip|gz|tar|whl|so|dylib|dll|exe|"
    r"woff2?|ttf|eot|mp4|mp3|lock)$",
    re.I,
)


def _clip(text: str, limit: int, what: str) -> str:
    if len(text) <= limit:
        return text
    return (
        text[:limit]
        + f"\n... [{what} truncated at {limit} chars; {len(text) - limit} more omitted]"
    )


def _numbered(text: str) -> str:
    return "\n".join(f"{i:>5}| {ln}" for i, ln in enumerate(text.split("\n"), 1))


class ToolSession:
    """Late-bound handle to the live client + failure context.

    The tools must exist *before* `fetch_failure` runs -- both `ToolNode` and
    `bind_tools` need a static tool list at graph-build time -- but the GitHub
    client and the failing SHA only exist *after* it. This box is the join:
    built empty, filled by the prefetch node, read lazily inside each tool
    body. It keeps the tool list byte-identical between `bind_tools` and
    `ToolNode`, which is the thing that silently breaks if you rebuild.
    """

    def __init__(self, gh: GitHubClient | None = None, ctx: FailureContext | None = None,
                 budget: ContextBudget = NORMAL):
        self.gh = gh
        self.ctx = ctx
        self.budget = budget
        self.file_cache: dict[str, str] = {}
        self.diff_cache: dict[str, Any] = {}

    def bind(self, gh: GitHubClient, ctx: FailureContext,
             budget: ContextBudget | None = None) -> None:
        self.gh, self.ctx = gh, ctx
        if budget is not None:
            self.budget = budget
        self.file_cache.clear()
        self.diff_cache.clear()

    def require(self) -> tuple[GitHubClient, FailureContext]:
        if self.gh is None or self.ctx is None:
            raise GitHubError("Tools were called before the failure context was fetched.")
        return self.gh, self.ctx


def build_tools(session: ToolSession) -> list[BaseTool]:
    """Bind the five read-only tools to one (late-filled) failure session."""

    def _read(path: str) -> str:
        """Every byte of repository content the agent sees passes through here.

        Redacted for the same reason the log is: repositories contain committed
        credentials more often than anyone would like -- a checked-in `.env`, a
        fixture with a real token, a hardcoded key in a config someone meant to
        remove. Without this the agent could quote one as evidence, which would
        put it on screen and in the checkpoint.

        One funnel serves both `read_file` and `search_code`, so neither can be
        forgotten later.
        """
        gh, ctx = session.require()
        path = path.lstrip("/")
        if path not in session.file_cache:
            session.file_cache[path] = redact(gh.get_file(path, ctx.head_sha))
        return session.file_cache[path]

    def _full_compare() -> dict:
        gh, ctx = session.require()
        if "cmp" not in session.diff_cache:
            session.diff_cache["cmp"] = gh.compare(ctx.base_sha, ctx.head_sha)
        return session.diff_cache["cmp"]

    @tool
    def read_file(path: str) -> str:
        """Read a source file at the exact commit that failed CI.

        USE THIS WHEN the log names a file whose contents you have not seen and
        you cannot state the root cause without them -- a traceback frame in
        application code, a test that asserts on a value defined elsewhere, or
        the workflow/config file that drives the failing step. Reading the ONE
        file at the centre of the failure is usually the difference between a
        correct diagnosis and a plausible guess.

        USE THIS ESPECIALLY WHEN the error is a type or attribute mismatch
        ('dict' object has no attribute X, NoneType is not subscriptable,
        expected X got Y). The traceback points at the *caller*; the bug is in
        what the callee returns, and only the source shows you that.

        DO NOT USE IT when the log already contains the answer verbatim -- an
        unresolvable dependency version, an invalid python-version, a lint rule
        printed with its code and line number. Re-reading a file to confirm
        something the log already stated wastes a turn and adds nothing.

        Args:
            path: repo-relative path, e.g. app/auth.py. No leading slash.
        """
        try:
            _, ctx = session.require()
            text = _read(path)
        except GitHubError as exc:
            return f"Could not read `{path}`: {exc}"
        short = (ctx.head_sha or "HEAD")[:8]
        header = f"----- {path} @ {short} ({len(text.splitlines())} lines) -----\n"
        return header + _clip(_numbered(text), session.budget.file_chars, "file")

    @tool
    def get_full_diff(path: str = "") -> str:
        """Read the actual patch (last green commit -> failing commit).

        USE THIS WHEN the diff summary lists a file whose change you need to see
        line-by-line to confirm or kill a hypothesis you already have. Passing
        `path` restricts the patch to one file and keeps your reasoning sharp.

        DO NOT USE IT as an opening move to "have a look around". The summary
        already says what changed and by how much, and the largest hunk in a
        diff is very often not the cause -- reading the whole patch first is the
        fastest way to anchor on the wrong file and write a confident wrong
        answer.

        Args:
            path: repo-relative path to restrict the patch to. Empty = all files.
        """
        try:
            _, ctx = session.require()
            data = _full_compare()
        except GitHubError as exc:
            return f"Could not fetch the diff: {exc}"
        base, short = ctx.base_sha[:8], ctx.head_sha[:8]
        files = data.get("files") or []
        if path:
            want = path.strip("/")
            picked = [f for f in files if f.get("filename") == want]
            if not picked:
                have = ", ".join(f.get("filename", "?") for f in files[:20])
                return (f"`{want}` was not changed between {base} and {short}. "
                        f"Changed files: {have or 'none'}")
            files = picked
        out = [f"----- patch {base}...{short} -----"]
        for f in files:
            out.append(
                f"\n=== {f.get('status')} {f.get('filename')} "
                f"(+{f.get('additions', 0)} -{f.get('deletions', 0)}) ==="
            )
            out.append(f.get("patch") or "(no textual patch: binary, renamed, or too large)")
        return _clip("\n".join(out), session.budget.diff_chars, "patch")

    @tool
    def search_code(query: str, path_filter: str = "") -> str:
        """Find where a symbol is defined or used, at the failing commit.

        USE THIS WHEN you know the name of the thing that broke -- a function, a
        constant, a class, an import -- but not which file holds it, and neither
        the log nor the diff says. Typical case: the traceback blames a test,
        the test calls refresh(), and you need to know where refresh lives
        before you can read it.

        DO NOT USE IT when you already know the path -- call read_file directly.
        Do not use it to explore the repo generally: it reads file contents, so
        a vague query is expensive and comes back as noise.

        Args:
            query: literal text to look for, e.g. "def refresh" or "TOKEN_TTL_SECONDS".
            path_filter: optional substring the path must contain, e.g. "app/" or ".py".
        """
        if not query.strip():
            return "search_code needs a non-empty query."
        try:
            gh, ctx = session.require()
            blobs = gh.tree(ctx.head_sha)
        except GitHubError as exc:
            return f"Could not list the repo tree: {exc}"
        short = ctx.head_sha[:8]

        cand = [
            b for b in blobs
            if not SKIP_DIRS.search("/" + b.get("path", ""))
            and not BINARYISH.search(b.get("path", ""))
            and (b.get("size") or 0) < 200_000
            and (path_filter in b.get("path", "") if path_filter else True)
        ]
        needle = query.lower()
        # Filename hits first: search_code("auth") should surface auth.py early.
        cand.sort(key=lambda b: (needle not in b["path"].lower(), b["path"]))
        cand = cand[:MAX_SEARCH_FILES]

        hits: list[str] = []
        scanned = 0
        for b in cand:
            if len(hits) >= 40:
                break
            try:
                text = _read(b["path"])
            except GitHubError:
                continue
            scanned += 1
            for i, line in enumerate(text.split("\n"), 1):
                if needle in line.lower():
                    hits.append(f"{b['path']}:{i}: {line.strip()[:160]}")
                    if len(hits) >= 40:
                        break
        if not hits:
            extra = f" under filter {path_filter!r}" if path_filter else ""
            return f"No match for {query!r} in {scanned} file(s) at {short}{extra}."
        return "\n".join([f"----- {len(hits)} match(es) for {query!r} @ {short} -----", *hits])

    @tool
    def list_directory(path: str = "") -> str:
        """List a directory at the failing commit.

        USE THIS WHEN you need to know whether a file exists, or what the
        project layout is, before reading anything -- e.g. the error is
        ModuleNotFoundError: app.auth and you want to see whether app/ has an
        __init__.py, or you need the workflow file's real name.

        DO NOT USE IT to browse. One targeted listing is fine; walking the tree
        directory by directory means you are guessing, and search_code gets you
        there in a single call.

        Args:
            path: repo-relative directory. Empty = repository root.
        """
        try:
            gh, ctx = session.require()
            entries = gh.list_dir(path, ctx.head_sha)
        except GitHubError as exc:
            return f"Could not list `{path or '/'}`: {exc}"
        short = ctx.head_sha[:8]
        rows = sorted(
            f"{'dir ' if e.get('type') == 'dir' else 'file'}  "
            f"{(e.get('size') or 0):>7}  {e.get('name')}"
            for e in entries
        )
        return "\n".join([f"----- {path or '/'} @ {short} ({len(rows)} entries) -----", *rows])

    @tool
    def get_more_log(start_line: int = 1, num_lines: int = 80) -> str:
        """Read another slice of the failing step's log, by line number.

        USE THIS WHEN the window you were given is visibly cut off mid-evidence:
        a traceback whose top is above the excerpt, a dependency resolver whose
        candidate list printed earlier, a second failure referenced in the
        summary whose body is not shown. The window header tells you the total
        line count and where your excerpt sits inside it.

        DO NOT USE IT to "read the rest just in case". The window is already
        anchored on the first real error and always includes the tail; paging
        through thousands of lines of setup output adds no evidence and burns
        the turns you need for reading source.

        Args:
            start_line: 1-based line number in the cleaned step log.
            num_lines: how many lines to return (capped at 200).
        """
        try:
            _, ctx = session.require()
        except GitHubError as exc:
            return str(exc)
        lines = ctx.log_window.cleaned
        if not lines:
            return "No step log is available for this run."
        return slice_log(lines, int(start_line), min(int(num_lines), 200))

    return [read_file, get_full_diff, search_code, list_directory, get_more_log]


# Human-readable step labels for the SSE stream. Keys are tool names, values
# take the tool-call args and produce "Opened app/auth.py".
STEP_LABELS = {
    "read_file": lambda a: ("check", f"Opened {a.get('path', '?')}"),
    "get_full_diff": lambda a: (
        "diff",
        f"Read the patch for {a['path']}" if a.get("path") else "Read the full patch",
    ),
    "search_code": lambda a: ("search", f"Searched the repo for {a.get('query', '?')!r}"),
    "list_directory": lambda a: ("folder", f"Listed {a.get('path') or '/'}"),
    "get_more_log": lambda a: (
        "log",
        f"Pulled log lines {a.get('start_line', 1)}-"
        f"{int(a.get('start_line', 1)) + int(a.get('num_lines', 80)) - 1}",
    ),
}


def describe_tool_call(name: str, args: dict[str, Any]) -> tuple[str, str]:
    """(icon, label) for one tool call. Unknown tools degrade gracefully."""
    fn = STEP_LABELS.get(name)
    if fn is None:
        return "tool", f"Called {name}"
    try:
        return fn(args or {})
    except Exception:  # pragma: no cover - never break the stream over a label
        return "tool", f"Called {name}"


def rehydrate_log_lines(step_log: str) -> list[str]:
    """Helper for tests/CLI: cleaned lines from a raw step log."""
    return clean_log(step_log)
