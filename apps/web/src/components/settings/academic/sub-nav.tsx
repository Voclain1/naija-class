"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/academic/years", label: "Years" },
  { href: "/settings/academic/class-levels", label: "Class Levels" },
] as const;

export function AcademicSubNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Academic settings sections"
      className="flex gap-1 border-b text-sm"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
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
