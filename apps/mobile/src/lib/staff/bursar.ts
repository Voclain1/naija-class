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
 * The four things a bursar does all day, in the order they do them — first
 * on the screen, above the full tile grid.
 *
 * "Record a payment" goes to the debtor list rather than a separate search:
 * the people who pay are the people who owe, that list already carries their
 * names, and it is the one list a bursar's permissions can read (the staff
 * student directory is owner/admin only).
 */
export function quickActions(permissions: readonly string[]): QuickAction[] {
  const can = (permission: string) => hasPermission(permissions, permission);
  const actions: QuickAction[] = [];
  if (can("payment.record") && can("finance.debtors.read")) {
    actions.push({ key: "record", label: "Record a payment", icon: "add-circle-outline", route: "/staff/collections/debtors" });
  }
  if (can("finance.debtors.read")) {
    actions.push({ key: "debtors", label: "Who owes", icon: "alert-circle-outline", route: "/staff/collections/debtors" });
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
