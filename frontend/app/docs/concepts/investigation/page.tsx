import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads, Sample } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "The investigation loop" };

export default function InvestigationPage() {
  return (
    <DocPage
      title="The investigation loop"
      lede="An investigation is a bounded graph with four phases, not an open-ended conversation. Knowing the shape tells you what the interface is showing you and why a run ended when it did."
    >
      <h2 id="shape">The shape of a run</h2>
      <Sample title="the graph">
        {`START -> fetch_failure -> investigate <-> tools -> diagnose -> END
            (no model)      (model)     (bounded)   (typed)`}
      </Sample>
      <p>
        The workspace shows this as four phases. The first two both come from{" "}
        <code>fetch_failure</code> and are separated in the interface because they fail for
        different reasons and it is useful to know which one you are stuck in.
      </p>

      <DefTable
        head={["Phase", "What is happening"]}
        rows={[
          [
            "Locate the run",
            "Resolving your input into a repository, then finding the failed run. Fails when the repository does not exist, is private without a token, or has no failed run.",
          ],
          [
            "Assemble context",
            "Downloading and windowing the failing step's log, resolving the last green commit, fetching the diff. This is the slowest phase and involves no model.",
          ],
          [
            "Investigate",
            "The agent reads the context and decides whether it needs anything else. Each row in the trace is a tool it chose to call.",
          ],
          [
            "Diagnose",
            "A separate model call that converts everything gathered into a validated result object.",
          ],
        ]}
      />

      <h2 id="no-model-first">Why the first two phases have no model in them</h2>
      <p>
        Everything <code>fetch_failure</code> does is unconditional. There is no version of this
        problem where you do not want the failing step&apos;s log, and no judgement involved in
        fetching it. Putting a model in front of that decision would add latency, add cost, and add
        a way for the run to fail before it started. The agentic part begins where the certainty
        ends — which, in practice, is the question &ldquo;is the log enough, or do I need to read
        the source?&rdquo;
      </p>

      <h2 id="budget">The tool budget</h2>
      <p>
        An investigation may make <strong>six</strong> tool calls. The bound is enforced twice, in
        two different ways, because they fail differently:
      </p>
      <ul>
        <li>
          <strong>A counter in graph state,</strong> checked before the model runs. When the budget
          is spent, the final call is made with no tools bound at all, so the model physically
          cannot request another one. Enforcing the limit in code rather than asking for it in the
          prompt is the difference between a cap and a wish.
        </li>
        <li>
          <strong>A graph recursion limit</strong> behind it, which catches a routing bug turning
          into an unbounded spend even if the counter logic is wrong.
        </li>
      </ul>
      <p>
        Six is deliberately tight. The failure mode it prevents is not cost, it is drift: an agent
        with twenty calls available will keep looking, and each additional file it reads makes it
        more likely to build a story around something incidental. Most correct diagnoses in
        practice use zero, one or two.
      </p>

      <Callout tone="neutral" title="Zero tool calls is often the right answer">
        On a dependency failure the resolver has already printed the conflicting constraints. An
        agent that goes and reads <code>requirements.txt</code> to confirm what the log already
        stated has wasted a turn and learned nothing.
      </Callout>

      <h2 id="termination">How a run ends</h2>
      <p>An investigation leaves the loop in one of four ways:</p>
      <ol>
        <li>
          <strong>The agent stops asking.</strong> It produces a message with no tool calls, which
          routes straight to <code>diagnose</code>. This is the normal path.
        </li>
        <li>
          <strong>The budget runs out.</strong> The agent is told it has used all six calls and
          asked to conclude from what it has. The diagnosis still gets produced; its confidence is
          usually lower, and it should be.
        </li>
        <li>
          <strong>An error.</strong> Anything from an expired log to a rate-limited provider. The
          stream emits one sentence you can act on, and the phase where it happened is marked
          failed in the trace. Partial progress is kept.
        </li>
        <li>
          <strong>You stop it.</strong> The request is aborted. Nothing is saved to the server and
          the trace shows how far it got.
        </li>
      </ol>

      <h2 id="separate-diagnose">Why diagnosis is a separate call</h2>
      <p>
        Asking one model call both to reason freely and to emit strict JSON degrades both: the
        reasoning gets terse because it is thinking about schema, and the JSON gets malformed
        because it is thinking about the problem. Splitting them means the loop can think in prose
        and the final step is a pure, schema-validated transform over everything the loop
        produced.
      </p>
      <p>
        This is why the diagnosis appears all at once rather than assembling itself line by line
        while you watch. The streaming text in the trace is the <em>investigation</em>; the result
        is written afterwards.
      </p>

      <h2 id="reopening">Reopening a run</h2>
      <p>
        Each investigation is checkpointed under a thread id. That id lets you reopen the complete
        record later, including the exact log window and diff summary the agent worked from. The
        record contains no key: the credential lives in the run configuration under a name the
        checkpointer refuses to persist, so there is nothing to filter out when the record is read
        back — which is the only kind of secret handling that survives a refactor.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/concepts/tools",
            title: "The agent's tools",
            note: "The five things it can spend its budget on.",
          },
          {
            href: "/docs/concepts/evidence",
            title: "Evidence and confidence",
            note: "What the run has to produce to be worth reading.",
          },
        ]}
      />
      <p className="mt-6">
        To watch the loop with your own eyes rather than read about it,{" "}
        <Link href="/investigate#replay">replay a recorded investigation</Link>.
      </p>
    </DocPage>
  );
}
