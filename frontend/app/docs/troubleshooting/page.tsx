import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Troubleshooting" };

type Entry = { id: string; symptom: string; cause: string; fix: React.ReactNode };

const ENTRIES: { heading: string; items: Entry[] }[] = [
  {
    heading: "The run will not start",
    items: [
      {
        id: "no-failed-run",
        symptom: "No failed run found for this repository",
        cause:
          "There is no failed workflow run on the branch, or the branch name does not match. Branch names containing slashes are a common trip point.",
        fix: (
          <>
            Confirm the run is red in the Actions tab, then paste its URL instead of the repository
            name. A run URL removes the lookup entirely.
          </>
        ),
      },
      {
        id: "not-found",
        symptom: "Repository not found, or 404 from GitHub",
        cause:
          "The repository is private and the server has no GitHub token, or the name is misspelled.",
        fix: (
          <>
            Check whether a token is configured in <Link href="/settings">settings</Link>. Without
            one, only public repositories are reachable.
          </>
        ),
      },
      {
        id: "bad-input",
        symptom: "Could not read a repository out of that input",
        cause: "The text is not a form TraceCI recognises.",
        fix: (
          <>
            Use <code>owner/repo</code>, a GitHub repository URL, a <code>tree/</code> URL, or an
            Actions run URL. All four are accepted.
          </>
        ),
      },
    ],
  },
  {
    heading: "The run starts and then fails",
    items: [
      {
        id: "logs-expired",
        symptom: "The logs for this run have expired",
        cause:
          "GitHub deletes run logs after a retention period, 90 days by default. The run still exists; its logs do not.",
        fix: (
          <>
            Investigate a more recent failure. TraceCI will not diagnose from the diff alone,
            because a diagnosis without the log is a guess dressed as a conclusion.
          </>
        ),
      },
      {
        id: "key-rejected",
        symptom: "That API key was rejected by the provider",
        cause: "Wrong key, wrong provider, or a key that has been revoked.",
        fix: (
          <>
            Keys are provider-specific — an OpenAI key will not work on a Groq model. Use{" "}
            <strong>Check key and model</strong> to test the pair directly.
          </>
        ),
      },
      {
        id: "rate-limited",
        symptom: "Rate limited by the provider",
        cause:
          "On a free tier this is almost always tokens per minute rather than requests. One investigation is three calls in about fifteen seconds, each resending the conversation.",
        fix: (
          <>
            Wait about a minute, or switch to a model with a higher limit. Re-running immediately
            is the most reliable way to hit it again.
          </>
        ),
      },
      {
        id: "no-quota",
        symptom: "The key is valid but the account has no quota left",
        cause: "Billing or credit exhausted at the provider.",
        fix: <>Top up, or switch to a model on a provider where you still have quota.</>,
      },
      {
        id: "step-limit",
        symptom: "The agent hit its step limit without reaching a conclusion",
        cause:
          "The model kept requesting tools. Usually a smaller model that cannot decide it has enough.",
        fix: (
          <>
            Switch to a stronger model. This is the clearest signal that the model, not the input,
            is the constraint.
          </>
        ),
      },
    ],
  },
  {
    heading: "The interface itself is wrong",
    items: [
      {
        id: "api-unreachable",
        symptom: "API unreachable, or the model catalog will not load",
        cause:
          "The backend is not running, the API base URL is wrong, or this origin is not allowed by the server's CORS configuration.",
        fix: (
          <>
            Open <Link href="/settings">settings</Link> and re-check the connection. If the backend
            is up but the browser still cannot reach it, the cause is almost always that this
            origin is missing from <code>ALLOWED_ORIGINS</code> on the server.
          </>
        ),
      },
      {
        id: "stuck",
        symptom: "The trace stops moving for ten or fifteen seconds",
        cause:
          "Normal. Assembling context means downloading and unzipping a multi-megabyte log archive and resolving the baseline commit — all before any model runs.",
        fix: (
          <>
            The status stays on <em>Investigating</em> throughout, and the elapsed clock keeps
            running. If it exceeds about two minutes, stop it and retry.
          </>
        ),
      },
      {
        id: "no-diagnosis",
        symptom: "The run ended without a diagnosis",
        cause:
          "The stream finished but no structured result arrived, usually because the model produced output the schema could not accept.",
        fix: (
          <>
            Re-run, or switch to a model with stronger structured-output support. The trace is
            preserved either way.
          </>
        ),
      },
      {
        id: "no-cause-found",
        symptom: "No cause found — TraceCI stopped rather than guess",
        cause:
          "The failing step's log contains no error-shaped line, so there is nothing to trace back to a change. The most common source is a run that never actually executed: a job cancelled while waiting for a runner, or a bot-raised run whose log is provisioning output.",
        fix: (
          <>
            This is the system working. If you had a specific red run in mind, paste its URL to
            pin the investigation to it; otherwise the repository&apos;s real CI is probably
            green.
          </>
        ),
      },
      {
        id: "wrong-run",
        symptom: "It diagnosed a run I did not mean",
        cause:
          "With no branch or run URL given, TraceCI takes the most recent failed run. Bot-raised runs — Dependabot and similar — are skipped automatically, but an older genuine failure can still be picked while newer runs are green.",
        fix: (
          <>
            The trace names the run it chose, and says so when newer runs have since succeeded.
            Paste a run URL for an exact target, or name a branch to narrow the search.
          </>
        ),
      },
      {
        id: "missing-record",
        symptom: "An investigation id opens but has no server record",
        cause:
          "The checkpoint database was reset, the run was a replay, or you are on a different machine from the one that ran it.",
        fix: (
          <>
            The local copy still renders in full. Only the raw log window and diff summary, which
            live on the server, are unavailable.
          </>
        ),
      },
    ],
  },
];

