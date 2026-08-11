import Link from "next/link";
import type { Metadata } from "next";
import { HeroTerminal } from "@/components/marketing/hero-terminal";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Reveal } from "@/components/marketing/reveal";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "TraceCI — diagnose a failed CI run",
  description:
    "TraceCI reads a failed GitHub Actions run, investigates the repository with read-only tools, and reports a root cause with quoted evidence.",
};

const STATS = [
  { figure: "4,112", label: "log lines in" },
  { figure: "4", label: "quoted evidence lines out" },
  { figure: "6", label: "tool calls, hard cap" },
  { figure: "0", label: "writes to your repository" },
];

const TOOLS = [
  ["read_file", "Open one source file at the failing commit."],
  ["get_full_diff", "Read the patch for a specific changed file."],
  ["search_code", "Find where a symbol is defined or used."],
  ["list_directory", "Check what actually exists in the tree."],
  ["get_more_log", "Pull another slice of the failing step's log."],
];

const SUFFICIENCY = [
  ["A dependency pin that cannot resolve", "the log, verbatim"],
  ["An invalid python-version", "the log"],
  ["A lint error", "the log — rule code and file:line"],
  ["A test asserting on a constant that changed", "the log and one file"],
  ["A function that quietly changed its return type", "the log, the diff, and choosing which file"],
];

