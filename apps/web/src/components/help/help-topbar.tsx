"use client";

import { ArrowLeft, LogOut, User as UserIcon } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/admin/theme-toggle";
import { SchoolLogo } from "@/components/school/school-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { homeRouteForRoles } from "@/lib/auth/home-route";
import { useAuth } from "@/lib/auth/use-auth";

// Deliberately minimal and role-agnostic — unlike AdminTopbar, this has no
// hamburger/nav-list (nothing under /help has a sidebar to open), so it
// doesn't need to know which of the four roles that can land here (owner,
// admin, bursar, teacher) is viewing. "Back" returns to whichever dashboard
// is actually that role's home (homeRouteForRoles — shared with LoginForm's
// post-login redirect) rather than guessing a single fixed route.
export function HelpTopbar() {
  const { school, user, roles, logout } = useAuth();

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <Button variant="ghost" size="sm" className="gap-2" asChild>
        <Link href={homeRouteForRoles(roles)}>
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Link>
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SchoolLogo className="h-7 w-7 shrink-0 rounded object-contain" />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {school?.name ?? ""}
        </span>
      </div>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 px-2 sm:px-3">
            <UserIcon className="h-4 w-4" />
            <span className="hidden sm:inline">{user ? `${user.firstName} ${user.lastName}` : ""}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="text-sm font-medium">{user ? `${user.firstName} ${user.lastName}` : ""}</span>
              {user?.email && (
                <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
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
    </header>
  );
}
