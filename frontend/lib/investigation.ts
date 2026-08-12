import type { Diagnosis, StreamEvent } from "./types";

/**
 * The investigation state machine.
 *
 * The backend streams a flat sequence of `step` events. A flat list is a log,
 * not an interface: it tells you what happened but not *where in the process
 * you are*, which is the one question somebody staring at a running agent
 * actually has. So this module folds the stream into four phases that match
 * the graph in backend/traceci/graph.py:
 *
 *     fetch_failure  ->  investigate <-> tools  ->  diagnose
 *     (locate, context)   (investigate)             (diagnose)
 *
 * Nothing here is invented. Every phase transition is triggered by a real
 * event; the only inference is the "composing the diagnosis" hint, which is
 * derived from the stream going quiet and is labelled as a hint in the UI.
 */

export type PhaseId = "locate" | "context" | "investigate" | "diagnose";
export type PhaseStatus = "pending" | "active" | "done" | "failed" | "stopped";
export type RunStatus = "idle" | "starting" | "running" | "complete" | "failed" | "stopped";
export type RunMode = "live" | "replay";

export type TraceStep = {
  id: number;
  phase: PhaseId;
  icon: string;
  label: string;
  detail?: string;
  at: number;
};

/** What the prefetch phase told us about the run, parsed out of its steps. */
export type RunContext = {
  repo?: string;
  runId?: string;
  workflow?: string;
  failedStep?: string;
  diffSummary?: string;
};

export type InvestigationState = {
  status: RunStatus;
  mode: RunMode;
  phases: Record<PhaseId, PhaseStatus>;
  steps: TraceStep[];
  reasoning: string;
  context: RunContext;
  diagnosis: Diagnosis | null;
  threadId: string;
  error: string;
  /** Set when the stream ended without ever producing a diagnosis. */
  incomplete: boolean;
  startedAt: number;
  endedAt: number;
  lastEventAt: number;
  now: number;
  cursor: PhaseId;
  target: { repo: string; branch: string; model: string };
};

export const PHASES: { id: PhaseId; title: string; summary: string }[] = [
  {
    id: "locate",
    title: "Locate the run",
    summary: "Find the most recent failed workflow run on the branch.",
  },
  {
    id: "context",
    title: "Assemble context",
    summary: "First failing step, anchored log window, diff since the last green commit.",
  },
  {
    id: "investigate",
    title: "Investigate",
    summary: "The agent decides which files, patches or log regions it needs.",
  },
  {
    id: "diagnose",
    title: "Diagnose",
    summary: "A typed root cause with quoted evidence and a confidence score.",
  },
];

export const PHASE_ORDER: PhaseId[] = ["locate", "context", "investigate", "diagnose"];

/** Icons come from the backend as short names; keep the mapping in one place. */
export const STEP_GLYPH: Record<string, string> = {
  search: "⌕",
  run: "◉",
  target: "◎",
  diff: "±",
  check: "▤",
  folder: "▸",
  log: "≡",
  ok: "✓",
  tool: "•",
};

/**
 * The backend stamps every step it emits from the agent's own `tool_calls`
 * with this detail. It is the only reliable marker of "the agent decided to do
 * this" -- icons are reused by the deterministic phases, and run-selection
 * notes share an icon with the initial lookup.
 */
const AGENT_CHOICE = "the agent chose this";

export function initialState(): InvestigationState {
  return {
    status: "idle",
    mode: "live",
    phases: { locate: "pending", context: "pending", investigate: "pending", diagnose: "pending" },
    steps: [],
    reasoning: "",
    context: {},
    diagnosis: null,
    threadId: "",
    error: "",
    incomplete: false,
    startedAt: 0,
    endedAt: 0,
    lastEventAt: 0,
    now: 0,
    cursor: "locate",
    target: { repo: "", branch: "", model: "" },
  };
}

export type Action =
  | { type: "start"; mode: RunMode; target: InvestigationState["target"]; at: number }
  | { type: "event"; event: StreamEvent; at: number }
  | { type: "stop"; at: number }
  | { type: "fail"; message: string; at: number }
  | { type: "tick"; at: number }
  | { type: "reset" };

