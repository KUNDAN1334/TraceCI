import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Best practices" };

export default function BestPracticesPage() {
  return (
    <DocPage
      title="Best practices"
      lede="Most of what makes an investigation accurate is decided before it starts. These are the habits that move results from 'plausible' to 'checkable'."
    >
      <h2 id="target">Point it precisely</h2>
      <ul>
        <li>
          <strong>Paste the run URL, not the repository name,</strong> when you already have the
          failed run open. It pins the investigation to that exact run instead of to whatever
          failed most recently, which matters on an active branch.
        </li>
        <li>
          <strong>Name the branch</strong> when several are red. Otherwise you may get a diagnosis
          for somebody else&apos;s failure and spend a minute confused before noticing.
        </li>
        <li>
          <strong>Investigate promptly.</strong> Run logs expire, and the value of the green-to-red
          diff decays as more commits land on the branch.
        </li>
      </ul>

      <h2 id="repo">Make your CI legible</h2>
      <p>
        TraceCI reads what your pipeline produces. Pipelines that are easy for a person to diagnose
        are the ones it does well on, and the improvements are the same in both cases.
      </p>
      <ul>
        <li>
          <strong>Split setup from execution.</strong> A workflow with distinct{" "}
          <code>Install</code>, <code>Lint</code> and <code>Test</code> steps lets the failing step
          name do real work. A single step called <code>build</code> that does everything discards
          that signal entirely.
        </li>
        <li>
          <strong>Fail fast.</strong> A job that keeps going after the first real error buries the
          cause under thousands of consequence lines, which makes the log window harder to anchor
          correctly.
        </li>
        <li>
          <strong>Do not suppress output on failure.</strong> Redirecting test output to a file and
          printing only a summary removes the traceback, and the traceback is where the diagnosis
          starts.
        </li>
        <li>
          <strong>Keep runs green.</strong> The baseline is the last <em>successful</em> run. A
          branch that has not been green for thirty commits gives TraceCI a thirty-commit diff to
          search, and its accuracy falls accordingly.
        </li>
      </ul>

      <Callout tone="neutral" title="The highest-leverage change is usually step granularity">
        Splitting one large step into three costs nothing and improves both human and automated
        diagnosis immediately, because it converts an unstructured log into a labelled failure
        location.
      </Callout>

      <h2 id="model">Choose the model for the failure</h2>
      <ul>
        <li>
          <strong>Free-tier models are fine for obvious failures</strong> — dependency conflicts,
          lint errors, config mistakes — where the log already contains the answer.
        </li>
        <li>
          <strong>Use a stronger model for subtle regressions.</strong> The decision that matters
          is whether to open a source file rather than guess from the traceback, and that is where
          smaller models most often go wrong.
        </li>
        <li>
          <strong>Validate the key before a real run.</strong> A model that cannot call tools fails
          silently, producing confident nonsense with no error anywhere.
        </li>
      </ul>
      <p>
        Details are in <Link href="/docs/models">models and keys</Link>.
      </p>

      <h2 id="reading">Read results in the right order</h2>
      <ol>
        <li>The trace — how many tools, and were they aimed at anything the log named?</li>
        <li>The evidence — does it establish the claim without the prose?</li>
        <li>The root cause — does it name a file, a function and a value?</li>
        <li>The confidence — and if it is below 5, find the inferred link.</li>
        <li>The patch, last. It is the part you are least able to check on its own.</li>
      </ol>

      <h2 id="workflow">Fit it into how you already work</h2>
      <ul>
        <li>
          <strong>Run it before you re-run the job.</strong> A green re-run destroys the evidence
          for a flaky test. Diagnose first, then re-run.
        </li>
        <li>
          <strong>Share the thread id, not a screenshot.</strong> The record contains the exact log
          window and diff the agent worked from, which is what a second reader needs.
        </li>
        <li>
          <strong>Treat it as triage, not as authority.</strong> Its job is to get you to the right
          file in thirty seconds instead of ten minutes. Confirming the fix is still yours.
        </li>
      </ul>

      <h2 id="antipatterns">Things not to do</h2>
      <ul>
        <li>
          <strong>Do not apply a suggested patch without reading the evidence.</strong> A patch
          that resolves the symptom while the cause is elsewhere turns one red build into an
          intermittent one.
        </li>
        <li>
          <strong>Do not re-run TraceCI hoping for a better answer.</strong> If the first result
          was thin, the input was thin. Fix the input — a narrower branch, a more precise run, a
          less noisy log — instead.
        </li>
        <li>
          <strong>Do not use it as a log viewer.</strong> If you already know what broke, reading
          the log is faster.
        </li>
      </ul>

      <NextReads
        items={[
          {
            href: "/docs/models",
            title: "Models and keys",
            note: "Picking a model, and what happens to your credentials.",
          },
          {
            href: "/docs/troubleshooting",
            title: "Troubleshooting",
            note: "When a run does not finish.",
          },
        ]}
      />
    </DocPage>
  );
}
