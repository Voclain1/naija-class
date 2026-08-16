import type { PaymentStatus, PortalPaymentDto } from "@school-kit/types";

// Post-checkout polling. Pure logic, no React Native import, so it is unit
// tested directly (poll.spec.ts).
//
// WHY POLL AT ALL
//
// The redirect back from Paystack is not authoritative and must never be
// treated as proof of payment. The authoritative signal is the Paystack
// WEBHOOK, which arrives at the API independently of anything the user's
// browser does — and may arrive before, during, or after the user closes the
// checkout tab. So the app treats "the browser closed" as "time to ask the
// server", never as "it worked". apps/portal's callback page polls for the
// same reason.
//
// This is also why phase-6.md D9 forbids offline write queues: a payment's
// truth lives on the server, and any client-side belief about it — queued,
// cached, or optimistic — is a guess that can be wrong in the direction that
// costs a parent money.

/**
 * Terminal states we stop polling on.
 *
 * Typed as PaymentStatus[] rather than string[] deliberately: PENDING is the
 * only non-terminal status, so if a new one is ever added to the enum this
 * array still compiles but `TERMINAL.includes(...)` narrows differently — and
 * the explicit annotation means a REMOVED or renamed status is a compile
 * error here instead of a poll loop that silently never terminates.
 */
const TERMINAL: readonly PaymentStatus[] = ["SUCCESS", "FAILED", "REVERSED"];

export type CheckoutOutcome =
  | { kind: "succeeded"; payment: PortalPaymentDto }
  | { kind: "failed"; payment: PortalPaymentDto }
  /** Still PENDING when we gave up. NOT a failure — see below. */
  | { kind: "pending" }
  /** Could not reach the server at all. */
  | { kind: "unknown" };

export interface PollOptions {
  /** Total attempts, including the first immediate one. */
  attempts?: number;
  /** Delay between attempts, in ms. */
  intervalMs?: number;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll a payment reference until it reaches a terminal state or we run out of
 * attempts.
 *
 * Defaults to ~20s of polling (10 attempts, 2s apart), matching the portal
 * callback page's window. A webhook usually lands in a second or two; the
 * budget exists for the case where it does not.
 *
 * **A `pending` result is deliberately not reported as failure.** The money
 * may well have left the parent's account, with the webhook still in flight.
 * Telling them "payment failed" at that moment invites a second payment for
 * the same invoice, which is a far worse outcome than telling them we are
 * still confirming.
 */
export async function pollPaymentOutcome(
  reference: string,
  verify: (reference: string) => Promise<PortalPaymentDto>,
  options: PollOptions = {},
): Promise<CheckoutOutcome> {
  const attempts = options.attempts ?? 10;
  const intervalMs = options.intervalMs ?? 2000;
  const sleep = options.sleep ?? defaultSleep;

  let reachedServer = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(intervalMs);

    try {
      const payment = await verify(reference);
      reachedServer = true;

      if (TERMINAL.includes(payment.status)) {
        // REVERSED counts as failed for the parent's purposes: whatever
        // happened, this invoice is not settled by this payment.
        return payment.status === "SUCCESS"
          ? { kind: "succeeded", payment }
          : { kind: "failed", payment };
      }
    } catch {
      // Transient: the reference may not be queryable yet, or the connection
      // dropped. Keep trying — giving up on the first error would report
      // "unknown" for a payment that is about to confirm.
      continue;
    }
  }

  // Distinguishing these two matters for what the user is told: "we are still
  // confirming" (we talked to the server, it said PENDING) versus "we could
  // not check" (we never got an answer).
  return reachedServer ? { kind: "pending" } : { kind: "unknown" };
}

/** User-facing copy for each outcome. Kept next to the logic that produces it. */
export function describeOutcome(outcome: CheckoutOutcome): {
  title: string;
  tone: "info" | "warning" | "danger";
} {
  switch (outcome.kind) {
    case "succeeded":
      return { title: "Payment confirmed. Thank you.", tone: "info" };
    case "failed":
      return { title: "That payment did not go through.", tone: "danger" };
    case "pending":
      return {
        title:
          "Still confirming your payment. If money left your account it will " +
          "appear here shortly — please do not pay again.",
        tone: "warning",
      };
    case "unknown":
      return {
        title:
          "We could not confirm the payment. Check your connection and open " +
          "this invoice again before trying to pay.",
        tone: "warning",
      };
  }
}
