import { hasPermission } from "@/lib/auth/has-permission";

// The dashboard header's three quick actions.
//
// Pure resolver with a sibling .spec.ts, same shape as quick-actions.ts: the
// permission gating is the only branching here, and apps/web has no DOM test
// setup by deliberate choice (vitest.config.ts).
//
// Every destination and gate below was verified against the running app rather
// than assumed — see the notes on each.

export type DashboardActionKey = "record-fee" | "insights" | "add-student";

export interface DashboardAction {
  key: DashboardActionKey;
  label: string;
  href: string;
  permission: string;
  /** The primary call to action gets filled styling; the others are outline. */
  emphasis: "primary" | "secondary";
}

const ACTIONS: DashboardAction[] = [
  {
    key: "record-fee",
    label: "Record Fee",
    // ONE-CLICK GAP, stated deliberately: there is no standalone
    // record-a-payment page in this app. Recording lives INSIDE an invoice
    // (finance/invoices/[id] renders the "Record payment" form), and the
    // finance sub-nav has no Payments tab — /settings/finance/payments is
    // Paystack credentials, not recording. So this lands on the invoice list,
    // where you pick the invoice and record against it. The label therefore
    // promises slightly more than one click delivers; that was an explicit
    // decision (keep the approved mockup's wording) rather than an oversight.
    href: "/finance/invoices",
    // The gate is the action the user will actually perform, not the page
    // they land on. Bursar holds both payment.record and invoice.read, so the
    // landing page is reachable for everyone this admits.
    permission: "payment.record",
    emphasis: "secondary",
  },
  {
    key: "insights",
    label: "Insights",
    // Replaced "Roll Call" after review (2026-09-10). Roll Call pointed at
    // /teacher/attendance, which owner/admin CAN use — the page is explicitly
    // built for managers — but a header quick-action that swaps admin chrome
    // for teacher chrome is a jarring place to exercise that capability. The
    // entry point now lives on the teacher dashboard, where the chrome does
    // not change under the user.
    //
    // Insights takes the slot because it is a real, shipped admin feature
    // (Phase 5 / slice 8) whose ONLY entry point was the sidebar — no quick
    // access anywhere.
    href: "/insights",
    // Verified: NAV_ITEMS gates the sidebar entry on this exact string, and
    // insight.read appears once in permissions.ts — in the owner/admin grant,
    // deliberately NOT in the teacher one ("management information about
    // colleagues' work rather than teaching workflow"). Bursar does not hold
    // it either, so a bursar still sees Record Fee alone.
    permission: "insight.read",
    emphasis: "secondary",
  },
  {
    key: "add-student",
    label: "Add Student",
    href: "/students/new",
    permission: "student.create",
    emphasis: "primary",
  },
];

/**
 * Filters the actions to what this user can actually do.
 *
 * Owner holds the "*" wildcard (verified live: /auth/me returns exactly one
 * permission for an owner), so the gates below are load-bearing for ADMIN and
 * BURSAR rather than for owner. Bursar's explicit grant includes
 * payment.record but neither insight.read nor student.create — so a bursar
 * sees Record Fee alone, which is the gate doing real work.
 */
export function resolveDashboardActions(permissions: string[]): DashboardAction[] {
  return ACTIONS.filter((a) => hasPermission(permissions, a.permission));
}
