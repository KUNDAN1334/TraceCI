"use client";

import Link from "next/link";
import { Badge, CategoryBadge, ConfidenceMeter } from "@/components/ui/badge";
import { DiffBlock, EvidenceList } from "@/components/ui/code";
import { Skeleton } from "@/components/ui/feedback";
import { Panel, SectionLabel } from "@/components/ui/panel";
import { categoryMeta, isInconclusive, type Diagnosis } from "@/lib/types";

/**
 * The answer, in the order a developer needs it:
 *   what kind of failure -> what broke -> why we believe that -> what to do.
 *
 * Evidence sits above the fix on purpose. A suggested patch read before the
 * evidence is a suggestion you have to trust; read after, it is one you can
 * check.
 */
export function DiagnosisPanel({ diagnosis }: { diagnosis: Diagnosis }) {
  if (isInconclusive(diagnosis)) return <NoCausePanel diagnosis={diagnosis} />;
  return <RootCausePanel diagnosis={diagnosis} />;
}

/**
 * The honest empty result.
 *
 * Rendered by a separate component rather than by hiding fields in the normal
 * one, because the difference has to be structural: no "Root cause" heading,
 * no "Suggested fix", no confidence meter implying a measured judgement. What
 * it shows instead is what was checked, the log lines that contain no error,
 * and the two actions that actually move the user forward.
 */
function NoCausePanel({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <Panel className="animate-rise overflow-hidden">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
        <Badge tone="neutral" dot>
          No cause found
        </Badge>
        <span className="text-xs text-fg-subtle">
          TraceCI stopped rather than guess
        </span>
      </div>

      <div className="space-y-5 px-4 py-5">
        <p className="text-[15px] leading-relaxed text-fg">{diagnosis.root_cause}</p>

        {diagnosis.evidence?.length ? (
          <section>
            <SectionLabel className="mb-2">What the failing step logged</SectionLabel>
            <EvidenceList items={diagnosis.evidence} />
          </section>
        ) : null}

        <section>
          <SectionLabel className="mb-2">What to try</SectionLabel>
          <ul className="space-y-2 text-[13.5px] leading-relaxed text-fg-muted">
            <li>
              If you had a specific red run in mind, paste its URL into the repository field —
              that pins the investigation to that run instead of the most recent failure.
            </li>
            <li>
              Naming a branch narrows the search when several are red at once.
            </li>
            <li>
              Bot-raised runs (Dependabot and similar) are skipped automatically because their
              logs describe infrastructure rather than a change in your code.
            </li>
          </ul>
        </section>
      </div>

      <p className="border-t border-line bg-elevated px-4 py-3 text-[12.5px] leading-relaxed text-fg-subtle">
        A suggested fix is deliberately absent. Proposing one for a cause that was never
        identified is the most expensive kind of wrong answer.{" "}
        <Link href="/docs/limitations" className="text-fg underline-offset-2 hover:underline">
          Read the limitations →
        </Link>
      </p>
    </Panel>
  );
}

function RootCausePanel({ diagnosis }: { diagnosis: Diagnosis }) {
  const meta = categoryMeta(diagnosis.category);
  const weak = diagnosis.confidence < 5;

  return (
    <Panel className="animate-rise overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CategoryBadge category={diagnosis.category} />
          <span className="text-xs text-fg-subtle">{meta.blurb}</span>
        </div>
        <ConfidenceMeter value={diagnosis.confidence} />
      </div>

      <div className="space-y-6 px-4 py-5">
        <section>
          <SectionLabel className="mb-2">Root cause</SectionLabel>
          <p className="text-[15px] leading-relaxed text-fg">{diagnosis.root_cause}</p>
          {weak ? (
            <p className="mt-2 rounded border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
              Confidence below 5 means the agent inferred more than it read. Check the evidence
              before acting on this.
            </p>
          ) : null}
        </section>

        <section>
          <SectionLabel className="mb-2">Evidence</SectionLabel>
          <p className="mb-2 text-[12.5px] text-fg-subtle">
            Quoted verbatim from the failing log and the source at the failing commit.
          </p>
          <EvidenceList items={diagnosis.evidence} />
        </section>

        <section>
          <SectionLabel className="mb-2">Suggested fix</SectionLabel>
          <p className="text-sm leading-relaxed text-fg">{diagnosis.suggested_fix}</p>
        </section>

        {diagnosis.fix_snippet ? (
          <section>
            <SectionLabel className="mb-2">Patch</SectionLabel>
            <DiffBlock patch={diagnosis.fix_snippet} />
          </section>
        ) : null}
      </div>

      <p className="border-t border-line bg-elevated px-4 py-3 text-[12.5px] leading-relaxed text-fg-subtle">
        Not applied, not run, not tested — TraceCI is read-only.{" "}
        <Link href="/docs/limitations" className="text-fg underline-offset-2 hover:underline">
          Why that is deliberate →
        </Link>
      </p>
    </Panel>
  );
}

/** What sits in the findings column while the agent is still working. */
export function DiagnosisPending() {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-5 px-4 py-5">
        <div className="space-y-2">
          <SectionLabel>Root cause</SectionLabel>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[92%]" />
          <Skeleton className="h-4 w-[64%]" />
        </div>
        <div className="space-y-2">
          <SectionLabel>Evidence</SectionLabel>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
        <p className="text-[12.5px] leading-relaxed text-fg-subtle">
          The diagnosis is written once, at the end, from everything the agent collected. It will
          appear here complete rather than assembling itself line by line.
        </p>
      </div>
    </Panel>
  );
}
