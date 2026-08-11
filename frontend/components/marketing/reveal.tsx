"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveal-on-scroll.
 *
 * The hidden state is applied by JavaScript, not by the server, so a reader
 * with scripting disabled gets the whole page rather than a blank column. The
 * motion is one short translate and a fade -- enough to give a section a
 * moment of arrival, not enough to make scrolling feel like work.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "shown">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("shown");
      return;
    }

    // Already in view on load (the hero, mostly): reveal on the next tick
    // rather than waiting for a scroll that may never come.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      setState("pending");
      const id = window.setTimeout(() => setState("shown"), delay + 24);
      return () => window.clearTimeout(id);
    }

    setState("pending");
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          timer = window.setTimeout(() => setState("shown"), delay);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, [delay]);

  return (
    <div ref={ref} data-reveal={state === "idle" ? undefined : state} className={className}>
      {children}
    </div>
  );
}
