import { cn } from "@/lib/cn";

/**
 * The mark: a signal running flat, spiking, and settling — inside the square
 * of a CI job. Drawn rather than imported so it inherits `currentColor` and
 * needs no asset pipeline.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className={cn("h-[22px] w-[22px]", className)}>
      <path
        d="M6 6 H42 V42 H6 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="M6 30 H16 L21 18 L27 36 L31 27 H42"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5 text-fg", className)}>
      <Mark />
      <span className="font-mono text-[15px] font-semibold tracking-[-0.01em]">TraceCI</span>
    </span>
  );
}
