import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "Models and keys" };

export default function ModelsPage() {
  return (
    <DocPage
      title="Models and keys"
      lede="TraceCI runs on your key, on a model you choose from a curated list. Both of those constraints exist for specific reasons, and both affect the quality of what you get back."
    >
      <h2 id="byok">Why bring-your-own-key</h2>
      <p>
        TraceCI is publicly reachable and has no accounts. Running it on a shared key would mean
        the first person to find it could exhaust the balance for everyone else. Requiring your own
        key also means there is nothing to store: it arrives in a request body, lives in the run
        configuration for the duration of one investigation, and is gone.
      </p>

      <h2 id="handling">What happens to your key</h2>
      <ul>
        <li>It is sent to the TraceCI API with one request, over the same connection as the run.</li>
        <li>
          On the server it is passed as a constructor argument to the model client. It is
          deliberately not written into the process environment, because that would leak one
          user&apos;s key into every other concurrent request in the same process.
        </li>
        <li>
          It is kept in the run configuration under a name the checkpointer refuses to persist, so
          it never reaches graph state or checkpoint metadata — and therefore never reaches a
          shared investigation record.
        </li>
        <li>
          In your browser it lives in memory by default and disappears on reload. Session retention
          is opt-in from <Link href="/settings">settings</Link> and still ends when the tab closes.
          It is never written to localStorage.
        </li>
      </ul>

      <Callout tone="neutral" title="It is not in the record either">
        Because the key was never in state, there is nothing to strip out when an investigation is
        read back by id. That is the only kind of secret handling that survives a refactor —
        filtering on the way out eventually gets forgotten.
      </Callout>

      <h2 id="curated">Why the model list is curated</h2>
      <p>
        Every model offered is known to support tool calling. That is an entry requirement, not a
        nicety, because a model without it fails <em>silently</em>: it never emits a tool call, the
        graph walks straight to the diagnosis step, and you get a fluent paragraph of confident
        nonsense with no error anywhere.
      </p>
      <p>
        A free-text model field would make that failure typeable. A dropdown makes it impossible,
        and <strong>Check key and model</strong> in the workspace verifies it directly by asking a
        question that can only be answered by calling a tool.
      </p>

      <h2 id="choosing">Choosing one</h2>
      <DefTable
        head={["Situation", "What to reach for"]}
        rows={[
          [
            "First run, no paid key",
            "The free Groq tier. Llama 3.3 70B has the highest token budget of the free options and is reliable at tool calling.",
          ],
          [
            "Obvious failure — dependency, lint, config",
            "Anything, including the smallest free model. The log already contains the answer; the model is formatting it.",
          ],
          [
            "Subtle regression",
            "A stronger model. The decision that matters is whether to open a source file rather than guess from the traceback, and that is where small models most often go wrong.",
          ],
          [
            "Repeated runs in quick succession",
            "A paid tier. Free plans cap tokens per minute, not just requests, and a re-run inside the same minute is the most common way to hit a 429.",
          ],
        ]}
      />

      <h2 id="budgets">Token budgets and why the log window shrinks</h2>
      <p>
        Free plans cap <strong>tokens per minute</strong>. One investigation is three model calls
        in about fifteen seconds, and each call resends the whole conversation — so a full-size log
        window plus a file read can burn well past a free-tier minute and take a rate-limit error
        halfway through the investigation.
      </p>
      <p>
        TraceCI therefore applies a tighter context budget on free-tier models: a smaller log
        window, smaller file reads, a smaller diff. The workspace tells you when this is in effect.
      </p>
      <p>
        Shrinking is not free. Cut the window too far and the traceback falls out and the diagnosis
        becomes a guess. The tight profile is tuned so that the anchored region <em>and</em> the
        tail both still fit — which is exactly what the windowing is built to guarantee — but on
        genuinely subtle failures a full-budget model still does better.
      </p>

      <h2 id="github">The GitHub token is separate</h2>
      <p>
        Reading runs, logs and source needs GitHub access, and that is configured on the server,
        not by you. Without it TraceCI is limited to public repositories and to GitHub&apos;s
        unauthenticated rate limit, which a single investigation can exhaust. Whether a token is
        configured is shown in <Link href="/settings">settings</Link>.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/troubleshooting",
            title: "Troubleshooting",
            note: "Rate limits, rejected keys and models that will not call tools.",
          },
          {
            href: "/docs/guides/best-practices",
            title: "Best practices",
            note: "Matching the model to the kind of failure.",
          },
        ]}
      />
    </DocPage>
  );
}
