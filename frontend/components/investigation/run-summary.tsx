"use client";

import { Badge, type Tone } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import {
  STATUS_COPY,
  formatDuration,
  type InvestigationState,
  type RunStatus,
} from "@/lib/investigation";

export function StatusBadge({ status, live }: { status: RunStatus; live?: boolean }) {
  const copy = STATUS_COPY[status];
  return (
    <Badge tone={copy.tone as Tone} dot pulse={live}>
      {copy.label}
    </Badge>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs uppercase tracking-[0.09em] text-fg-subtle">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[13px] tabular-nums text-fg">{value}</p>
    </div>
  );
}

/**
 * The bar that answers "what am I looking at and is it still running" without
 * scrolling. It is the one element that is present in every run state.
 */
export function RunSummary({
  state,
  elapsed,
  toolCalls,
  running,
  actions,
}: {
  state: InvestigationState;
  elapsed: number;
  toolCalls: number;
  running: boolean;
  actions?: React.ReactNode;
}) {
  const repo = state.context.repo || state.target.repo || "—";
  const branch = state.target.branch;

  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[13px] font-normal text-fg">{repo}</span>
            {branch ? (
              <span className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                {branch}
              </span>
            ) : null}
            <StatusBadge status={state.status} live={running} />
            {state.mode === "replay" ? <Badge tone="violet">Recorded run</Badge> : null}
          </span>
        }
        meta={
          state.context.workflow
            ? `Workflow ${state.context.workflow}${state.context.runId ? ` · run ${state.context.runId}` : ""}`
            : "Waiting for the run context"
        }
        actions={actions}
      />
      <PanelBody className="grid grid-cols-2 gap-4 py-3 sm:grid-cols-4">
        <Stat label="Failing step" value={state.context.failedStep || "—"} />
        <Stat label="Tool calls" value={`${toolCalls} / 6`} />
        <Stat label="Elapsed" value={elapsed ? formatDuration(elapsed) : "—"} />
        <Stat
          label="Model"
          value={state.mode === "replay" ? "recorded" : state.target.model || "—"}
        />
      </PanelBody>
    </Panel>
  );
}