export default function TroubleshootingPage() {
  return (
    <DocPage
      title="Troubleshooting"
      lede="Every error TraceCI can put in front of you, what it actually means, and what to do next. Errors are written as one actionable sentence rather than a stack trace, so the message you saw should map directly onto an entry here."
    >
      {ENTRIES.map((group) => (
        <section key={group.heading}>
          <h2 id={group.heading.toLowerCase().replace(/[^a-z]+/g, "-")}>{group.heading}</h2>
          <dl className="mt-4">
            {group.items.map((entry) => (
              <div key={entry.id} className="border-b border-line pb-4 last:border-0">
                <dt className="text-fg">{entry.symptom}</dt>
                <dd className="mt-1.5">
                  <p>{entry.cause}</p>
                  <p className="mt-1.5 text-fg">{entry.fix}</p>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <h2 id="diagnosis-wrong">The diagnosis is wrong</h2>
      <p>
        This is not an error state, so nothing will tell you about it. The procedure is the same
        every time and it starts with the inputs, not the reasoning:
      </p>
      <ol>
        <li>
          Open the full record and read the <strong>log window</strong>. Did it anchor on the real
          error, or on a warning above it?
        </li>
        <li>
          Read the <strong>diff summary</strong>. Is the baseline where you expected? A branch that
          has been red for a while produces a much larger diff than you would guess.
        </li>
        <li>
          Look at the <strong>tool calls</strong>. Did the agent read the file the traceback named,
          or did it never open anything?
        </li>
        <li>
          Check the <strong>confidence</strong>. A wrong answer at confidence 4 is the system
          working as designed; a wrong answer at confidence 9 is worth reporting.
        </li>
      </ol>

      <Callout tone="neutral" title="Input problems outnumber reasoning problems">
        In practice most bad diagnoses are traceable to a log window that missed the error or a
        baseline further back than expected. Both are visible in the record in seconds, and neither
        is fixed by re-running.
      </Callout>

      <NextReads
        items={[
          {
            href: "/docs/limitations",
            title: "Limitations",
            note: "Cases where a wrong answer is expected rather than a bug.",
          },
          {
            href: "/docs/guides/best-practices",
            title: "Best practices",
            note: "Avoiding most of the above in the first place.",
          },
        ]}
      />
    </DocPage>
  );
}
