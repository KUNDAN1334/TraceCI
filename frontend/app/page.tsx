"use client";

/**
 * TraceCI - one page, on purpose.
 *
 * Two things here are not optional, and both exist because of the same
 * observation: an interviewer will not paste an API key and will not type a
 * repository name. Without a demo button and prefilled example chips they read
 * the header, find nothing to click, and close the tab. So:
 *
 *   - "Watch the demo" replays a pre-recorded stream (public/demo-stream.json)
 *     through the exact same reducer as a live run. No key, no backend.
 *   - The example chips fill the form with a real repo and branch in one click.
 *
 * The timeline is the product. Every row in it is a decision the agent made -
 * the labels come from the AIMessage's tool_calls, not from a fake progress
 * bar - so watching it is watching the reasoning.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

type StepEvent = { type: "step"; icon: string; label: string; detail?: string };
type TokenEvent = { type: "token"; text: string };
type ResultEvent = { type: "result"; diagnosis: Diagnosis; thread_id: string };
type DoneEvent = { type: "done" };
type ErrorEvent = { type: "error"; message: string };
type Event = StepEvent | TokenEvent | ResultEvent | DoneEvent | ErrorEvent;

type Diagnosis = {
  category: string;
  root_cause: string;
  evidence: string[];
  confidence: number;
  suggested_fix: string;
  fix_snippet: string;
};

type ModelSpec = {
  id: string;
  label: string;
  provider: string;
  key_hint: string;
  key_url: string;
  notes?: string;
  free_tier?: boolean;
  budget?: string;
};

const EXAMPLES = [
  { label: "subtle regression", repo: "kundan/traceme-lab", branch: "break/subtle", hint: "the one a script cannot solve" },
  { label: "bad dependency", repo: "kundan/traceme-lab", branch: "break/dependency", hint: "0 tool calls - the log is enough" },
  { label: "lint / type error", repo: "kundan/traceme-lab", branch: "break/lint_type", hint: "fails at Lint" },
  { label: "broken workflow config", repo: "kundan/traceme-lab", branch: "break/config", hint: "fails at Set up Python" },
];

const CATEGORY_STYLE: Record<string, string> = {
  test_failure: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  dependency: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  config: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  infra: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  lint_type: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  flaky: "bg-fuchsia-500/15 text-fuchsia-300 ring-fuchsia-500/30",
  unknown: "bg-ink-700 text-ink-300 ring-ink-600",
};

const ICONS: Record<string, string> = {
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

function Icon({ name }: { name: string }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-800 text-[13px] text-ink-300 ring-1 ring-ink-700">
      {ICONS[name] ?? "•"}
    </span>
  );
}

export default function Page() {
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [modelId, setModelId] = useState("groq-llama-3.3-70b");
  const [apiKey, setApiKey] = useState("");
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [thinking, setThinking] = useState("");
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [threadId, setThreadId] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timelineEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${API}/models`)
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setModelId(d.default ?? "groq-llama-3.3-70b");
      })
      .catch(() => {
        /* backend not up yet: the demo still works, which is the point */
      });
  }, []);

  useEffect(() => {
    timelineEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [steps.length, thinking]);

  const reset = () => {
    setSteps([]);
    setThinking("");
    setDiagnosis(null);
    setThreadId("");
    setError("");
    setCopied(false);
  };

  /** One reducer for both the live stream and the recorded demo. */
  const apply = useCallback((ev: Event) => {
    switch (ev.type) {
      case "step":
        setSteps((s) => [...s, ev]);
        break;
      case "token":
        setThinking((t) => (t + ev.text).slice(-1200));
        break;
      case "result":
        setDiagnosis(ev.diagnosis);
        setThreadId(ev.thread_id);
        break;
      case "error":
        setError(ev.message);
        break;
      case "done":
        setRunning(false);
        break;
    }
  }, []);

  const runDemo = async () => {
    reset();
    setIsDemo(true);
    setRunning(true);
    setRepo("kundan/traceme-lab");
    setBranch("break/subtle");
    const res = await fetch("/demo-stream.json");
    const recorded: { delay_ms: number; event: Event }[] = await res.json();
    for (const frame of recorded) {
      await new Promise((r) => setTimeout(r, frame.delay_ms));
      apply(frame.event);
    }
    setRunning(false);
  };

  const runLive = async () => {
    if (!repo.trim()) return setError("Enter a repository, e.g. `owner/repo`.");
    if (!apiKey.trim()) return setError("Bring your own key - it is used for this request only and never stored.");
    reset();
    setIsDemo(false);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${API}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repo.trim(),
          branch: branch.trim() || null,
          model: modelId,
          key: apiKey.trim(),
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error(`Backend returned ${resp.status}.`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          apply(JSON.parse(line.slice(6)) as Event);
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || "The stream failed.");
    } finally {
      setRunning(false);
    }
  };

  const copySnippet = async () => {
    if (!diagnosis?.fix_snippet) return;
    await navigator.clipboard.writeText(diagnosis.fix_snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const selected = models.find((m) => m.id === modelId);

  return (
    <main className="relative mx-auto max-w-3xl px-5 pb-24 pt-14">
      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">TraceCI</h1>
          <span className="text-sm text-ink-400">CI failure, diagnosed</span>
        </div>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-300">
          Point it at a red GitHub Actions run. It reads the failing step&apos;s log and the diff since the last
          green commit, decides for itself whether it needs to open the source, and reports a root cause with
          quoted evidence.
        </p>
      </header>

      {/* ------------------------------------------------ controls */}
      <section className="rounded-xl border border-ink-800 bg-ink-900/70 p-4 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.branch}
              onClick={() => {
                setRepo(ex.repo);
                setBranch(ex.branch);
                setError("");
              }}
              title={ex.hint}
              className={`rounded-full px-3 py-1 text-[13px] ring-1 transition ${
                branch === ex.branch
                  ? "bg-ink-100 text-ink-950 ring-ink-100"
                  : "bg-ink-850 text-ink-300 ring-ink-700 hover:bg-ink-800 hover:text-ink-100"
              }`}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_200px]">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo, or paste an Actions run URL"
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-ink-600 focus:border-ink-600"
          />
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="branch (optional)"
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-ink-600 focus:border-ink-600"
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[240px_1fr]">
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 text-sm outline-none focus:border-ink-600"
          >
            {(models.length
              ? models
              : [{ id: "groq-llama-3.3-70b", label: "Groq - Llama 3.3 70B (FREE)" } as ModelSpec]
            ).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={selected ? `${selected.key_hint}  (your key, used once, never stored)` : "your API key"}
            className="w-full rounded-lg border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm outline-none placeholder:text-ink-600 focus:border-ink-600"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={runLive}
            disabled={running}
            className="rounded-lg bg-ink-100 px-4 py-2 text-sm font-medium text-ink-950 transition hover:bg-white disabled:opacity-40"
          >
            {running && !isDemo ? "Analysing..." : "Analyse"}
          </button>
          <button
            onClick={runDemo}
            disabled={running}
            className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-100 transition hover:bg-ink-800 disabled:opacity-40"
          >
            {running && isDemo ? "Replaying..." : "▶ Watch the demo (no key)"}
          </button>
          {selected?.key_url && (
            <a
              href={selected.key_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-400 underline-offset-2 hover:text-ink-300 hover:underline"
            >
              {selected.free_tier ? "get a free key" : "get a key"}
            </a>
          )}
          {selected?.free_tier && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-500/30">
              free tier
            </span>
          )}
        </div>

        {selected?.notes && (
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            {selected.notes}
            {selected.budget === "tight" && (
              <>
                {" "}
                TraceCI automatically shrinks the log window and file reads for free-tier models so
                one analysis stays inside the tokens-per-minute cap.
              </>
            )}
          </p>
        )}
        {isDemo && (
          <p className="mt-3 text-xs text-ink-400">
            Replaying a recorded run of <span className="font-mono">break/subtle</span> - the same event stream a
            live analysis produces, so nothing here is mocked-up UI.
          </p>
        )}
      </section>

      {error && (
        <div className="mt-4 animate-slidein rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* ------------------------------------------------ timeline */}
      {(steps.length > 0 || running) && (
        <section className="mt-6">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-ink-400">What the agent did</h2>
          <ol className="relative space-y-2 border-l border-ink-800 pl-5">
            {steps.map((s, i) => (
              <li key={i} className="animate-slidein">
                <span className="absolute -left-[13px] mt-1">
                  <Icon name={s.icon} />
                </span>
                <div className="ml-2">
                  <div className="text-sm text-ink-100">{s.label}</div>
                  {s.detail && <div className="font-mono text-xs text-ink-400">{s.detail}</div>}
                </div>
              </li>
            ))}
            {running && (
              <li className="ml-2 animate-pulseline text-sm text-ink-400">working...</li>
            )}
          </ol>
          {thinking && (
            <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-relaxed text-ink-400">
              {thinking}
            </pre>
          )}
          <div ref={timelineEnd} />
        </section>
      )}

      {/* ------------------------------------------------ diagnosis */}
      {diagnosis && (
        <section className="mt-8 animate-slidein overflow-hidden rounded-xl border border-ink-800 bg-ink-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 px-5 py-4">
            <div className="flex items-center gap-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium uppercase tracking-wide ring-1 ${
                  CATEGORY_STYLE[diagnosis.category] ?? CATEGORY_STYLE.unknown
                }`}
              >
                {diagnosis.category.replace("_", " ")}
              </span>
              <span className="text-xs text-ink-400">root cause</span>
            </div>
            <div className="flex items-center gap-2" title="How much of this is evidence vs inference">
              <span className="text-xs text-ink-400">confidence</span>
              <div className="flex gap-[3px]">
                {Array.from({ length: 10 }, (_, i) => (
                  <span
                    key={i}
                    className={`h-3.5 w-1.5 rounded-sm ${
                      i < diagnosis.confidence
                        ? diagnosis.confidence >= 8
                          ? "bg-emerald-400"
                          : diagnosis.confidence >= 5
                          ? "bg-amber-400"
                          : "bg-rose-400"
                        : "bg-ink-700"
                    }`}
                  />
                ))}
              </div>
              <span className="font-mono text-xs text-ink-300">{diagnosis.confidence}/10</span>
            </div>
          </div>

          <div className="space-y-5 px-5 py-5">
            <p className="text-[15px] leading-relaxed text-ink-100">{diagnosis.root_cause}</p>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400">Evidence</h3>
              <ul className="space-y-1.5">
                {diagnosis.evidence.map((e, i) => (
                  <li
                    key={i}
                    className="overflow-x-auto rounded-md border-l-2 border-ink-600 bg-ink-950 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink-300"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-400">Suggested fix</h3>
              <p className="text-sm leading-relaxed text-ink-100">{diagnosis.suggested_fix}</p>
            </div>

            {diagnosis.fix_snippet && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-medium uppercase tracking-wider text-ink-400">Patch</h3>
                  <button
                    onClick={copySnippet}
                    className="rounded-md border border-ink-700 px-2 py-1 text-xs text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
                  >
                    {copied ? "copied" : "copy"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-ink-800 bg-ink-950 p-3 font-mono text-[12px] leading-relaxed">
                  {diagnosis.fix_snippet.split("\n").map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.startsWith("+")
                          ? "text-emerald-300"
                          : line.startsWith("-")
                          ? "text-rose-300"
                          : "text-ink-400"
                      }
                    >
                      {line || " "}
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </div>

          {threadId && (
            <div className="border-t border-ink-800 px-5 py-3 text-xs text-ink-400">
              thread <span className="font-mono text-ink-300">{threadId}</span> - re-openable at{" "}
              <span className="font-mono">/analysis/{threadId}</span>
            </div>
          )}
        </section>
      )}

      <footer className="mt-14 border-t border-ink-800 pt-5 text-xs leading-relaxed text-ink-400">
        Read-only: TraceCI never writes to your repository. Your API key is sent with a single request, is never
        written to the graph state or the checkpoint database, and is not returned by the share link.
      </footer>
    </main>
  );
}
