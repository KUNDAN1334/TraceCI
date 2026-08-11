"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, Spinner } from "@/components/ui/feedback";
import { Select, TextInput } from "@/components/ui/form";
import { Panel, PanelBody, PanelHeader, SectionLabel } from "@/components/ui/panel";
import { explainNetworkError, fetchModels, validateKey } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EXAMPLE_TARGETS } from "@/lib/sample";
import { readCachedKey, usePrefs, writeCachedKey } from "@/lib/settings";
import type { ModelSpec } from "@/lib/types";
import type { StartArgs } from "@/lib/use-investigation";

type Validation = { state: "idle" | "checking" | "ok" | "bad"; message: string };

/**
 * Is this plausibly a git ref?
 *
 * Not a full `git check-ref-format` -- branch names are permissive and
 * rejecting a valid one would be worse than accepting a bad one. This exists
 * to catch the specific thing that happened: a browser autofilled an email
 * address into the branch field, it was submitted, and it was then persisted
 * as the user's default branch, so it came back on every visit long after the
 * autofill was fixed.
 */
function branchProblem(value: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/\s/.test(v)) return "Branch names cannot contain spaces.";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return "That looks like an email address, not a branch. Clear it unless you meant it.";
  }
  if (/[~^:?*[\\]|\.\.|@\{/.test(v)) return "That is not a valid git ref name.";
  return "";
}

const FALLBACK_MODEL: ModelSpec = {
  id: "groq-llama-3.3-70b",
  label: "Groq — Llama 3.3 70B (free tier)",
  provider: "groq",
  key_hint: "gsk_...",
  key_url: "https://console.groq.com/keys",
  free_tier: true,
};

export function LaunchForm({
  onStart,
  onReplay,
  busy,
}: {
  onStart: (args: StartArgs) => void;
  onReplay: () => void;
  busy: boolean;
}) {
  const { prefs, setPrefs, loaded } = usePrefs();
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [catalogState, setCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [catalogError, setCatalogError] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [modelId, setModelId] = useState(FALLBACK_MODEL.id);
  const [apiKey, setApiKey] = useState("");
  const [formError, setFormError] = useState("");
  const [validation, setValidation] = useState<Validation>({ state: "idle", message: "" });
  const validateAbort = useRef<AbortController | null>(null);

  // Restore what the browser is allowed to remember: never the key unless the
  // user opted into session retention. A stored branch that is not a plausible
  // ref is dropped rather than restored -- it got there by autofill, not by
  // choice, and re-presenting it every visit is how that mistake persists.
  useEffect(() => {
    if (!loaded) return;
    setRepo((v) => v || prefs.lastRepo);
    if (prefs.lastBranch && branchProblem(prefs.lastBranch)) {
      // Evict it for good, not just for this render, so anyone who already
      // submitted an autofilled value stops seeing it.
      setPrefs({ lastBranch: "" });
    } else {
      setBranch((v) => v || prefs.lastBranch);
    }
    if (prefs.model) setModelId(prefs.model);
    if (prefs.keyRetention === "session") setApiKey(readCachedKey());
  }, [loaded, prefs.lastRepo, prefs.lastBranch, prefs.model, prefs.keyRetention, setPrefs]);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    setCatalogState("loading");
    setCatalogError("");
    try {
      const data = await fetchModels(signal);
      const list = data.models?.length ? data.models : [FALLBACK_MODEL];
      setModels(list);
      setCatalogState("ready");
      setModelId((current) =>
        list.some((m) => m.id === current) ? current : data.default || list[0].id
      );
    } catch (err) {
      if (signal?.aborted) return;
      setModels([FALLBACK_MODEL]);
      setCatalogState("error");
      setCatalogError(explainNetworkError(err));
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void loadCatalog(ac.signal);
    return () => ac.abort();
  }, [loadCatalog]);

  useEffect(() => () => validateAbort.current?.abort(), []);

  const selected = models.find((m) => m.id === modelId) ?? FALLBACK_MODEL;

  const applyExample = (example: (typeof EXAMPLE_TARGETS)[number]) => {
    setRepo(example.repo);
    setBranch(example.branch);
    setFormError("");
  };

  const runValidation = async () => {
    if (!apiKey.trim()) {
      setValidation({ state: "bad", message: "Enter a key first." });
      return;
    }
    validateAbort.current?.abort();
    const ac = new AbortController();
    validateAbort.current = ac;
    setValidation({ state: "checking", message: "" });
    try {
      const result = await validateKey(modelId, apiKey.trim(), ac.signal);
      setValidation({ state: result.ok ? "ok" : "bad", message: result.message });
    } catch (err) {
      if (ac.signal.aborted) return;
      setValidation({ state: "bad", message: explainNetworkError(err) });
    }
  };

  const submit = () => {
    const trimmedRepo = repo.trim();
    if (!trimmedRepo) {
      setFormError("Enter a repository, for example owner/repo, or paste an Actions run URL.");
      return;
    }
    if (!apiKey.trim()) {
      setFormError(
        "TraceCI runs on your key. It is sent with this one request and is never stored."
      );
      return;
    }
    setFormError("");
    // Only remember a branch that looks like one.
    const trimmedBranch = branch.trim();
    setPrefs({
      lastRepo: trimmedRepo,
      lastBranch: branchProblem(trimmedBranch) ? "" : trimmedBranch,
      model: modelId,
    });
    writeCachedKey(apiKey.trim(), prefs.keyRetention);
    onStart({ repo: trimmedRepo, branch: branch.trim(), model: modelId, key: apiKey.trim() });
  };

  return (
    <Panel>
      <PanelHeader
        title="New investigation"
        meta="Point TraceCI at a repository with a failed GitHub Actions run."
        actions={
          catalogState === "error" ? (
            <Badge tone="warn" dot>
              API unreachable
            </Badge>
          ) : catalogState === "loading" ? (
            <Badge tone="neutral" dot pulse>
              Loading catalog
            </Badge>
          ) : (
            <Badge tone="ok" dot>
              API connected
            </Badge>
          )
        }
      />

      <PanelBody>
        {/* A real <form> for two reasons: Enter submits, and it scopes the
            browser's autofill heuristics. Without it Chrome treats every
            control on the page as one unowned group, sees the masked key
            field, decides this is a sign-in form, and fills a saved email
            address into the nearest text input above it -- which is the
            branch field. */}
        <form
          className="space-y-5"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
          <SectionLabel className="mb-2">Example failures</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_TARGETS.map((example) => (
              <button
                key={example.branch}
                type="button"
                title={example.hint}
                onClick={() => applyExample(example)}
                className={cn(
                  "rounded border px-2.5 py-1 text-[13px] transition-colors",
                  branch === example.branch
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-line bg-elevated text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
          <TextInput
            label="Repository or run URL"
            mono
            name="traceci-repository"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            hint="A run URL is accepted too, and pins the investigation to that exact run."
          />
          <TextInput
            label="Branch"
            mono
            name="traceci-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="optional"
            spellCheck={false}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            error={branchProblem(branch)}
            hint="Blank means the most recent failed run."
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,280px)_1fr]">
          <Select
            label="Model"
            name="traceci-model"
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value);
              setValidation({ state: "idle", message: "" });
            }}
            hint={selected.notes}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>

          <TextInput
            label="API key"
            type="password"
            mono
            name="traceci-provider-key"
            // `new-password` is the sanctioned way to tell a browser that a
            // masked field is not a login credential. It suppresses both the
            // username autofill and the "save password?" prompt.
            autoComplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setValidation({ state: "idle", message: "" });
            }}
            placeholder={selected.key_hint}
            spellCheck={false}
            action={
              selected.key_url ? (
                <a
                  href={selected.key_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-2xs text-accent hover:underline"
                >
                  {selected.free_tier ? "get a free key" : "get a key"}
                </a>
              ) : null
            }
            hint={
              validation.state === "ok" ? (
                <span className="text-ok">{validation.message}</span>
              ) : validation.state === "bad" ? (
                <span className="text-danger">{validation.message}</span>
              ) : (
                "Sent with this request only. Never written to state, checkpoints or share links."
              )
            }
          />
        </div>

        {selected.budget === "tight" ? (
          <Callout tone="neutral">
            This model has a tight tokens-per-minute cap, so TraceCI shrinks the log window and
            file reads to keep one investigation inside it. Diagnosis quality is slightly lower on
            subtle failures than on a full-budget model.
          </Callout>
        ) : null}

        {formError ? <ErrorState title="Cannot start" message={formError} /> : null}

        {catalogState === "error" ? (
          <ErrorState
            title="The model catalog could not be loaded"
            message={
              <>
                {catalogError} Until it reconnects, only the default free model is offered and a
                live run will fail.
              </>
            }
            action={
              <>
                <Button size="sm" onClick={() => void loadCatalog()}>
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={onReplay}>
                  Replay a recorded run instead
                </Button>
              </>
            }
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? <Spinner /> : null}
            Start investigation
          </Button>
          <Button variant="ghost" onClick={runValidation} disabled={busy || !apiKey.trim()}>
            {validation.state === "checking" ? <Spinner /> : null}
            Check key and model
          </Button>
          <span className="ml-auto text-2xs text-fg-subtle">
            No key handy?{" "}
            <button
              type="button"
              onClick={onReplay}
              disabled={busy}
              className="text-accent hover:underline disabled:opacity-50"
            >
              Replay a recorded investigation
            </button>
          </span>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
