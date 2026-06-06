"use client";

import {
  BarChart3,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
}

// Phase 1 / Slice 1 wires Academics to /settings/academic (the academic
// structure tab) — the spec keeps academic structure under Settings rather
// than its own top-level so the IA mirrors Phase 0's "Settings" container.
// Other items remain disabled until their slices land.
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Students", href: "/students", icon: GraduationCap, enabled: true },
  { label: "Staff", href: "/staff", icon: Users, enabled: true },
  { label: "Academics", href: "/settings/academic", icon: BarChart3, enabled: true },
  { label: "Grading", href: "/settings/grading", icon: SlidersHorizontal, enabled: true },
  { label: "Report Cards", href: "/report-cards", icon: FileText, enabled: true },
  { label: "Finance", href: "/finance", icon: Wallet, enabled: false },
  { label: "Reports", href: "/reports", icon: BarChart3, enabled: false },
  { label: "Settings", href: "/settings", icon: Settings, enabled: true },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4 font-semibold">
        School Kit
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.enabled &&
            (pathname === item.href || pathname.startsWith(`${item.href}/`));
          const baseClasses =
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm";
          if (!item.enabled) {
            return (
              <span
                key={item.href}
                className={cn(
                  baseClasses,
                  "cursor-not-allowed text-muted-foreground/60",
                )}
                title="Coming soon"
                aria-disabled="true"
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                baseClasses,
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
