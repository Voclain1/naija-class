"use client";

import { Bell, LogOut, Search, User as UserIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth/use-auth";
import { SchoolLogo } from "@/components/school/school-logo";

import { CommandDialog, useCommandDialogHotkey } from "./command-dialog";
import { DashboardTermSelector } from "./dashboard-term-selector";
import { MobileNav } from "./mobile-nav";
import type { NavItem } from "./nav-items";
import { ThemeToggle } from "./theme-toggle";

// `navItems`/`navLaterPhaseItems` pass straight through to MobileNav
// (undefined -> its admin defaults). The (admin) layout renders
// `<AdminTopbar />` with neither prop, unchanged. The teacher portal renders
// `<TeacherTopbar />` (components/teacher/topbar.tsx) instead, which supplies
// its own nav list here — see nav-list.tsx's header comment for why this
// exists.
export function AdminTopbar({
  navItems,
  navLaterPhaseItems,
}: {
  navItems?: NavItem[];
  navLaterPhaseItems?: NavItem[];
} = {}) {
  const { school, user, logout } = useAuth();
  const [commandOpen, setCommandOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  useCommandDialogHotkey(() => setCommandOpen(true));

  return (
    <header className="flex h-16 items-center gap-2 border-b border-border bg-card px-3 sm:gap-4 sm:px-6">
      <MobileNav items={navItems} laterPhaseItems={navLaterPhaseItems} />

      <div className="hidden min-w-0 items-center gap-2 sm:flex">
        <SchoolLogo className="h-7 w-7 shrink-0 rounded object-contain" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {school?.name ?? ""}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        aria-label="Search or run a command"
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground hover:bg-accent/40 sm:max-w-sm"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden truncate md:inline">Search or run a command</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] md:inline">
          ⌘K
        </kbd>
      </button>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <DashboardTermSelector />

        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Notifications"
            onClick={() => setNotificationsOpen((v) => !v)}
          >
            <Bell className="h-4 w-4" />
          </Button>
          {notificationsOpen && (
            <div
              className="absolute right-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-md border border-border bg-popover p-4 text-sm text-muted-foreground shadow-lg"
              onMouseLeave={() => setNotificationsOpen(false)}
            >
              No notifications yet.
            </div>
          )}
        </div>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2 px-2 sm:px-3">
              <UserIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                {user ? `${user.firstName} ${user.lastName}` : ""}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {user ? `${user.firstName} ${user.lastName}` : ""}
                </span>
                {user?.email && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void logout();
              }}
              className="text-destructive focus:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  );
}
