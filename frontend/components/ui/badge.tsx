import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { categoryMeta } from "@/lib/types";

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "violet" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-line-strong/70 bg-elevated text-fg-muted",
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  danger: "border-danger/30 bg-danger/10 text-danger",
  info: "border-info/30 bg-info/10 text-info",
  violet: "border-violet/30 bg-violet/10 text-violet",
  accent: "border-accent/30 bg-accent/10 text-accent",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-fg-subtle",
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  violet: "bg-violet",
  accent: "bg-accent",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
  pulse = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  pulse?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-2xs font-medium",
        TONES[tone],
        className
      )}
    >
      {dot ? (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone], pulse && "animate-pulse")}
        />
      ) : null}
      {children}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string }) {
  const meta = categoryMeta(category);
  return <Badge tone={meta.tone as Tone}>{meta.label}</Badge>;
}

/**
 * Confidence is the model's own 1-10 score. Rendering it as ten discrete
 * ticks rather than a percentage keeps it honest -- it is a coarse judgement,
 * and a bar labelled "90%" would imply a precision that does not exist.
 */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const safe = Math.max(0, Math.min(10, Math.round(value)));
  const tone = safe >= 8 ? "bg-ok" : safe >= 5 ? "bg-warn" : "bg-danger";
  const verdict = safe >= 8 ? "evidence-backed" : safe >= 5 ? "partly inferred" : "largely inferred";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-2xs uppercase tracking-[0.09em] text-fg-subtle">Confidence</span>
      <div
        className="flex gap-[3px]"
        role="meter"
        aria-valuenow={safe}
        aria-valuemin={1}
        aria-valuemax={10}
        aria-label={`Confidence ${safe} of 10, ${verdict}`}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            className={cn("h-3 w-1 rounded-[1px]", i < safe ? tone : "bg-line-strong/60")}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-fg-muted">{safe}/10</span>
    </div>
  );
}
