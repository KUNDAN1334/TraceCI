import type { Diagnosis } from "./types";

/**
 * The overview page shows a real result, not an illustration.
 *
 * This is the diagnosis from `public/demo-stream.json` -- a captured live run
 * against the lab repository's `break/subtle` branch. Showing a fabricated
 * example on the front page of a diagnosis tool would be a strange choice.
 */
export const SAMPLE_DIAGNOSIS: Diagnosis = {
  category: "test_failure",
  root_cause:
    "app/auth.py:refresh() was changed to return a plain dict instead of the Token it is still annotated to return. tests/unit/test_auth.py:47 reads .expires_at off that result and raises AttributeError. The token-bucket rewrite of app/rate_limit.py in the same commit is the largest hunk in the diff but is not imported anywhere in the test suite.",
  evidence: [
    "E       AttributeError: 'dict' object has no attribute 'expires_at'",
    "tests/unit/test_auth.py:47: AttributeError",
    "app/auth.py:18: return {'value': fresh.value, 'user': fresh.user, 'expires_at': fresh.expires_at}",
    "1 failed, 402 passed in 12.41s",
  ],
  confidence: 9,
  suggested_fix:
    "Return the Token from refresh() and move the dict conversion to the API serialisation layer, or update every caller and the type annotation together.",
  fix_snippet: [
    " def refresh(token: Token, now: int) -> Token:",
    "     if is_expired(token, now):",
    '         raise AuthError("cannot refresh an expired token")',
    "-    fresh = issue_token(token.user, now)",
    '-    return {"value": fresh.value, "user": fresh.user, "expires_at": fresh.expires_at}',
    "+    return issue_token(token.user, now)",
  ].join("\n"),
};

export const SAMPLE_TRACE: { icon: string; label: string; detail: string }[] = [
  { icon: "search", label: "Located the failed run", detail: "kundan/traceme-lab · break/subtle" },
  { icon: "target", label: "First failing step: Run tests", detail: "log window anchored on the first real error" },
  { icon: "diff", label: "Diffed last green → failing commit", detail: "2 files changed across 1 commit" },
  { icon: "check", label: "Opened app/auth.py", detail: "the agent chose this" },
  { icon: "ok", label: "Evidence collected", detail: "root cause reached in 1 tool call" },
];

/** Prefilled targets. Every one is a real branch in the lab repository. */
export const EXAMPLE_TARGETS = [
  {
    label: "Subtle regression",
    repo: "kundan/traceme-lab",
    branch: "break/subtle",
    hint: "Traceback blames the test; the bug is in a return type two files away. Needs a file read.",
  },
  {
    label: "Bad dependency",
    repo: "kundan/traceme-lab",
    branch: "break/dependency",
    hint: "The resolver already printed the answer. A correct run uses zero tool calls.",
  },
  {
    label: "Lint / type error",
    repo: "kundan/traceme-lab",
    branch: "break/lint_type",
    hint: "Fails at the Lint step, before any test executes.",
  },
  {
    label: "Broken workflow config",
    repo: "kundan/traceme-lab",
    branch: "break/config",
    hint: "Fails at Set up Python. Nothing is wrong with the application code.",
  },
];
