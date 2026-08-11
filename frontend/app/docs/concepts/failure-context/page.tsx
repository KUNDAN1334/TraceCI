import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads, Sample } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Failure context" };

export default function FailureContextPage() {
  return (
    <DocPage
      title="Failure context"
      lede="Everything the agent is handed before it is allowed to make a single decision. Most wrong diagnoses come from reading the wrong thing, so this part is deterministic on purpose."
    >
      <h2 id="run">The run and the job</h2>
      <p>
        A GitHub Actions <strong>run</strong> is one execution of a workflow. It contains{" "}
        <strong>jobs</strong>, and each job contains <strong>steps</strong>. A run is red because
        at least one step in at least one job exited non-zero.
      </p>
      <p>
        TraceCI resolves the target in this order: an explicit run id if you pasted a run URL,
        otherwise the most recent failed run on the branch you named, otherwise the most recent
        failed run on the repository. It then takes the first failed job in that run.
      </p>

      <h2 id="failing-step">The first failing step</h2>
      <p>
        The <em>first</em> failing step matters, not the last. Once a step fails, later steps often
        fail as consequences — a test job that failed to install dependencies will also report that
        no tests were collected, and diagnosing that second message sends you somewhere useless.
      </p>
      <p>
        The failing step name is also the strongest single hint about the category of failure. A
        failure at <code>Set up Python</code> is a configuration problem no matter what the
        application code looks like; a failure at <code>Lint</code> means nothing has executed yet.
      </p>

      <h2 id="log-window">The log window</h2>
      <p>
        A CI log is routinely tens of thousands of lines, and almost all of it is installation
        noise. Handing the whole thing to a model is impossible on token grounds and unhelpful
        anyway. Handing it the last N lines — the obvious approach — is worse than it sounds: a
        pytest run prints its summary at the end but the traceback that explains the failure can be
        thousands of lines earlier, and a dependency resolver prints its candidate list long before
        the line that says it gave up.
      </p>
      <p>So the window is built in three moves:</p>
      <ol>
        <li>
          <strong>Clean.</strong> Timestamps, ANSI colour codes and GitHub&apos;s workflow command
          markers are stripped, because they consume tokens and carry nothing.
        </li>
        <li>
          <strong>Anchor.</strong> The window is centred on the <em>first real error</em> — the
          first line that looks like a genuine failure rather than a warning or a retry.
        </li>
        <li>
          <strong>Always include the tail.</strong> The final lines are appended regardless, so the
          summary line survives even when the anchor is far from the end.
        </li>
      </ol>
      <Sample title="what a window header looks like">
        {`----- step log: Run tests (4182 lines, showing 61-240 and the tail) -----`}
      </Sample>
      <p>
        The header states the total line count and where the excerpt sits inside it. That is what
        makes it possible for the agent to ask for a different slice sensibly rather than paging
        blindly — see <Link href="/docs/concepts/tools">the agent&apos;s tools</Link>.
      </p>

      <Callout tone="warn" title="Expired logs">
        GitHub deletes run logs after a retention period, 90 days by default. TraceCI cannot
        investigate a run whose logs are gone, and says so rather than guessing from the diff
        alone.
      </Callout>

      <h2 id="baseline">The green-to-red diff</h2>
      <p>
        The comparison that explains a failure is <strong>last green commit → failing commit</strong>
        , not <em>previous commit → failing commit</em>. If a branch has had four red runs in a
        row, the change that broke it is four commits back, and diffing against the immediately
        previous commit shows you an unrelated typo fix.
      </p>
      <p>
        TraceCI walks the branch&apos;s run history to find the most recent <em>successful</em> run
        of the same workflow, takes its head SHA as the baseline, and fetches the comparison. The
        agent is given a summary — file names, added and deleted line counts, commit count — not
        the full patch, because the largest hunk in a diff is very often not the cause, and reading
        the whole patch first is the fastest way to anchor on the wrong file.
      </p>
      <Sample title="diff summary as the agent sees it">
        {`----- changes since the last green run -----
2 file(s) changed across 1 commit(s), green -> red.
  modified  app/auth.py         (+4 -3)
  modified  app/rate_limit.py   (+87 -21)`}
      </Sample>
      <p>
        In that example the large hunk is a red herring and the four-line change is the cause. The
        agent has to decide which to look at, which is exactly the judgement the system exists to
        apply.
      </p>

      <h2 id="pinning">Everything is pinned to the failing SHA</h2>
      <p>
        Every read the agent makes — files, directory listings, symbol searches — happens at the
        commit that failed, not at the branch head and not at <code>main</code>. This matters more
        than it sounds. If someone pushed the fix while you were investigating, reading the branch
        head shows you corrected source next to a log that describes the bug, and any diagnosis
        built from both is incoherent.
      </p>

      <DefTable
        head={["Input", "Where it comes from"]}
        rows={[
          ["Repository, run, job", "GitHub Actions run history, filtered to failures"],
          ["Failing step", "The first step in the first failed job with a non-zero conclusion"],
          ["Log window", "The step's log: cleaned, anchored on the first real error, tail appended"],
          ["Diff summary", "Compare API, last successful run's head SHA → failing head SHA"],
          ["Source files", "Contents API, always at the failing head SHA, only when the agent asks"],
        ]}
      />

      <NextReads
        items={[
          {
            href: "/docs/concepts/investigation",
            title: "The investigation loop",
            note: "What happens once the agent has all of this.",
          },
          {
            href: "/docs/concepts/tools",
            title: "The agent's tools",
            note: "How it goes and gets what the context does not include.",
          },
        ]}
      />
    </DocPage>
  );
}
