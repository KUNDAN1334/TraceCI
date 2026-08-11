import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads, Sample, Step, Steps } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Your first investigation" };

export default function QuickstartPage() {
  return (
    <DocPage
      title="Your first investigation"
      lede="Five minutes, one red build and one API key. By the end you will know what every part of a TraceCI result means and how far to trust it."
    >
      <h2 id="before">Before you start</h2>
      <p>You need two things:</p>
      <ul>
        <li>
          A GitHub repository with at least one <strong>failed</strong> Actions run whose logs have
          not expired. GitHub keeps run logs for 90 days by default.
        </li>
        <li>
          An API key for a model that supports tool calling. The free Groq tier is enough — see{" "}
          <Link href="/docs/models">models and keys</Link>.
        </li>
      </ul>
      <p>
        If you have neither to hand, <Link href="/investigate#replay">replay a recorded run</Link>{" "}
        instead. It is a captured live investigation and exercises the same interface, so the rest
        of this page still applies.
      </p>

      <h2 id="run">Run one</h2>
      <Steps>
        <Step n={1} title="Open the workspace and name a target">
          <p>
            In <Link href="/investigate">Investigate</Link>, put{" "}
            <code>owner/repo</code> in the repository field. You can paste other things instead and
            TraceCI will work out what you meant:
          </p>
          <Sample title="all of these are accepted">
            {`owner/repo
https://github.com/owner/repo
git@github.com:owner/repo.git
https://github.com/owner/repo/tree/break/subtle
https://github.com/owner/repo/actions/runs/1234567890`}
          </Sample>
          <p>
            A run URL is the most precise option: it pins the investigation to that exact run
            instead of to the most recent failure. A <code>tree/</code> URL carries its branch.
          </p>
        </Step>

        <Step n={2} title="Leave the branch blank, or narrow it">
          <p>
            Blank means &ldquo;the most recent failed run on this repository&rdquo;. Naming a
            branch is worth doing when several branches are failing at once and you care about one
            of them.
          </p>
        </Step>

        <Step n={3} title="Pick a model and paste your key">
          <p>
            Only models known to call tools reliably are offered. Use{" "}
            <strong>Check key and model</strong> before a real run: it verifies the key{" "}
            <em>and</em> that the model actually emits a tool call. A key that is valid on a model
            which cannot call tools produces a fluent, confident, entirely wrong answer with no
            error anywhere — the single worst failure mode in this system, and the only one you
            cannot see from the result.
          </p>
        </Step>

        <Step n={4} title="Start it and watch the trace">
          <p>
            The left column fills in as the run proceeds. Rows appear because the agent decided to
            do something, not because a timer advanced — a row saying{" "}
            <em>Opened app/auth.py</em> means the agent read that file.
          </p>
        </Step>

        <Step n={5} title="Read the result from the evidence up">
          <p>
            When the diagnosis appears, read the <strong>evidence</strong> first and the{" "}
            <strong>root cause</strong> second. In that order you are checking a claim. In the
            other order you are being persuaded.
          </p>
        </Step>
      </Steps>

      <h2 id="expect">What you should expect to see</h2>
      <p>
        A typical run takes 15 to 45 seconds. The first ten to fifteen of those are spent before
        the agent does anything: listing runs, listing jobs, downloading and unzipping a
        multi-megabyte log archive, resolving the last green commit and fetching the comparison.
        The trace starts moving immediately so you can tell the difference between working and
        hung.
      </p>
      <p>
        Tool-call counts vary by failure type, and a low count is not a worse answer. A dependency
        failure where the resolver already printed the conflict should use{" "}
        <strong>zero</strong> tool calls; a subtle type regression usually needs one file read. A
        run that burns all six calls is usually a run that is lost — see{" "}
        <Link href="/docs/guides/reading-an-investigation">reading an investigation</Link>.
      </p>

      <Callout tone="neutral" title="Nothing is written to your repository">
        There is no code path in TraceCI that commits, comments, opens a pull request or re-runs a
        job. Everything it touches on GitHub is a read.
      </Callout>

      <h2 id="after">After the run</h2>
      <ul>
        <li>
          Diagnosed runs get a <strong>thread id</strong>. Opening the full record shows the exact
          log window and diff the agent was given — the fastest way to check whether it was working
          from the right inputs.
        </li>
        <li>
          Every run this browser starts is listed under{" "}
          <Link href="/investigations">Investigations</Link>, including failures and runs you
          stopped.
        </li>
        <li>
          Your key is not part of any of that. It is not in the record, not in the checkpoint and
          not in the id.
        </li>
      </ul>

      <NextReads
        items={[
          {
            href: "/docs/concepts/failure-context",
            title: "Failure context",
            note: "What the agent is given before it decides anything.",
          },
          {
            href: "/docs/guides/reading-an-investigation",
            title: "Reading an investigation",
            note: "How to tell a strong result from a plausible one.",
          },
        ]}
      />
    </DocPage>
  );
}
