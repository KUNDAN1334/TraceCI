import type { Health, ModelCatalog, StoredAnalysis } from "./types";

/**
 * Every call to the TraceCI backend lives here.
 *
 * The base URL is compiled in from NEXT_PUBLIC_API_BASE, but a browser-local
 * override wins. That override is not a gimmick: the most common way this app
 * is run is a static frontend on one host and the API on another, and being
 * able to repoint it without a rebuild is the difference between "the demo is
 * broken" and "the demo works".
 */
const BUILD_TIME_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const OVERRIDE_KEY = "traceci.apiBase";

export function apiBase(): string {
  if (typeof window !== "undefined") {
    try {
      const override = window.localStorage.getItem(OVERRIDE_KEY);
      if (override && override.trim()) return override.trim().replace(/\/$/, "");
    } catch {
      /* privacy mode: fall through to the build-time value */
    }
  }
  return BUILD_TIME_BASE.replace(/\/$/, "");
}

export function defaultApiBase(): string {
  return BUILD_TIME_BASE.replace(/\/$/, "");
}

export function setApiBaseOverride(value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value && value.trim()) window.localStorage.setItem(OVERRIDE_KEY, value.trim());
    else window.localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* nothing we can do, and nothing worth crashing over */
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

/** Turn any fetch failure into one sentence a developer can act on. */
export function explainNetworkError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return `Could not reach the TraceCI API at ${apiBase()}. Check that the backend is running and that this origin is in ALLOWED_ORIGINS.`;
  }
  return msg || "The request failed.";
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
      else if (body?.message) detail = body.message;
    } catch {
      /* not JSON; the status line is all we have */
    }
    throw new ApiError(detail, res.status);
  }
  return (await res.json()) as T;
}

export function fetchHealth(signal?: AbortSignal) {
  return getJson<Health>("/health", { signal, cache: "no-store" });
}

export function fetchModels(signal?: AbortSignal) {
  return getJson<ModelCatalog>("/models", { signal, cache: "no-store" });
}

export function fetchAnalysis(threadId: string, signal?: AbortSignal) {
  return getJson<StoredAnalysis>(`/analysis/${encodeURIComponent(threadId)}`, {
    signal,
    cache: "no-store",
  });
}

/**
 * `POST /validate` does more than check the key: it proves the model actually
 * emits a tool call. A key that is valid on a model that cannot call tools
 * produces a fluent, confident, entirely wrong diagnosis with no error
 * anywhere -- so it is worth one round trip before a real run.
 */
export async function validateKey(
  model: string,
  key: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${apiBase()}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, key }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
  return {
    ok: Boolean(body.ok),
    message: body.message || (res.ok ? "Key accepted." : `Validation failed (${res.status}).`),
  };
}

export type AnalyzeRequest = {
  repo: string;
  branch?: string | null;
  run_id?: number | null;
  model: string;
  key: string;
};

export function analyzeUrl() {
  return `${apiBase()}/analyze`;
}

export function analyzeInit(req: AnalyzeRequest, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      repo: req.repo,
      branch: req.branch || null,
      run_id: req.run_id ?? null,
      model: req.model,
      key: req.key,
    }),
    signal,
  };
}
