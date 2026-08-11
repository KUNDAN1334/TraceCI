"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { analyzeInit, analyzeUrl, explainNetworkError } from "./api";
import {
  elapsedMs,
  initialState,
  isRunning,
  reduce,
  toolCallCount,
  type InvestigationState,
  type RunMode,
} from "./investigation";
import type { StreamEvent } from "./types";

export type StartArgs = {
  repo: string;
  branch: string;
  model: string;
  key: string;
  runId?: number | null;
};

type RecordedFrame = { delay_ms: number; event: StreamEvent };

/**
 * One hook, two sources, one reducer.
 *
 * The recorded replay is not a mock: `public/demo-stream.json` is a captured
 * live stream and it is fed through the exact same reducer as a live run. If
 * the replay renders correctly, the live path renders correctly -- which is
 * the only reason a demo mode is worth having.
 */
export function useInvestigation(onFinished?: (state: InvestigationState) => void) {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const abortRef = useRef<AbortController | null>(null);
  const runToken = useRef(0);
  const finishedRef = useRef(onFinished);
  const notifiedFor = useRef(-1);

  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);

  // Cancel any in-flight work if the workspace unmounts mid-run. Without this
  // a replay keeps firing timers into a dead component.
  useEffect(
    () => () => {
      runToken.current += 1;
      abortRef.current?.abort();
    },
    []
  );

  // Drives the elapsed clock and the "composing the diagnosis" hint.
  const running = isRunning(state.status);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => dispatch({ type: "tick", at: Date.now() }), 250);
    return () => window.clearInterval(id);
  }, [running]);

  // Fire the completion callback exactly once per run.
  useEffect(() => {
    const settled =
      state.status === "complete" || state.status === "failed" || state.status === "stopped";
    if (!settled || !state.startedAt || notifiedFor.current === state.startedAt) return;
    notifiedFor.current = state.startedAt;
    finishedRef.current?.(state);
  }, [state]);

  const stop = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "stop", at: Date.now() });
  }, []);

  const reset = useCallback(() => {
    runToken.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    notifiedFor.current = -1;
    dispatch({ type: "reset" });
  }, []);

  const begin = useCallback((mode: RunMode, target: InvestigationState["target"]) => {
    runToken.current += 1;
    abortRef.current?.abort();
    notifiedFor.current = -1;
    dispatch({ type: "start", mode, target, at: Date.now() });
    return runToken.current;
  }, []);

  /** Replay the captured stream. No key, no backend, same reducer. */
  const startReplay = useCallback(async () => {
    const token = begin("replay", {
      repo: "kundan/traceme-lab",
      branch: "break/subtle",
      model: "recorded",
    });
    try {
      const res = await fetch("/demo-stream.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`The recorded run could not be loaded (${res.status}).`);
      const frames = (await res.json()) as RecordedFrame[];
      for (const frame of frames) {
        if (runToken.current !== token) return;
        await new Promise((r) => setTimeout(r, frame.delay_ms));
        if (runToken.current !== token) return;
        dispatch({ type: "event", event: frame.event, at: Date.now() });
      }
    } catch (err) {
      if (runToken.current !== token) return;
      dispatch({
        type: "fail",
        message: err instanceof Error ? err.message : "The recorded run could not be replayed.",
        at: Date.now(),
      });
    }
  }, [begin]);

  /** Stream a live analysis over SSE. */
  const startLive = useCallback(
    async (args: StartArgs) => {
      const token = begin("live", {
        repo: args.repo,
        branch: args.branch,
        model: args.model,
      });
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          analyzeUrl(),
          analyzeInit(
            {
              repo: args.repo,
              branch: args.branch,
              run_id: args.runId ?? null,
              model: args.model,
              key: args.key,
            },
            controller.signal
          )
        );
        if (!res.ok) {
          throw new Error(
            `The backend rejected the request (${res.status} ${res.statusText}).`
          );
        }
        if (!res.body) throw new Error("The backend returned no stream body.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (runToken.current !== token) {
            await reader.cancel().catch(() => undefined);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(6)) as StreamEvent;
              dispatch({ type: "event", event, at: Date.now() });
            } catch {
              // A malformed frame is not worth killing a working stream over.
            }
          }
        }
        // A stream that ends without `done` (proxy timeout, dropped
        // connection) must not leave the UI spinning forever.
        if (runToken.current === token) {
          dispatch({ type: "event", event: { type: "done" }, at: Date.now() });
        }
      } catch (err) {
        if (runToken.current !== token) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        dispatch({ type: "fail", message: explainNetworkError(err), at: Date.now() });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [begin]
  );

  const derived = useMemo(
    () => ({
      running: isRunning(state.status),
      settled:
        state.status === "complete" || state.status === "failed" || state.status === "stopped",
      elapsed: elapsedMs(state),
      toolCalls: toolCallCount(state),
    }),
    [state]
  );

  return { state, ...derived, startLive, startReplay, stop, reset };
}