export default function OverviewPage() {
  return (
    <>
      {/* ================================================================ hero */}
      <section className="mx-auto max-w-shell px-6 pt-16 sm:pt-24 lg:px-8">
        <Reveal>
          <h1 className="display-xl max-w-[16ch]">Your build went red. Skip the scroll.</h1>
        </Reveal>

        <Reveal delay={80}>
          <div className="mb-12 mt-8 grid items-end gap-8 lg:grid-cols-2 lg:gap-14">
            <p className="max-w-[48ch] text-[19px] leading-[1.58] text-fg-muted">
              An agent that reads the failing step&apos;s log and the diff since the last green
              commit, then tells you which change broke the build — with the lines that prove it.
            </p>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <ButtonLink href="/investigate" variant="primary" size="lg">
                Start an investigation
              </ButtonLink>
              <ButtonLink href="/docs" size="lg">
                Read the docs
              </ButtonLink>
            </div>
          </div>
        </Reveal>

        <Reveal delay={140}>
          <HeroTerminal />
        </Reveal>
      </section>

      {/* =============================================================== stats */}
      <section className="mx-auto max-w-shell px-6 pt-4 lg:px-8">
        <Reveal>
          <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface md:grid-cols-4">
            {STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={cn(
                  "px-6 py-5",
                  i < STATS.length - 1 && "md:border-r md:border-line",
                  i % 2 === 0 && "border-r border-line md:border-r",
                  i < 2 && "border-b border-line md:border-b-0"
                )}
              >
                <dd className="font-mono text-2xl font-semibold tracking-[-0.02em] text-fg">
                  {stat.figure}
                </dd>
                <dt className="mt-1.5 text-[13.5px] text-fg-subtle">{stat.label}</dt>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      {/* ============================================================= problem */}
      <Section id="problem">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <Reveal>
            <h2 className="display-lg max-w-[20ch]">
              The first fifteen minutes are always the same fifteen minutes.
            </h2>
            <div className="mt-6 flex max-w-[52ch] flex-col gap-4 text-[17px] leading-[1.65] text-fg-muted">
              <p>
                A build goes red. The log is four thousand lines. GitHub shows you the end of it,
                which is the same line for <em className="italic text-fg">every</em> failed step
                regardless of cause: process completed with exit code 1.
              </p>
              <p>
                So you scroll. You find the traceback. You read the test. You open the diff and
                work out which of the last eleven commits could have done it. Fifteen minutes
                later you know it was a three-line hunk in a commit about something else.
              </p>
              <p className="font-medium text-fg">TraceCI automates that first fifteen minutes.</p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="flex flex-col gap-3.5">
              <div className="overflow-hidden rounded-lg border border-danger/25 bg-danger/[0.045]">
                <p className="border-b border-danger/20 px-4 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.09em] text-danger">
                  what GitHub shows you
                </p>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.7] text-fg-subtle">
                  {"  ... 3,997 lines omitted ...\n"}
                  <span className="text-danger">
                    {"##[error]Process completed with exit code 1."}
                  </span>
                  {"\n  line 4,000 of 4,000"}
                </pre>
              </div>

              <div className="overflow-hidden rounded-lg border border-line-strong bg-elevated">
                <p className="border-b border-line-strong px-4 py-2.5 font-mono text-[11.5px] uppercase tracking-[0.09em] text-fg-subtle">
                  what TraceCI shows you
                </p>
                <div className="flex flex-col gap-3 px-4 py-4">
                  <p className="text-[15px] leading-[1.6] text-fg">
                    <strong className="font-semibold">Root cause:</strong>{" "}
                    <code className="font-mono text-[13.5px]">refresh()</code> in{" "}
                    <code className="font-mono text-[13.5px]">app/auth.py</code> returns a{" "}
                    <code className="font-mono text-[13.5px]">dict</code> instead of a{" "}
                    <code className="font-mono text-[13.5px]">Token</code>. The commit message is
                    about a rate limiter that nothing in the test suite imports.
                  </p>
                  <div className="flex flex-wrap gap-2 font-mono text-[11px] text-fg-subtle">
                    {["log window", "diff vs. last green", "read_file app/auth.py"].map((chip) => (
                      <span key={chip} className="rounded border border-line-strong px-2.5 py-1">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ========================================================= how it works */}
      <Section id="how">
        <Reveal>
          <h2 className="display-lg max-w-[24ch]">
            Certainty is hard-coded. Judgement is the agent&apos;s.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[17px] leading-[1.65] text-fg-muted">
            Fetching the run, the failing step, the log and the diff is unconditional — a model
            choosing whether to do that would only add latency, cost and a new way to fail. The
            agentic part starts exactly where the certainty ends: deciding whether the log is
            enough, or whether it has to go and open the source.
          </p>
        </Reveal>
        <div className="mt-14">
          <HowItWorks />
        </div>
      </Section>

      {/* =========================================================== why agent */}
      <Section id="why">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Reveal>
            <h2 className="display-lg max-w-[18ch]">
              Why an agent, and not a script.
            </h2>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.65] text-fg-muted">
              Because the evidence needed differs per failure. A script has to pick one strategy
              and be wrong for most of them. Deciding <em className="italic text-fg">how much</em>{" "}
              to read is the actual problem.
            </p>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.65] text-fg-subtle">
              This is also why a low tool-call count is not a worse answer. On a dependency
              conflict the resolver already printed the cause, and a correct run reads nothing at
              all.
            </p>
          </Reveal>

          <Reveal delay={100}>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] border-b border-line px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.09em] text-fg-subtle">
                <span>Failure</span>
                <span>What is sufficient</span>
              </div>
              {SUFFICIENCY.map(([failure, sufficient]) => (
                <div
                  key={failure}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-4 border-b border-line px-5 py-3.5 last:border-0"
                >
                  <span className="text-[14px] leading-snug text-fg">{failure}</span>
                  <span className="text-[13.5px] leading-snug text-fg-muted">{sufficient}</span>
                </div>
              ))}
            </div>

            <div className="mt-3.5 overflow-hidden rounded-lg border border-line bg-surface">
              <p className="border-b border-line px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.09em] text-fg-subtle">
                five read-only tools
              </p>
              <ul className="divide-y divide-line">
                {TOOLS.map(([name, use]) => (
                  <li key={name} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
                    <code className="font-mono text-[13px] text-fg">{name}</code>
                    <span className="text-[13px] text-fg-muted">{use}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ============================================================== verify */}
      <Section id="verify">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Reveal>
            <h2 className="display-lg max-w-[20ch]">One repository URL in. A cause you can check.</h2>
            <p className="mt-4 max-w-[48ch] text-[17px] leading-[1.65] text-fg-muted">
              Every diagnosis carries two to five lines quoted verbatim from the log and the source
              at the failing commit. Read them in order and the argument is complete without the
              prose — which is the only standard at which an automated answer is worth reading.
            </p>
            <p className="mt-4 max-w-[48ch] text-[15px] leading-[1.65] text-fg-subtle">
              Confidence is a claim about sourcing, not a mood. Eight and above means nothing was
              inferred; below five the agent tells you it is reasoning past its evidence instead of
              sounding certain.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/investigate#replay" variant="primary">
                Watch a recorded investigation
              </ButtonLink>
              <Link
                href="/docs/guides/reading-an-investigation"
                className="inline-flex items-center text-[15px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              >
                How to read a result →
              </Link>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-panel">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 font-mono text-[11.5px] text-fg-subtle">
                <span>evidence</span>
                <span className="text-fg">confidence 9 / 10</span>
              </div>
              <ul className="flex flex-col gap-2 px-5 py-5">
                {[
                  ["log:2907", "E   AttributeError: 'dict' object has no attribute 'expires_at'"],
                  ["log:2908", "tests/unit/test_auth.py:47: AttributeError"],
                  ["auth.py:18", "return {'value': fresh.value, 'expires_at': fresh.expires_at}"],
                  ["log:3996", "1 failed, 402 passed in 12.41s"],
                ].map(([source, quote]) => (
                  <li key={source} className="rounded border-l-2 border-line-strong bg-canvas py-2 pl-3 pr-3">
                    <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">
                      {source}
                    </span>
                    <span className="block overflow-x-auto font-mono text-[12px] leading-relaxed text-fg-muted">
                      {quote}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line bg-elevated px-5 py-3 text-[12.5px] text-fg-subtle">
                Not applied, not run, not tested — TraceCI is read-only.{" "}
                <Link href="/docs/limitations" className="text-fg underline-offset-2 hover:underline">
                  Why that is deliberate →
                </Link>
              </p>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* =============================================================== setup */}
      <Section id="setup">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Reveal>
            <h2 className="display-lg max-w-[16ch]">Three commands, no card.</h2>
            <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.65] text-fg-muted">
              TraceCI runs on your key, and the default model is Groq&apos;s free{" "}
              <code className="font-mono text-[15px] text-fg">llama-3.3-70b-versatile</code>. Public
              repositories need nothing else.
            </p>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.65] text-fg-subtle">
              Your key is sent with one request, is never written to graph state or the checkpoint
              database, and is not returned by a shared investigation link.
            </p>
            <div className="mt-7">
              <Link
                href="/docs/quickstart"
                className="inline-flex items-center text-[15px] text-fg-muted underline-offset-4 hover:text-fg hover:underline"
              >
                Full setup in the quickstart →
              </Link>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <p className="border-b border-line px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.09em] text-fg-subtle">
                local setup
              </p>
              <pre className="overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[2] text-fg-muted">
                <span className="text-fg-subtle">{"# backend\n"}</span>
                {"pip install -r requirements-dev.txt\n"}
                {"uvicorn traceci.api:app --reload\n\n"}
                <span className="text-fg-subtle">{"# frontend\n"}</span>
                {"npm run dev"}
              </pre>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* ================================================================= cta */}
      <section className="mx-auto mt-8 max-w-shell px-6 lg:px-8">
        <Reveal>
          <div className="rounded-xl border border-line bg-surface px-8 py-14 text-center shadow-panel sm:px-14 sm:py-20">
            <h2 className="display-lg mx-auto max-w-[22ch]">
              Read the log once. Let the next one be the agent&apos;s turn.
            </h2>
            <p className="mx-auto mt-4 max-w-[52ch] text-[16px] leading-[1.6] text-fg-muted">
              Read-only tools, a six-call budget, and a diagnosis you can verify line by line.
            </p>
            <div className="mt-8 flex justify-center">
              <ButtonLink href="/investigate" variant="primary" size="lg">
                Start an investigation
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-shell px-6 pt-24 sm:pt-28 lg:px-8">
      {children}
    </section>
  );
}

