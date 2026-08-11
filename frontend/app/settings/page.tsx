"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout, ErrorState, Skeleton, Spinner } from "@/components/ui/feedback";
import { SegmentedControl, Select, TextInput } from "@/components/ui/form";
import { DataRow, PageHeader, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import {
  apiBase,
  defaultApiBase,
  explainNetworkError,
  fetchHealth,
  fetchModels,
  setApiBaseOverride,
} from "@/lib/api";
import { clearHistory, useHistory } from "@/lib/history";
import { forgetKey, usePrefs, type KeyRetention } from "@/lib/settings";
import type { Health, ModelSpec } from "@/lib/types";

type Probe =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up"; health: Health }
  | { kind: "down"; message: string };

export default function SettingsPage() {
  const { prefs, setPrefs, loaded } = usePrefs();
  const { records } = useHistory();
  const [base, setBase] = useState("");
  const [savedBase, setSavedBase] = useState("");
  const [probe, setProbe] = useState<Probe>({ kind: "idle" });
  const [models, setModels] = useState<ModelSpec[]>([]);

  useEffect(() => {
    const current = apiBase();
    setBase(current);
    setSavedBase(current);
  }, []);

  const check = useCallback(async () => {
    setProbe({ kind: "checking" });
    try {
      const health = await fetchHealth();
      setProbe({ kind: "up", health });
      const catalog = await fetchModels().catch(() => null);
      if (catalog?.models) setModels(catalog.models);
    } catch (err) {
      setProbe({ kind: "down", message: explainNetworkError(err) });
    }
  }, []);

  // Waits for the first effect to resolve the base URL, so mounting fires one
  // probe rather than two.
  useEffect(() => {
    if (!savedBase) return;
    void check();
  }, [check, savedBase]);

  const applyBase = () => {
    const next = base.trim().replace(/\/$/, "");
    setApiBaseOverride(next === defaultApiBase() || !next ? null : next);
    setSavedBase(apiBase());
    setBase(apiBase());
  };

  const resetBase = () => {
    setApiBaseOverride(null);
    setBase(defaultApiBase());
    setSavedBase(defaultApiBase());
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Settings"
        description="Connection, model defaults and how much this browser is allowed to remember."
      />

      <div className="mt-8 space-y-6">
        <Panel>
          <PanelHeader
            title="Backend connection"
            meta="TraceCI's frontend is stateless; every investigation runs against this API."
            actions={
              probe.kind === "up" ? (
                <Badge tone="ok" dot>
                  Reachable
                </Badge>
              ) : probe.kind === "down" ? (
                <Badge tone="danger" dot>
                  Unreachable
                </Badge>
              ) : (
                <Badge tone="neutral" dot pulse>
                  Checking
                </Badge>
              )
            }
          />
          <PanelBody className="space-y-4">
            <TextInput
              label="API base URL"
              mono
              value={base}
              onChange={(e) => setBase(e.target.value)}
              placeholder={defaultApiBase()}
              spellCheck={false}
              hint={
                savedBase === defaultApiBase()
                  ? "Using the URL this frontend was built with."
                  : `Overriding the built-in value (${defaultApiBase()}) for this browser only.`
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={applyBase} disabled={base.trim() === savedBase}>
                Save and re-check
              </Button>
              <Button onClick={() => void check()}>
                {probe.kind === "checking" ? <Spinner /> : null}
                Re-check now
              </Button>
              {savedBase !== defaultApiBase() ? (
                <Button variant="ghost" onClick={resetBase}>
                  Reset to default
                </Button>
              ) : null}
            </div>

            {probe.kind === "down" ? (
              <ErrorState
                title="No response from the API"
                message={
                  <>
                    <p>{probe.message}</p>
                    <p className="mt-2 text-fg-subtle">
                      If the backend is running, the usual cause is CORS: this origin has to be
                      listed in <code className="font-mono text-fg-muted">ALLOWED_ORIGINS</code> on
                      the server.
                    </p>
                  </>
                }
              />
            ) : null}

            {probe.kind === "up" ? (
              <dl className="rounded-md border border-line bg-canvas px-3 py-1">
                <DataRow label="Version" value={probe.health.version} mono />
                <DataRow
                  label="GitHub token"
                  value={
                    probe.health.github_token ? (
                      <Badge tone="ok">Configured</Badge>
                    ) : (
                      <Badge tone="warn">Not configured</Badge>
                    )
                  }
                />
                <DataRow label="Models available" value={String(models.length || "—")} mono />
              </dl>
            ) : probe.kind === "checking" ? (
              <Skeleton className="h-24 w-full" />
            ) : null}

            {probe.kind === "up" && !probe.health.github_token ? (
              <Callout tone="warn" title="Public repositories only">
                Without a server-side GitHub token, the API is limited to public repositories and
                to GitHub&apos;s unauthenticated rate limit, which one investigation can exhaust.
              </Callout>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Defaults"
            meta="Prefilled the next time you open the workspace."
          />
          <PanelBody className="space-y-4">
            {!loaded ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <>
                <Select
                  label="Default model"
                  value={prefs.model}
                  onChange={(e) => setPrefs({ model: e.target.value })}
                  hint="Only models known to support tool calling are offered. A model that cannot call tools fails silently rather than loudly."
                >
                  <option value="">Use the backend default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextInput
                    label="Default repository"
                    mono
                    value={prefs.lastRepo}
                    onChange={(e) => setPrefs({ lastRepo: e.target.value })}
                    placeholder="owner/repo"
                    spellCheck={false}
                  />
                  <TextInput
                    label="Default branch"
                    mono
                    value={prefs.lastBranch}
                    onChange={(e) => setPrefs({ lastBranch: e.target.value })}
                    placeholder="optional"
                    spellCheck={false}
                  />
                </div>
              </>
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="API key handling" meta="Your key is never sent anywhere but the TraceCI API." />
          <PanelBody className="space-y-4">
            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                Retention
              </p>
              <SegmentedControl<KeyRetention>
                ariaLabel="API key retention"
                value={prefs.keyRetention}
                onChange={(next) => {
                  setPrefs({ keyRetention: next });
                  if (next === "memory") forgetKey();
                }}
                options={[
                  { value: "memory", label: "This tab only" },
                  { value: "session", label: "Until the tab closes" },
                ]}
              />
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-subtle">
                {prefs.keyRetention === "memory"
                  ? "The key lives in memory and disappears on reload. Safest, and the default."
                  : "The key is kept in sessionStorage so a reload does not lose it. It is still gone when the tab closes, and never written to localStorage."}
              </p>
            </div>
            <Button variant="ghost" onClick={forgetKey}>
              Forget the stored key now
            </Button>
            <Callout tone="neutral">
              On the server the key is passed as a constructor argument to the model client and
              lives in the run config under a name the checkpointer refuses to persist. It is not
              in graph state, not in checkpoint metadata, and not in a shared record.
            </Callout>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Local data" meta={`${records.length} investigation${records.length === 1 ? "" : "s"} stored in this browser.`} />
          <PanelBody className="space-y-3">
            <p className="text-[13px] leading-relaxed text-fg-muted">
              TraceCI stores your investigation list, preferences and theme in this browser. There
              are no accounts and nothing is synced.
            </p>
            <Button variant="danger" onClick={clearHistory} disabled={records.length === 0}>
              Clear investigation history
            </Button>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
