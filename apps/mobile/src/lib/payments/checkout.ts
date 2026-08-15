import * as WebBrowser from "expo-web-browser";
import { initiatePayment, verifyPayment } from "../api/portal";
import { pollPaymentOutcome, type CheckoutOutcome } from "./poll";

// Guardian checkout, mobile edition.
//
// THE ONE PLACE MOBILE DIVERGES FROM THE PORTAL, AND WHY
//
// PortalPaymentsService hardcodes Paystack's callback to
// `${PORTAL_BASE_URL}/payments/callback` — a WEB url. On mobile we open the
// hosted checkout in an in-app browser, so after paying the user lands on the
// portal's web callback page inside that browser rather than being returned
// to the app automatically, and closes it themselves.
//
// That is a real UX wrinkle, and it is accepted for this slice rather than
// papered over, because the alternative is an API change (letting the client
// supply a callback URL, or adding a deep-link-aware one) and slice 2's whole
// premise is that guardian mobile needs no server change. It is logged in
// docs/deferred.md so it is a known trade rather than an accident.
//
// Crucially, the wrinkle is cosmetic, not correctness: the outcome is
// determined by polling the API after the browser closes, never by the
// redirect. See poll.ts.

export async function runCheckout(
  studentId: string,
  invoiceId: string,
): Promise<CheckoutOutcome> {
  const init = await initiatePayment(studentId, invoiceId);

  // openBrowserAsync (not openAuthSessionAsync): the latter auto-dismisses
  // when the browser reaches a redirect URL we nominate, and Paystack redirects
  // to the PORTAL's callback URL, which we cannot claim as a scheme. Using it
  // here would just never fire, so the plain browser is the honest call.
  //
  // It resolves when the user dismisses the browser — which tells us the
  // checkout is over, but nothing whatsoever about whether it succeeded.
  await WebBrowser.openBrowserAsync(init.authorizationUrl, {
    // Match the app chrome so the handoff does not look like leaving for a
    // different product.
    toolbarColor: "#0E5C43",
    controlsColor: "#F7F5EF",
  });

  return pollPaymentOutcome(init.reference, verifyPayment);
}
