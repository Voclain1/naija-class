"use client";

import {
  BarChart3,
  GraduationCap,
  LayoutDashboard,
  Settings,
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

// Phase 0: only Dashboard is wired up. Other items render as visibly
// disabled placeholders so the sidebar shows the intended IA but cannot
// navigate to half-built pages.
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Students", href: "/students", icon: GraduationCap, enabled: false },
  { label: "Staff", href: "/staff", icon: Users, enabled: false },
  { label: "Academics", href: "/academics", icon: BarChart3, enabled: false },
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
