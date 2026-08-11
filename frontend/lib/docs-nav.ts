export type DocLink = { href: string; title: string; summary: string };
export type DocGroup = { heading: string; items: DocLink[] };

/**
 * The documentation IA. One flat source of truth: it drives the sidebar, the
 * filter, the previous/next footer and the index page, so a page can never be
 * added to one and missed from another.
 */
export const DOCS_NAV: DocGroup[] = [
  {
    heading: "Start here",
    items: [
      {
        href: "/docs",
        title: "What TraceCI is",
        summary: "The problem it solves, what it does, and what it deliberately does not do.",
      },
      {
        href: "/docs/quickstart",
        title: "Your first investigation",
        summary: "Run one end to end and understand what you are looking at.",
      },
    ],
  },
  {
    heading: "Core concepts",
    items: [
      {
        href: "/docs/concepts/failure-context",
        title: "Failure context",
        summary: "Run, job, failing step, log window and the green-to-red diff.",
      },
      {
        href: "/docs/concepts/investigation",
        title: "The investigation loop",
        summary: "Four phases, a six-call budget, and how a run terminates.",
      },
      {
        href: "/docs/concepts/tools",
        title: "The agent's tools",
        summary: "Five read-only tools, and when calling one is the wrong move.",
      },
      {
        href: "/docs/concepts/evidence",
        title: "Evidence and confidence",
        summary: "What counts as evidence, and what a confidence score is claiming.",
      },
      {
        href: "/docs/concepts/root-cause",
        title: "Root cause and categories",
        summary: "Why failures are classified by cause rather than by failing step.",
      },
    ],
  },
  {
    heading: "Guides",
    items: [
      {
        href: "/docs/guides/reading-an-investigation",
        title: "Reading an investigation",
        summary: "Work through a real result and learn to spot a weak one.",
      },
      {
        href: "/docs/guides/scenarios",
        title: "Failure scenarios",
        summary: "How TraceCI behaves on the six kinds of CI failure.",
      },
      {
        href: "/docs/guides/best-practices",
        title: "Best practices",
        summary: "Habits that make investigations faster and more accurate.",
      },
    ],
  },
  {
    heading: "Operating TraceCI",
    items: [
      {
        href: "/docs/models",
        title: "Models and keys",
        summary: "Choosing a model, token budgets, and how your key is handled.",
      },
      {
        href: "/docs/troubleshooting",
        title: "Troubleshooting",
        summary: "Every error TraceCI can show you, and what to do about it.",
      },
      {
        href: "/docs/limitations",
        title: "Limitations",
        summary: "Where TraceCI is unreliable, and where it will not help at all.",
      },
      {
        href: "/docs/faq",
        title: "FAQ",
        summary: "Short answers to the questions that come up first.",
      },
    ],
  },
];

export const DOC_ORDER: DocLink[] = DOCS_NAV.flatMap((group) => group.items);

export function docNeighbours(pathname: string) {
  const index = DOC_ORDER.findIndex((item) => item.href === pathname);
  return {
    previous: index > 0 ? DOC_ORDER[index - 1] : null,
    next: index >= 0 && index < DOC_ORDER.length - 1 ? DOC_ORDER[index + 1] : null,
  };
}
