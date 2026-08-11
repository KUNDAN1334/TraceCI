"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import {
  PHASES,
  STEP_GLYPH,
  formatDuration,
  stepsForPhase,
  type InvestigationState,
  type PhaseStatus,
  type TraceStep,
} from "@/lib/investigation";
import { Spinner } from "@/components/ui/feedback";

const PHASE_TONE: Record<PhaseStatus, string> = {
  pending: "text-fg-subtle",
  active: "text-fg",
  done: "text-fg",
  failed: "text-danger",
  stopped: "text-warn",
};

function PhaseMarker({ status }: { status: PhaseStatus }) {
  const base =
    "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border bg-surface text-[11px]";
  if (status === "active") {
    return (
      <span className={cn(base, "border-accent text-accent")}>
        <Spinner className="h-3 w-3" />
      </span>
    );
  }
  if (status === "done") {
    return <span className={cn(base, "border-ok/50 bg-ok/10 text-ok")}>✓</span>;
  }
  if (status === "failed") {
    return <span className={cn(base, "border-danger/50 bg-danger/10 text-danger")}>!</span>;
  }
  if (status === "stopped") {
    return <span className={cn(base, "border-warn/50 bg-warn/10 text-warn")}>■</span>;
  }
  return <span className={cn(base, "border-line-strong/60 text-fg-subtle")}>·</span>;
}

function StepRow({ step, startedAt }: { step: TraceStep; startedAt: number }) {
  const chosen = step.detail === "the agent chose this";
  return (
    <li className="animate-rise flex items-start gap-2.5 py-1">
      <span
        aria-hidden
        className="mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded border border-line bg-elevated text-[11px] text-fg-subtle"
      >
        {STEP_GLYPH[step.icon] ?? "•"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug text-fg">{step.label}</span>
        {step.detail ? (
          <span
            className={cn(
              "mt-0.5 block font-mono text-[11.5px] leading-snug",
              chosen ? "text-accent/80" : "text-fg-subtle"
            )}
          >
            {chosen ? "chosen by the agent" : step.detail}
          </span>
        ) : null}
      </span>
      {startedAt ? (
        <span className="mt-[3px] shrink-0 font-mono text-2xs tabular-nums text-fg-subtle/70">
          {formatDuration(Math.max(0, step.at - startedAt))}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The trace answers "where is this right now" before it answers "what
 * happened". Phases come from the graph; the rows inside them are the agent's
 * own decisions, streamed from its tool calls.
 */
export function TraceTimeline({ state }: { state: InvestigationState }) {
  return (
    <ol className="relative trace-rail space-y-4 pl-0">
      {PHASES.map((phase) => {
        const status = state.phases[phase.id];
        const steps = stepsForPhase(state, phase.id);
        return (
          <li key={phase.id} className="relative flex gap-3">
            <PhaseMarker status={status} />
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <h3 className={cn("text-[13px] font-semibold tracking-tight", PHASE_TONE[status])}>
                  {phase.title}
                </h3>
                {status === "active" ? (
                  <span className="text-2xs text-accent">
                    {phase.id === "diagnose" ? "composing the diagnosis" : "in progress"}
                  </span>
                ) : null}
                {status === "stopped" ? (
                  <span className="text-2xs text-warn">did not finish</span>
                ) : null}
              </div>
              {status === "pending" ? (
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-subtle">
                  {phase.summary}
                </p>
              ) : null}
              {steps.length ? (
                <ul className="mt-1.5">
                  {steps.map((s) => (
                    <StepRow key={s.id} step={s} startedAt={state.startedAt} />
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The model's prose, streamed token by token.
 *
 * Scrolling is pinned to the bottom only while the reader is already at the
 * bottom -- yanking the viewport away from someone who scrolled up to read is
 * the classic streaming-UI bug.
 */
export function ReasoningStream({
  text,
  live,
}: {
  text: string;
  live: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  if (!text) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
          Agent reasoning
        </h3>
        {live ? <span className="text-2xs text-fg-subtle">streaming</span> : null}
      </div>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="scroll-shadow max-h-52 overflow-auto rounded-md border border-line bg-elevated p-3"
      >
        <p className="whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-fg-muted">
          {text}
          {live ? (
            <span aria-hidden className="ml-0.5 inline-block h-3 w-[7px] animate-blink bg-fg align-[-1px]" />
          ) : null}
        </p>
      </div>
    </div>
  );
}
