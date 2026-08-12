/**
 * The wire contract, mirrored from backend/traceci/api.py.
 *
 * The backend emits exactly five event types. Nothing in the UI may invent a
 * sixth: every state the interface shows has to be derivable from these, which
 * is what keeps the trace honest rather than decorative.
 */

export type StepEvent = {
  type: "step";
  icon: string;
  label: string;
  detail?: string;
};
export type TokenEvent = { type: "token"; text: string };
export type ResultEvent = { type: "result"; diagnosis: Diagnosis; thread_id: string };
export type DoneEvent = { type: "done" };
export type ErrorEvent = { type: "error"; message: string };
export type StreamEvent = StepEvent | TokenEvent | ResultEvent | DoneEvent | ErrorEvent;

/** `Diagnosis` in backend/traceci/graph.py -- the typed output of the graph. */
export type DiagnosisCategory =
  | "test_failure"
  | "dependency"
  | "config"
  | "infra"
  | "lint_type"
  | "flaky"
  | "inconclusive"
  | "unknown";

export type Diagnosis = {
  category: DiagnosisCategory;
  root_cause: string;
  evidence: string[];
  confidence: number;
  suggested_fix: string;
  fix_snippet: string;
};

/** One entry of `GET /models`. */
export type ModelSpec = {
  id: string;
  label: string;
  provider: string;
  key_hint: string;
  key_url: string;
  notes?: string;
  free_tier?: boolean;
  budget?: "tight" | "normal" | string;
};

export type ModelCatalog = { models: ModelSpec[]; default: string };

/** `GET /health`. */
export type Health = { ok: boolean; version: string; github_token: boolean };

/** `GET /analysis/{thread_id}` -- a finished run read back from the checkpoint. */
export type StoredAnalysis = {
  thread_id: string;
  repo: string | null;
  run_id: number | null;
  workflow_name: string | null;
  failed_step: string | null;
  log_tail: string | null;
  diff_summary: string | null;
  tool_calls: number;
  diagnosis: Diagnosis | null;
};

export const CATEGORY_META: Record<
  DiagnosisCategory,
  { label: string; tone: "danger" | "warn" | "violet" | "info" | "ok" | "neutral"; blurb: string }
> = {
  test_failure: {
    label: "Test failure",
    tone: "danger",
    blurb: "Application or test code asserts something that is no longer true.",
  },
  dependency: {
    label: "Dependency",
    tone: "warn",
    blurb: "A package version, resolution or lockfile made the build unbuildable.",
  },
  config: {
    label: "Configuration",
    tone: "violet",
    blurb: "The workflow, tooling config or environment is wrong, not the code.",
  },
  infra: {
    label: "Infrastructure",
    tone: "info",
    blurb: "The runner, network or an external service failed, not your change.",
  },
  lint_type: {
    label: "Lint / type",
    tone: "ok",
    blurb: "A static check rejected the code before anything ran.",
  },
  flaky: {
    label: "Flaky",
    tone: "warn",
    blurb: "Non-deterministic behaviour: timing, ordering or shared state.",
  },
  inconclusive: {
    label: "No cause found",
    tone: "neutral",
    blurb: "Nothing in this run supports a root cause.",
  },
  unknown: {
    label: "Unclassified",
    tone: "neutral",
    blurb: "The evidence did not support any single category.",
  },
};

export function categoryMeta(category: string) {
  return CATEGORY_META[category as DiagnosisCategory] ?? CATEGORY_META.unknown;
}

/**
 * A result that names no cause is not a diagnosis and must not be rendered as
 * one. Presenting hedged prose under a "Root cause" heading next to a
 * "Suggested fix" is how a non-answer gets mistaken for an answer.
 */
export function isInconclusive(diagnosis: Diagnosis): boolean {
  // Driven by the explicit signal, not by the score. An earlier version also
  // treated `confidence <= 2` on its own as inconclusive, which is wrong: a
  // real, correctly-identified cause can carry a low score when the agent had
  // to infer a link, and that is exactly the case where the reader most needs
  // to see the evidence and the fix. A low score now only counts when the
  // result also names no fix -- i.e. when nothing was actually concluded.
  if (diagnosis.category === "inconclusive") return true;
  if (diagnosis.category === "unknown" && !diagnosis.suggested_fix?.trim()) return true;
  return diagnosis.confidence <= 2 && !diagnosis.suggested_fix?.trim();
}
