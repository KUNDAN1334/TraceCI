import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Limitations" };

export default function LimitationsPage() {
  return (
    <DocPage
      title="Limitations"
      lede="Where TraceCI is unreliable, and where it will not help at all. This page is written as carefully as the rest because a tool that hides its edges is a tool you cannot calibrate."
    >
      <h2 id="scope">Hard boundaries</h2>
      <ul>
        <li>
          <strong>GitHub Actions only.</strong> There is no support for other CI providers. The log
          retrieval, job model and run history are all GitHub-specific.
        </li>
        <li>
          <strong>One repository at a time.</strong> A failure caused by a change in a different
          repository — a shared library, a reusable workflow, a container image built elsewhere —
          is visible only through its effects.
        </li>
        <li>
          <strong>One failure at a time.</strong> TraceCI diagnoses the first failing step. A run
          with two genuinely independent failures produces one diagnosis, not a list.
        </li>
        <li>
          <strong>Nothing is executed.</strong> It cannot run the test, reproduce the failure
          locally or bisect. Everything is inferred from logs, diffs and source.
        </li>
        <li>
          <strong>Read-only, permanently.</strong> No commits, comments, pull requests or re-runs.
          This is a design decision, not a missing feature.
        </li>
      </ul>

      <h2 id="degrades">Where accuracy degrades</h2>

      <h3>Long-red branches</h3>
      <p>
        The baseline is the last <em>successful</em> run. A branch that has not been green for
        thirty commits gives the agent a thirty-commit diff, and the signal that would normally
        point at one small change is spread across everything. Accuracy falls roughly with the size
        of the diff.
      </p>

      <h3>Failures the log does not describe</h3>
      <p>
        If a job is killed by the runner — out of memory, out of disk, a hard timeout — the log
        frequently ends mid-sentence with no error at all. TraceCI will usually categorise this
        correctly as infrastructure, but it cannot tell you which test allocated the memory,
        because nothing in the log says.
      </p>

      <h3>Suppressed or restructured output</h3>
      <p>
        Pipelines that redirect test output to a file and print only a summary have removed the
        traceback. Custom reporters that reformat failures into a shape unlike anything in the
        training distribution have the same effect. The window anchors on what looks like the first
        real error, and if nothing looks like an error, the anchor is arbitrary.
      </p>

      <h3>Non-determinism</h3>
      <p>
        A single failed run cannot establish flakiness. TraceCI can often identify the shared
        fixture or ordering assumption that <em>would</em> explain it, but the claim &ldquo;this is
        flaky&rdquo; is not provable from one run and any diagnosis asserting it at high confidence
        is overreaching.
      </p>

      <h3>Very large files</h3>
      <p>
        File reads are clipped at a character budget, tighter still on free-tier models. A relevant
        definition several thousand lines into a large module may fall outside the excerpt. The
        clip is marked in the text the agent sees, so it knows it is working from a fragment, but
        it cannot always recover the missing part inside its tool budget.
      </p>

      <h3>Small models on subtle failures</h3>
      <p>
        The judgement that matters is deciding to open a source file rather than guessing from the
        traceback. Smaller models systematically under-call tools here and produce a fluent
        diagnosis of the symptom. See <Link href="/docs/models">models and keys</Link>.
      </p>

      <Callout tone="warn" title="The failure mode to watch for">
        The dangerous output is not an obviously wrong answer — it is a <em>plausible</em> one
        built from real evidence that supports a weaker claim than the one being made. This is why
        every diagnosis carries its evidence, and why the reading order is evidence first.
      </Callout>

      <h2 id="not-designed">Things it is not designed to do</h2>
      <ul>
        <li>
          <strong>Fix the build.</strong> The suggested patch is illustrative and minimal, not a
          production change.
        </li>
        <li>
          <strong>Review code.</strong> It looks at a failure, not at quality, security or design.
        </li>
        <li>
          <strong>Track failures over time.</strong> There is no aggregation, no flake-rate
          tracking and no trend analysis. Each investigation is independent.
        </li>
        <li>
          <strong>Replace reading the log.</strong> When you already know what broke, opening the
          log is faster.
        </li>
      </ul>

      <h2 id="privacy">Data boundaries</h2>
      <ul>
        <li>
          The log window, diff summary and any source the agent reads are sent to the model
          provider you selected. If your CI logs contain secrets, those secrets are in the request.
        </li>
        <li>
          Checkpoints on the server contain the failure context and the diagnosis. They do not
          contain your key.
        </li>
        <li>
          Your investigation list, preferences and theme are stored in your browser only. There are
          no accounts and nothing is synced.
        </li>
      </ul>

      <NextReads
        items={[
          {
            href: "/docs/faq",
            title: "FAQ",
            note: "Shorter answers to adjacent questions.",
          },
          {
            href: "/docs/concepts/evidence",
            title: "Evidence and confidence",
            note: "How to tell which limitation you have hit.",
          },
        ]}
      />
    </DocPage>
  );
}
