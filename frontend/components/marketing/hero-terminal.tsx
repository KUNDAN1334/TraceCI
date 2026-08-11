"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The hero panel: four thousand lines of log going in, four lines of cause
 * coming out.
 *
 * It is an animation of a real run, not a video and not a fabrication -- the
 * log excerpt, the tool call, the patch and the graph transitions are the same
 * ones `public/demo-stream.json` contains. Motion is doing an argument here
 * rather than decorating one: the left column has to feel like a wall of text
 * arriving faster than you can read it, so that the right column landing all
 * at once reads as relief.
 */

type LogLine = { text: string; tone?: "error" | "muted" | "strong" };

const LOG: LogLine[] = [
  { text: "  ... 2,904 lines ...", tone: "muted" },
  { text: "tests/unit/test_auth.py:47: in test_session_refresh" },
  { text: "E   AttributeError: 'dict' object has no", tone: "error" },
  { text: "    attribute 'expires_at'", tone: "error" },
  { text: "  ... 1,088 lines ...", tone: "muted" },
  { text: "=== 1 failed, 402 passed in 12.41s ===", tone: "strong" },
  { text: "##[error]Process completed, exit code 1.", tone: "error" },
];

const CHIPS = ["log window", "diff vs. last green", "read_file app/auth.py"];

const NODES = ["fetch_failure", "investigate", "tools", "diagnose"];

// step 0-6 log lines · 7 thinking · 8 answer · 9-11 chips
const LAST_STEP = 11;
const TIMINGS: number[] = [
  260, 240, 240, 240, 240, 260, 300, // log lines
  900, // thinking
  520, // answer lands
  200, 200, 200, // chips
];

export function HeroTerminal() {
  const [step, setStep] = useState(-1);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(LAST_STEP);
      return;
    }
    let current = -1;
    const advance = () => {
      current += 1;
      setStep(current);
      if (current >= LAST_STEP) return;
      timer.current = window.setTimeout(advance, TIMINGS[current + 1] ?? 240);
    };
    timer.current = window.setTimeout(advance, 260);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  const streaming = step >= 0 && step < 7;
  const thinking = step >= 6 && step < 8;
  const answered = step >= 8;

  // Which graph node is lit. Mirrors the real graph:
  // fetch_failure -> investigate <-> tools -> diagnose
  const activeNode = !answered ? (step < 5 ? 0 : step < 7 ? 1 : 2) : 3;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-hero">
      {/* window chrome */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3 font-mono text-[11.5px] text-fg-subtle">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-[9px] w-[9px] rounded-full bg-line-strong" />
          <span className="h-[9px] w-[9px] rounded-full bg-line-strong" />
          <span className="h-[9px] w-[9px] rounded-full bg-line-strong" />
        </span>
        <span className="ml-1.5 truncate">kundan/traceme-lab · run 15938201234</span>
        <span className="ml-auto flex items-center gap-2 text-fg">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              answered ? "bg-ok" : "animate-pulse bg-fg"
            )}
          />
          {answered ? "done" : "live"}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2">
        {/* ---------------------------------------------------------- in */}
        <div className="border-b border-line bg-canvas px-5 py-6 sm:border-b-0 sm:border-r">
          <p className="rubric mb-4">In — 4,112 lines</p>
          <div className="min-h-[168px] font-mono text-[11.5px] leading-[1.85]">
            {/* Sliced rather than hidden: a line that is rendered but
                invisible has already run its entry animation by the time it
                is shown, so the stream arrives all at once. */}
            {LOG.slice(0, Math.max(0, step + 1)).map((line, i) => (
              <div
                key={i}
                className={cn(
                  "animate-line whitespace-pre",
                  line.tone === "error" && "text-danger",
                  line.tone === "muted" && "text-fg-subtle",
                  line.tone === "strong" && "text-fg",
                  !line.tone && "text-fg-muted"
                )}
              >
                {line.text}
              </div>
            ))}
            {streaming || thinking ? (
              <span
                aria-hidden
                className="mt-1 inline-block h-3 w-[7px] animate-blink bg-fg align-[-1px]"
              />
            ) : null}
          </div>
        </div>

        {/* --------------------------------------------------------- out */}
        <div className="px-5 py-6">
          <p className="rubric mb-4">Out — root cause</p>

          {!answered ? (
            <div className="flex min-h-[168px] items-start gap-2.5 font-mono text-[11.5px] text-fg-subtle">
              <span
                aria-hidden
                className="mt-[3px] inline-block h-3 w-[7px] animate-blink bg-fg-subtle"
              />
              {thinking ? "reading app/auth.py…" : "waiting for the failing step…"}
            </div>
          ) : (
            <div className="min-h-[168px] animate-rise">
              <p className="mb-4 text-[16px] leading-[1.55] text-fg">
                <code className="font-mono text-[15px]">refresh()</code> in{" "}
                <code className="font-mono text-[15px]">app/auth.py</code> returns a plain{" "}
                <code className="font-mono text-[15px]">dict</code> where the annotation still
                promises a <code className="font-mono text-[15px]">Token</code> — a three-line hunk
                inside a commit about an unrelated rate limiter.
              </p>

              <pre className="mb-4 overflow-x-auto rounded-md border border-line bg-canvas px-4 py-3 font-mono text-[11.5px] leading-[1.75]">
                <span className="text-danger">
                  {"-    return {\"value\": fresh.value, \"expires_at\": fresh.expires_at}"}
                </span>
                {"\n"}
                <span className="text-ok">{"+    return issue_token(token.user, now)"}</span>
              </pre>

              <div className="flex flex-wrap gap-2 font-mono text-[11px] text-fg-subtle">
                {CHIPS.map((chip, i) => (
                  <span
                    key={chip}
                    className={cn(
                      "rounded border border-line px-2.5 py-1 transition-opacity duration-300",
                      step >= 9 + i ? "opacity-100" : "opacity-0"
                    )}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- graph bar */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line bg-elevated px-4 py-3 font-mono text-[11.5px] text-fg-subtle">
        {NODES.map((node, i) => (
          <span key={node} className="flex items-center gap-2">
            <span
              className={cn(
                "transition-colors duration-300",
                activeNode === i && "text-fg",
                activeNode > i && "text-fg-muted"
              )}
            >
              {node}
            </span>
            {i < NODES.length - 1 ? (
              <span aria-hidden className="text-fg-subtle/60">
                {i === 1 ? "⇄" : "→"}
              </span>
            ) : null}
          </span>
        ))}
        <span className="ml-auto hidden sm:inline">
          LangGraph · SQLite checkpointer · ≤6 tool calls
        </span>
      </div>
    </div>
  );
}