/** The stream stops emitting while `diagnose` runs; after this long, say so. */
const QUIET_BEFORE_DIAGNOSING_MS = 1400;
/**
 * Total silence for this long means the run is gone, not thinking. Generous
 * enough to cover the slowest real gap -- downloading and unzipping a large
 * log archive before the first model call -- and short enough that nobody
 * sits watching a dead spinner.
 */
const STALL_MS = 90_000;
/** Reasoning is prose, not a log. Cap it so a runaway model cannot eat memory. */
const MAX_REASONING_CHARS = 40_000;

function advanceTo(state: InvestigationState, phase: PhaseId): InvestigationState {
  const from = PHASE_ORDER.indexOf(state.cursor);
  const to = PHASE_ORDER.indexOf(phase);
  if (to <= from) return state;
  const phases = { ...state.phases };
  for (let i = from; i < to; i++) {
    if (phases[PHASE_ORDER[i]] !== "failed") phases[PHASE_ORDER[i]] = "done";
  }
  phases[phase] = "active";
  return { ...state, phases, cursor: phase };
}

function parseContext(step: { icon: string; label: string; detail?: string }): RunContext {
  const out: RunContext = {};
  if (step.icon === "run") {
    const workflow = /^Workflow `(.+)` failed$/.exec(step.label);
    if (workflow) out.workflow = workflow[1];
    const detail = /^(\S+\/\S+)\s+-\s+run\s+(\S+)$/.exec((step.detail || "").trim());
    if (detail) {
      out.repo = detail[1];
      out.runId = detail[2];
    }
  }
  if (step.icon === "target") {
    const m = /^First failing step:\s*(.+)$/.exec(step.label);
    if (m) out.failedStep = m[1];
  }
  if (step.icon === "diff" && step.detail) out.diffSummary = step.detail;
  return out;
}

