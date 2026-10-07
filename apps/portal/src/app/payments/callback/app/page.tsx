"use client";

// Where Paystack sends a parent who paid from the School Kit APP (2026-10-07,
// docs/deferred.md item 2). The API picks this page when the app asks for
// returnTo "app" (PortalPaymentsService.paymentCallbackUrl).
//
// It does one thing: hand the browser back to the app at
// schoolkit://payments/callback. The app opened checkout with
// openAuthSessionAsync, which closes the in-app browser the moment it sees that
// address, and the app then asks the API what happened. Nothing here decides
// whether the payment worked, and nothing in the app trusts this redirect for
// that either: the outcome always comes from the API (the webhook, or the
// app's own verify poll).
//
// Public, like /payments/callback: Paystack redirects here from its own domain,
// and the in-app browser has no portal session.

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { APP_PAYMENT_RETURN_URL } from "@school-kit/types";

export default function AppPaymentReturnPage() {
  return (
    <Suspense fallback={null}>
      <AppPaymentReturn />
    </Suspense>
  );
}

function AppPaymentReturn() {
  const reference = useSearchParams().get("reference");
  const appUrl = reference
    ? `${APP_PAYMENT_RETURN_URL}?reference=${encodeURIComponent(reference)}`
    : APP_PAYMENT_RETURN_URL;

  useEffect(() => {
    window.location.replace(appUrl);
  }, [appUrl]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Returning to the School Kit app…</h1>
      <p className="text-sm text-muted-foreground">
        The app will confirm your payment. If it does not open by itself, tap the button below, or close this page
        and go back to the app.
      </p>
      <a
        href={appUrl}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Open the School Kit app
      </a>
    </main>
  );
}
