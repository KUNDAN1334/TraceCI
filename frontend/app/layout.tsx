import type { Metadata, Viewport } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TraceCI — diagnose a failed CI run",
    template: "%s · TraceCI",
  },
  description:
    "TraceCI reads a failed GitHub Actions run, investigates the repository with read-only tools, and reports a root cause with quoted evidence and a suggested fix.",
  applicationName: "TraceCI",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Loaded at runtime rather than through next/font so the build does
            not need network access. `display=swap` keeps first paint honest. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
        {/* Applies the stored theme before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-fg focus:px-3 focus:py-2 focus:text-sm focus:text-canvas"
        >
          Skip to content
        </a>
        <div className="flex min-h-screen flex-col">
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
