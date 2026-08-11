"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { DOCS_NAV } from "@/lib/docs-nav";

export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() || "/docs";
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOCS_NAV;
    return DOCS_NAV.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.href.toLowerCase().includes(q)
      ),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="docs-filter" className="sr-only">
          Filter documentation
        </label>
        <input
          id="docs-filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter pages"
          type="search"
          className="h-8 w-full rounded-md border border-line bg-canvas px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle/70 focus:border-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-[13px] text-fg-subtle">No page matches “{query}”.</p>
      ) : (
        <nav aria-label="Documentation">
          {groups.map((group) => (
            <div key={group.heading} className="mb-5">
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                {group.heading}
              </p>
              <ul className="space-y-px border-l border-line">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "-ml-px block border-l py-1.5 pl-3 text-[13px] transition-colors",
                          active
                            ? "border-accent font-medium text-fg"
                            : "border-transparent text-fg-muted hover:border-line-strong hover:text-fg"
                        )}
                      >
                        {item.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}

/** Disclosure wrapper so the sidebar does not eat the whole screen on mobile. */
export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-[13px] font-medium text-fg"
      >
        Documentation menu
        <span aria-hidden className={cn("text-fg-subtle transition-transform", open && "rotate-90")}>
          ▸
        </span>
      </button>
      {open ? (
        <div className="animate-fade mt-3 rounded-md border border-line bg-surface p-4">
          <DocsSidebar onNavigate={() => setOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
