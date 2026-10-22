import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "KG Practice",
    template: "%s · KG Practice",
  },
  description: "Offline practice, timed sessions and performance analytics for your KnowledgeGate question bank.",
};

const themeScript = `
try {
  const stored = localStorage.getItem("kg-theme");
  if (stored === "light") document.documentElement.classList.remove("dark");
  if (stored === "dark") document.documentElement.classList.add("dark");
} catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
