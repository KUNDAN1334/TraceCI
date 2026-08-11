import Link from "next/link";
import type { ReactNode } from "react";
import { DocPage } from "@/components/docs/doc-page";
import { NextReads } from "@/components/docs/doc-parts";

export const metadata = { title: "FAQ" };

const FAQ: { heading: string; items: { q: string; a: ReactNode }[] }[] = [
  {
    heading: "Using it",
    items: [
      {
        q: "Do I need a GitHub token?",
        a: (
          <>
            Not for public repositories. Private ones need a token configured on the server, and
            without one you are also subject to GitHub&apos;s unauthenticated rate limit, which a
            single investigation can exhaust.
          </>
        ),
      },
      {
        q: "Can I investigate a specific run rather than the latest failure?",
        a: (
          <>
            Yes — paste the run URL into the repository field. It pins the investigation to that
            run.
          </>
        ),
      },
      {
        q: "How long does one take?",
        a: (
          <>
            Usually 15 to 45 seconds. The first ten to fifteen are spent downloading and unzipping
            the log archive and resolving the baseline commit, before any model runs.
          </>
        ),
      },
      {
        q: "What does it cost?",
        a: (
          <>
            Whatever three model calls cost on the provider you chose. On a free Groq key, nothing.
            TraceCI itself takes no payment and has no accounts.
          </>
        ),
      },
      {
        q: "Can I run it without an API key?",
        a: (
          <>
            You can <Link href="/investigate#replay">replay a recorded investigation</Link>, which
            is a captured live run played through the same interface. A live run needs a key.
          </>
        ),
      },
    ],
  },
  {
    heading: "Safety and data",
    items: [
      {
        q: "Can it change my repository?",
        a: (
          <>
            No. There is no code path that commits, comments, opens a pull request or re-runs a
            job. Every GitHub call it makes is a read.
          </>
        ),
      },
      {
        q: "Where does my API key go?",
        a: (
          <>
            To the TraceCI API with one request, then to the model provider. It is never written to
            graph state, checkpoint metadata or a shared record — see{" "}
            <Link href="/docs/models">models and keys</Link>.
          </>
        ),
      },
      {
        q: "What is sent to the model provider?",
        a: (
          <>
            The failure context — log window, diff summary, and any source the agent chooses to
            read. If your CI logs contain secrets, those secrets are in the request.
          </>
        ),
      },
      {
        q: "Who can see an investigation I ran?",
        a: (
          <>
            Anyone with the thread id can read that record from the server. Ids are random and not
            listed anywhere, but they are not access-controlled — treat one like a share link.
          </>
        ),
      },
    ],
  },
  {
    heading: "Results",
    items: [
      {
        q: "Why did it use zero tool calls?",
        a: (
          <>
            Because the log already contained the answer. On a dependency conflict or a lint error
            that is the correct behaviour, not a shortcut.
          </>
        ),
      },
      {
        q: "Why is the confidence low?",
        a: (
          <>
            Confidence measures how much of the root cause is quotation rather than inference. A
            low score usually means a thin log window, a non-deterministic failure, or an exhausted
            tool budget.
          </>
        ),
      },
      {
        q: "It blamed the wrong file. What now?",
        a: (
          <>
            Open the full record and check the log window and the baseline. Most wrong diagnoses
            are input problems rather than reasoning problems — the procedure is in{" "}
            <Link href="/docs/troubleshooting">troubleshooting</Link>.
          </>
        ),
      },
      {
        q: "Can I trust the suggested patch?",
        a: (
          <>
            Read it after the evidence, and treat it as the minimal change that addresses the
            stated cause rather than the change you should ship. It is most reliable on lint and
            type errors, least reliable on dependency conflicts.
          </>
        ),
      },
      {
        q: "Does it get better if I re-run it?",
        a: (
          <>
            Not meaningfully. If the first result was thin, the input was thin. A narrower branch,
            a more precise run, or a stronger model will change the outcome; repetition will not.
          </>
        ),
      },
    ],
  },
  {
    heading: "Scope",
    items: [
      {
        q: "Does it work with GitLab, CircleCI or Jenkins?",
        a: <>No. GitHub Actions only.</>,
      },
      {
        q: "Can it diagnose two failures in one run?",
        a: (
          <>
            It diagnoses the first failing step. Investigate the second separately once the first
            is fixed.
          </>
        ),
      },
      {
        q: "Does it track flaky tests over time?",
        a: (
          <>
            No. Each investigation is independent; there is no aggregation or trend analysis. See{" "}
            <Link href="/docs/limitations">limitations</Link>.
          </>
        ),
      },
      {
        q: "Are my past investigations stored anywhere I can search?",
        a: (
          <>
            The list is kept in your browser, not on the server — there are no accounts, and a
            shared index would expose everyone&apos;s repositories to everyone else. Diagnosed runs
            remain reachable on the server by id.
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <DocPage
      title="Frequently asked questions"
      lede="Short answers. Each one links to the page that explains it properly."
    >
      {FAQ.map((group) => (
        <section key={group.heading}>
          <h2 id={group.heading.toLowerCase().replace(/[^a-z]+/g, "-")}>{group.heading}</h2>
          <dl className="mt-4">
            {group.items.map((item) => (
              <div key={item.q} className="border-b border-line pb-4 last:border-0">
                <dt className="font-sans text-[14.5px] font-semibold text-fg">{item.q}</dt>
                <dd className="mt-1.5">{item.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <NextReads
        items={[
          {
            href: "/docs/quickstart",
            title: "Your first investigation",
            note: "The fastest way to answer the rest of your questions.",
          },
          {
            href: "/docs/limitations",
            title: "Limitations",
            note: "What TraceCI will not do for you.",
          },
        ]}
      />
    </DocPage>
  );
}
