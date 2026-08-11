"use client";

import { useCallback, useEffect, useState } from "react";
import type { InvestigationState, TraceStep } from "./investigation";
import { elapsedMs, toolCallCount } from "./investigation";
import type { Diagnosis } from "./types";

/**
 * A browser-local index of investigations this browser has run.
 *
 * The backend checkpoints every run and `GET /analysis/{thread_id}` reads one
 * back, but there is deliberately no "list my runs" endpoint -- there are no
 * accounts, and a shared server listing every thread id would hand strangers
 * each other's repositories. So the index lives here, and the detail view
 * re-fetches the authoritative record from the server by id.
 *
 * Everything stored is something this browser already displayed. No keys.
 */

const STORE_KEY = "traceci.investigations";
const LIMIT = 25;
const CHANGED = "traceci:investigations-changed";

export type HistoryRecord = {
  id: string;
  threadId: string | null;
  mode: "live" | "replay";
  status: "complete" | "failed" | "stopped" | "incomplete";
  repo: string;
  branch: string;
  model: string;
  workflow?: string;
  failedStep?: string;
  runId?: string;
  category?: string;
  confidence?: number;
  rootCause?: string;
  error?: string;
  toolCalls: number;
  durationMs: number;
  finishedAt: number;
  diagnosis: Diagnosis | null;
  steps: TraceStep[];
};

function read(): HistoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryRecord[]) : [];
  } catch {
    return [];
  }
}

function write(records: HistoryRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(records.slice(0, LIMIT)));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* quota or privacy mode -- history is a convenience, never a requirement */
  }
}

export function recordFromState(state: InvestigationState): HistoryRecord | null {
  if (!state.startedAt) return null;
  const status: HistoryRecord["status"] =
    state.status === "failed"
      ? "failed"
      : state.status === "stopped"
        ? "stopped"
        : state.incomplete
          ? "incomplete"
          : "complete";

  return {
    id: state.threadId || `local-${state.startedAt.toString(36)}`,
    threadId: state.threadId || null,
    mode: state.mode,
    status,
    repo: state.context.repo || state.target.repo || "unknown",
    branch: state.target.branch,
    model: state.target.model,
    workflow: state.context.workflow,
    failedStep: state.context.failedStep,
    runId: state.context.runId,
    category: state.diagnosis?.category,
    confidence: state.diagnosis?.confidence,
    rootCause: state.diagnosis?.root_cause,
    error: state.error || undefined,
    toolCalls: toolCallCount(state),
    durationMs: elapsedMs(state),
    finishedAt: state.endedAt || Date.now(),
    diagnosis: state.diagnosis,
    steps: state.steps,
  };
}

export function saveRecord(record: HistoryRecord) {
  const existing = read().filter((r) => r.id !== record.id);
  write([record, ...existing]);
}

export function deleteRecord(id: string) {
  write(read().filter((r) => r.id !== id));
}

export function clearHistory() {
  write([]);
}

export function getRecord(id: string): HistoryRecord | null {
  return read().find((r) => r.id === id) ?? null;
}

/**
 * `loading` is a real state, not ceremony: localStorage is unreachable during
 * the server render, so the first client paint has no data and the list must
 * not flash its empty state on the way to showing results.
 */
export function useHistory() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setRecords(read());
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(CHANGED, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(CHANGED, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);

  return { records, loading, refresh };
}
