import Link from "next/link";
import { DocPage } from "@/components/docs/doc-page";
import { DefTable, NextReads } from "@/components/docs/doc-parts";

export const metadata = { title: "What TraceCI is" };

export default function DocsIndex() {
  return (
    <DocPage
      title="What TraceCI is"
      lede="TraceCI is an agent that reads a failed GitHub Actions run and traces the failure back to the change that caused it, with the log lines and source that prove it."
      chips={["GitHub Actions", "read-only", "bring your own key", "≤ 6 tool calls", "~15s"]}
    >
      <h2 id="problem">The problem it solves</h2>
      <p>
        A red build tells you a step exited non-zero. It does not tell you which of the fourteen
        commits since the last green run is responsible, whether the traceback is pointing at the
        bug or at a victim of the bug, or whether the failure has anything to do with your change
        at all. Working that out means opening the run, scrolling several thousand lines of
        installation output to find the first real error, going back to the commit list to work out
        what the last passing run was, and then reading source to check whether what the log claims
        is actually true.
      </p>
      <p>
        That sequence is mechanical up to the last step, and the last step is where judgement is
        needed. TraceCI automates the mechanical part exactly, and applies a model only where a
        decision has to be made.
      </p>

      <h2 id="what-it-does">What it does</h2>
      <p>Given a repository, TraceCI:</p>
      <ol>
        <li>Finds the most recent failed workflow run, on a branch if you name one.</li>
        <li>
          Identifies the first step that actually failed, and builds a log window anchored on the
          first real error rather than on the end of the file.
        </li>
        <li>
          Resolves the last <em>green</em> commit on that branch and diffs it against the failing
          one, so the comparison is the one that matters.
        </li>
        <li>
          Hands all of that to an agent that decides for itself whether it needs to open source
          files, read a specific patch, search for a symbol, or read more of the log.
        </li>
        <li>
          Returns a typed result: a category, a root cause naming file and function, two to five
          verbatim evidence lines, a confidence score, a suggested fix and often a minimal patch.
        </li>
      </ol>
      <p>
        Steps one to three involve no model at all. They are the same every time, so letting
        something choose whether to do them would only add latency and a new way to fail.
      </p>

      <h2 id="what-it-is-not">What it is not</h2>
      <DefTable
        head={["Not this", "Because"]}
        rows={[
          [
            "A chatbot",
            "There is no conversation. One failed run in, one structured diagnosis out. The prose you see streaming is the agent working, not a reply to you.",
          ],
          [
            "An autofixer",
            "TraceCI has no write access to anything. It suggests a patch; applying it is your decision and your commit.",
          ],
          [
            "A log search tool",
            "Grep finds the error line. The error line is usually not the cause — that is the entire difficulty.",
          ],
          [
            "A CI provider",
            "It reads runs that GitHub Actions already produced. It does not schedule, run or re-run anything.",
          ],
        ]}
      />

      <h2 id="guarantees">What it guarantees</h2>
      <ul>
        <li>
          <strong>Read-only.</strong> No commits, comments, pull requests, re-runs or pushes exist
          anywhere in the system. The worst outcome of a wrong diagnosis is a paragraph of text.
        </li>
        <li>
          <strong>Pinned reads.</strong> Every file the agent opens is read at the exact commit
          that failed. Reading <code>main</code> while diagnosing a branch produces a diagnosis
          that contradicts its own evidence.
        </li>
        <li>
          <strong>Bounded work.</strong> Six tool calls per investigation, enforced in code, with a
          graph recursion limit behind it as a backstop.
        </li>
        <li>
          <strong>Your key, once.</strong> The key you supply is used for one request and is never
          written to graph state, checkpoint metadata or a shared record.
        </li>
      </ul>

      <h2 id="where-to-start">Where to start</h2>
      <p>
        If you have a repository with a red build and an API key, go straight to the{" "}
        <Link href="/docs/quickstart">quickstart</Link>. If you would rather see a finished result
        first, <Link href="/investigate#replay">replay a recorded investigation</Link> — it is a
        captured live run, replayed through the same interface, and needs no key.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/quickstart",
            title: "Your first investigation",
            note: "Run one end to end and learn what each part of the result means.",
          },
          {
            href: "/docs/concepts/investigation",
            title: "The investigation loop",
            note: "The four phases, the tool budget, and how a run terminates.",
          },
          {
            href: "/docs/limitations",
            title: "Limitations",
            note: "Read this before you rely on a diagnosis.",
          },
          {
            href: "/docs/models",
            title: "Models and keys",
            note: "Which model to pick, and what happens to your key.",
          },
        ]}
      />
    </DocPage>
  );
}
