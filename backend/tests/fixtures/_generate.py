"""Generate the noisy log fixtures.

Run: `python tests/fixtures/_generate.py`

Real Actions logs are thousands of lines of `Collecting ...`, `Requirement
already satisfied`, dependency resolution chatter and pytest dots, with the one
line that matters buried in the middle. Fixtures that are 20 clean lines long
prove nothing -- the whole point of `build_log_window` is surviving the noise,
so the fixtures have to contain it.
"""

from __future__ import annotations

import pathlib
import random

HERE = pathlib.Path(__file__).parent
random.seed(1729)

RED = "\x1b[31m"
GREEN = "\x1b[32m"
BOLD = "\x1b[1m"
OFF = "\x1b[0m"

_clock = [0]


def ts() -> str:
    _clock[0] += 37
    ms = _clock[0]
    return f"2026-08-04T09:{(ms // 60) % 60:02d}:{ms % 60:02d}.{(ms * 7919) % 10_000_000:07d}Z "


def stamp(lines: list[str]) -> str:
    return "\n".join(ts() + ln for ln in lines) + "\n"


PACKAGES = [
    "pytest", "ruff", "packaging", "pluggy", "iniconfig", "exceptiongroup",
    "tomli", "attrs", "typing-extensions", "certifi", "charset-normalizer",
    "idna", "urllib3", "click", "colorama", "pyyaml", "jinja2", "markupsafe",
]


def install_noise(n: int = 180) -> list[str]:
    out = ["##[group]Run python -m pip install --upgrade pip",
           "python -m pip install --upgrade pip",
           "pip install -r requirements.txt",
           "shell: /usr/bin/bash -e {0}",
           "##[endgroup]",
           "Requirement already satisfied: pip in /opt/hostedtoolcache/Python/3.11.9/x64/lib/python3.11/site-packages (24.0)",
           "Collecting pip",
           "  Downloading pip-24.2-py3-none-any.whl.metadata (3.6 kB)"]
    for i in range(n):
        pkg = random.choice(PACKAGES)
        ver = f"{random.randint(0, 9)}.{random.randint(0, 20)}.{random.randint(0, 9)}"
        out.append(f"Collecting {pkg}=={ver} (from -r requirements.txt (line {i % 7 + 1}))")
        out.append(f"  Downloading {pkg}-{ver}-py3-none-any.whl.metadata "
                   f"({random.randint(1, 9)}.{random.randint(0, 9)} kB)")
        out.append(f"  Using cached {pkg}-{ver}-py3-none-any.whl ({random.randint(10, 900)} kB)")
    out.append(f"{GREEN}Successfully installed{OFF} " +
               " ".join(f"{p}-1.{i}.0" for i, p in enumerate(PACKAGES)))
    return out


def collect_noise(n: int = 120) -> list[str]:
    out = [
        "##[group]Run pytest -v",
        "pytest -v",
        "shell: /usr/bin/bash -e {0}",
        "##[endgroup]",
        "============================= test session starts ==============================",
        "platform linux -- Python 3.11.9, pytest-8.3.3, pluggy-1.5.0 -- /opt/hostedtoolcache/Python/3.11.9/x64/bin/python",
        "cachedir: .pytest_cache",
        "rootdir: /home/runner/work/traceme-lab/traceme-lab",
        "configfile: pyproject.toml",
        "testpaths: tests",
        f"collecting ... collected {n + 5} items",
        "",
    ]
    for i in range(n):
        out.append(f"tests/test_module_{i // 12:02d}.py::test_case_{i:03d} "
                   f"{GREEN}PASSED{OFF} [{int((i + 1) / (n + 5) * 100):>3}%]")
    return out


