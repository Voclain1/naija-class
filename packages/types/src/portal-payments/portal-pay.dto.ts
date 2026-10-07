import { z } from "zod";

// Body of POST /portal/students/:id/invoices/:invoiceId/pay (2026-10-07).
//
// `returnTo` picks where Paystack sends the browser after checkout, from a
// FIXED list. It is never a URL: a client-supplied callback on a money
// endpoint would let anyone aim a paying parent at a page of their choosing.
//   - "portal" (default): the portal's own callback page, which polls.
//   - "app": a portal page that hands straight back to the School Kit app
//     (schoolkit://payments/callback), which then polls. Without it, a parent
//     paying in the app finishes inside the in-app browser and has to close it.
export const PORTAL_PAY_RETURN_TO = ["portal", "app"] as const;
export type PortalPayReturnTo = (typeof PORTAL_PAY_RETURN_TO)[number];

// No body at all (the portal, and app builds from before this field) means
// the default, so every existing caller keeps working unchanged.
export const portalPaySchema = z.preprocess(
  (v) => v ?? {},
  z.object({ returnTo: z.enum(PORTAL_PAY_RETURN_TO).default("portal") }).strict(),
);
export type PortalPayInput = { returnTo?: PortalPayReturnTo };

/** Where the app listens for the end of checkout. Must match app.json's scheme. */
export const APP_PAYMENT_RETURN_URL = "schoolkit://payments/callback";
