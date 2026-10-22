import { Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { DesktopNav, MobileNav } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-card/70 px-4 py-5 backdrop-blur lg:flex">
        <Link href="/" className="flex items-center gap-3 px-2">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20">
            KG
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight">KG Practice</span>
            <span className="block text-[11px] text-muted-foreground">Offline question bank</span>
          </span>
        </Link>

        <div className="mt-8 flex-1">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Workspace
          </p>
          <DesktopNav />
        </div>

        <div className="rounded-2xl border border-border bg-background/60 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <Sparkles className="size-3.5 text-primary" />
            Built for deliberate practice
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            Attempts, keys and timings are stored in your local SQLite file.
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">
            KG
          </span>
          <span className="text-sm font-semibold">KG Practice</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="pb-24 lg:pl-64 lg:pb-10">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>

      <div className="fixed right-4 top-4 z-30 hidden lg:block">
        <ThemeToggle />
      </div>

      <MobileNav />
    </div>
  );
}
