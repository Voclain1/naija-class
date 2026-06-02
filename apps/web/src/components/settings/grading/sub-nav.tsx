"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Sub-nav for /settings/grading/*. Phase 2 / Slice 1 ships two tabs: the
// component-weight scheme and the letter-grade boundaries. Later slices may add
// more grading config here.
const TABS = [
  { href: "/settings/grading", label: "Scheme", exact: true },
  { href: "/settings/grading/boundaries", label: "Boundaries", exact: false },
] as const;

export function GradingSubNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Grading settings sections" className="flex gap-1 border-b text-sm">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "px-3 py-2 border-b-2 -mb-px transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
