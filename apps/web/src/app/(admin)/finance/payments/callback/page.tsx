"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import type { PaymentDto } from "@school-kit/types";

import { formatKobo } from "@/lib/finance/format";
import { verifyPaystackPayment } from "@/lib/finance/payments-api";

export default function PaystackCallbackPage() {
  const searchParams = useSearchParams();
  const reference = searchParams.get("reference");

  const [status, setStatus] = useState<"loading" | "success" | "failed" | "error">("loading");
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!reference) {
      setStatus("error");
      setErrorMessage("No payment reference in URL.");
      return;
    }
    verifyPaystackPayment(reference)
      .then((p) => {
        setPayment(p);
        setStatus(p.status === "SUCCESS" ? "success" : p.status === "FAILED" ? "failed" : "error");
      })
      .catch((e) => {
        setErrorMessage(e instanceof Error ? e.message : "Verification failed.");
        setStatus("error");
      });
  }, [reference]);

  if (status === "loading") {
    return (
      <div className="p-6 flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin motion-reduce:animate-none" />
        <p>Verifying payment…</p>
      </div>
    );
  }

  if (status === "success" && payment) {
    return (
      <div className="p-6 max-w-md space-y-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 px-6 py-5 space-y-2">
          <p className="text-emerald-800 dark:text-emerald-200 font-semibold text-lg">Payment successful</p>
          <p className="text-sm text-emerald-800 dark:text-emerald-200">
            {formatKobo(payment.amount)} received via Paystack.
          </p>
          {payment.paidAt && (
            <p className="text-xs text-emerald-800 dark:text-emerald-200">
              {new Date(payment.paidAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/finance/invoices/${payment.invoiceId}`}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90"
          >
            View invoice
          </Link>
          <Link href="/finance/invoices" className="px-4 py-2 border rounded text-muted-foreground hover:bg-accent">
            All invoices
          </Link>
        </div>
      </div>
    );
  }

  if (status === "failed" && payment) {
    return (
      <div className="p-6 max-w-md space-y-4">
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-6 py-5 space-y-2">
          <p className="text-destructive font-semibold text-lg">Payment failed</p>
          <p className="text-sm text-destructive">
            The payment was not completed. No amount has been charged.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/finance/invoices/${payment.invoiceId}`}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90"
          >
            Return to invoice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md space-y-4">
      <div className="rounded-lg border border-border bg-card px-6 py-5 space-y-2">
        <p className="text-foreground font-semibold">Could not verify payment</p>
        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
      </div>
      <Link href="/finance/invoices" className="text-sm text-primary hover:underline">
        ← Back to invoices
      </Link>
    </div>
  );
}
