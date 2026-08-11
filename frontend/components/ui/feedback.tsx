import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./badge";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={cn("h-3.5 w-3.5 animate-spin text-current", className)}
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden rounded bg-elevated", className)}
    >
      <div className="absolute inset-y-0 -left-full w-1/2 animate-sweep bg-gradient-to-r from-transparent via-fg/[0.06] to-transparent" />
    </div>
  );
}

/**
 * Empty states carry the instruction, not just the absence. An empty state
 * that only says "nothing here" makes the user go looking for the button.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line-strong/70 px-6 py-14 text-center",
        className
      )}
    >
      {icon ? <div className="mb-3 text-fg-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-fg-subtle">{description}</p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something failed",
  message,
  action,
  className,
}: {
  title?: string;
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("rounded-lg border border-danger/35 bg-danger/[0.07] p-4", className)}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-danger/40 text-2xs font-bold text-danger"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          <div className="mt-1 text-[13px] leading-relaxed text-fg-muted">{message}</div>
          {action ? <div className="mt-3 flex flex-wrap gap-2">{action}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    neutral: "border-line-strong/70 bg-elevated/60",
    ok: "border-ok/30 bg-ok/[0.06]",
    warn: "border-warn/30 bg-warn/[0.06]",
    danger: "border-danger/30 bg-danger/[0.06]",
    info: "border-info/30 bg-info/[0.06]",
    violet: "border-violet/30 bg-violet/[0.06]",
    accent: "border-accent/30 bg-accent/[0.06]",
  };
  return (
    <div className={cn("rounded-md border p-3.5", border[tone], className)}>
      {title ? (
        <p className="mb-1 text-[13px] font-semibold tracking-tight text-fg">{title}</p>
      ) : null}
      <div className="text-[13px] leading-relaxed text-fg-muted [&_a]:text-accent [&_a:hover]:underline [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-fg">
        {children}
      </div>
    </div>
  );
}
