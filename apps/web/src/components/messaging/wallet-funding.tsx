"use client";

import { useEffect, useRef, useState } from "react";
import type { Kobo, MessagingTopUpAvailability, MessagingTopUpCheckout, MessagingTopUpQuote } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { formatKobo } from "@/lib/finance/format";
import { parseTopUpNaira, safeCheckoutUrl } from "@/lib/messaging/wallet-funding";

type Intent = { clientRequestId: string; amountKobo: Kobo; reference?: string };
const endpoint = "/messaging/wallet/top-ups";
const cash = (value: Kobo | null) => value === null ? "Not configured" : formatKobo(BigInt(value));
const errText = (e: unknown) => e instanceof ApiError ? e.message : "Could not complete the request. Check the original attempt before starting another.";

export function WalletFunding({ availability, storageKey, onChecked }: { availability: MessagingTopUpAvailability | undefined; storageKey: string; onChecked: () => void }) {
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<MessagingTopUpQuote | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const parsed = parseTopUpNaira(amount);
  const valid = !!parsed && availability?.available === true && availability.minKobo !== null && availability.maxKobo !== null && BigInt(parsed) >= BigInt(availability.minKobo) && BigInt(parsed) <= BigInt(availability.maxKobo);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved) as Intent;
        if (!/^[a-f0-9-]{36}$/i.test(value.clientRequestId) || !/^[1-9]\d{0,9}$/.test(value.amountKobo)) throw new Error("Invalid saved request");
        setIntent(value); setReference(value.reference ?? "");
      }
      setReady(true);
    } catch { setError("This browser could not restore safe checkout recovery. Funding is unavailable here; contact SchoolKit support."); }
  }, [storageKey]);

  function persist(value: Intent) {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
    setIntent(value);
  }

  async function getQuote() {
    if (!valid || !parsed || intent || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setQuote(null);
    try { setQuote(await apiFetch<MessagingTopUpQuote>(endpoint + "/quote?amountKobo=" + encodeURIComponent(parsed))); }
    catch (e) { setError(errText(e)); } finally { lock.current = false; setBusy(false); }
  }

  async function start() {
    if (lock.current || !ready || !availability?.available || (!intent && (!quote || quote.amountKobo !== parsed || !valid))) return;
    if (!intent && !window.confirm("Create this Paystack checkout for the reviewed gross amount? The actual fee determines your net credit.")) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const original = intent ?? { clientRequestId: crypto.randomUUID(), amountKobo: quote!.amountKobo };
      persist(original);
      const result = await apiFetch<MessagingTopUpCheckout>(endpoint, { method: "POST", body: { clientRequestId: original.clientRequestId, amountKobo: original.amountKobo } });
      const url = safeCheckoutUrl(result.checkoutUrl);
      if (!url) throw new Error("Invalid checkout URL");
      persist({ ...original, reference: result.reference });
      setReference(result.reference); setQuote(result.quote ?? null); setCheckout(url);
    } catch (e) { setError(errText(e)); } finally { lock.current = false; setBusy(false); }
  }

  async function recover() {
    if (lock.current || !/^mwallet-[a-f0-9-]{36}-[a-f0-9-]{36}$/i.test(reference.trim())) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await apiFetch(endpoint + "/" + encodeURIComponent(reference.trim()) + "/recover", { method: "POST" });
      setNotice("Paystack verification was requested. Check the refreshed wallet history to confirm actual credit. A checked reference is not proof of credit.");
      onChecked();
    } catch (e) { setError(errText(e)); } finally { lock.current = false; setBusy(false); }
  }

  function clearReviewed() {
    if (busy || !intent || !window.confirm("Only clear this browser's saved request after confirming its final outcome in the wallet or with SchoolKit support. This does not cancel or refund a Paystack payment. Continue?")) return;
    try { sessionStorage.removeItem(storageKey); setIntent(null); setCheckout(null); setQuote(null); setReference(""); setAmount(""); setNotice(""); }
    catch { setError("Could not clear the saved request."); }
  }

  return <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
    <div><h2 className="text-lg font-semibold">Fund your SMS wallet</h2><p className="mt-1 text-sm text-muted-foreground">Messaging credit is separate from school fees. Meta bills your school directly for school-owned WhatsApp.</p></div>
    {availability?.available !== true && <p className="rounded-xl bg-muted p-3 text-sm">New top-ups are unavailable. Existing payment references can still be checked.</p>}
    {availability?.available && ready && !intent && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Allowed gross charge: {cash(availability.minKobo)} – {cash(availability.maxKobo)}</p>
      <label className="block space-y-1 text-sm"><span>Amount to pay (₦)</span><input className="w-full rounded-xl border bg-background px-3 py-2" inputMode="decimal" value={amount} disabled={busy} onChange={(e) => { setAmount(e.target.value); setQuote(null); }} placeholder="5000" /></label>
      <Button variant="outline" disabled={!valid || busy} onClick={() => void getQuote()}>Review funding cost</Button>
    </div>}
    {intent && <p className="rounded-xl bg-muted p-3 text-sm">Saved checkout attempt for {cash(intent.amountKobo)}. Use the same request to recover an interrupted checkout.</p>}
    {quote && <dl className="space-y-2 rounded-xl border p-3 text-sm">
      <div className="flex justify-between gap-3"><dt>Gross charge</dt><dd>{cash(quote.amountKobo)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Estimated Paystack fee</dt><dd>{cash(quote.estimatedFeeKobo)}</dd></div>
      <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><dt>Expected wallet credit</dt><dd>{cash(quote.expectedCreditKobo)}</dd></div>
      <p className="text-xs text-muted-foreground">Actual verified processing fees may differ. Only net verified funds become spendable.</p>
    </dl>}
    {!checkout && availability?.available && ready && (intent || quote) && <Button disabled={busy} onClick={() => void start()}>{intent ? "Recover same checkout" : "Create Paystack checkout"}</Button>}
    {checkout && <Button asChild><a href={checkout} target="_blank" rel="noopener noreferrer">Continue to Paystack</a></Button>}
    <div className="space-y-2 border-t pt-4"><h3 className="font-medium">Check an existing payment</h3><label className="block text-sm"><span className="sr-only">Messaging payment reference</span><input className="w-full rounded-xl border bg-background px-3 py-2" value={reference} disabled={busy} onChange={(e) => setReference(e.target.value)} placeholder="mwallet-…" /></label><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !/^mwallet-[a-f0-9-]{36}-[a-f0-9-]{36}$/i.test(reference.trim())} onClick={() => void recover()}>Check payment</Button>{intent && <Button variant="ghost" disabled={busy} onClick={clearReviewed}>Clear reviewed attempt</Button>}</div></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
