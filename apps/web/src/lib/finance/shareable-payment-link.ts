import type { PaymentLinkStateDto } from "@school-kit/types";

// Which Paystack link, if any, may go into a debtor's WhatsApp reminder.
//
// Plan-first: docs/modules/school-bank-details.md, D5b — the link is fetched
// when the share is clicked, never per row, and the message omits the line
// rather than promising a link that does not work.

/** How long the share waits for the link before sending without it. */
export const PAYMENT_LINK_FETCH_TIMEOUT_MS = 4000;

/**
 * The link's URL if it may be quoted beside `balance`, otherwise null.
 *
 * Two conditions, and both are necessary:
 *
 *   - `LIVE`. Every other state (CONNECT_PAYSTACK, NOT_CREATED, CREATING,
 *     RETRYABLE_FAILURE) has no payable URL.
 *   - The link's amount EQUALS the balance the message quotes. A LIVE link is
 *     archived when an invoice's balance changes (PaymentLinkInvalidationService),
 *     but the debtor list on screen can be older than that: a payment that lands
 *     after the page loaded would otherwise produce "₦45,000 is outstanding —
 *     Pay online: <link for ₦30,000>". Two figures in one message that
 *     disagree is worse than one figure and no link.
 *
 * This compares two numbers the API returned. It does not compute a balance.
 */
export function shareablePaymentLinkUrl(
  state: PaymentLinkStateDto | null | undefined,
  balance: number,
): string | null {
  if (!state || state.state !== "LIVE") return null;
  if (state.amount !== balance) return null;
  return state.url || null;
}

/**
 * Fetch the link state and resolve it to a quotable URL. NEVER rejects: a
 * 403 (a role without payment.read), a 404, a network error, or a slow
 * response all resolve to null, and the reminder goes out without that line.
 * A reminder without a link is still useful; a share button that does nothing
 * is not.
 */
export async function resolveShareablePaymentLink(
  fetchState: () => Promise<PaymentLinkStateDto>,
  balance: number,
  timeoutMs: number = PAYMENT_LINK_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const state = await Promise.race([fetchState(), timeout]);
    return shareablePaymentLinkUrl(state, balance);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
