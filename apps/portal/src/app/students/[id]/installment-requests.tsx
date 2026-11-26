"use client";

import { useState, type FormEvent } from "react";
import { formatKobo, type InstallmentPolicy, type InstallmentRequestDto, type PortalInvoiceDto } from "@school-kit/types";

type RequestView = { policy: InstallmentPolicy; requests: InstallmentRequestDto[] };
const statusLabels: Record<string, string> = { PENDING: "Awaiting school review", COUNTERED: "School counter-offer", APPROVED: "Approved", REJECTED: "Declined" };

export function InstallmentRequests({ invoice }: { invoice: PortalInvoiceDto }) {
  const [view, setView] = useState<RequestView>();
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const path = "/api/portal/students/" + invoice.studentId + "/invoices/" + invoice.id + "/installment-requests";
  const current = view?.requests[0];

  async function api<T>(suffix = "", body?: unknown): Promise<T> {
    const response = await fetch(path + suffix, body === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Could not update the request.");
    return data as T;
  }

  async function update(work?: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work?.();
      const refreshed = await api<RequestView>();
      setView(refreshed);
      if (work && refreshed.requests[0]?.status === "APPROVED") window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load instalment options.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const schedule = Array.from({ length: count }, (_, index) => ({
      amount: Number(data.get("amount-" + index)), dueDate: String(data.get("due-" + index)),
    }));
    void update(() => api("", schedule));
  }

  return (
    <section className="space-y-3 border-t pt-3" aria-label="Instalment request">
      {!view && <button type="button" disabled={busy} className="text-sm font-medium text-primary" onClick={() => void update()}>Instalment options</button>}
      {view && !view.policy.enabled && <p className="text-sm text-muted-foreground">The school has paused new instalment requests.</p>}
      {current && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">{statusLabels[current.status] ?? current.status}</p>
          <ul className="space-y-1">{current.schedule.map((row) => <li key={row.dueDate}>{row.dueDate} · {formatKobo(row.amount)}</li>)}</ul>
          {current.status === "COUNTERED" && (
            <div className="flex flex-wrap gap-2">
              {[true, false].map((accept) => (
                <button key={String(accept)} type="button" disabled={busy} className="rounded-md border px-3 py-2"
                  onClick={() => void update(() => api("/" + current.id + "/respond", { revision: current.revision, accept }))}>
                  {accept ? "Accept schedule" : "Decline"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {view?.policy.enabled && (!current || current.status === "REJECTED") && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm">Enter amounts in kobo totalling {formatKobo(invoice.totalDue)}. The school reviews your proposed dates.</p>
          <label className="block text-sm">Number of instalments
            <select className="ml-2 rounded border p-1" value={count} onChange={(event) => setCount(Number(event.target.value))}>
              {Array.from({ length: view.policy.maxInstallments - 1 }, (_, index) => <option key={index + 2}>{index + 2}</option>)}
            </select>
          </label>
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 text-sm">
              <label>Amount {index + 1} (kobo)<input className="block w-full rounded border p-2" required type="number" min={1} name={"amount-" + index} /></label>
              <label>Due date {index + 1}<input className="block w-full rounded border p-2" required type="date" name={"due-" + index} /></label>
            </div>
          ))}
          <button type="submit" disabled={busy} className="rounded-md border px-3 py-2 text-sm font-medium">Send request to school</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
