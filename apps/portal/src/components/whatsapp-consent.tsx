"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { portalJson } from "@/lib/portal-api";
import { usePortalRouter } from "@/lib/portal-router";

type Consent = { version: string; wording: string; granted: boolean };
type Challenge = { url: string; expiresAt: string };
const path = "/messaging/whatsapp-consent";
const btn = "rounded-xl border px-4 py-2 text-sm font-medium disabled:opacity-50";
function validLink(value: string): boolean {
  try { const url = new URL(value); return url.origin === "https://wa.me" && !url.username && !url.password && /^\/[1-9]\d{7,14}$/.test(url.pathname); }
  catch { return false; }
}

export function WhatsAppConsent() {
  const router = usePortalRouter();
  const [consent, setConsent] = useState<Consent | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    const r = await portalJson<Consent>(path, { cache: "no-store" }, (url) => router.replace(url));
    if (r.ok) { setConsent(r.body); setError(""); if (r.body.granted) { setChallenge(null); setAgree(false); } }
    else if (!r.redirected) { setConsent(null); setError(r.message); }
  }, [router]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function requestChallenge() {
    if (!consent || consent.granted || !agree || lock.current) return;
    lock.current = true; setBusy(true); setError(""); setFeedback(""); setChallenge(null);
    try {
      const r = await portalJson<Challenge>(path + "/challenge", { method: "POST", json: { consentVersion: consent.version } }, (url) => router.replace(url));
      if (r.ok && validLink(r.body.url) && Date.parse(r.body.expiresAt) > Date.now()) { setChallenge(r.body); setFeedback("Send the prefilled message from the WhatsApp number your school holds for you, then return and check your status."); }
      else if (!r.ok) setError(r.message); else setError("Verification link unavailable. Refresh and try again.");
    } finally { lock.current = false; setBusy(false); }
  }

  async function withdraw() {
    if (lock.current || !window.confirm("Withdraw permission for this school to send WhatsApp notifications?")) return;
    lock.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const r = await portalJson<null>(path + "/withdraw", { method: "POST" }, (url) => router.replace(url));
      if (r.ok) { setAgree(false); setChallenge(null); await refresh(); setFeedback("Withdrawal recorded. You can choose to verify again later."); } else setError(r.message);
    } finally { lock.current = false; setBusy(false); }
  }

  return <section aria-labelledby="whatsapp-consent" className="flex flex-col gap-3 rounded-lg border bg-card p-5 text-sm">
    <h2 id="whatsapp-consent" className="font-medium">WhatsApp notifications</h2>
    {consent ? <>
      <p className="text-muted-foreground">{consent.wording}</p>
      <p className="font-medium">{consent.granted ? "Permission granted" : "Permission not verified"}</p>
      {consent.granted ? <button type="button" className={btn} disabled={busy} onClick={() => void withdraw()}>Withdraw permission</button> : <>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" disabled={busy} checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I have read the wording and choose to receive these school WhatsApp notifications.</span></label>
        <button type="button" className={btn} disabled={!agree || busy} onClick={() => void requestChallenge()}>Request verification link</button>
        {challenge && <div className="space-y-2 rounded-lg border p-3"><p>Valid until {new Date(challenge.expiresAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" })} (Lagos time). Sending the message is required; opening WhatsApp does not grant consent.</p><a className="inline-block font-semibold text-primary underline" href={challenge.url} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (Date.parse(challenge.expiresAt) <= Date.now()) { e.preventDefault(); setChallenge(null); setError("Verification link expired. Request a fresh link."); } }}>Open WhatsApp to verify</a><button type="button" className={btn} disabled={busy} onClick={() => void withdraw()}>Cancel pending consent</button></div>}
      </>}
    </> : !error && <p role="status" className="text-muted-foreground">Checking permission…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}{feedback && <p role="status">{feedback}</p>}
    <button type="button" className={btn} disabled={busy} onClick={() => void refresh()}>Check permission status</button>
  </section>;
}
