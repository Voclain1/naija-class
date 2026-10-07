import * as WebBrowser from "expo-web-browser";
import { APP_PAYMENT_RETURN_URL } from "@school-kit/types";

import { initiatePayment, verifyPayment } from "../api/portal";
import { pollPaymentOutcome, type CheckoutOutcome } from "./poll";

// Guardian checkout, mobile edition.
//
// HOW THE PARENT GETS BACK TO THE APP (2026-10-07, docs/deferred.md item 2)
//
// initiatePayment asks the API for returnTo "app". Paystack's callback is then
// the portal page /payments/callback/app, which immediately redirects to
// APP_PAYMENT_RETURN_URL (schoolkit://payments/callback). openAuthSessionAsync
// watches for exactly that address and closes the in-app browser when it
// appears, so the parent lands back in the app instead of on a web page they
// have to close by hand. (The portal's own checkout keeps its web callback.)
//
// The callback is a fixed choice made on the server, never a URL the app
// supplies: a client-chosen redirect on a money endpoint would let anyone aim
// a paying parent at a page of their choosing.
//
// Crucially, the return is still not proof of payment. Whatever the browser
// does (redirects back, is closed early, or the parent abandons checkout),
// the outcome comes from polling the API afterwards. See poll.ts.

export async function runCheckout(
  studentId: string,
  invoiceId: string,
): Promise<CheckoutOutcome> {
  const init = await initiatePayment(studentId, invoiceId);

  // Resolves when the browser reaches APP_PAYMENT_RETURN_URL ("success" in
  // expo's terms, which only means the redirect happened) or when the parent
  // dismisses it. Both mean "checkout is over, ask the server".
  await WebBrowser.openAuthSessionAsync(init.authorizationUrl, APP_PAYMENT_RETURN_URL, {
    // Match the app chrome so the handoff does not look like leaving for a
    // different product.
    toolbarColor: "#0E5C43",
    controlsColor: "#F7F5EF",
  });

  return pollPaymentOutcome(init.reference, verifyPayment);
}