# --------------------------------------------------------------------------
# 1. the `subtle` failure: AttributeError from a changed return type
# --------------------------------------------------------------------------
def pytest_attribute_error() -> str:
    lines: list[str] = []
    lines += install_noise(90)
    lines += collect_noise(320)
    lines += [
        "tests/test_auth.py::test_hash_password_is_not_plaintext_and_is_stable "
        f"{GREEN}PASSED{OFF} [ 97%]",
        f"tests/test_auth.py::test_verify_password_roundtrip {GREEN}PASSED{OFF} [ 98%]",
        f"tests/test_auth.py::test_short_password_is_rejected {GREEN}PASSED{OFF} [ 98%]",
        f"tests/test_auth.py::test_issue_token_sets_ttl {GREEN}PASSED{OFF} [ 99%]",
        f"tests/test_auth.py::test_refresh_extends_session {RED}FAILED{OFF} [100%]",
        "",
        f"=================================== {BOLD}FAILURES{OFF} ===================================",
        f"{RED}__________________________ test_refresh_extends_session __________________________{OFF}",
        "",
        "    def test_refresh_extends_session():",
        "        token = issue_token(\"alice\", now=1_000)",
        "        renewed = refresh(token, now=2_000)",
        ">       assert renewed.user == \"alice\"",
        f"{RED}E       AttributeError: 'dict' object has no attribute 'user'{OFF}",
        "",
        "tests/test_auth.py:46: AttributeError",
        f"=========================== {BOLD}short test summary info{OFF} ============================",
        "FAILED tests/test_auth.py::test_refresh_extends_session - AttributeError: 'dict' object has no attribute 'user'",
        f"{RED}========================= 1 failed, 124 passed in 1.82s ========================={OFF}",
        "##[error]Process completed with exit code 1.",
    ]
    return stamp(lines)


# --------------------------------------------------------------------------
# 2. the `dependency` failure: pip cannot resolve
# --------------------------------------------------------------------------
def pip_resolution_error() -> str:
    lines = install_noise(150)
    lines += [
        "Collecting requests==99.99.99 (from -r requirements.txt (line 3))",
        f"{RED}ERROR: Could not find a version that satisfies the requirement "
        f"requests==99.99.99 (from versions: 0.2.0, 0.2.1, 0.2.2, 0.2.3, 0.2.4, "
        f"0.3.0, 1.0.0, 1.2.3, 2.0.0, 2.25.1, 2.28.2, 2.31.0, 2.32.3){OFF}",
        f"{RED}ERROR: No matching distribution found for requests==99.99.99{OFF}",
        "##[error]Process completed with exit code 1.",
    ]
    return stamp(lines)


# --------------------------------------------------------------------------
# 3. the `lint_type` failure: ruff
# --------------------------------------------------------------------------
def ruff_error() -> str:
    lines = [
        "##[group]Run ruff check .",
        "ruff check .",
        "shell: /usr/bin/bash -e {0}",
        "##[endgroup]",
    ]
    lines += [f"Checking {i} files..." for i in range(3)]
    lines += [
        f"{RED}app/auth.py:5:8: F401{OFF} [*] `json` imported but unused",
        "  |",
        "3 | import hashlib",
        "4 | import hmac",
        "5 | import json",
        "  |        ^^^^ F401",
        "  |",
        "  = help: Remove unused import: `json`",
        "",
        f"{RED}app/auth.py:53:5: F821{OFF} Undefined name `AUDIT_LOG`",
        "   |",
        "53 |     AUDIT_LOG.append({\"event\": \"issue\", \"user\": user, \"at\": now})",
        "   |     ^^^^^^^^^ F821",
        "   |",
        "",
        "Found 2 errors.",
        "[*] 1 fixable with the `--fix` option.",
        "##[error]Process completed with exit code 1.",
    ]
    return stamp(lines)


