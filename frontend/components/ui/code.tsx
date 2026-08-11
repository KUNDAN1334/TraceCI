"use client";

import { useCallback, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded border border-line bg-elevated px-1 py-0.5 font-mono text-[0.85em] text-fg">
      {children}
    </code>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
  className,
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = useCallback(async () => {
    try {
      // clipboard is unavailable on http:// origins other than localhost, so
      // the failure path is real rather than defensive decoration.
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1800);
  }, [value]);

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={copy}
      className={cn("text-fg-subtle", className)}
      aria-live="polite"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}

export function CodeBlock({
  children,
  title,
  copyValue,
  className,
  maxHeight = "22rem",
}: {
  children: ReactNode;
  title?: ReactNode;
  copyValue?: string;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <figure className={cn("overflow-hidden rounded-md border border-line bg-canvas", className)}>
      {title || copyValue ? (
        <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-elevated px-3 py-1.5">
          <span className="truncate font-mono text-2xs text-fg-subtle">{title}</span>
          {copyValue ? <CopyButton value={copyValue} /> : null}
        </figcaption>
      ) : null}
      <pre
        className="overflow-auto p-3 font-mono text-[12.5px] leading-[1.65] text-fg-muted"
        style={{ maxHeight }}
      >
        {children}
      </pre>
    </figure>
  );
}

/**
 * Unified-diff renderer. It colours by leading character only -- no parser and
 * no syntax highlighting dependency, which is the right trade for a snippet
 * that is at most a dozen lines.
 */
export function DiffBlock({
  patch,
  title = "suggested patch",
  className,
}: {
  patch: string;
  title?: string;
  className?: string;
}) {
  const lines = patch.replace(/\n$/, "").split("\n");
  return (
    <figure className={cn("overflow-hidden rounded-md border border-line bg-canvas", className)}>
      <figcaption className="flex items-center justify-between gap-3 border-b border-line bg-elevated px-3 py-1.5">
        <span className="font-mono text-2xs text-fg-subtle">{title}</span>
        <CopyButton value={patch} label="Copy patch" />
      </figcaption>
      <div className="overflow-x-auto">
        <pre className="min-w-full py-2 font-mono text-[12.5px] leading-[1.7]">
          {lines.map((line, i) => {
            const added = line.startsWith("+");
            const removed = line.startsWith("-");
            const meta = line.startsWith("@@");
            return (
              <div
                key={i}
                className={cn(
                  "px-3",
                  added && "bg-ok/[0.09] text-ok",
                  removed && "bg-danger/[0.09] text-danger",
                  meta && "text-violet",
                  !added && !removed && !meta && "text-fg-muted"
                )}
              >
                {line || " "}
              </div>
            );
          })}
        </pre>
      </div>
    </figure>
  );
}

/**
 * Where an evidence line appears to have come from.
 *
 * Read off the quotation itself and nothing else. If the line carries a
 * `path:line` reference the agent quoted a file; otherwise it is treated as a
 * log line and labelled as such. Inventing a more precise provenance than the
 * quote supports would undermine the one field whose value is that it was not
 * paraphrased.
 */
function evidenceSource(line: string): string {
  const fileRef = /(^|\s)([\w./-]+\.[A-Za-z]\w*):(\d+)/.exec(line);
  if (fileRef) {
    const file = fileRef[2].split("/").pop() ?? fileRef[2];
    return `${file}:${fileRef[3]}`;
  }
  return "log";
}

/**
 * Evidence lines are quoted verbatim from a log or a source file. They are
 * rendered as quotations, not as prose, because the whole point of the field
 * is that the agent did not paraphrase.
 */
export function EvidenceList({ items }: { items: string[] }) {
  if (!items?.length) {
    return (
      <p className="text-[13px] text-fg-subtle">
        No evidence lines were returned. Treat the root cause as unsupported.
      </p>
    );
  }
  return (
    <ul className="list-none space-y-2 pl-0">
      {items.map((item, i) => (
        <li key={i} className="rounded-r border-l-2 border-line-strong bg-canvas py-2 pl-3 pr-3">
          <span className="mb-1 block font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">
            {evidenceSource(item)}
          </span>
          <span className="block overflow-x-auto whitespace-pre font-mono text-[12.5px] leading-relaxed text-fg-muted">
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}
