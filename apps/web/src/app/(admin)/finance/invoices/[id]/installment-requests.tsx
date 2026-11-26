"use client";

import { useState, type FormEvent } from "react";
import { formatKobo, type InstallmentPolicy, type InstallmentRequestDecision, type InstallmentRequestDto } from "@school-kit/types";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type RequestView = { policy: InstallmentPolicy; requests: InstallmentRequestDto[] };

export function StaffInstallmentRequests({ invoiceId, canDecide, canConfigure, onApprove }: {
  invoiceId: string;
  canDecide: boolean;
  canConfigure: boolean;
  onApprove: () => void;
}) {
  const [view, setView] = useState<RequestView>();
  const [counterId, setCounterId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const path = "/payment-plans/invoice/" + invoiceId + "/requests";

  async function update(work?: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work?.();
      setView(await apiFetch<RequestView>(path));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update instalment requests.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(request: InstallmentRequestDto, decision: InstallmentRequestDecision) {
    await update(async () => {
      await apiFetch(path + "/" + request.id, { method: "POST", body: decision });
      setCounterId(undefined);
      if (decision.action === "APPROVE") onApprove();
    });
  }

  function submitCounter(event: FormEvent<HTMLFormElement>, request: InstallmentRequestDto) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void decide(request, {
      action: "COUNTER", revision: request.revision,
      schedule: request.schedule.map((_, index) => ({
        amount: Number(data.get("amount-" + index)), dueDate: String(data.get("due-" + index)),
      })),
    });
  }

  function updatePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const policy: InstallmentPolicy = {
      enabled: form.has("enabled"), maxInstallments: Number(form.get("count")),
      minimumFirstKobo: Number(form.get("minimum")), requireWithinTerm: form.has("term"),
    };
    void update(() => apiFetch("/payment-plans/policy", { method: "PUT", body: policy }));
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Guardian instalment requests">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Guardian instalment requests</h3>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void update()}>{view ? "Refresh" : "View requests"}</Button>
      </div>
      {view && view.requests.length === 0 && <p className="text-sm text-muted-foreground">No requests for this invoice.</p>}
      {view?.requests.map((request) => (
        <article key={request.id} className="space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">{request.status === "COUNTERED" ? "Awaiting guardian response" : request.status}</p>
          {request.explanation && <p className="whitespace-pre-wrap break-words">{request.explanation}</p>}
          <ul>{request.schedule.map((row) => <li key={row.dueDate}>{row.dueDate} · {formatKobo(row.amount)}</li>)}</ul>
          {canDecide && (request.status === "PENDING" || request.status === "COUNTERED") && (
            <div className="flex flex-wrap gap-2">
              {request.status === "PENDING" && <>
                <Button size="sm" disabled={busy} onClick={() => void decide(request, { action: "APPROVE", revision: request.revision })}>Approve</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setCounterId(request.id)}>Counter-offer</Button>
              </>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(request, { action: "REJECT", revision: request.revision })}>Decline</Button>
            </div>
          )}
          {counterId === request.id && (
            <form className="space-y-3" onSubmit={(event) => submitCounter(event, request)}>
              {request.schedule.map((row, index) => (
                <div key={row.dueDate} className="grid grid-cols-2 gap-2">
                  <label>Amount (kobo)<input className="block w-full rounded border p-2" name={"amount-" + index} required type="number" min={1} defaultValue={row.amount} /></label>
                  <label>Due date<input className="block w-full rounded border p-2" name={"due-" + index} required type="date" defaultValue={row.dueDate} /></label>
                </div>
              ))}
              <Button size="sm" type="submit" disabled={busy}>Send counter-offer</Button>
            </form>
          )}
        </article>
      ))}
      {view && canConfigure && (
        <details className="space-y-2 text-sm">
          <summary className="cursor-pointer">School policy (owner or admin)</summary>
          <form className="grid gap-3 p-2 sm:grid-cols-2" onSubmit={updatePolicy}>
            <label><input type="checkbox" name="enabled" defaultChecked={view.policy.enabled} /> Allow guardian requests</label>
            <label><input type="checkbox" name="term" defaultChecked={view.policy.requireWithinTerm} /> Require due dates within term</label>
            <label>Maximum instalments<input className="block w-full rounded border p-2" required type="number" min={2} max={12} name="count" defaultValue={view.policy.maxInstallments} /></label>
            <label>Minimum first instalment (kobo)<input className="block w-full rounded border p-2" required type="number" min={0} name="minimum" defaultValue={view.policy.minimumFirstKobo} /></label>
            <Button type="submit" size="sm" disabled={busy}>Save school policy</Button>
          </form>
        </details>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
