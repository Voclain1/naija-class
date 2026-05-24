"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useMatrixDirty } from "@/components/settings/academic/matrix-dirty-context";
import { cn } from "@/lib/utils";

// Slice 3 added Class Arms, Subjects, and Class-Subject Matrix tabs.
// Order follows the first-time-setup cognitive flow:
//   calendar → buckets → groupings → catalogue → mapping.
const TABS = [
  { href: "/settings/academic/years", label: "Years" },
  { href: "/settings/academic/class-levels", label: "Class Levels" },
  { href: "/settings/academic/class-arms", label: "Class Arms" },
  { href: "/settings/academic/subjects", label: "Subjects" },
  { href: "/settings/academic/class-subjects", label: "Matrix" },
] as const;

export function AcademicSubNav() {
  const pathname = usePathname() ?? "";
  // The matrix page provides the dirty signal via context. Other pages
  // see the default (false) and the confirm guard is a no-op there.
  const matrixDirty = useMatrixDirty();

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
            onClick={(e) => {
              if (active) return;
              if (
                matrixDirty &&
                !window.confirm(
                  "The matrix has unsaved changes. Discard them and leave this tab?",
                )
              ) {
                e.preventDefault();
              }
            }}
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
