"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Scroll-driven walkthrough of the graph.
 *
 * Four steps on the left; a panel on the right that changes to show what the
 * agent is actually holding at that point. The rail on the left fills as you
 * go, which is the only thing on the page that tells you how much of the
 * process is left -- a progress bar for reading rather than for loading.
 *
 * Every number in the panels comes from the recorded run.
 */

type StepDef = {
  node: string;
  kicker: string;
  body: string;
};

const STEPS: StepDef[] = [
  {
    node: "fetch_failure",
    kicker: "no model",
    body: "Finds the red run, the first failing job and step, pulls the log archive, resolves the last green commit and diffs against it.",
  },
  {
    node: "log_window",
    kicker: "windowing",
    body: "Strips ANSI codes and timestamps, anchors on the first real error rather than on noise, and always keeps the tail so the summary line survives.",
  },
  {
    node: "investigate ⇄ tools",
    kicker: "≤ 6 calls",
    body: "The model decides what evidence it still needs and goes and reads it — five read-only tools, every one pinned to the commit that failed.",
  },
  {
    node: "diagnose",
    kicker: "typed output",
    body: "A separate node emitting a validated result. Asking one call to both investigate and format degrades both, so they are split.",
  },
];

type Row = { k: string; v: string };

const PANELS: { rubric: string; rows?: Row[]; log?: string[]; chips?: string[] }[] = [
  {
    rubric: "deterministic pre-fetch",
    rows: [
      { k: "run", v: "15938201234 · red" },
      { k: "job", v: "tests (3.11)" },
      { k: "failing step", v: "6 · Run tests" },
      { k: "raw log", v: "4,112 lines" },
      { k: "last green", v: "9e11c4a → 4f8b2d1" },
      { k: "diff", v: "2 files · 98 lines" },
    ],
  },
  {
    rubric: "log window",
    log: [
      "tests/unit/test_auth.py:47: in test_session_refresh",
      "E   AttributeError: 'dict' object has no",
      "    attribute 'expires_at'",
      "  ... 1,088 lines stripped ...",
      "=== 1 failed, 402 passed in 12.41s ===",
    ],
    rows: [
      { k: "in", v: "4,112 lines" },
      { k: "out", v: "118 lines" },
      { k: "anchor", v: "tier 1 · traceback" },
    ],
  },
  {
    rubric: "investigate ⇄ tools",
    chips: ["read_file app/auth.py"],
    rows: [
      { k: "hypothesis", v: "refresh() return type" },
      { k: "tool calls", v: "1 of 6 used" },
      { k: "decision", v: "open the source" },
    ],
  },
  {
    rubric: "typed output",
    rows: [
      { k: "category", v: "test_failure" },
      { k: "root cause", v: "refresh() → dict" },
      { k: "evidence", v: "4 quoted lines" },
      { k: "confidence", v: "9 / 10" },
      { k: "elapsed", v: "14.8s · 1 tool call" },
    ],
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const nodes = cardRefs.current.filter(Boolean) as HTMLDivElement[];
    if (!nodes.length) return;

    // Whichever card is closest to the upper third of the viewport wins. An
    // ordinary "is intersecting" test flickers between two cards when both
    // are on screen, which is most of the time on a tall display.
    const pick = () => {
      const target = window.innerHeight * 0.38;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      nodes.forEach((node, i) => {
        const distance = Math.abs(node.getBoundingClientRect().top - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      setActive(best);
    };

    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, []);

  const panel = PANELS[active];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-14">
      {/* ------------------------------------------------------------ steps */}
      <div className="relative pl-8">
        <div aria-hidden className="absolute bottom-0 left-0 top-0 w-px bg-line" />
        <div
          aria-hidden
          className="absolute left-0 top-0 w-px bg-fg transition-[height] duration-[620ms] ease-rail"
          style={{ height: `${((active + 1) / STEPS.length) * 100}%` }}
        />

        <ol className="flex flex-col gap-5">
          {STEPS.map((step, i) => (
            <li key={step.node}>
              <div
                ref={(el) => {
                  cardRefs.current[i] = el;
                }}
                className={cn(
                  "rounded-lg border bg-surface px-6 py-6 transition-all duration-500",
                  active === i
                    ? "border-line-strong shadow-sticky"
                    : "border-line opacity-60 shadow-none"
                )}
              >
                <div className="mb-3 flex items-baseline gap-3 font-mono text-[11.5px] uppercase tracking-[0.08em]">
                  <span
                    className={cn(
                      "transition-colors duration-300",
                      active === i ? "text-fg" : "text-fg-subtle"
                    )}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-fg-subtle">{step.kicker}</span>
                </div>
                <p className="font-mono text-[19px] font-semibold tracking-[-0.01em] text-fg">
                  {step.node}
                </p>
                <p className="mt-2 max-w-[44ch] text-[15px] leading-[1.62] text-fg-muted">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ------------------------------------------------------------ panel */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-sticky">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 font-mono text-[11.5px] text-fg-subtle">
            <span>traceci · graph</span>
            <span className="text-fg">
              {String(active + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
            </span>
          </div>

          <div key={active} className="animate-fade px-6 py-6 lg:min-h-[360px]">
            <p className="rubric mb-5">{panel.rubric}</p>

            {panel.log ? (
              <pre className="mb-5 overflow-x-auto rounded-md border border-line bg-canvas px-4 py-3 font-mono text-[11.5px] leading-[1.75]">
                {panel.log.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      l.startsWith("E ") && "text-danger",
                      l.startsWith("  ...") && "text-fg-subtle",
                      l.startsWith("===") && "text-fg",
                      !l.startsWith("E ") && !l.startsWith("  ...") && !l.startsWith("===")
                        ? "text-fg-muted"
                        : undefined
                    )}
                  >
                    {l}
                  </div>
                ))}
              </pre>
            ) : null}

            {panel.chips ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {panel.chips.map((chip) => (
                  <span
                    key={chip}
                    className="rounded border border-line-strong bg-elevated px-2.5 py-1 font-mono text-[11.5px] text-fg"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}

            <dl>
              {panel.rows?.map((row) => (
                <div
                  key={row.k}
                  className="flex items-baseline justify-between gap-5 border-b border-line py-3 last:border-0"
                >
                  <dt className="text-[14px] text-fg-muted">{row.k}</dt>
                  <dd className="text-right font-mono text-[13px] text-fg">{row.v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
