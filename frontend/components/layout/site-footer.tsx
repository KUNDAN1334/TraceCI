import Link from "next/link";

const LINKS: { heading: string; items: { href: string; label: string }[] }[] = [
  {
    heading: "Product",
    items: [
      { href: "/investigate", label: "Investigation workspace" },
      { href: "/investigations", label: "Past investigations" },
      { href: "/settings", label: "Settings" },
    ],
  },
  {
    heading: "Learn",
    items: [
      { href: "/docs/quickstart", label: "First investigation" },
      { href: "/docs/concepts/investigation", label: "How an investigation runs" },
      { href: "/docs/guides/reading-an-investigation", label: "Reading a result" },
    ],
  },
  {
    heading: "Reference",
    items: [
      { href: "/docs/troubleshooting", label: "Troubleshooting" },
      { href: "/docs/limitations", label: "Limitations" },
      { href: "/docs/faq", label: "FAQ" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto max-w-shell px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="max-w-xs">
            <p className="text-[13px] font-semibold tracking-tight text-fg">TraceCI</p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-subtle">
              Reads a failed GitHub Actions run and traces it back to the change that broke it.
              Read-only, bring-your-own-key, no write access to your repository.
            </p>
          </div>
          {LINKS.map((group) => (
            <div key={group.heading}>
              <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                {group.heading}
              </p>
              <ul className="mt-3 space-y-2">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-[13px] text-fg-muted transition-colors hover:text-fg"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-fg-subtle">
          Your API key is sent with a single request, is never written to graph state or the
          checkpoint database, and is not returned by a shared investigation link.
        </p>
      </div>
    </footer>
  );
}
