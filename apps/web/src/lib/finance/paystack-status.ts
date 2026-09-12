import type { SchoolMeDto } from "@school-kit/types";

// Whether this school can take card payments, for the finance dashboard's
// eyebrow line.
//
// THE MOCKUP SHOWED A BANK ACCOUNT NUMBER HERE. This deliberately does not,
// and the number is not repeated anywhere in this repo: the dashboard renders
// on every finance visit, so an account-shaped string in the eyebrow would
// spread through logs, screenshots and screen shares for information nobody
// needs at a glance. Same reasoning that keeps banking detail out of
// platform_admin_list_paystack_setup_requests (CLAUDE.md, SECURITY DEFINER
// inventory).
//
// What a bursar actually needs from this line is one fact — can parents pay
// by card right now — so that is the only thing it reports. The subaccount
// CODE is also withheld: it is an opaque Paystack identifier rather than a
// bank account, so it is not dangerous, but it is another identifier on a
// high-traffic screen and it belongs on the settings page that manages the
// integration, not here.

export type PaystackConnectionState = "LIVE" | "CONFIGURED_OFF" | "NOT_CONNECTED";

export interface PaystackStatus {
  state: PaystackConnectionState;
  /** Short, plain-language label. Never mentions a bursar (small schools have none). */
  label: string;
}

/**
 * Resolve the school's card-payment readiness.
 *
 * Three states, not two. "Connected but switched off" is deliberately distinct
 * from "never set up": the first is one toggle away from working and the
 * second needs a whole Paystack onboarding, and telling a school the wrong one
 * sends it down the wrong path.
 *
 * `paystackPaymentsEnabled` can only be true when the subaccount code is
 * non-null (the API enforces this — see SchoolMeDto). The code is still
 * checked here rather than trusted, because this function's answer decides
 * what a school is told about its own money plumbing.
 */
export function resolvePaystackStatus(
  school: Pick<SchoolMeDto, "paystackSubaccountCode" | "paystackPaymentsEnabled"> | null | undefined,
): PaystackStatus {
  const code = school?.paystackSubaccountCode?.trim();

  if (!code) {
    return { state: "NOT_CONNECTED", label: "Card payments not set up" };
  }
  if (!school?.paystackPaymentsEnabled) {
    return { state: "CONFIGURED_OFF", label: "Card payments switched off" };
  }
  return { state: "LIVE", label: "Card payments live" };
}
