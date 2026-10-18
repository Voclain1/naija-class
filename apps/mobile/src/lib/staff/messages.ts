import type { DashboardAlertType } from "@school-kit/types";

// Phase 9 / CP11.1 (docs/modules/phase-9.md §20).

/** The last four digits of a phone number, enough to tell two parents of the same name apart. */
export function lastDigits(phone: string, count = 4): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= count ? digits : digits.slice(-count);
}

export interface AlertRouteContext {
  canApprove: boolean;
  canCheckTermHealth: boolean;
  canReadMessages: boolean;
  canOverseeMessages: boolean;
}

/**
 * Where a "Needs you" alert opens IN THE APP, or null when the work is on the
 * website (it then opens there, signed in). Messages live in the app since
 * CP8.1, so their two alerts no longer send anyone to the website.
 */
export function alertInAppRoute(type: DashboardAlertType, ctx: AlertRouteContext): string | null {
  switch (type) {
    case "pending_report_card_approval":
      return ctx.canApprove ? "/staff/approvals" : null;
    case "term_health":
      return ctx.canCheckTermHealth ? "/staff/reports" : null;
    case "unread_messages":
      return ctx.canReadMessages ? "/staff/messages" : null;
    case "flagged_messages":
      return ctx.canOverseeMessages ? "/staff/messages?box=FLAGGED" : null;
    default:
      return null;
  }
}
