import { hasPermission } from "@/lib/auth/has-permission";
import { PRIMARY_TASKS, type PrimaryTaskKey } from "./nav-items";

// The dashboard header's three quick actions.
//
// Pure resolver with a sibling .spec.ts, same shape as quick-actions.ts: the
// permission gating is the only branching here, and apps/web has no DOM test
// setup by deliberate choice (vitest.config.ts).
//
// Every destination and gate below was verified against the running app rather
// than assumed — see the notes on each.

export type DashboardActionKey = PrimaryTaskKey;

export interface DashboardAction {
  key: DashboardActionKey;
  label: string;
  href: string;
  permission: string;
  /** The primary call to action gets filled styling; the others are outline. */
  emphasis: "primary" | "secondary";
}

const ACTIONS: DashboardAction[] = PRIMARY_TASKS;

/**
 * Filters the actions to what this user can actually do.
 *
 * Owner holds the "*" wildcard (verified live: /auth/me returns exactly one
 * permission for an owner), so the gates below are load-bearing for ADMIN and
 * BURSAR rather than for owner. Bursar's explicit grant includes
 * payment.record but neither insight.read nor student.create — so a bursar
 * sees Record Fee alone, which is the gate doing real work.
 */
export function resolveDashboardActions(permissions: string[], selectedModules?: string[]): DashboardAction[] {
  return ACTIONS.filter(
    (a) =>
      hasPermission(permissions, a.permission) &&
      (!selectedModules || selectedModules.includes(taskModule(a.key))),
  );
}

function taskModule(key: DashboardActionKey): string {
  if (key === "take-attendance") return "attendance";
  if (key === "record-payment") return "fees";
  if (key === "add-student") return "students";
  return "results";
}