# --------------------------------------------------------------------------
# 4. `config`: setup-python cannot find the version
# --------------------------------------------------------------------------
def setup_python_error() -> str:
    lines = [
        "##[group]Run actions/setup-python@v5",
        "with:",
        "  python-version: 3.99",
        "  check-latest: false",
        "  token: ***",
        "  update-environment: true",
        "##[endgroup]",
        "Version 3.99 was not found in the local cache",
        "Version 3.99 is available for downloading",
        "##[error]The version '3.99' with architecture 'x64' was not found for Ubuntu 24.04.",
        "The list of all available versions can be found here: "
        "https://raw.githubusercontent.com/actions/python-versions/main/versions-manifest.json",
        "##[error]Process completed with exit code 1.",
    ]
    return stamp(lines)


# --------------------------------------------------------------------------
# 5. the pathological case: no error-shaped line except the trailer
# --------------------------------------------------------------------------
def only_trailer() -> str:
    lines = [f"step output line {i}" for i in range(300)]
    lines.append("##[error]Process completed with exit code 1.")
    return stamp(lines)


# --------------------------------------------------------------------------
# 6. the case the tail-only and head-only strategies both fail on:
#    a `run: |` block with two commands. The real traceback is at ~line 90;
#    then 400 lines of the second suite; then the summary at the very bottom.
#    Any window that keeps only the head loses "1 failed, 402 passed"; any
#    window that keeps only the tail loses the traceback entirely.
# --------------------------------------------------------------------------
def early_error_late_summary() -> str:
    lines = [
        "##[group]Run pytest tests/unit -q",
        "pytest tests/unit -q",
        "pytest tests/integration -q",
        "shell: /usr/bin/bash -e {0}",
        "##[endgroup]",
        "============================= test session starts ==============================",
        "platform linux -- Python 3.11.9, pytest-8.3.3, pluggy-1.5.0",
        "rootdir: /home/runner/work/traceme-lab/traceme-lab",
        "collected 42 items",
        "",
    ]
    lines += [f"tests/unit/test_batch_{i:02d}.py .......                    [{i * 2:>3}%]"
              for i in range(20)]
    lines += [
        "",
        f"=================================== {BOLD}FAILURES{OFF} ===================================",
        f"{RED}______________________________ test_refresh_extends_session ______________________________{OFF}",
        "",
        "    def test_refresh_extends_session():",
        "        token = issue_token(\"alice\", now=1_000)",
        "        renewed = refresh(token, now=2_000)",
        ">       assert renewed.expires_at == 2_000 + TOKEN_TTL_SECONDS",
        f"{RED}E       AttributeError: 'dict' object has no attribute 'expires_at'{OFF}",
        "",
        "tests/unit/test_auth.py:47: AttributeError",
        "1 failed, 41 passed in 0.94s",
        "",
    ]
    # ...and now four hundred lines of the *second* suite, which passes.
    for i in range(400):
        lines.append(f"tests/integration/test_flow_{i // 20:02d}.py::test_step_{i:03d} "
                     f"{GREEN}PASSED{OFF} [{int((i + 1) / 400 * 100):>3}%]")
    lines += [
        "",
        f"=========================== {BOLD}short test summary info{OFF} ============================",
        "FAILED tests/unit/test_auth.py::test_refresh_extends_session - AttributeError: "
        "'dict' object has no attribute 'expires_at'",
        f"{RED}========================= 1 failed, 402 passed in 12.41s ========================={OFF}",
        "##[error]Process completed with exit code 1.",
    ]
    return stamp(lines)


FIXTURES = {
    "log_pytest_attribute_error.txt": pytest_attribute_error,
    "log_early_error_late_summary.txt": early_error_late_summary,
    "log_pip_resolution.txt": pip_resolution_error,
    "log_ruff.txt": ruff_error,
    "log_setup_python.txt": setup_python_error,
    "log_only_trailer.txt": only_trailer,
}


if __name__ == "__main__":
    for name, fn in FIXTURES.items():
        text = fn()
        (HERE / name).write_text(text, encoding="utf-8")
        print(f"{name:<34} {len(text.splitlines()):>5} lines  {len(text):>7} chars")
