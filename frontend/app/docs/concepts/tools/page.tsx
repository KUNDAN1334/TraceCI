import { DocPage } from "@/components/docs/doc-page";
import { NextReads } from "@/components/docs/doc-parts";
import { Callout } from "@/components/ui/feedback";

export const metadata = { title: "The agent's tools" };

const TOOLS = [
  {
    name: "read_file",
    line: "Open one source file at the failing commit.",
    use: "The log names a file whose contents you have not seen and the root cause cannot be stated without them — a traceback frame in application code, a test asserting on a value defined elsewhere, or the workflow file driving the failing step.",
    avoid:
      "The log already contains the answer verbatim. Re-reading a file to confirm something the log stated wastes a turn.",
    note: "This is the highest-value call in the set. It is especially the right move on type and attribute mismatches, where the traceback points at the caller and the bug is in what the callee returns.",
  },
  {
    name: "get_full_diff",
    line: "Read the actual patch for a changed file.",
    use: "The diff summary lists a file whose change you need line by line to confirm or kill a hypothesis you already have. Passing a path restricts the patch to that file.",
    avoid:
      "As an opening move to look around. The summary already says what changed and by how much, and the largest hunk is very often not the cause.",
  },
  {
    name: "search_code",
    line: "Find where a symbol is defined or used.",
    use: "You know the name of the thing that broke — a function, constant, class or import — but not which file holds it, and neither the log nor the diff says.",
    avoid:
      "You already know the path; call read_file directly. It also reads file contents, so a vague query is expensive and comes back as noise.",
  },
  {
    name: "list_directory",
    line: "List a directory at the failing commit.",
    use: "You need to know whether a file exists or what the layout is before reading anything — a ModuleNotFoundError where the question is whether a package has an __init__.py, or finding a workflow file's real name.",
    avoid:
      "Browsing. One targeted listing is fine; walking the tree directory by directory means you are guessing.",
  },
  {
    name: "get_more_log",
    line: "Read another slice of the failing step's log by line number.",
    use: "The window is visibly cut off mid-evidence: a traceback whose top is above the excerpt, or a second failure referenced in the summary whose body is not shown.",
    avoid:
      "Reading the rest just in case. The window is already anchored on the first real error and always includes the tail.",
  },
];

export default function ToolsPage() {
  return (
    <DocPage
      title="The agent's tools"
      lede="Five read-only calls, each with an explicit brief for when using it is the wrong move. Restraint is the point: knowing when not to look is most of what separates a diagnosis from a guess."
    >
      <h2 id="read-only">All five are reads</h2>
      <p>
        Nothing in this set writes, comments, re-runs or pushes, and there is no sixth tool that
        does. Everything is pinned to the SHA that failed, taken from the run rather than from
        anything the model says, so the agent cannot talk itself into reading a different commit.
      </p>

      <h2 id="catalog">The catalog</h2>
      {TOOLS.map((tool) => (
        <section key={tool.name} className="mt-8">
          <h3 id={tool.name}>
            <code>{tool.name}</code>
          </h3>
          <p className="text-fg">{tool.line}</p>
          <dl className="mt-3">
            <dt className="text-ok">use when</dt>
            <dd>{tool.use}</dd>
            <dt className="mt-3 text-danger">do not use when</dt>
            <dd>{tool.avoid}</dd>
          </dl>
          {tool.note ? <p className="mt-3 text-fg-subtle">{tool.note}</p> : null}
        </section>
      ))}

      <h2 id="descriptions">Why the descriptions are written as decision criteria</h2>
      <p>
        A tool description is the only thing the model sees when deciding what to do next. Written
        as a description of behaviour — &ldquo;reads a file from the repository&rdquo; — it gives
        the model nothing to decide with, and the result is an agent that either calls everything
        or calls nothing.
      </p>
      <p>
        So each one is written as a pair of criteria: <em>use this when X</em> and{" "}
        <em>do not use it when Y</em>. Over-calling and under-calling are both tuned here rather
        than in the system prompt, because this is the text that is in front of the model at the
        moment the choice is made.
      </p>

      <Callout tone="neutral" title="Reading the trace as a quality signal">
        The tools an agent chose tell you how the diagnosis was reached. A single{" "}
        <code>read_file</code> on the file the traceback named is a good sign. Three
        <code>search_code</code> calls with vague queries followed by a confident answer is a sign
        the agent was lost and then guessed.
      </Callout>

      <h2 id="budget-interaction">Interaction with the budget</h2>
      <p>
        Each call spends one of six. A call that returns nothing useful still spends one — so the
        cost of an exploratory <code>search_code</code> is not zero, and the tool descriptions are
        written to discourage it for that reason. When the budget is exhausted the agent is asked
        to conclude from what it has, and the resulting confidence should be, and usually is,
        lower.
      </p>

      <NextReads
        items={[
          {
            href: "/docs/concepts/evidence",
            title: "Evidence and confidence",
            note: "What the agent has to bring back from these calls.",
          },
          {
            href: "/docs/guides/scenarios",
            title: "Failure scenarios",
            note: "Which tools a good run uses on each kind of failure.",
          },
        ]}
      />
    </DocPage>
  );
}
