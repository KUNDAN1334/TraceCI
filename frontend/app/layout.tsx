import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceCI - diagnose a red CI build",
  description:
    "An agent that reads a failed GitHub Actions run, investigates the repo with read-only tools, and reports an evidence-backed root cause.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