export function reduce(state: InvestigationState, action: Action): InvestigationState {
  switch (action.type) {
    case "reset":
      return initialState();

    case "start":
      return {
        ...initialState(),
        status: "starting",
        mode: action.mode,
        target: action.target,
        startedAt: action.at,
        lastEventAt: action.at,
        now: action.at,
        phases: {
          locate: "active",
          context: "pending",
          investigate: "pending",
          diagnose: "pending",
        },
      };

    case "tick": {
      if (state.status !== "running" && state.status !== "starting") return state;
      // A run that has sent nothing at all for this long is not slow, it is
      // broken -- a cancelled replay, a dropped stream, a proxy that closed
      // without sending `done`. Failing loudly beats a spinner that never
      // resolves and gives the reader nothing to act on.
      if (state.startedAt && action.at - state.lastEventAt > STALL_MS) {
        const phases = { ...state.phases };
        for (const id of PHASE_ORDER) if (phases[id] === "active") phases[id] = "failed";
        return {
          ...state,
          status: "failed",
          phases,
          endedAt: action.at,
          now: action.at,
          error:
            "The investigation stopped sending updates, so it has been abandoned. " +
            "Nothing was lost — start it again, or replay the recorded run.",
        };
      }
      let next = { ...state, now: action.at };
      // The graph goes quiet between the last tool result and the structured
      // diagnosis. Saying "composing the diagnosis" beats an idle spinner.
      if (
        next.cursor === "investigate" &&
        next.reasoning.length > 0 &&
        action.at - next.lastEventAt > QUIET_BEFORE_DIAGNOSING_MS
      ) {
        next = advanceTo(next, "diagnose");
      }
      return next;
    }

    case "stop": {
      const phases = { ...state.phases };
      for (const id of PHASE_ORDER) if (phases[id] === "active") phases[id] = "stopped";
      return { ...state, status: "stopped", phases, endedAt: action.at, now: action.at };
    }

    case "fail": {
      const phases = { ...state.phases };
      for (const id of PHASE_ORDER) if (phases[id] === "active") phases[id] = "failed";
      return {
        ...state,
        status: "failed",
        error: action.message,
        phases,
        endedAt: action.at,
        now: action.at,
      };
    }

    case "event": {
      const ev = action.event;
      let next: InvestigationState = {
        ...state,
        status: state.status === "starting" ? "running" : state.status,
        lastEventAt: action.at,
        now: action.at,
      };

      switch (ev.type) {
        case "step": {
          // Phase assignment, driven purely by the order the backend emits in:
          // one `search`, then run/target/diff from the prefetch node, then
          // everything the agent chose to do.
          let phase: PhaseId = next.cursor;
          if (next.cursor === "locate") {
            if (next.steps.length === 0) phase = "locate";
            else if (ev.icon === "run") {
              next = advanceTo(next, "context");
              phase = "context";
            } else {
              next = advanceTo(next, "investigate");
              phase = "investigate";
            }
          } else if (next.cursor === "context") {
            // Everything the deterministic layer emits -- the failing step, the
            // diff, and any notes about which run was selected -- stays in
            // `context`. Only a step the agent chose moves the phase on. Keying
            // off the icon instead would file run-selection notes as tool calls
            // and inflate the budget counter.
            if (ev.detail === AGENT_CHOICE) {
              next = advanceTo(next, "investigate");
              phase = "investigate";
            } else {
              phase = "context";
            }
          } else if (next.cursor === "diagnose") {
            // The quiet-period hint was wrong: the agent was still working.
            // Roll it back rather than showing a finished phase that is not.
            next = {
              ...next,
              cursor: "investigate",
              phases: { ...next.phases, investigate: "active", diagnose: "pending" },
            };
            phase = "investigate";
          } else {
            phase = next.cursor;
          }

          const step: TraceStep = {
            id: next.steps.length,
            phase,
            icon: ev.icon,
            label: ev.label,
            detail: ev.detail || undefined,
            at: action.at,
          };
          return {
            ...next,
            steps: [...next.steps, step],
            context: { ...next.context, ...parseContext(ev) },
          };
        }

        case "token": {
          if (next.cursor !== "investigate" && next.cursor !== "diagnose") {
            next = advanceTo(next, "investigate");
          }
          const reasoning = (next.reasoning + ev.text).slice(-MAX_REASONING_CHARS);
          return { ...next, reasoning };
        }

        case "result": {
          const phases = { ...next.phases };
          for (const id of PHASE_ORDER) if (phases[id] !== "failed") phases[id] = "done";
          // A run that stopped because there was nothing to diagnose never
          // entered the investigation loop. Marking that phase "done" would
          // claim work that did not happen.
          const investigated = next.steps.some((s) => s.phase === "investigate");
          if (!investigated && ev.diagnosis?.category === "inconclusive") {
            phases.investigate = "stopped";
          }
          return {
            ...next,
            phases,
            cursor: "diagnose",
            diagnosis: ev.diagnosis,
            threadId: ev.thread_id,
            incomplete: false,
          };
        }

        case "error": {
          const phases = { ...next.phases };
          for (const id of PHASE_ORDER) if (phases[id] === "active") phases[id] = "failed";
          return { ...next, phases, status: "failed", error: ev.message, endedAt: action.at };
        }

        case "done": {
          if (next.status === "failed") return { ...next, endedAt: action.at };
          const resolved = Boolean(next.diagnosis);
          const phases = { ...next.phases };
          for (const id of PHASE_ORDER) {
            if (phases[id] === "active") phases[id] = resolved ? "done" : "stopped";
          }
          return {
            ...next,
            phases,
            status: "complete",
            incomplete: !resolved,
            endedAt: action.at,
          };
        }
      }
      return next;
    }
  }
}

// ------------------------------------------------------------------ selectors

export function isRunning(status: RunStatus) {
  return status === "starting" || status === "running";
}

/** Tool calls the agent chose to make. `ok` is the tool-node acknowledgement. */
export function toolCallCount(state: InvestigationState) {
  return state.steps.filter((s) => s.phase === "investigate" && s.icon !== "ok").length;
}

export function elapsedMs(state: InvestigationState) {
  if (!state.startedAt) return 0;
  const end = state.endedAt || state.now || state.startedAt;
  return Math.max(0, end - state.startedAt);
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function stepsForPhase(state: InvestigationState, phase: PhaseId) {
  return state.steps.filter((s) => s.phase === phase);
}

export const STATUS_COPY: Record<RunStatus, { label: string; tone: string }> = {
  idle: { label: "Idle", tone: "neutral" },
  starting: { label: "Connecting", tone: "info" },
  running: { label: "Investigating", tone: "info" },
  complete: { label: "Complete", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  stopped: { label: "Stopped", tone: "warn" },
};
