"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { LibraryCopyStatus, LibraryLoanDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";

// Phase 9 / CP6.1 — pieces every library page shares (docs/modules/phase-9.md §14).

export function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

/** "17 Oct 2026" for a YYYY-MM-DD date. */
export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00.000Z`),
  );
}

export const COPY_STATUS_LABEL: Record<LibraryCopyStatus, string> = {
  AVAILABLE: "On the shelf",
  ON_LOAN: "On loan",
  LOST: "Lost",
  WITHDRAWN: "Withdrawn",
};

/** Due date in words, with "overdue" said, not only coloured. */
export function dueText(loan: LibraryLoanDto): string {
  if (loan.returnedAt) return `Returned ${formatDay(loan.returnedAt)}`;
  if (loan.overdue) return `Overdue by ${loan.daysLate} ${loan.daysLate === 1 ? "day" : "days"} (due ${formatDay(loan.dueOn)})`;
  return `Due ${formatDay(loan.dueOn)}`;
}

export function LibraryNav() {
  const pathname = usePathname();
  const { permissions } = useAuth();
  const links = [
    { href: "/library", label: "Catalogue", match: (p: string) => p === "/library" || p.startsWith("/library/books") },
    ...(hasPermission(permissions, "library.lend") ? [{ href: "/library/desk", label: "Lending desk", match: (p: string) => p.startsWith("/library/desk") }] : []),
    { href: "/library/loans", label: "Loans", match: (p: string) => p.startsWith("/library/loans") },
    ...(hasPermission(permissions, "library.resource.read") ? [{ href: "/library/resources", label: "Resources", match: (p: string) => p.startsWith("/library/resources") }] : []),
    ...(hasPermission(permissions, "library.settings") ? [{ href: "/library/settings", label: "Rules", match: (p: string) => p.startsWith("/library/settings") }] : []),
  ];
  return (
    <nav aria-label="Library" className="flex flex-wrap gap-1 border-b pb-2">
      {links.map((l) => {
        const active = l.match(pathname ?? "");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function LibraryHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      <LibraryNav />
    </div>
  );
}
