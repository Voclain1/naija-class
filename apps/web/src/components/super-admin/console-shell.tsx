"use client";

import {
  History,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Rocket,
  ScanLine,
  School,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";
import { withBasePath } from "@/lib/base-path";
import { cn } from "@/lib/utils";

// The platform admin's console (docs/modules/platform-admin.md, 2026-10-30
// redesign): one page per job instead of one long page of cards. Every page
// sits under /super-admin/dashboard so the middleware's platform-session gate
// covers all of them.

export const CONSOLE_NAV = [
  { href: "/super-admin/dashboard", label: "Overview", icon: LayoutDashboard },
  {
    href: "/super-admin/dashboard/getting-started",
    label: "Getting started",
    icon: Rocket,
  },
  { href: "/super-admin/dashboard/schools", label: "Schools", icon: School },
  { href: "/super-admin/dashboard/requests", label: "Requests", icon: Inbox },
  {
    href: "/super-admin/dashboard/smart-import",
    label: "Smart Import beta",
    icon: ScanLine,
  },
  { href: "/super-admin/dashboard/people", label: "People", icon: Users },
  { href: "/super-admin/dashboard/activity", label: "Activity", icon: History },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/super-admin/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    await fetch(withBasePath("/api/platform-admin/logout"), {
      method: "DELETE",
    });
    router.replace("/super-admin/login");
  }

  const nav = (
    <nav aria-label="Platform admin" className="flex flex-col gap-1">
      {CONSOLE_NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Desktop: a fixed side menu. */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 bg-card p-4 shadow-sm md:flex md:sticky md:top-0 md:h-screen">
        <div className="px-2 pt-1">
          <SchoolKitWordmark iconSize={28} textClassName="text-lg" />
          <p className="mt-1 text-xs text-muted-foreground">Platform admin</p>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </aside>

      {/* Phone: a top bar whose menu folds down. */}
      <header className="sticky top-0 z-30 bg-card shadow-sm md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <SchoolKitWordmark iconSize={24} textClassName="text-base" />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="console-menu"
            className="rounded-lg p-2 text-foreground hover:bg-muted"
          >
            {open ? (
              <X className="h-5 w-5" aria-hidden />
            ) : (
              <Menu className="h-5 w-5" aria-hidden />
            )}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
        {open && (
          <div id="console-menu" className="flex flex-col gap-2 px-4 pb-4">
            {nav}
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </header>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          {children}
        </div>
      </main>
    </div>
  );
}

/** The heading every console page starts with. */
export function ConsoleHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
