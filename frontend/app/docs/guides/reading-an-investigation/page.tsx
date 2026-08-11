import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads, Sample, Step, Steps } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";
import { DiffBlock, EvidenceList } from "@/components/ui/code";
import { SAMPLE_DIAGNOSIS } from "@/lib/sample";

export const metadata = { title: "Reading an investigation" };

export default function ReadingPage() {
  return (
    <DocPage
      title="Reading an investigation"
      lede="A worked example, followed by the signals that separate a result you can act on from one that merely sounds right."
    >
      <h2 id="case">The case</h2>
      <p>
        A CI run on <code>break/subtle</code> failed at <code>Run tests</code>. One test out of 403
        failed. The diff since the last green run touched two files: a four-line change to{" "}
        <code>app/auth.py</code> and an eighty-seven-line rewrite of{" "}
        <code>app/rate_limit.py</code>.
      </p>
      <p>
        This is the shape that defeats a script. The obvious suspect is the large hunk. The
        traceback points at a test file, which is neither of the changed files. Nothing in the log
        names the actual cause.
      </p>

      <h2 id="trace">What the agent did</h2>
      <Sample title="investigation trace">
        {`⌕  Looking up kundan/traceme-lab        finding the most recent failed run
◉  Workflow \`CI\` failed                 run 15938201234
◎  First failing step: Run tests         log window anchored on the first real error
±  Diffed last green -> failing          2 file(s) changed across 1 commit(s)
▤  Opened app/auth.py                    chosen by the agent
✓  Evidence collected`}
      </Sample>
      <p>
        One tool call. The agent read the traceback, saw an <code>AttributeError</code> on a value
        the test did not create, and went to the file that creates it — not to the biggest hunk in
        the diff. That decision is the entire product.
      </p>

      <h2 id="evidence">The evidence</h2>
      <div className="my-5">
        <EvidenceList items={SAMPLE_DIAGNOSIS.evidence} />
      </div>
      <p>
        Read them as an argument. Line one is the error. Line two is where it surfaced — in the
        test, at line 47. Line three is the cause, in a different file, at line 18: a function
        returning a dict. Line four bounds the scope: one failure out of 403, so this is not an
        environment collapse.
      </p>
      <p>
        Every line is quoted. You can open the run and the file and confirm all four in under a
        minute, which is the standard the evidence field exists to meet.
      </p>

      <h2 id="conclusion">The conclusion</h2>
      <blockquote>{SAMPLE_DIAGNOSIS.root_cause}</blockquote>
      <p>
        Note the last sentence. The agent explicitly discharges the large hunk rather than ignoring
        it. That is worth more than it looks: it tells you the alternative was considered, so you
        do not have to go and check it yourself.
      </p>
      <div className="my-5">
        <DiffBlock patch={SAMPLE_DIAGNOSIS.fix_snippet} />
      </div>
      <p>
        Confidence was 9. Nothing in the root cause is absent from the evidence, so that is the
        correct score.
      </p>

      <h2 id="signals">Signals of a strong result</h2>
      <Steps>
        <Step n={1} title="The tool calls are few and targeted">
          <p>
            Zero to two calls, each one aimed at something the log named. A single{" "}
            <code>read_file</code> on the file in the traceback is the healthiest pattern there is.
          </p>
        </Step>
        <Step n={2} title="The evidence chain is complete without the prose">
          <p>
            Error, location, cause, scope. If you can reconstruct the argument from the quoted
            lines alone, the prose is a summary rather than a substitute.
          </p>
        </Step>
        <Step n={3} title="The root cause names things">
          <p>
            A file, a function, a value. &ldquo;A recent change to the authentication logic&rdquo;
            is not a root cause; <code>app/auth.py:refresh()</code> returning a dict is.
          </p>
        </Step>
        <Step n={4} title="Alternatives are addressed">
          <p>
            When the diff contained an obvious decoy, a good diagnosis says why it is not the
            cause.
          </p>
        </Step>
      </Steps>

      <h2 id="weak">Signals of a weak result</h2>
      <ul>
        <li>
          <strong>All six tool calls used.</strong> Usually an agent that could not find the thread
          and kept pulling. Read the diagnosis with the confidence score firmly in mind.
        </li>
        <li>
          <strong>Several vague <code>search_code</code> calls.</strong> A sign it did not know
          what it was looking for. Targeted searches for a symbol the log named are fine; searches
          for general terms are fishing.
        </li>
        <li>
          <strong>Evidence that restates the conclusion.</strong> If every quoted line is the error
          message in a slightly different form, nothing has been established beyond
          &ldquo;something failed&rdquo;.
        </li>
        <li>
          <strong>High confidence with a hedged root cause.</strong> &ldquo;Likely caused by&rdquo;
          at confidence 9 is internally inconsistent, and the confidence is the field that is
          wrong.
        </li>
        <li>
          <strong>The category contradicts the failing step without saying why.</strong> A{" "}
          <code>config</code> diagnosis for a failure at <code>Run tests</code> can be exactly
          right, but it needs a sentence explaining the connection.
        </li>
      </ul>

      <Callout tone="neutral" title="When something looks wrong, suspect the inputs first">
        Open the full record and read the log window. An anchor that landed on a warning instead of
        the real error, or a baseline commit further back than you expected, explains most bad
        diagnoses — and both are visible at a glance.
      </Callout>

      <NextReads
        items={[
          {
            href: "/docs/guides/scenarios",
            title: "Failure scenarios",
            note: "What good looks like for each kind of CI failure.",
          },
          {
            href: "/docs/troubleshooting",
            title: "Troubleshooting",
            note: "When the run does not finish at all.",
          },
        ]}
      />
      <p className="mt-6">
        This example is available to replay in full —{" "}
        <Link href="/investigate#replay">watch it run</Link>.
      </p>
    </DocPage>
  );
}
