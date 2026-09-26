import type { Principal } from "../auth/principal";

// Where a tapped notification takes you (notifications-v1.md, mobile half).
//
// The server sends an opaque routing hint — `data.screen` — and never a name,
// a grade or an amount (N3), so this is the only place that knows what
// "results" means for a parent versus a student versus a teacher.
//
// Two rules, both about not making things worse:
//
//  1. THE PRINCIPAL DECIDES THE DESTINATION. The same "results" hint is a
//     parent's children list and a student's own results screen. Sending a
//     parent to /me would show them a screen built for their child's account.
//  2. AN UNKNOWN HINT GOES HOME, NEVER NOWHERE. A notification sent by a
//     newer server than this app understands must still open something. A tap
//     that appears to do nothing reads as a broken app.

export const HOME: Record<Principal, string> = {
  guardian: "/students",
  student: "/me",
  staff: "/staff",
};

const ROUTES: Record<Principal, Record<string, string>> = {
  guardian: {
    results: "/students",
    fees: "/students",
    announcements: "/announcements",
    // An absence alert names no child (the-school-day.md A3), so the tap has
    // to land where the parent can see WHICH — the children list, not a
    // single child's page.
    attendance: "/students",
  },
  student: {
    results: "/me/results",
    fees: "/me/fees",
    announcements: "/me/announcements",
    // A student is not told they were absent — they know (A1). The mapping
    // exists because the hint is per-principal and a future event may use it.
    attendance: "/me/attendance",
  },
  staff: {
    attendance: "/staff",
    gradebook: "/staff/gradebook",
    results: "/staff/approvals",
    fees: "/staff/collections",
    announcements: "/staff/announcements",
  },
};

/**
 * The path to open for a notification's payload, for whoever is signed in.
 *
 * `null` when nobody is signed in: the router sends them to sign in, and the
 * notification is still in the tray afterwards.
 */
export function routeForNotification(
  data: Record<string, unknown> | undefined,
  principal: Principal | null,
): string | null {
  if (principal === null) return null;
  const screen = typeof data?.screen === "string" ? data.screen : "";
  return ROUTES[principal][screen] ?? HOME[principal];
}
