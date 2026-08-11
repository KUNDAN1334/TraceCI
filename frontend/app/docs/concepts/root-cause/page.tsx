import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";
import { CATEGORY_META } from "@/lib/types";

export const metadata = { title: "Root cause and categories" };

export default function RootCausePage() {
  return (
    <DocPage
      title="Root cause and categories"
      lede="The result is a typed object, not a paragraph that happens to look structured. Each field has a job, and knowing what each one is for tells you how much weight to put on it."
    >
      <h2 id="fields">The five fields</h2>
      <DefTable
        head={["Field", "What it is for"]}
        rows={[
          [
            "category",
            "Routing. It answers 'who should look at this' before anyone reads a word of the analysis.",
          ],
          [
            "root_cause",
            "Two or three specific sentences naming the file, function and value at fault. Specificity is the requirement — a root cause you cannot act on has not been found.",
          ],
          [
            "evidence",
            "Two to five verbatim quotations that make the case checkable without trusting the prose.",
          ],
          [
            "confidence",
            "How much of the above is quotation and how much is inference. See evidence and confidence.",
          ],
          [
            "suggested_fix",
            "What to change, imperative, one or two sentences — plus a minimal patch where one exists.",
          ],
        ]}
      />
      <p>
        Because it is a validated schema rather than free text, a malformed result is a caught
        error rather than a plausible-looking paragraph with a missing field.
      </p>

      <h2 id="categories">Classification is by cause, not by failing step</h2>
      <p>
        This is the distinction that makes the category worth having. A run that failed at{" "}
        <code>Run tests</code> might be a genuine test failure, or a dependency that installed at a
        version the tests were never written against, or a runner that ran out of disk. All three
        fail at the same step and all three need a different person.
      </p>

      <dl className="mt-6">
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <div key={key}>
            <dt>
              <code>{key}</code> — {meta.label}
            </dt>
            <dd>{meta.blurb}</dd>
          </div>
        ))}
      </dl>

      <h3>Reading the harder categories</h3>
      <ul>
        <li>
          <strong>infra</strong> is the category that says &ldquo;this is not your change&rdquo;.
          Runner exhaustion, a registry timeout, a service container that never became healthy.
          Re-running is a legitimate response, which is not true of any other category.
        </li>
        <li>
          <strong>flaky</strong> is a claim about non-determinism: timing, ordering or shared
          state. It is the hardest to prove from a single run, so it usually comes with a modest
          confidence score and should.
        </li>
        <li>
          <strong>inconclusive</strong> means no cause was found. It is a first-class outcome, not
          a failure to try harder. When the deterministic layer can already see that the failing
          step&apos;s log contains no error, the model is never invoked at all — there is nothing
          to reason about, and asking anyway produces fluent hedging rather than silence. Such a
          result carries no suggested fix, on purpose: a fix for a cause nobody identified is the
          most expensive kind of wrong answer.
        </li>
      </ul>

      <Callout tone="neutral" title="The category can be right while the root cause is thin">
        Categorisation needs much less evidence than root-cause identification. A confident{" "}
        <code>dependency</code> label with a vague root cause is a normal and useful outcome: it
        has told you where to look even though it could not finish the job.
      </Callout>

      <h2 id="patch">The suggested patch</h2>
      <p>
        Where a minimal patch exists, it is included as a unified diff. It is{" "}
        <strong>illustrative</strong>: TraceCI has no write access and does not apply anything. It
        is deliberately minimal — the smallest change that addresses the stated cause — rather than
        the change you would probably make, because a large suggested rewrite is impossible to
        review against the evidence.
      </p>
      <p>
        Read it after the evidence, never before. A patch read first is a suggestion you have to
        trust; read after, it is one you can check.
      </p>

      <h2 id="acting">Acting on a diagnosis</h2>
      <ol>
        <li>Read the evidence. Does it say what the root cause says?</li>
        <li>
          Check the category against the failing step. A mismatch is not wrong, but it is the point
          at which to read more carefully.
        </li>
        <li>
          Check the confidence. Below 5, find the inferred link and verify it before touching code.
        </li>
        <li>
          If anything looks off, open the full record and read the log window the agent was given.
          Input problems are far more common than reasoning problems.
        </li>
      </ol>

      <NextReads
        items={[
          {
            href: "/docs/guides/reading-an-investigation",
            title: "Reading an investigation",
            note: "The same procedure applied to a real result.",
          },
          {
            href: "/docs/limitations",
            title: "Limitations",
            note: "Cases where the root cause is systematically unreliable.",
          },
        ]}
      />
      <p className="mt-6">
        The category is shown on every entry in the{" "}
        <Link href="/investigations">investigations list</Link>, so a pattern across several runs
        is visible without opening any of them.
      </p>
    </DocPage>
  );
}
