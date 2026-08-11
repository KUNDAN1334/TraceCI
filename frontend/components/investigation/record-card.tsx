"use client";

import Link from "next/link";
import { Badge, CategoryBadge, type Tone } from "@/components/ui/badge";
import { formatDuration } from "@/lib/investigation";
import type { HistoryRecord } from "@/lib/history";

const STATUS_TONE: Record<HistoryRecord["status"], Tone> = {
  complete: "ok",
  failed: "danger",
  stopped: "warn",
  incomplete: "warn",
};

const STATUS_LABEL: Record<HistoryRecord["status"], string> = {
  complete: "Diagnosed",
  failed: "Failed",
  stopped: "Stopped",
  incomplete: "No diagnosis",
};

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(ts).toLocaleDateString();
}

export function RecordCard({ record }: { record: HistoryRecord }) {
  return (
    <li>
      <Link
        href={`/investigations/${encodeURIComponent(record.id)}`}
        className="block rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-elevated"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-[13px] text-fg">{record.repo}</span>
          {record.branch ? (
            <span className="rounded border border-line bg-elevated px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
              {record.branch}
            </span>
          ) : null}
          {/* A completed run that named no cause is not a diagnosis, and the
              list must not imply it was one. */}
          {record.status === "complete" && record.category === "inconclusive" ? (
            <Badge tone="neutral" dot>
              No cause found
            </Badge>
          ) : (
            <>
              <Badge tone={STATUS_TONE[record.status]} dot>
                {STATUS_LABEL[record.status]}
              </Badge>
              {record.category ? <CategoryBadge category={record.category} /> : null}
            </>
          )}
          {record.mode === "replay" ? <Badge tone="violet">Recorded</Badge> : null}
          <span className="ml-auto shrink-0 text-2xs text-fg-subtle">
            {relativeTime(record.finishedAt)}
          </span>
        </div>

        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-fg-muted">
          {record.rootCause || record.error || "No conclusion was reached in this run."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-subtle">
          {record.failedStep ? <span>failed at {record.failedStep}</span> : null}
          <span>{record.toolCalls} tool calls</span>
          <span>{formatDuration(record.durationMs)}</span>
          {record.confidence != null ? <span>confidence {record.confidence}/10</span> : null}
        </div>
      </Link>
    </li>
  );
}
