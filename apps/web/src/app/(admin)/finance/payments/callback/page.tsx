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
      <div className="p-6 flex flex-col items-center gap-3 text-gray-400">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p>Verifying payment…</p>
      </div>
    );
  }

  if (status === "success" && payment) {
    return (
      <div className="p-6 max-w-md space-y-4">
        <div className="rounded-lg border border-green-200 bg-green-50 px-6 py-5 space-y-2">
          <p className="text-green-700 font-semibold text-lg">Payment successful</p>
          <p className="text-sm text-green-600">
            {formatKobo(payment.amount)} received via Paystack.
          </p>
          {payment.paidAt && (
            <p className="text-xs text-green-500">
              {new Date(payment.paidAt).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/finance/invoices/${payment.invoiceId}`}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            View invoice
          </Link>
          <Link href="/finance/invoices" className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-50">
            All invoices
          </Link>
        </div>
      </div>
    );
  }

  if (status === "failed" && payment) {
    return (
      <div className="p-6 max-w-md space-y-4">
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-5 space-y-2">
          <p className="text-red-700 font-semibold text-lg">Payment failed</p>
          <p className="text-sm text-red-600">
            The payment was not completed. No amount has been charged.
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            href={`/finance/invoices/${payment.invoiceId}`}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Return to invoice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md space-y-4">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-6 py-5 space-y-2">
        <p className="text-gray-700 font-semibold">Could not verify payment</p>
        {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      </div>
      <Link href="/finance/invoices" className="text-sm text-blue-600 hover:underline">
        ← Back to invoices
      </Link>
    </div>
  );
}
