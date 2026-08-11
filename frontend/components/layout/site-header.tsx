"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Wordmark } from "./logo";
import { ThemeToggle } from "./theme-toggle";

// "Investigate" is deliberately absent: the primary button beside this nav
// already goes there, and a nav item plus a button for the same destination is
// the repetition this design is trying to avoid.
const NAV = [
  { href: "/", label: "Overview", exact: true },
  { href: "/investigations", label: "Investigations" },
  { href: "/docs", label: "Docs" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);

  // A menu that survives navigation is a menu that covers the page you just
  // asked for.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/80 backdrop-blur-[14px]">
      <div className="mx-auto flex h-16 max-w-shell items-center gap-8 px-6 lg:px-8">
        <Link href="/" className="shrink-0 rounded" aria-label="TraceCI home">
          <Wordmark />
        </Link>

        <nav aria-label="Primary" className="hidden md:flex md:items-center md:gap-6">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href, item.exact) ? "page" : undefined}
              className={cn(
                "text-[14px] transition-colors",
                isActive(pathname, item.href, item.exact)
                  ? "font-medium text-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/investigate"
            className="inline-flex rounded-md bg-fg px-3 py-2 text-[13px] font-medium text-canvas transition-opacity hover:opacity-90 sm:px-4 sm:text-[14px]"
          >
            Investigate
          </Link>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-8 w-8 place-items-center rounded-md border border-line text-fg-subtle transition-colors hover:text-fg md:hidden"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
              {open ? (
                <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="animate-fade border-t border-line bg-canvas px-4 py-2 md:hidden"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(pathname, item.href, item.exact) ? "page" : undefined}
              className={cn(
                "block rounded px-2 py-2.5 text-sm font-medium",
                isActive(pathname, item.href, item.exact)
                  ? "bg-elevated text-fg"
                  : "text-fg-muted hover:text-fg"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}
