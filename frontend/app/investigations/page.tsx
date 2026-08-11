"use client";

import { useMemo, useState } from "react";
import { RecordCard } from "@/components/investigation/record-card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState, Skeleton } from "@/components/ui/feedback";
import { SegmentedControl } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/panel";
import { clearHistory, useHistory } from "@/lib/history";

type Filter = "all" | "diagnosed" | "unresolved";

export default function InvestigationsPage() {
  const { records, loading } = useHistory();
  const [filter, setFilter] = useState<Filter>("all");
  const [confirming, setConfirming] = useState(false);

  const visible = useMemo(() => {
    if (filter === "diagnosed") return records.filter((r) => r.status === "complete");
    if (filter === "unresolved") return records.filter((r) => r.status !== "complete");
    return records;
  }, [records, filter]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Investigations"
        description="Every run this browser has started. Diagnosed runs stay on the server too and can be reopened by id."
        actions={
          <>
            {records.length ? (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Clear history
              </Button>
            ) : null}
            <ButtonLink href="/investigate" variant="primary">
              New investigation
            </ButtonLink>
          </>
        }
      />

      {confirming ? (
        <Callout tone="warn" className="mt-6" title="Clear local history?">
          <p>
            This removes the list from this browser. Diagnosed runs remain on the server and stay
            reachable by their thread id.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                clearHistory();
                setConfirming(false);
              }}
            >
              Clear
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </Callout>
      ) : null}

      {records.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <SegmentedControl
            ariaLabel="Filter investigations"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: `All (${records.length})` },
              {
                value: "diagnosed",
                label: `Diagnosed (${records.filter((r) => r.status === "complete").length})`,
              },
              {
                value: "unresolved",
                label: `Unresolved (${records.filter((r) => r.status !== "complete").length})`,
              },
            ]}
          />
        </div>
      ) : null}

      <div className="mt-5">
        {loading ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : records.length === 0 ? (
          <EmptyState
            title="No investigations yet"
            description="Run one against a repository with a failed GitHub Actions run, or replay a recorded investigation to see what a finished result looks like."
            action={
              <>
                <ButtonLink href="/investigate" variant="primary" size="sm">
                  Start an investigation
                </ButtonLink>
                <ButtonLink href="/investigate#replay" size="sm">
                  Replay a recorded run
                </ButtonLink>
              </>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="Nothing matches this filter"
            description="Switch back to All to see every run."
            action={
              <Button size="sm" onClick={() => setFilter("all")}>
                Show all
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {visible.map((record) => (
              <RecordCard key={record.id} record={record} />
            ))}
          </ul>
        )}
      </div>

      {records.length > 0 ? (
        <p className="mt-6 text-[12.5px] leading-relaxed text-fg-subtle">
          This list is stored in your browser, not on the server — there are no accounts, and a
          shared index would expose everyone&apos;s repositories to everyone else. The most recent
          25 runs are kept.
        </p>
      ) : null}
    </div>
  );
}
