"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { useVisibleAdminNavItems } from "./sidebar";
import { resolveQuickActions } from "./quick-actions";

// The topbar's A / B quick actions.
//
// A — opens the command palette (⌘K), which already exists and already lists
//     every nav item. This pill is only the visible affordance for it; the
//     dialog itself is command-dialog.tsx and is unchanged.
// B — jumps to the finance ledger, shown only when the signed-in user can
//     actually get there.
//
// The permission gate comes from useVisibleAdminNavItems() — the same filtered
// list the sidebar renders — rather than a second permission check that could
// drift from it. See quick-actions.ts.
//
// Hidden below lg (1024px), NOT sm. At 768px the desktop sidebar is already
// visible and takes 256px, leaving ~512px of topbar — and two ~85px pills
// pushed the account control clean off the right edge (right=858 against a
// 768px viewport), which a11y-wave3a's responsive-overflow test caught. lg
// gives the topbar 768px, i.e. 256px more than the width that was already
// tight without the pills.
//
// Both actions stay reachable everywhere they are hidden: ⌘K on a keyboard,
// Finance in the sidebar or the hamburger drawer.

const PILL_CLASSES =
  "hidden h-9 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm " +
  "text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground lg:inline-flex";

function Badge({ children }: { children: string }) {
  return (
    <span
      // aria-hidden: the letter is a visual shortcut cue, not the button's
      // name. The accessible name lives on the control itself and is a real
      // phrase — a screen reader announcing "A" would be useless.
      aria-hidden
      className="rounded bg-muted px-1 text-[10px] font-semibold uppercase text-muted-foreground"
    >
      {children}
    </span>
  );
}

export function QuickActionPills({ onOpenCommand }: { onOpenCommand: () => void }) {
  const { items } = useVisibleAdminNavItems();
  const actions = resolveQuickActions(items);

  return (
    <>
      {actions.map((action) =>
        action.href ? (
          <Link key={action.key} href={action.href} aria-label={action.label} className={cn(PILL_CLASSES)}>
            <Badge>{action.badge}</Badge>
            {action.text}
          </Link>
        ) : (
          <button
            key={action.key}
            type="button"
            onClick={onOpenCommand}
            aria-label={action.label}
            className={cn(PILL_CLASSES)}
          >
            <Badge>{action.badge}</Badge>
            {action.text}
          </button>
        ),
      )}
    </>
  );
}
