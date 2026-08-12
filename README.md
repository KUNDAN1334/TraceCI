<p align="center">
<img width="1880" height="907" alt="image" src="https://github.com/user-attachments/assets/d7d3bb48-6474-4ffd-98c5-e475f4cc8595" />
</p>

<h1 align="center">TraceCI</h1>

**An agent that reads a failed GitHub Actions run and tells you which change
broke the build — with the log lines that prove it.**

Read-only. Bounded to six tool calls. And it tells you when it doesn't know.

[**Live demo →**](https://trace-ci.vercel.app/) · no API key needed
&nbsp;·&nbsp;

---

## What it actually does

A build goes red. The log is four thousand lines. GitHub shows you the last one:

```
##[error]Process completed with exit code 1.
```

Which tells you nothing — that line is appended to **every** failed step
regardless of cause. So you scroll, find the traceback, read the test, open the
diff, and fifteen minutes later discover it was a three-line hunk in a commit
about something else.

TraceCI does that in about thirty seconds and shows its working:

```
⌕  Looking up KUNDAN1334/traceme-lab      finding the most recent failed run
◉  Workflow `CI` failed                    run 31351514474
◎  First failing step: Run tests           log window anchored on the first real error
±  Diffed last green → failing commit      2 files changed across 1 commit
⌕  Searched the repo for 'def refresh'     chosen by the agent
▤  Opened app/auth.py                      chosen by the agent
✓  Evidence collected

── test_failure ─────────────────────────────────── confidence 9/10 ──

  app/auth.py:refresh() was changed to return a plain dict instead of the
  Token it is still annotated to return. tests/unit/test_auth.py:47 reads
  .expires_at off that result and raises AttributeError. The token-bucket
  rewrite of app/rate_limit.py in the same commit is the largest hunk in
  the diff but is not imported anywhere in the test suite.

  evidence
    log:2907    E   AttributeError: 'dict' object has no attribute 'expires_at'
    log:2908    tests/unit/test_auth.py:47: AttributeError
    auth.py:18  return {'value': fresh.value, 'expires_at': fresh.expires_at}
    log:3996    1 failed, 402 passed in 12.41s
```

Note the last sentence of the root cause: it names the loudest change in the
diff and explicitly **discharges** it. That is the whole problem in one line.

---

## The part I'd point at: it refuses to guess

Most tools in this space always answer. This one has a category for *no cause
found*, and it is reached without ever calling the model.

If the failing step's log contains no error — a job cancelled while waiting for
a runner, a Dependabot maintenance run, a step that never executed — the graph
routes **past the model entirely** and says so:

```
── No cause found ──────────── TraceCI stopped rather than guess ──

  This job never started executing — its log is runner-provisioning output
  with no command output and no error. Nothing failed here that can be
  traced to a change in the repository.

  A suggested fix is deliberately absent.
```

This exists because of a real bug. Run against a repo whose CI was green, an
earlier version returned a confident-looking diagnosis at confidence 5/10 with
a suggested fix. Four things were wrong at once, and only the last was visible:
run selection picked a Dependabot job, a "no error found" signal was computed
and then ignored, the output schema had no way to express *nothing to
diagnose*, and the UI rendered the result under a "Root cause" heading.

> Asking a model to explain a failure that isn't in front of it doesn't produce
> silence — it produces fluent hedging at a middling confidence, which reads
> exactly like a real diagnosis to anyone skimming. The only reliable fix is to
> not ask the question.

Where the model *is* asked and still hedges, `enforce_honesty()` reconciles it
in code: hedged prose demotes the category, caps confidence at 2, and **drops
the suggested fix** — because a fix proposed for a cause nobody identified is
the part someone acts on.

---

## Why an agent, and not a script

Because **the evidence needed differs per failure.**

| Failure | What is sufficient | Tool calls |
|---|---|---|
| A dependency pin that cannot resolve | the log, verbatim | **0** |
| An invalid `python-version` | the log | 0–1 |
| A lint error | the log — rule code and `file:line` are printed | 0–1 |
| A test asserting on a constant that changed | the log + one file | 1 |
| **A function that quietly changed its return type** | the log + *choosing* to open a file the diff does not point at | **1–2** |

A fixed pipeline has to decide in advance what to fetch. Fetch too little and
the last row is unanswerable. Fetch everything and the first row costs four
times as much and gets a *worse* answer, because irrelevant source dilutes the
evidence.

The lab repo's `break/subtle` branch makes this falsifiable: `refresh()` starts
returning a `dict` instead of a `Token`, in a three-line hunk, inside a commit
whose message and 95-line diff are about a rate limiter that nothing imports.
The traceback names the *test*. The diff summary names the *rate limiter*. The
cause is reachable only by deciding to open `app/auth.py`.

**A script cannot solve that row. That row is the argument.**

---

## Architecture

<img width="856" height="190" alt="image" src="https://github.com/user-attachments/assets/6ea203e9-49da-4d5f-bc2a-d67d7b04ab54" />


**`fetch_failure` contains no LLM.** Finding the failed run, the first failing
job and *step*, downloading the log zip, resolving the last green commit and
diffing it are all unconditional. Letting a model choose to do them adds
latency, cost and failure modes and buys nothing. *The agentic part starts
where the certainty ends.*

**`investigate ⇄ tools`** is a ReAct loop with a hard cap of six calls enforced
**in code** — past the cap the model is invoked with no tools bound, so it
physically cannot ask for another — plus LangGraph's `recursion_limit` as a
backstop. Enforcing a bound in code rather than in a prompt is the difference
between a cap and a wish.

**`diagnose`** is separate, using `with_structured_output`. Asking one call to
both investigate and emit strict JSON degrades both.

### Where the frameworks show up

| | Used for |
|---|---|
| **LangChain** | `init_chat_model` (Groq, OpenAI, Anthropic and Google are four catalog entries, not four code paths), `@tool`, `bind_tools`, `with_structured_output` |
| **LangGraph** | `TypedDict` state, deterministic pre-fetch node, ReAct loop with `ToolNode` + conditional edges, iteration bound, SQLite checkpointer, `stream_mode=["updates","messages"]` |

---

## The log window is the product

`backend/traceci/log_window.py` turns a noisy 4,000-line log into ~120 readable
lines. Three rules, each learned the hard way:

1. **Strip first.** ANSI escapes and per-line ISO timestamps eat context budget
   and break the anchor patterns.
2. **Anchor in tiers, never on noise.** Tier 1 is test-framework/compiler output
   (`Traceback`, `E   AssertionError`, `npm ERR!`, `error TS####`, `panic:`,
   ruff's `file:line: F401`). Tier 2 is a *meaningful* `##[error]`. Tier 3 is
   anything error-shaped. There is an explicit noise list, because anchoring on
   `Process completed with exit code 1` throws away the real traceback hundreds
   of lines earlier — and the model then produces a fluent, confident, **wrong**
   diagnosis with no error visible anywhere.
3. **Always include the tail.** `=== 1 failed, 402 passed ===` only exists at
   the bottom. Without it the model cannot tell "one test regressed" from "the
   suite is down", and that changes the diagnosis.

The bar, asserted in `tests/test_log_window.py`: a human should be able to
diagnose the failure from the window alone in about fifteen seconds.

---

## How I know it works — evals

`pytest` proves the plumbing. This proves the agent is any good, which is a
different question.

```bash
python scripts/run_evals.py --model groq-llama-3.3-70b
```

Four cases, chosen because a *correct* run behaves differently on each:

| Case | Correct behaviour | Tool calls | Confidence |
|---|---|---|---|
| `subtle` | Must open a source file the diff doesn't point at | 1–3 | 7–10 |
| `dependency` | Must use **zero** — the resolver already printed the answer | 0–1 | 7–10 |
| `lint_type` | Rule code, file and line are all in the log | 0–2 | 7–10 |
| `config` | Must classify by *cause*, not by the failing step's job | 0–2 | 6–10 |

Five checks each: category, evidence quoted verbatim, root cause names the file
and function, tool calls in range, confidence in range.

**`confidently_wrong` is tracked separately** — wrong category at confidence
≥ 8. A wrong answer at confidence 3 is the system working as designed; a wrong
answer at confidence 9 is the system lying. Any aggregate that averages those
together hides the number that matters. The runner exits non-zero if it's above
zero, so it can gate a release.

Rate-limited cases are reported as **skipped** and excluded from every rate — a
score that moves with your provider quota is not a measurement of the agent.

> The harness earned its place on its first run, catching a bug that only fires
> on one failure class with one model family: Groq validates tool arguments
> server-side and rejects `"confidence": "9"` as a string, killing an otherwise
> complete analysis after twenty seconds of work.

---

## Security

BYOK, and the key never touches persistent state:

- **Not in `CIState`** — the checkpointer serialises state and
  `GET /analysis/{thread_id}` reads it back, so a key in state means every share
  link leaks somebody's key.
- **Not in checkpoint metadata either.** Putting it in
  `config["configurable"]["api_key"]` is *not* sufficient: LangGraph copies every
  `str`/`int`/`bool` in `configurable` into checkpoint metadata. The only thing
  it skips is keys beginning with `__` — hence `__api_key` / `__github_token`.
  A test greps the raw `.sqlite` bytes, because this leak is invisible until
  someone opens the file.
- **Passed as an explicit constructor argument**, never by mutating
  `os.environ`, which would leak one user's key into every concurrent request in
  the process.
- **Never in an SSE event** or the share-link response.

`validate_key()` checks the key **and** that the model actually emits a
`tool_call` — because a model without tool-calling degrades silently: it never
calls a tool, the graph walks to `diagnose`, and the output is confident
nonsense with no error anywhere.

---

## Free to run

The default model is Groq's free `llama-3.3-70b-versatile`. No card.

The constraint that creates: Groq's free plan caps **tokens per minute** (12K on
Llama 3.3), and one analysis is three model calls in fifteen seconds, each
resending the conversation. So every catalog entry carries a `ContextBudget`,
and free-tier models get `TIGHT`.

```
normal budget : ~9,100 tokens per analysis   -> 429s on both 8K and 12K TPM
tight  budget : ~6,000 tokens per analysis   -> fits
```

That squeeze is only safe because the windowing scales its *line counts* with
the budget rather than chopping a finished window in half — so the anchored
traceback and the `1 failed, 402 passed` summary both survive.
`tests/test_budget.py` asserts both ends.

---

## Running it locally

```bash
cd backend
pip install -r requirements-dev.txt
pytest                                  # 180+ tests, no credentials needed
uvicorn traceci.api:app --reload        # :8000

cd ../frontend
npm install && npm run dev              # :3000
```

Deployment (Vercel + Render, free tier, ~30 minutes): **[DEPLOY.md](DEPLOY.md)**.
Day-to-day usage and troubleshooting: **[HOW_TO_RUN.md](HOW_TO_RUN.md)**.

---

## Repository layout

```
backend/
  traceci/
    repo_input.py   accepts owner/repo, URLs, SSH, .git, tree/ and run URLs
    github.py       GitHub REST client; run/job selection, log zip, compare
    log_window.py   ANSI/timestamp stripping, tiered anchoring, tail
    prefetch.py     the deterministic layer -> FailureContext
    tools.py        the five read-only tools, pinned to the failing SHA
    prompts.py      the system prompt, and why each clause is in it
    models.py       BYOK catalog, per-model context budgets, validate_key
    graph.py        CIState, the nodes, the bound, the honesty guards
    api.py          FastAPI + SSE (five event types)
  evals/            the scored eval set and its harness
  tests/            180+ tests, all runnable without credentials
frontend/           Next.js App Router — landing, workspace, history, docs
lab-repo/           the demo subject; five reproducible failures
```

---

## Limitations

An honest list. The scope discipline is why this shipped.

- **GitHub Actions only.** The graph is provider-agnostic; only `prefetch.py`
  is GitHub-shaped.
- **One failure per run.** A matrix build failing in three places gets one
  diagnosis.
- **Long-red branches degrade accuracy.** The baseline is the last *successful*
  run, so thirty commits of diff spreads the signal.
- **Nothing is executed.** It cannot reproduce or bisect; everything is inferred
  from logs, diffs and source.
- **Flakiness is unprovable from one run.** It can name the shared fixture that
  *would* explain it, but the claim needs history.
- **Logs expire after ~90 days.** GitHub returns `410`; TraceCI reports that
  rather than guessing.
- **Log contents go to your model provider.** If your CI logs contain secrets,
  those secrets are in the request. This is the real enterprise blocker.
- **SQLite on an ephemeral disk.** On Render's free tier share links don't
  survive a redeploy; the frontend detects this and falls back to its local copy.

## Future work

A GitHub App that comments on red builds automatically (the real unlock — today
you have to remember to visit) · persisting diagnoses to detect flakiness across
runs · closing the loop by checking whether a suggested fix correlated with the
next run going green, which turns the honesty work into a measurable accuracy
number · secret redaction before egress · GitLab and Buildkite prefetch
implementations.
