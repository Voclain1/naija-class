"use client";

// Phase 4 / Slice 5 — where the guardian's browser lands after completing
// (or abandoning) Paystack checkout. Paystack appends `?reference=` and
// `?trxref=` to whatever callbackUrl PortalPaymentsService.initiate passed
// (see that file's own comment on why an explicit callbackUrl is needed —
// the default would land the guardian on apps/web, not here).
//
// Polls GET /api/portal/payments/:reference — an ACTIVE verify-and-apply
// (see PortalPaymentsService.verify), not a passive read. Each poll asks
// Paystack directly and applies whatever it reports, so a response is
// always terminal (SUCCESS or FAILED) once it succeeds — there is no
// "still PENDING" response to wait out anymore, unlike the original
// pure-read design this replaced. The only reason a poll doesn't resolve
// immediately is a transient failure reaching Paystack (or our own API) —
// so retries here are backing off a real error, not waiting on an async
// webhook. After a few failed attempts, the page offers a manual
// "Check again" instead of silently giving up.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import type { PortalPaymentDto } from "@school-kit/types";

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 5; // ~15 seconds of retries against transient failures

type PollState =
  | { kind: "polling"; attempt: number }
  | { kind: "unresolved" } // repeated attempts to reach Paystack failed
  | { kind: "error"; message: string } // non-retryable: bad/forbidden reference
  | { kind: "resolved"; payment: PortalPaymentDto };

export default function PaymentCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </main>
      }
    >
      <PaymentCallbackContent />
    </Suspense>
  );
}

function PaymentCallbackContent() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference");
  const [state, setState] = useState<PollState>({ kind: "polling", attempt: 0 });
  const cancelledRef = useRef(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!reference) {
      setState({ kind: "error", message: "No payment reference was provided." });
      return;
    }

    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      attempt += 1;
      try {
        const res = await fetch(`/api/portal/payments/${reference}`);
        if (cancelledRef.current) return;

        if (res.ok) {
          const payment = (await res.json()) as PortalPaymentDto;
          setState({ kind: "resolved", payment });
          return;
        }

        // Not retryable — a bad reference or another guardian's payment
        // will fail the same way every time, so show it immediately
        // rather than burning the retry budget on it.
        if (res.status === 404 || res.status === 403) {
          const body: unknown = await res.json().catch(() => null);
          const message =
            body !== null && typeof body === "object" && "error" in body
              ? ((body as { error?: { message?: string } }).error?.message ??
                  "Something went wrong. Try again.")
              : "Something went wrong. Try again.";
          setState({ kind: "error", message });
          return;
        }

        // Retryable — our own attempt to confirm with Paystack failed
        // transiently (e.g. Paystack's API errored). Back off and retry.
        if (attempt >= MAX_ATTEMPTS) {
          setState({ kind: "unresolved" });
          return;
        }
        setState({ kind: "polling", attempt });
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch {
        if (cancelledRef.current) return;
        if (attempt >= MAX_ATTEMPTS) {
          setState({ kind: "unresolved" });
          return;
        }
        setState({ kind: "polling", attempt });
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    }

    setState({ kind: "polling", attempt: 0 });
    void poll();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [reference, retryToken]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      {state.kind === "polling" && (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Confirming your payment…</h1>
          <p className="text-sm text-muted-foreground">This usually only takes a moment.</p>
        </>
      )}

      {state.kind === "unresolved" && (
        <>
          <h1 className="text-xl font-semibold tracking-tight">Couldn&apos;t confirm yet</h1>
          <p className="text-sm text-muted-foreground">
            We tried checking with Paystack a few times but didn&apos;t get a
            clear result. This doesn&apos;t mean the payment failed — it
            usually means Paystack (or the connection to them) was slow to
            respond. Try checking again, or view your child&apos;s invoice
            directly.
          </p>
          <button
            type="button"
            onClick={() => setRetryToken((n) => n + 1)}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Check again
          </button>
        </>
      )}

      {state.kind === "error" && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-destructive">
            Something went wrong
          </h1>
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        </>
      )}

      {state.kind === "resolved" && state.payment.status === "SUCCESS" && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-emerald-600">
            Payment successful
          </h1>
          <p className="text-sm text-muted-foreground">
            Your payment has been confirmed and applied to the invoice.
          </p>
        </>
      )}

      {state.kind === "resolved" && state.payment.status !== "SUCCESS" && (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-destructive">
            Payment not completed
          </h1>
          <p className="text-sm text-muted-foreground">
            This payment wasn&apos;t successful. No charge was applied — you
            can try again from your child&apos;s invoice.
          </p>
        </>
      )}

      {state.kind === "resolved" && (
        <Link
          href={`/students/${state.payment.studentId}`}
          className="text-sm text-primary underline"
        >
          Back to invoice
        </Link>
      )}
      {(state.kind === "unresolved" || state.kind === "error") && (
        <Link href="/" className="text-sm text-primary underline">
          Back to your children
        </Link>
      )}
    </main>
  );
}
