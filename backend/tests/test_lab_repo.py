"""The lab repo is a deliverable, so it gets tested like one.

These tests copy `lab-repo/` to a temp dir, apply each break for real, and
assert that it fails at the step it is supposed to fail at with the error the
diagnosis is supposed to find. If a break stops reproducing, the demo is broken
and I want to know here rather than on a call.

Portability note: the edits are applied by calling `apply_break.py` with the
running interpreter, NOT by shelling out to `break.sh`. The shared Python file
is the one thing both `break.sh` and `break.ps1` depend on, so testing it
directly covers both platforms -- and these tests then pass on Windows, where
there may be no `bash` at all. The shell wrappers get their own tests below,
skipped when their interpreter is missing.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

import pytest

LAB = pathlib.Path(__file__).resolve().parents[2] / "lab-repo"
pytestmark = pytest.mark.skipif(not LAB.exists(), reason="lab-repo not present")


def _find_git_bash() -> str | None:
    """Resolve a bash that can run break.sh's git commands against Windows paths.

    `shutil.which("bash")` returns whichever `bash.exe` is first on PATH, and on
    a machine with WSL installed that is often `System32\\bash.exe` (the WSL
    launcher stub), not Git Bash. WSL's bash runs a separate Linux git with no
    view of Windows drive letters, so a `C:\\...` remote URL gets misparsed as
    SCP syntax (`ssh: Could not resolve hostname c`). Only a real Git Bash
    (MSYS/MINGW `uname`) can run this test on Windows; walk PATH ourselves and
    pick that one instead of trusting the first match.
    """
    if sys.platform != "win32":
        return shutil.which("bash")

    candidates = [pathlib.Path(d) / "bash.exe" for d in os.environ.get("PATH", "").split(os.pathsep)]
    # Git for Windows adds `<root>\cmd` (git.exe only) to PATH, not `<root>\bin`
    # or `<root>\usr\bin` (where bash.exe actually lives), so a plain PATH walk
    # misses it entirely outside a Git Bash shell. Derive the install root from
    # wherever git.exe is instead.
    git = shutil.which("git")
    if git:
        root = pathlib.Path(git).resolve().parent.parent
        candidates += [root / "bin" / "bash.exe", root / "usr" / "bin" / "bash.exe"]

    seen = set()
    for candidate in candidates:
        if candidate in seen or not candidate.exists():
            continue
        seen.add(candidate)
        try:
            out = subprocess.run(
                [str(candidate), "-c", "uname -s"], capture_output=True, text=True, timeout=10
            ).stdout
        except OSError:
            continue
        if "MSYS" in out or "MINGW" in out:
            return str(candidate)
    return None


BASH = _find_git_bash()
HAS_BASH = BASH is not None
CASES = ["test_failure", "dependency", "lint_type", "config", "subtle"]


def lab_copy(tmp_path: pathlib.Path) -> pathlib.Path:
    """Copy lab-repo's *files*, not whatever git state it happens to be in.

    `lab-repo/` is a real, separately-pushed repo -- it has its own `.git`
    with real history and a real `origin`. These tests want a pristine
    directory they can `git init` fresh on top of; copying `.git` wholesale
    would carry that real history (and remote) into the copy, so a later
    `git commit` here finds nothing to commit and `git remote add origin`
    collides with the one already configured.
    """
    dst = tmp_path / "lab"
    shutil.copytree(LAB, dst, ignore=shutil.ignore_patterns(".git"))
    try:
        (dst / "break.sh").chmod(0o755)
    except OSError:  # Windows does not have a mode bit to set
        pass
    return dst


def run(cmd: list[str], cwd: pathlib.Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=180)


def pytest_in(path: pathlib.Path) -> subprocess.CompletedProcess:
    return run([sys.executable, "-m", "pytest", "-q"], path)


def apply_break(path: pathlib.Path, case: str) -> subprocess.CompletedProcess:
    """Apply a break the cross-platform way: the shared Python, directly."""
    proc = run([sys.executable, "apply_break.py", case], path)
    assert proc.returncode == 0, f"apply_break.py {case} failed:\n{proc.stdout}\n{proc.stderr}"
    assert "COMMIT_MESSAGE=" in proc.stdout, "the wrappers read the commit message from stdout"
    return proc


# -- baseline ---------------------------------------------------------------
def test_baseline_is_green(tmp_path):
    lab = lab_copy(tmp_path)
    proc = pytest_in(lab)
    assert proc.returncode == 0, proc.stdout
    assert "5 passed" in proc.stdout


def test_the_five_cases_are_what_we_think_they_are(tmp_path):
    lab = lab_copy(tmp_path)
    out = run([sys.executable, "apply_break.py", "--list"], lab).stdout.split()
    assert out == CASES


@pytest.mark.skipif(not HAS_BASH, reason="bash not available (normal on Windows)")
def test_the_bash_wrapper_agrees_with_the_shared_python(tmp_path):
    lab = lab_copy(tmp_path)
    assert run([BASH, "./break.sh", "--list"], lab).stdout.split() == CASES
    proc = run([BASH, "./break.sh", "subtle", "--local"], lab)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    # The wrapper must swallow the machine-readable line and print the rest.
    assert "COMMIT_MESSAGE=" not in proc.stdout
    assert "refresh() now returns a dict" in proc.stdout
    assert "no git operations" in proc.stdout
    assert '"expires_at": fresh.expires_at' in (lab / "app" / "auth.py").read_text()


def test_the_powershell_wrapper_stays_in_sync_with_the_bash_one(tmp_path):
    """Cannot execute break.ps1 here, but the two wrappers drifting apart is a
    real risk, so assert the contract they share: same cases, same delegation."""
    ps1 = (LAB / "break.ps1").read_text(encoding="utf-8")
    sh = (LAB / "break.sh").read_text(encoding="utf-8")
    for case in CASES:
        assert case in ps1, f"break.ps1 is missing the `{case}` case"
    # Neither wrapper may contain the edits -- apply_break.py owns those.
    for name, text in (("break.ps1", ps1), ("break.sh", sh)):
        assert "apply_break.py" in text, f"{name} must delegate to apply_break.py"
        assert "TOKEN_TTL_SECONDS" not in text, f"{name} has drifted a copy of the edits"
        assert "COMMIT_MESSAGE" in text, f"{name} must read the commit message back"


# -- the breaks that fail at "Run tests" ------------------------------------
def test_test_failure_break_fails_the_ttl_assertion(tmp_path):
    lab = lab_copy(tmp_path)
    apply_break(lab, "test_failure")
    proc = pytest_in(lab)
    assert proc.returncode != 0
    assert "test_issue_token_sets_ttl" in proc.stdout
    assert "assert 3600 == 1800" in proc.stdout or "1800" in proc.stdout
    assert "1 failed, 4 passed" in proc.stdout


def test_subtle_break_produces_the_intended_attribute_error(tmp_path):
    """The most important artifact in the project.

    The failure must be an AttributeError from a *return type* change, the
    traceback must point at the test (not at auth.py), and the loud part of the
    diff must be somewhere else entirely."""
    lab = lab_copy(tmp_path)
    out = apply_break(lab, "subtle").stdout
    assert "refresh() now returns a dict" in out
    assert "rate_limit.py" in out

    proc = pytest_in(lab)
    assert proc.returncode != 0
    assert "AttributeError" in proc.stdout
    assert "'dict' object has no attribute" in proc.stdout
    # Exactly one test fails, and it is not named after anything in the loud hunk.
    assert "1 failed, 4 passed" in proc.stdout
    assert "test_refresh_extends_session" in proc.stdout
    assert "rate" not in "test_refresh_extends_session"


def test_subtle_break_leaves_the_real_cause_only_in_the_source(tmp_path):
    lab = lab_copy(tmp_path)
    apply_break(lab, "subtle")
    auth = (lab / "app" / "auth.py").read_text()
    # The cause: refresh() no longer returns a Token.
    assert '"expires_at": fresh.expires_at' in auth
    assert "-> Token" in auth, "the annotation still lies, which is the point"
    # The loud change is real but harmless -- nothing imports it.
    rl = (lab / "app" / "rate_limit.py").read_text()
    assert "token bucket" in rl.lower()
    for f in (lab / "tests").glob("*.py"):
        assert "rate_limit" not in f.read_text(), "the tests must not touch the loud file"


def test_subtle_break_still_passes_lint(tmp_path):
    """It has to reach `Run tests` to be a test failure -- a lint error earlier
    in the workflow would make it a `lint_type` failure instead."""
    ruff = shutil.which("ruff")
    if not ruff:
        pytest.skip("ruff not installed")
    lab = lab_copy(tmp_path)
    apply_break(lab, "subtle")
    proc = run([ruff, "check", "."], lab)
    assert proc.returncode == 0, proc.stdout


# -- the breaks that fail earlier in the workflow ---------------------------
def test_dependency_break_pins_an_impossible_version(tmp_path):
    lab = lab_copy(tmp_path)
    apply_break(lab, "dependency")
    reqs = (lab / "requirements.txt").read_text()
    assert "requests==99.99.99" in reqs
    # It must fail at `Install deps`, i.e. before pytest ever runs.
    assert pytest_in(lab).returncode == 0, "the dependency break must not break the tests"


def test_lint_type_break_trips_f401_and_f821(tmp_path):
    ruff = shutil.which("ruff")
    lab = lab_copy(tmp_path)
    apply_break(lab, "lint_type")
    auth = (lab / "app" / "auth.py").read_text()
    assert "import json" in auth and "AUDIT_LOG" in auth
    if not ruff:
        pytest.skip("ruff not installed")
    proc = run([ruff, "check", "."], lab)
    assert proc.returncode != 0
    assert "F401" in proc.stdout and "F821" in proc.stdout


def test_config_break_sets_an_impossible_python_version(tmp_path):
    lab = lab_copy(tmp_path)
    apply_break(lab, "config")
    ci = (lab / ".github" / "workflows" / "ci.yml").read_text()
    assert 'python-version: "3.99"' in ci
    # ...and nothing else changed, so it must fail at `Set up Python`.
    assert pytest_in(lab).returncode == 0


def test_the_workflow_has_the_distinct_named_steps_we_rely_on(tmp_path):
    lab = lab_copy(tmp_path)
    ci = (lab / ".github" / "workflows" / "ci.yml").read_text()
    for name in ["Checkout", "Set up Python", "Install deps", "Lint", "Run tests"]:
        assert f"name: {name}" in ci, f"missing step `{name}`"


@pytest.mark.skipif(not HAS_BASH, reason="bash not available (normal on Windows)")
def test_the_full_git_flow_branches_commits_and_pushes(tmp_path):
    """`break.sh` without --local is what actually gets used, so test it against
    a local bare remote: five independent branches off main, and a working tree
    left clean on main afterwards."""
    if not shutil.which("git"):
        pytest.skip("git not installed")
    bare = tmp_path / "origin.git"
    run(["git", "init", "-q", "--bare", str(bare)], tmp_path)
    lab = lab_copy(tmp_path)

    # Git for Windows ships two git.exe builds: the native one (which is what
    # the test's own `run()` calls resolve via PATH) and the MSYS-compiled one
    # bundled with Git Bash (what `bash ./break.sh` below actually runs). The
    # MSYS build misparses a bare `C:\Users\...` remote URL as SCP syntax
    # (host "C", path "\Users\..."), so `origin.git`'s URL must be given as a
    # POSIX-style path (`bare.as_posix()`) to parse the same way in both.
    for cmd in (
        ["git", "init", "-q", "-b", "main"],
        ["git", "config", "user.email", "t@example.com"],
        ["git", "config", "user.name", "t"],
        ["git", "add", "-A"],
        ["git", "commit", "-qm", "initial: green baseline"],
        ["git", "remote", "add", "origin", bare.as_posix()],
        ["git", "push", "-q", "-u", "origin", "main"],
    ):
        assert run(cmd, lab).returncode == 0, cmd

    cases = ["test_failure", "dependency", "lint_type", "config", "subtle"]
    for case in cases:
        proc = run([BASH, "./break.sh", case], lab)
        assert proc.returncode == 0, f"{case}:\n{proc.stdout}\n{proc.stderr}"

    branches = run(["git", "--git-dir", str(bare), "branch"], lab).stdout
    for case in cases:
        assert f"break/{case}" in branches

    # Left on main, with nothing uncommitted -- otherwise the next break
    # inherits the previous one and every branch is a lie.
    assert run(["git", "rev-parse", "--abbrev-ref", "HEAD"], lab).stdout.strip() == "main"
    assert run(["git", "status", "--porcelain"], lab).stdout.strip() == ""

    # The subtle branch: the loud file must dominate the diffstat, and the
    # commit message must advertise the loud file.
    stat = run(["git", "diff", "--stat", "main", "break/subtle"], lab).stdout
    assert "app/auth.py" in stat and "app/rate_limit.py" in stat
    auth_line = next(ln for ln in stat.splitlines() if "auth.py" in ln)
    rl_line = next(ln for ln in stat.splitlines() if "rate_limit.py" in ln)
    assert int(auth_line.split("|")[1].split()[0]) < int(rl_line.split("|")[1].split()[0]) / 5
    subject = run(["git", "log", "--format=%s", "-1", "break/subtle"], lab).stdout
    assert "rate-limit" in subject and "auth" not in subject


@pytest.mark.parametrize("case", CASES)
def test_every_break_applies_cleanly_from_baseline(tmp_path, case):
    lab = lab_copy(tmp_path)
    apply_break(lab, case)
    # Applying twice must refuse rather than silently corrupt the file.
    second = run([sys.executable, "apply_break.py", case], lab)
    assert second.returncode != 0, f"{case} applied twice without complaining"
    assert "not at baseline" in second.stderr
