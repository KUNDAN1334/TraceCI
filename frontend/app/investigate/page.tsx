"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DiagnosisPanel, DiagnosisPending } from "@/components/investigation/diagnosis";
import { LaunchForm } from "@/components/investigation/launch-form";
import { RunSummary } from "@/components/investigation/run-summary";
import { ReasoningStream, TraceTimeline } from "@/components/investigation/trace";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout, ErrorState } from "@/components/ui/feedback";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { CopyButton } from "@/components/ui/code";
import { recordFromState, saveRecord } from "@/lib/history";
import { PHASES, type InvestigationState } from "@/lib/investigation";
import { useInvestigation, type StartArgs } from "@/lib/use-investigation";

export default function InvestigatePage() {
  const onFinished = useCallback((state: InvestigationState) => {
    const record = recordFromState(state);
    if (record) saveRecord(record);
  }, []);

  const { state, running, settled, elapsed, toolCalls, startLive, startReplay, stop, reset } =
    useInvestigation(onFinished);
  const [showForm, setShowForm] = useState(true);

  // The overview links here with #replay so the recorded run has exactly one
  // entry point from the marketing page and no query-string plumbing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#replay") return;
    history.replaceState(null, "", window.location.pathname);
    setShowForm(false);
    void startReplay();
  }, [startReplay]);

  const begin = (args: StartArgs) => {
    setShowForm(false);
    void startLive(args);
  };

  const beginReplay = () => {
    setShowForm(false);
    void startReplay();
  };

  const startOver = () => {
    reset();
    setShowForm(true);
  };

  const idle = state.status === "idle";

  return (
    <div className="mx-auto max-w-shell px-4 py-8 sm:px-6">
      {idle || showForm ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {!idle ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-elevated px-3 py-2">
                <p className="text-[13px] text-fg-muted">Editing the target of a finished run.</p>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                  Back to results
                </Button>
              </div>
            ) : null}
            <LaunchForm onStart={begin} onReplay={beginReplay} busy={running} />
          </div>
          <WhatHappensNext />
        </div>
      ) : (
        <div className="space-y-6">
          <RunSummary
            state={state}
            elapsed={elapsed}
            toolCalls={toolCalls}
            running={running}
            actions={
              <>
                {running ? (
                  <Button size="sm" variant="danger" onClick={stop}>
                    Stop
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
                    Edit target
                  </Button>
                )}
                {settled ? (
                  <Button size="sm" onClick={startOver}>
                    New investigation
                  </Button>
                ) : null}
              </>
            }
          />

          <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
            <Panel className="lg:sticky lg:top-20 lg:self-start">
              <PanelHeader
                title="Investigation trace"
                meta="Each row is a decision the agent made, not a progress bar."
              />
              <PanelBody className="space-y-5">
                <TraceTimeline state={state} />
                <ReasoningStream text={state.reasoning} live={running} />
              </PanelBody>
            </Panel>

            <div className="space-y-4">
              <Findings state={state} running={running} onRetry={() => setShowForm(true)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Findings({
  state,
  running,
  onRetry,
}: {
  state: InvestigationState;
  running: boolean;
  onRetry: () => void;
}) {
  if (state.status === "failed") {
    return (
      <ErrorState
        title="The investigation failed"
        message={
          <>
            <p>{state.error}</p>
            <p className="mt-2 text-fg-subtle">
              Partial progress is preserved in the trace. Common causes are covered in{" "}
              <Link href="/docs/troubleshooting" className="text-accent hover:underline">
                troubleshooting
              </Link>
              .
            </p>
          </>
        }
        action={
          <Button size="sm" onClick={onRetry}>
            Adjust and retry
          </Button>
        }
      />
    );
  }

  if (state.status === "stopped") {
    return (
      <Callout tone="warn" title="Stopped before a conclusion">
        You stopped this investigation. The steps completed so far are still in the trace, but no
        root cause was produced and nothing was saved to the server.
      </Callout>
    );
  }

  if (state.diagnosis) {
    return (
      <>
        <DiagnosisPanel diagnosis={state.diagnosis} />
        {state.threadId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-elevated px-3 py-2">
            <p className="min-w-0 text-[12.5px] text-fg-subtle">
              Saved as thread <span className="font-mono text-fg-muted">{state.threadId}</span>
            </p>
            <div className="flex items-center gap-1">
              <CopyButton value={state.threadId} label="Copy id" />
              <ButtonLink size="sm" href={`/investigations/${state.threadId}`}>
                Open full record
              </ButtonLink>
            </div>
          </div>
        ) : state.mode === "replay" ? (
          <Callout tone="violet" title="This was a recorded run">
            Replays are not stored on the server, so there is no thread to reopen. They are listed
            under your investigations and rendered from what this browser captured.
          </Callout>
        ) : null}
      </>
    );
  }

  if (state.incomplete && !running) {
    return (
      <Callout tone="warn" title="The run ended without a diagnosis">
        The stream finished but no structured result arrived. This usually means the model produced
        output the schema could not accept. Re-running, or switching to a model with stronger tool
        support, normally resolves it.
      </Callout>
    );
  }

  return <DiagnosisPending />;
}

function WhatHappensNext() {
  return (
    <Panel className="h-fit">
      <PanelHeader title="What happens when you run this" />
      <PanelBody className="space-y-4">
        <ol className="space-y-3">
          {PHASES.map((phase, i) => (
            <li key={phase.id} className="flex gap-3">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-line-strong text-2xs tabular-nums text-fg-subtle">
                {i + 1}
              </span>
              <div>
                <p className="text-[13px] font-medium text-fg">{phase.title}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-fg-subtle">
                  {phase.summary}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="border-t border-line pt-4 text-[12.5px] leading-relaxed text-fg-subtle">
          TraceCI reads. It never writes to your repository, comments on a pull request, or
          re-runs a job. A wrong diagnosis costs you a paragraph of text.
        </p>
        <EmptyStateHint />
      </PanelBody>
    </Panel>
  );
}

function EmptyStateHint() {
  return (
    <Link
      href="/docs/quickstart"
      className="block rounded-md border border-line bg-elevated px-3 py-2.5 text-[12.5px] text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
    >
      First time here? The quickstart walks through one investigation end to end. →
    </Link>
  );
}
