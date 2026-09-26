import type { AuthMeRoleDto, FinanceDashboardDto } from "@school-kit/types";
import { formatKobo } from "@school-kit/types";

import { hasPermission } from "../auth/permissions";
import { hasRole } from "../auth/roles";
import type { IconName } from "../../components/layout";

// The bursar's home (docs/modules/phone-for-every-role.md D1).
//
// Every money screen already existed; what a bursar did not have was a home
// that answers their question. They land on a dashboard written for teachers
// (today's lessons, registers) and owners (enrolment, report cards), with no
// money figures at all, because those bands are gated on `dashboard.read`,
// which a bursar does not hold.
//
// The rule here is deliberately about the PERMISSIONS, not the role name: a
// person who can read the finance dashboard but not the school dashboard is
// someone whose day is money, whatever their role is called. That also keeps
// owners and admins — who hold both — on the school band they already have,
// rather than stacking two summaries on one screen.

export function showsMoneyBand(
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined,
  permissions: readonly string[],
): boolean {
  const financeOnly =
    hasPermission(permissions, "finance.dashboard.read") && !hasPermission(permissions, "dashboard.read");
  return financeOnly || (hasRole(roles, "bursar") && !hasPermission(permissions, "dashboard.read"));
}

export interface MoneyStat {
  key: string;
  icon: IconName;
  value: string;
  label: string;
  tone?: "warning";
  /** Where tapping it goes, when it leads somewhere. */
  route?: string;
}

/**
 * The band itself, from the figures `GET /finance/dashboard` already returns.
 * No new endpoint, and nothing computed from parts: every naira shown here is
 * a number the server sent.
 *
 * There is no "collected today" line, deliberately: the endpoint has no such
 * figure, and deriving one on the phone would mean adding up payments, which
 * is exactly what the money rule forbids. If a school asks for it, it belongs
 * in the endpoint.
 */
export function moneyBand(dashboard: FinanceDashboardDto): MoneyStat[] {
  const owing = dashboard.debtorCount;
  const stats: MoneyStat[] = [
    {
      key: "collected",
      icon: "cash-outline",
      value: formatKobo(dashboard.totalCollected),
      label: `Collected this term · ${dashboard.collectionRatePercent}% of ${formatKobo(dashboard.totalInvoiced)}`,
      route: "/staff/collections",
    },
  ];
  if (owing > 0) {
    stats.push({
      key: "outstanding",
      icon: "alert-circle-outline",
      tone: "warning",
      value: formatKobo(dashboard.outstandingBalance),
      label: `Outstanding · ${owing} famil${owing === 1 ? "y" : "ies"} owing`,
      route: "/staff/collections/debtors",
    });
  } else {
    stats.push({
      key: "outstanding",
      icon: "checkmark-circle-outline",
      value: "Nothing owed",
      label: "Every invoice this term is settled",
    });
  }
  stats.push({
    key: "expenses",
    icon: "receipt-outline",
    value: formatKobo(dashboard.totalExpenses),
    label: `Expenses this term · ${formatKobo(dashboard.netPosition)} net`,
    route: "/staff/expenses",
  });
  return stats;
}

export interface QuickAction {
  key: string;
  label: string;
  icon: IconName;
  route: string;
}

/**
 * The things a bursar does all day, in the order they do them — first on the
 * screen, above the full tile grid.
 *
 * "Record a payment" goes to the debtor list rather than a separate search:
 * the people who pay are the people who owe, that list already carries their
 * names, and it is the one list a bursar's permissions can read (the staff
 * student directory is owner/admin only).
 *
 * There is deliberately NO "Who owes" tile here, though a bursar asks that
 * question constantly. It would be the SAME ROUTE as "Record a payment", and
 * a band of four tiles where two open one screen reads as a mistake — which
 * is exactly how it read on a device (2026-09-25). The question is still
 * answered twice on this screen: the figures band above says "Outstanding · N
 * families owing" and taps through to that list, and the tile grid below
 * carries it under its own name. `dedupeByRoute` keeps those three from ever
 * becoming three copies again.
 */
export function quickActions(permissions: readonly string[]): QuickAction[] {
  const can = (permission: string) => hasPermission(permissions, permission);
  const actions: QuickAction[] = [];
  if (can("payment.record") && can("finance.debtors.read")) {
    actions.push({ key: "record", label: "Record a payment", icon: "add-circle-outline", route: "/staff/collections/debtors" });
  }
  if (can("payment.read")) {
    actions.push({ key: "receipts", label: "Receipts", icon: "document-text-outline", route: "/staff/receipts" });
  }
  if (can("expense.create")) {
    actions.push({ key: "expense", label: "Log an expense", icon: "wallet-outline", route: "/staff/expenses" });
  }
  return actions;
}

/** Filters the debtor list by student name or admission number, as typed. */
export function filterDebtors<T extends { studentName: string; admissionNumber: string; classArm: string }>(
  rows: readonly T[],
  search: string,
): T[] {
  const needle = search.trim().toLowerCase();
  if (needle === "") return [...rows];
  return rows.filter((row) =>
    [row.studentName, row.admissionNumber, row.classArm].some((field) => field.toLowerCase().includes(needle)),
  );
}

/**
 * Drops anything whose route is already offered above it on the same screen.
 *
 * The staff home renders three things that can name one screen: the money
 * figures (each stat may link), the quick actions, and the full "Everything
 * you do" grid built from `staffDestinations`. For a bursar those overlap
 * almost completely — on a device, "Who owes", "Log an expense" and
 * "Receipts" each appeared TWICE (2026-09-25).
 *
 * Earlier wins: a tile in the band is there because it is what this person
 * does most, and the grid is the exhaustive list, so the grid is what gives
 * way. Anything with no route (a website handoff) is always kept — it is not
 * the same destination as an in-app screen even when it looks related.
 */
export function dedupeByRoute<T extends { route?: string }>(
  items: readonly T[],
  alreadyShown: readonly (string | undefined)[],
): T[] {
  const taken = new Set(alreadyShown.filter((route): route is string => typeof route === "string"));
  return items.filter((item) => {
    if (item.route === undefined) return true;
    if (taken.has(item.route)) return false;
    taken.add(item.route);
    return true;
  });
}
