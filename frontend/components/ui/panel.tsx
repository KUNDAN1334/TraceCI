import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-line bg-surface shadow-panel", className)}
      {...rest}
    />
  );
}

export function PanelHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {meta ? <p className="mt-0.5 text-xs text-fg-subtle">{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...rest} />;
}

/** The small uppercase rubric used above every group of content. */
export function SectionLabel({
  children,
  className,
  as: Tag = "h3",
}: {
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3" | "h4" | "div";
}) {
  return (
    <Tag
      className={cn(
        "text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle",
        className
      )}
    >
      {children}
    </Tag>
  );
}

/** Page-level heading block, shared by every route so the rhythm matches. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <SectionLabel className="mb-2">{eyebrow}</SectionLabel> : null}
        <h1 className="display-lg text-balance">{title}</h1>
        {description ? (
          <p className="mt-3 text-pretty text-[15.5px] leading-relaxed text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function DataRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2 last:border-0">
      <dt className="shrink-0 text-xs text-fg-subtle">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right text-[13px] text-fg",
          mono && "font-mono text-xs"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
