import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Numbered procedure. Used where order genuinely matters. */
export function Steps({ children }: { children: ReactNode }) {
  // `list-none pl-0` because this renders inside `.doc-body`, whose default
  // `ol` styling would otherwise add a second set of numbers next to ours.
  return <ol className="my-6 list-none space-y-4 border-l border-line pl-0">{children}</ol>;
}

export function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4 pl-0">
      <span className="-ml-3 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-strong bg-surface font-mono text-2xs tabular-nums text-fg-muted">
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[15px] font-semibold tracking-tight text-fg">{title}</p>
        <div className="mt-1.5 space-y-3 text-[14.5px] leading-relaxed text-fg-muted">
          {children}
        </div>
      </div>
    </li>
  );
}

/** Terse two-column reference used for tools, categories and error causes. */
export function DefTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: [ReactNode, ReactNode][];
}) {
  return (
    <div className="my-6 overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr>
            <th className="w-1/3 border-b border-line-strong pb-2 pr-4 text-left text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
              {head[0]}
            </th>
            <th className="border-b border-line-strong pb-2 text-left text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="border-b border-line py-2.5 pr-4 align-top text-fg">{row[0]}</td>
              <td className="border-b border-line py-2.5 align-top leading-relaxed text-fg-muted">
                {row[1]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A short list of "read this next" links at the end of a concept page. */
export function NextReads({
  items,
}: {
  items: { href: string; title: string; note: string }[];
}) {
  return (
    <div className="mt-10 grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-md border border-line bg-surface p-3.5 transition-colors hover:border-line-strong"
        >
          <p className="text-[13.5px] font-medium text-fg">{item.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-fg-subtle">{item.note}</p>
        </Link>
      ))}
    </div>
  );
}

/** Verbatim terminal or log excerpt inside prose. */
export function Sample({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure
      className={cn(
        "my-6 overflow-hidden rounded-md border border-line bg-canvas",
        className
      )}
    >
      {title ? (
        <figcaption className="border-b border-line bg-elevated px-3 py-1.5 font-mono text-2xs text-fg-subtle">
          {title}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-[1.65] text-fg-muted">
        {children}
      </pre>
    </figure>
  );
}
