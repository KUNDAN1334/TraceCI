"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { docNeighbours } from "@/lib/docs-nav";

/**
 * Shared page chrome for every documentation page: title block, a table of
 * contents derived from the rendered headings, and previous/next links driven
 * by the nav order. Deriving the contents from the DOM rather than from a
 * hand-written list means it can never disagree with the page.
 */
export function DocPage({
  title,
  lede,
  chips,
  children,
}: {
  title: string;
  lede: string;
  /** Short factual qualifiers shown under the title, e.g. "read-only". */
  chips?: string[];
  children: ReactNode;
}) {
  const pathname = usePathname() || "";
  const { previous, next } = docNeighbours(pathname);

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_200px]">
      <article className="min-w-0">
        <header className="border-b border-line pb-7">
          <h1 className="display-lg text-balance">{title}</h1>
          <p className="mt-3 max-w-prose text-pretty text-[16px] leading-[1.6] text-fg-muted">
            {lede}
          </p>
          {chips?.length ? (
            <ul className="mt-5 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li
                  key={chip}
                  className="rounded border border-line bg-elevated px-2.5 py-1 font-mono text-[11.5px] text-fg-muted"
                >
                  {chip}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <div id="doc-content" className="doc-body pt-8">
          {children}
        </div>

        {previous || next ? (
          <nav
            aria-label="Documentation pages"
            className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2"
          >
            {previous ? (
              <Link
                href={previous.href}
                className="rounded-md border border-line bg-surface p-3 transition-colors hover:border-line-strong"
              >
                <span className="text-2xs uppercase tracking-[0.09em] text-fg-subtle">
                  Previous
                </span>
                <span className="mt-1 block text-[13px] font-medium text-fg">{previous.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                href={next.href}
                className="rounded-md border border-line bg-surface p-3 text-right transition-colors hover:border-line-strong sm:col-start-2"
              >
                <span className="text-2xs uppercase tracking-[0.09em] text-fg-subtle">Next</span>
                <span className="mt-1 block text-[13px] font-medium text-fg">{next.title}</span>
              </Link>
            ) : null}
          </nav>
        ) : null}
      </article>

      <TableOfContents key={pathname} />
    </div>
  );
}

function TableOfContents() {
  const [headings, setHeadings] = useState<{ id: string; text: string }[]>([]);
  const [active, setActive] = useState("");

  useEffect(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLHeadingElement>("#doc-content h2[id]")
    );
    setHeadings(nodes.map((n) => ({ id: n.id, text: n.textContent || "" })));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  if (headings.length < 2) return <div className="hidden xl:block" />;

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-20">
        <p className="mb-2 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
          On this page
        </p>
        <ul className="space-y-1 border-l border-line">
          {headings.map((h) => (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                className={cn(
                  "-ml-px block border-l py-1 pl-3 text-[12.5px] leading-snug transition-colors",
                  active === h.id
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg"
                )}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
