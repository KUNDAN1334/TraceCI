import type { Metadata } from "next";
import { DocsMobileNav, DocsSidebar } from "@/components/docs/docs-sidebar";

export const metadata: Metadata = {
  title: { default: "Documentation", template: "%s · TraceCI docs" },
  description:
    "How TraceCI investigates a failed CI run: concepts, workflows, reading a result, troubleshooting and limitations.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-shell px-4 py-8 sm:px-6">
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <aside className="mb-8 lg:mb-0">
          <DocsMobileNav />
          <div className="hidden lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-8">
            <DocsSidebar />
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
