import type { AuthMeRoleDto, ManualPaymentMethod } from "@school-kit/types";

import { hasPermission } from "../auth/permissions";
import { hasRole } from "../auth/roles";

// CP9b / D38 — the money safeguards on the phone.
//
// Pure and separately tested, because each rule here stands between a thumb
// on a phone keyboard and a school's books:
//
// 1. NAIRA → KOBO BY EXACT STRING ARITHMETIC. "50,000.50" becomes 5000050
//    by splitting on the decimal point and joining digits — never by
//    multiplying a float by 100, which turns 0.29 into 28.999999999999996.
//    More than two decimal places, a minus sign, letters or zero are REFUSED,
//    never rounded: a rounded amount is an amount nobody typed.
// 2. AMOUNT IN WORDS. The confirmation shows "fifty thousand naira" beside
//    ₦50,000.00. A misplaced zero is the likeliest costly mistake on a phone
//    keyboard, and words catch it where digits do not.
// 3. WHO MAY — the permission each endpoint checks, plus the role where the
//    service also checks one (payment links: owner, admin or bursar).
//
// Kobo travel as JS numbers because that is what the API's Zod schemas take
// (`z.number().int()`); every value is checked to be a safe integer here, so
// no amount this file accepts can lose precision.

/** ₦1 billion — far above any school fee, and far below Number.MAX_SAFE_INTEGER kobo. */
export const MAX_NAIRA = 1_000_000_000;

export type NairaParse =
  | { ok: true; kobo: number }
  | { ok: false; reason: "empty" | "invalid" | "too-precise" | "zero" | "too-large" };

export function nairaToKobo(text: string): NairaParse {
  const cleaned = text.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  if (cleaned === "") return { ok: false, reason: "empty" };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { ok: false, reason: "invalid" };
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > 2) return { ok: false, reason: "too-precise" };
  if (whole.replace(/^0+/, "").length > 10) return { ok: false, reason: "too-large" };
  const kobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(kobo)) return { ok: false, reason: "too-large" };
  if (kobo === 0) return { ok: false, reason: "zero" };
  if (kobo > MAX_NAIRA * 100) return { ok: false, reason: "too-large" };
  return { ok: true, kobo };
}

export function nairaParseMessage(reason: Exclude<NairaParse, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Enter the amount.";
    case "invalid":
      return "Enter the amount in figures, like 50000 or 50,000.50.";
    case "too-precise":
      return "Naira amounts have at most two digits after the point (kobo).";
    case "zero":
      return "The amount must be more than ₦0.";
    case "too-large":
      return "That amount is too large. Check the number of zeros.";
  }
}

// Amount-in-words lives in @school-kit/types (shared with the API's branded
// receipt); re-exported so existing imports keep working.
export { koboInWords, numberInWords } from "@school-kit/types";

export interface MoneyAbilities {
  recordPayment: boolean;
  remind: boolean;
  paymentLink: boolean;
  logExpense: boolean;
  attachReceipt: boolean;
}

export function moneyAbilities(
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined,
  permissions: readonly string[],
): MoneyAbilities {
  const financeRole = hasRole(roles, "owner") || hasRole(roles, "admin") || hasRole(roles, "bursar");
  return {
    recordPayment: hasPermission(permissions, "payment.record"),
    remind: hasPermission(permissions, "finance.debtors.remind"),
    // PaymentLinksService also checks the owner/admin/bursar ROLE.
    paymentLink: financeRole && hasPermission(permissions, "payment.read") && hasPermission(permissions, "payment.record"),
    logExpense: hasPermission(permissions, "expense.create") && hasPermission(permissions, "expense-category.read"),
    attachReceipt: hasPermission(permissions, "expense.update"),
  };
}

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: ManualPaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "POS", label: "POS" },
];

/** The server's limit on reminders per request (sendRemindersSchema). */
export const REMINDER_BATCH_SIZE = 50;

export function reminderBatches<T>(items: readonly T[], size = REMINDER_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/**
 * When the money was received, as the ISO instant the API takes.
 *
 * "Today" is the moment of recording. An earlier date (a payment received
 * yesterday and recorded now) is pinned to 12:00 in Lagos (11:00 UTC), so the
 * stored instant falls on the intended calendar day in the school's zone and
 * never slips a day either way.
 */
export function paidAtFor(date: string | null, nowMs: number): string {
  if (date === null) return new Date(nowMs).toISOString();
  return `${date}T11:00:00.000Z`;
}
