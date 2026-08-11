"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DiagnosisPanel } from "@/components/investigation/diagnosis";
import { StatusBadge } from "@/components/investigation/run-summary";
import { Button, ButtonLink } from "@/components/ui/button";
import { CodeBlock, CopyButton } from "@/components/ui/code";
import { Callout, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { DataRow, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { explainNetworkError, fetchAnalysis } from "@/lib/api";
import { deleteRecord, getRecord, type HistoryRecord } from "@/lib/history";
import { STEP_GLYPH, formatDuration } from "@/lib/investigation";
import type { StoredAnalysis } from "@/lib/types";

type ServerState =
  | { kind: "skipped" }
  | { kind: "loading" }
  | { kind: "ready"; data: StoredAnalysis }
  | { kind: "missing" }
  | { kind: "error"; message: string };

/**
 * Two sources, deliberately: the local record is what this browser watched,
 * the server record is what the checkpointer kept. The local one renders
 * instantly and works offline; the server one adds the raw log window and diff
 * summary. When the server has nothing (a replay, a failed run, a different
 * machine) that is stated rather than hidden.
 */
export default function InvestigationDetailPage({ params }: { params: { threadId: string } }) {
  const id = decodeURIComponent(params.threadId);
  const [local, setLocal] = useState<HistoryRecord | null>(null);
  const [localLoaded, setLocalLoaded] = useState(false);
  const [server, setServer] = useState<ServerState>({ kind: "loading" });

  useEffect(() => {
    setLocal(getRecord(id));
    setLocalLoaded(true);
  }, [id]);

  useEffect(() => {
    // Locally-generated ids never existed on the server; asking for them would
    // guarantee a 404 and a misleading error.
    if (id.startsWith("local-")) {
      setServer({ kind: "skipped" });
      return;
    }
    const ac = new AbortController();
    setServer({ kind: "loading" });
    fetchAnalysis(id, ac.signal)
      .then((data) => setServer({ kind: "ready", data }))
      .catch((err) => {
        if (ac.signal.aborted) return;
        const status = (err as { status?: number }).status;
        setServer(
          status === 404
            ? { kind: "missing" }
            : { kind: "error", message: explainNetworkError(err) }
        );
      });
    return () => ac.abort();
  }, [id]);

  const serverData = server.kind === "ready" ? server.data : null;
  const diagnosis = serverData?.diagnosis ?? local?.diagnosis ?? null;
  const repo = serverData?.repo ?? local?.repo ?? id;

  if (localLoaded && !local && (server.kind === "missing" || server.kind === "skipped")) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <EmptyState
          title="No investigation with that id"
          description={
            <>
              Nothing is stored under <span className="font-mono text-fg-muted">{id}</span> in this
              browser, and the server has no checkpoint for it either. Ids expire when the backend
              database is reset.
            </>
          }
          action={
            <>
              <ButtonLink href="/investigations" size="sm">
                Back to investigations
              </ButtonLink>
              <ButtonLink href="/investigate" variant="primary" size="sm">
                Start a new one
              </ButtonLink>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-5 text-[13px] text-fg-subtle">
        <Link href="/investigations" className="hover:text-fg">
          Investigations
        </Link>
        <span className="px-1.5">/</span>
        <span className="font-mono text-fg-muted">{id}</span>
      </nav>

      <PageHeader
        title={<span className="font-mono text-xl sm:text-2xl">{repo}</span>}
        description={
          local?.failedStep || serverData?.failed_step
            ? `Failed at ${local?.failedStep ?? serverData?.failed_step}`
            : "Investigation record"
        }
        actions={
          <>
            <CopyButton value={id} label="Copy id" size="md" />
            {local ? (
              <Button
                variant="ghost"
                onClick={() => {
                  deleteRecord(id);
                  setLocal(null);
                }}
              >
                Remove from history
              </Button>
            ) : null}
            <ButtonLink href="/investigate" variant="primary">
              New investigation
            </ButtonLink>
          </>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          {diagnosis ? (
            <DiagnosisPanel diagnosis={diagnosis} />
          ) : local?.status === "failed" ? (
            <ErrorState
              title="This investigation failed"
              message={local.error || "The run ended with an error before reaching a conclusion."}
            />
          ) : local?.status === "stopped" ? (
            <Callout tone="warn" title="Stopped before a conclusion">
              This run was stopped by hand. The steps it completed are below.
            </Callout>
          ) : server.kind === "loading" ? (
            <Panel>
              <PanelBody className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </PanelBody>
            </Panel>
          ) : (
            <Callout tone="warn" title="No diagnosis on this record">
              The run finished without producing a structured result.
            </Callout>
          )}

          {local?.steps?.length ? (
            <Panel>
              <PanelHeader
                title="Trace"
                meta={`${local.steps.length} steps · ${local.toolCalls} chosen by the agent`}
              />
              <PanelBody>
                <ol className="space-y-1.5">
                  {local.steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded border border-line bg-elevated text-[11px] text-fg-subtle"
                      >
                        {STEP_GLYPH[step.icon] ?? "•"}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] leading-snug text-fg">{step.label}</span>
                        {step.detail ? (
                          <span className="mt-0.5 block font-mono text-[11.5px] leading-snug text-fg-subtle">
                            {step.detail}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
              </PanelBody>
            </Panel>
          ) : null}

          {serverData?.log_tail ? (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold tracking-tight text-fg marker:content-none">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="text-fg-subtle transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  Log window the agent was given
                </span>
              </summary>
              <div className="border-t border-line p-4">
                <CodeBlock copyValue={serverData.log_tail} maxHeight="26rem">
                  {serverData.log_tail}
                </CodeBlock>
              </div>
            </details>
          ) : null}

          {serverData?.diff_summary ? (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold tracking-tight text-fg marker:content-none">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="text-fg-subtle transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  Diff since the last green commit
                </span>
              </summary>
              <div className="border-t border-line p-4">
                <CodeBlock copyValue={serverData.diff_summary} maxHeight="26rem">
                  {serverData.diff_summary}
                </CodeBlock>
              </div>
            </details>
          ) : null}
        </div>

        <aside className="space-y-4">
          <Panel>
            <PanelHeader title="Record" />
            <PanelBody className="py-1">
              <dl>
                <DataRow
                  label="Status"
                  value={
                    local ? (
                      <StatusBadge
                        status={
                          local.status === "failed"
                            ? "failed"
                            : local.status === "stopped"
                              ? "stopped"
                              : "complete"
                        }
                      />
                    ) : diagnosis ? (
                      <StatusBadge status="complete" />
                    ) : (
                      "—"
                    )
                  }
                />
                <DataRow label="Thread" value={id} mono />
                {serverData?.workflow_name || local?.workflow ? (
                  <DataRow label="Workflow" value={serverData?.workflow_name ?? local?.workflow} />
                ) : null}
                {serverData?.run_id || local?.runId ? (
                  <DataRow label="Run" value={String(serverData?.run_id ?? local?.runId)} mono />
                ) : null}
                {local?.branch ? <DataRow label="Branch" value={local.branch} mono /> : null}
                {local?.model ? <DataRow label="Model" value={local.model} mono /> : null}
                <DataRow
                  label="Tool calls"
                  value={String(serverData?.tool_calls ?? local?.toolCalls ?? 0)}
                  mono
                />
                {local ? (
                  <DataRow label="Duration" value={formatDuration(local.durationMs)} mono />
                ) : null}
                {local ? (
                  <DataRow
                    label="Finished"
                    value={new Date(local.finishedAt).toLocaleString()}
                  />
                ) : null}
              </dl>
            </PanelBody>
          </Panel>

          <SourceNote server={server} hasLocal={Boolean(local)} mode={local?.mode} />
        </aside>
      </div>
    </div>
  );
}

function SourceNote({
  server,
  hasLocal,
  mode,
}: {
  server: ServerState;
  hasLocal: boolean;
  mode?: HistoryRecord["mode"];
}) {
  if (mode === "replay") {
    return (
      <Callout tone="violet" title="Recorded run">
        Replays are never sent to the server, so this record is rendered entirely from what your
        browser captured.
      </Callout>
    );
  }
  if (server.kind === "ready") {
    return (
      <Callout tone="ok" title="Server record loaded">
        The log window and diff below are the exact inputs the agent was given, read back from the
        checkpoint.
      </Callout>
    );
  }
  if (server.kind === "loading") {
    return <Skeleton className="h-24 w-full" />;
  }
  if (server.kind === "missing") {
    return (
      <Callout tone="warn" title="Not on the server">
        The backend has no checkpoint for this id. It was either never completed or the checkpoint
        database has been reset since.{hasLocal ? " Your local copy is shown instead." : ""}
      </Callout>
    );
  }
  if (server.kind === "error") {
    return (
      <Callout tone="warn" title="Server record unavailable">
        {server.message}
        {hasLocal ? " Showing the copy stored in this browser." : ""}
      </Callout>
    );
  }
  return (
    <Callout tone="neutral" title="Local record">
      This run never reached a server checkpoint, so only what your browser captured is available.
    </Callout>
  );
}
