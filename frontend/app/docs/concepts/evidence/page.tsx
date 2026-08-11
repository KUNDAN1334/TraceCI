import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads, Sample } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Evidence and confidence" };

export default function EvidencePage() {
  return (
    <DocPage
      title="Evidence and confidence"
      lede="An automated diagnosis is only useful if you can check it faster than you could have found it yourself. Evidence and confidence exist to make that check take about ten seconds."
    >
      <h2 id="what-counts">What counts as evidence</h2>
      <p>
        Every diagnosis carries two to five evidence entries, and each one must be a{" "}
        <strong>verbatim quotation</strong> from something the agent actually read — a line from
        the failing step&apos;s log, or a <code>file:line</code> reference with the source text at
        that line.
      </p>
      <Sample title="evidence from a real run">
        {`E       AttributeError: 'dict' object has no attribute 'expires_at'
tests/unit/test_auth.py:47: AttributeError
app/auth.py:18: return {'value': fresh.value, 'user': fresh.user, 'expires_at': fresh.expires_at}
1 failed, 402 passed in 12.41s`}
      </Sample>
      <p>
        Read those four lines in order and the argument is complete without the prose: the error,
        where it surfaced, the line that caused it, and the scope. That is what evidence is for. If
        you have to read the root-cause paragraph to understand why the evidence was chosen, the
        evidence is weak.
      </p>

      <h3>What does not count</h3>
      <ul>
        <li>
          <strong>Paraphrase.</strong> &ldquo;The test failed with an attribute error&rdquo; is a
          summary, not a quotation. You cannot check it against the log by eye.
        </li>
        <li>
          <strong>Unattributed source.</strong> A code fragment without a path and line number
          cannot be located, so it cannot be verified.
        </li>
        <li>
          <strong>Restating the conclusion.</strong> Evidence that says the same thing as the root
          cause in different words is circular.
        </li>
      </ul>

      <Callout tone="warn" title="Check the evidence supports the specific claim">
        The most common way a diagnosis goes wrong is not fabricated evidence — it is real evidence
        that supports a weaker claim than the one being made. A traceback proves{" "}
        <em>where the error surfaced</em>. It does not, by itself, prove what caused it.
      </Callout>

      <h2 id="confidence">What confidence is claiming</h2>
      <p>
        Confidence is a 1–10 integer, and it is a statement about <strong>sourcing</strong>, not
        about how likely the answer is to be right in some general sense. The question it answers
        is: how much of this root cause is present in the quoted lines, and how much did the agent
        infer?
      </p>

      <DefTable
        head={["Score", "What it means and what to do"]}
        rows={[
          [
            "8–10",
            "Nothing is inferred. Every part of the root cause appears in a quoted line. Read the evidence, confirm it says what the summary says, and act.",
          ],
          [
            "5–7",
            "The mechanism is supported but at least one link is reasoning rather than quotation — typically the agent saw the effect and inferred the cause. Verify the inferred link yourself before changing code.",
          ],
          [
            "1–4",
            "The agent is reasoning past its evidence and is telling you so. Treat this as a lead, not an answer. Usually means the log window was thin, the failure is non-deterministic, or the tool budget ran out.",
          ],
        ]}
      />

      <p>
        Rendering the score as ten discrete ticks rather than a percentage is deliberate. It is a
        coarse judgement, and a bar labelled &ldquo;90%&rdquo; would imply a precision that does
        not exist.
      </p>

      <h2 id="low-confidence">A low score is a feature</h2>
      <p>
        A system that always sounds certain is a system you eventually stop reading, because you
        cannot tell its good answers from its bad ones. TraceCI is prompted to score honestly and
        to reserve 8+ for cases where nothing was inferred, which means a 4 is real information:
        it tells you where to spend your own attention.
      </p>
      <p>
        If low scores are the norm on your repository rather than the exception, that is usually a
        context problem, not a model problem — see{" "}
        <Link href="/docs/guides/best-practices">best practices</Link>.
      </p>

      <h2 id="disagreeing">When you disagree with the evidence</h2>
      <p>
        Open the full record of the investigation. It contains the exact log window and diff
        summary the agent was given. Nine times out of ten a wrong diagnosis is not a reasoning
        failure but an input failure: the log window was anchored on a warning rather than the real
        error, or the baseline commit was further back than expected and the diff contained
        unrelated work. Both are visible immediately from the record and neither is guesswork.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/concepts/root-cause",
            title: "Root cause and categories",
            note: "How the conclusion itself is structured.",
          },
          {
            href: "/docs/guides/reading-an-investigation",
            title: "Reading an investigation",
            note: "A worked example, including what a weak result looks like.",
          },
        ]}
      />
    </DocPage>
  );
}
