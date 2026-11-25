"use client";

import { useEffect, useRef, useState } from "react";
import type { MessagingMetaSignupSession, MessagingInboundHistory } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { listGuardians } from "@/lib/guardians/guardians-api";
import { parseMetaSignupEvent } from "@/lib/messaging/meta-signup";

type SDK = { init(options: { appId: string; version: string; xfbml: boolean; cookie: boolean; autoLogAppEvents: boolean }): void; login(callback: (result: { authResponse?: { code?: string } }) => void, options: { config_id: string; response_type: "code"; override_default_response_type: true; extras: { version: "v4" } }): void };
const fb = () => (window as Window & { FB?: SDK }).FB;
const box = "space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6";
const input = "w-full rounded-xl border bg-background px-3 py-2 text-sm";
const errorText = (e: unknown) => e instanceof ApiError ? e.message : "Could not confirm the result. Check the saved account or provider dashboard before trying again.";
let sdkLoad: Promise<SDK> | null = null;
function loadSdk(): Promise<SDK> {
  const current = fb();
  if (current) return Promise.resolve(current);
  if (sdkLoad) return sdkLoad;
  sdkLoad = new Promise<SDK>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js"; script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error("Meta SDK unavailable")); }, 15000);
    script.onload = () => { window.clearTimeout(timeout); const sdk = fb(); if (sdk) resolve(sdk); else reject(new Error("Meta SDK unavailable")); };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Meta SDK unavailable")); };
    document.head.appendChild(script);
  }).catch((e) => { sdkLoad = null; throw e; });
  return sdkLoad;
}

export function MetaSignup({ onConnected }: { onConnected: () => void }) {
  const [session, setSession] = useState<MessagingMetaSignupSession | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "ready" | "waiting" | "verifying" | "uncertain">("idle");
  const [error, setError] = useState("");
  const cleanup = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cleanup.current?.(); }; }, []);

  async function prepare() {
    if (locked.current) return;
    locked.current = true; setPhase("preparing"); setError("");
    try {
      // Ask the server before loading third-party scripts or opening Meta.
      const next = await apiFetch<MessagingMetaSignupSession>("/messaging/whatsapp/signup", { method: "POST" });
      if (!alive.current) return;
      if (!/^\d{1,32}$/.test(next.appId) || !/^\d{1,32}$/.test(next.configId) || !/^v\d+\.\d+$/.test(next.graphVersion) || !/^[A-Za-z0-9_-]{43}$/.test(next.state) || Date.parse(next.expiresAt) <= Date.now()) throw new Error("Invalid signup session");
      const sdk = await loadSdk();
      if (!alive.current) return;
      sdk.init({ appId: next.appId, version: next.graphVersion, xfbml: false, cookie: false, autoLogAppEvents: false });
      setSession(next); setPhase("ready");
    } catch (e) { if (alive.current) { setError(errorText(e)); setPhase("idle"); } }
    finally { locked.current = false; }
  }

  function launch() {
    const sdk = fb();
    if (!sdk || !session || phase !== "ready" || locked.current) return;
    if (Date.parse(session.expiresAt) <= Date.now()) { setSession(null); setPhase("idle"); setError("The preparation expired. Prepare a new session."); return; }
    locked.current = true; setError(""); setPhase("waiting");
    let active = true;
    let code: string | undefined;
    let account: { wabaId: string; phoneNumberId: string } | undefined;
    let source: MessageEventSource | null = null;
    let sent = false;
    let timer: number;
    function stop() {
      active = false; code = undefined; account = undefined;
      window.removeEventListener("message", receive);
      window.clearTimeout(timer); cleanup.current = null; locked.current = false;
    }
    function fail(message: string) { stop(); if (alive.current) { setSession(null); setPhase("idle"); setError(message); } }
    async function complete() {
      if (!active || sent || !code || !account) return;
      if (!session || Date.parse(session.expiresAt) <= Date.now()) { fail("The signup session expired. Check Meta before preparing again."); return; }
      sent = true; const body = { code, state: session.state, ...account };
      stop(); locked.current = true; setPhase("verifying");
      try {
        const result = await apiFetch<{ status: "CONNECTED"; billing: "SCHOOL_OWNED" }>("/messaging/whatsapp/signup/complete", { method: "POST", body });
        if (alive.current) { setSession(null); setPhase("idle"); if (result.status === "CONNECTED" && result.billing === "SCHOOL_OWNED") onConnected(); else { setPhase("uncertain"); setError("Connection outcome not confirmed. Refresh account status."); } }
      } catch { if (alive.current) { setSession(null); setPhase("uncertain"); setError("Connection could not be confirmed. Refresh account status and check WhatsApp Manager before starting another signup."); } }
      finally { locked.current = false; }
    }
    function receive(event: MessageEvent) {
      if (!active || !event.source || event.source === window) return;
      const parsed = parseMetaSignupEvent(event.origin, event.data);
      if (!parsed || (source && source !== event.source)) return;
      source = event.source;
      if (parsed.kind !== "finish") { fail(parsed.kind === "cancel" ? "Signup cancelled. No connection was confirmed." : "Meta reported a signup error. Check WhatsApp Manager."); return; }
      account = { wabaId: parsed.wabaId, phoneNumberId: parsed.phoneNumberId };
      void complete();
    }
    timer = window.setTimeout(() => fail("Signup expired or did not return the required account details. Check Meta before trying again."), Math.max(0, Date.parse(session.expiresAt) - Date.now()));
    cleanup.current = stop;
    window.addEventListener("message", receive);
    try {
      // Keep the actual popup in a direct click, not after an awaited request.
      sdk.login((result) => {
        if (!active) return;
        const value = result.authResponse?.code;
        if (typeof value !== "string" || !value || value.length > 2048) { fail("No exchangeable code was returned. Check Meta before starting again."); return; }
        code = value; void complete();
      }, { config_id: session.configId, response_type: "code", override_default_response_type: true, extras: { version: "v4" } });
    } catch { fail("Could not open the Meta signup window."); }
  }

  return <div className="mt-4 space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Connect a school-owned account</h3>
    <p className="text-sm text-muted-foreground">Use a Meta Business account and dedicated school WhatsApp number. This does not enable paid sending. Availability is checked by SchoolKit before Meta opens.</p>
    {phase === "idle" && <Button onClick={() => void prepare()}>Prepare secure connection</Button>}
    {phase === "ready" && <Button onClick={launch}>Continue with Meta</Button>}
    {phase === "preparing" && <p role="status" className="text-sm">Checking onboarding availability…</p>}
    {phase === "waiting" && <><p role="status" className="text-sm">Complete the Meta window, including the final Finish button.</p><Button variant="outline" onClick={() => { cleanup.current?.(); setSession(null); setPhase("uncertain"); setError("Signup stopped locally. Check Meta and refresh before restarting."); }}>Stop waiting</Button></>}
    {phase === "verifying" && <p role="status" className="text-sm">Verifying account ownership and registration details…</p>}
    {phase === "uncertain" && <Button variant="outline" onClick={onConnected}>Refresh account status</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}

export function MetaManagement({ names, onChanged }: { names: string[]; onChanged: () => void }) {
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [body, setBody] = useState("");
  const [samples, setSamples] = useState("");
  const [button, setButton] = useState("Pay fees");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const payment = ["fee_payment_reminder","fee_invoice_issued","fee_payment_overdue"].includes(name);
  const examples = samples.split("\n").map(x => x.trim()).filter(Boolean);
  const ids = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]);
  const valid = names.includes(name) && /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language) && body.trim().length > 0 && body.trim().length <= 1024 && ids.length === examples.length && ids.every((id,i) => id === String(i+1)) && !/[{}]/.test(body.replace(/\{\{\d+\}\}/g,"")) && examples.length <= 20 && examples.every(x => x.length <= 100) && (!payment || (!!button.trim() && button.trim().length <= 25));
  async function action(kind: "register" | "template") {
    if (lock.current || uncertain || (kind === "register" ? !/^\d{6}$/.test(pin) : !valid)) return;
    if (!window.confirm(kind === "register" ? "Request phone registration with this PIN? Confirm the account in WhatsApp Manager first." : "Submit this utility template to Meta for review? Submission is not approval.")) return;
    lock.current = true; setBusy(true); setNote(""); setError("");
    try {
      if (kind === "register") {
        const secret = pin; setPin("");
        await apiFetch("/messaging/whatsapp/connection/register", { method: "POST", body: { registrationSecret: secret } });
        setNote("Provider confirmed registration. Check account health before sending.");
      } else {
        await apiFetch("/messaging/whatsapp/templates", { method: "POST", body: { name, language, category: "UTILITY", body: body.trim(), bodyExamples: examples, ...(payment ? { paymentButtonText: button.trim() } : {}) } });
        setNote("Template submitted for provider review. Automatic sending remains subject to separate approval."); setBody(""); setSamples("");
      }
      onChanged();
    } catch (e) { setError(errorText(e)); setUncertain(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className={box}>
    <h2 className="text-lg font-semibold">Account & template management</h2>
    <p className="text-sm text-muted-foreground">These actions require separate platform releases. Do not submit a PIN or repeat a request when Meta already completed it.</p>
    <div className="space-y-2 rounded-xl border p-3"><label className="block space-y-1 text-sm"><span>Six-digit phone registration PIN</span><input type="password" inputMode="numeric" autoComplete="off" className={input} value={pin} maxLength={6} disabled={busy || uncertain} onChange={e => setPin(e.target.value.replace(/\D/g,"").slice(0,6))} /></label><Button variant="outline" disabled={busy || uncertain || !/^\d{6}$/.test(pin)} onClick={() => void action("register")}>Request registration</Button></div>
    <div className="space-y-3 rounded-xl border p-3"><h3 className="font-semibold">Submit a utility template</h3>
      <label className="block space-y-1 text-sm"><span>Template name</span><select className={input} value={name} disabled={busy} onChange={e => setName(e.target.value)}><option value="">Select template</option>{names.map(n => <option key={n} value={n}>{n.replaceAll("_"," ")}</option>)}</select></label>
      <label className="block space-y-1 text-sm"><span>Language code</span><input className={input} value={language} disabled={busy} onChange={e => setLanguage(e.target.value)} /></label>
      <label className="block space-y-1 text-sm"><span>Body (use sequential numbered variables)</span><textarea className={input} rows={4} value={body} maxLength={1024} disabled={busy} onChange={e => setBody(e.target.value)} placeholder="Hello {{1}}, your fee balance is {{2}}." /></label>
      <label className="block space-y-1 text-sm"><span>Example for each variable, one per line (fictional values only)</span><textarea className={input} rows={3} value={samples} disabled={busy} onChange={e => setSamples(e.target.value)} /></label>
      {payment && <label className="block space-y-1 text-sm"><span>Payment button text (Paystack URL is configured by SchoolKit)</span><input className={input} value={button} maxLength={25} disabled={busy} onChange={e => setButton(e.target.value)} /></label>}
      <Button disabled={!valid || busy || uncertain} onClick={() => void action("template")}>Submit for approval</Button>
    </div>
    {note && <p role="status" className="text-sm">{note}</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {uncertain && <Button variant="outline" onClick={() => { if (window.confirm("Have you checked WhatsApp Manager for the previous operation?")) { setUncertain(false); setError(""); onChanged(); } }}>I checked the provider status</Button>}
  </section>;
}

export function InboundHistory() {
  const [query, setQuery] = useState("");
  const [parents, setParents] = useState<{id: string; label: string}[]>([]);
  const [selected, setSelected] = useState("");
  const [history, setHistory] = useState<MessagingInboundHistory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  async function search() {
    if (busy || query.trim().length < 2) return;
    setBusy(true); setError(""); setSelected(""); setHistory(null); setParents([]); setSearched(false);
    try { const result = await listGuardians({ search: query.trim() }); setParents(result.data.map(g => ({ id: g.id, label: g.firstName + " " + g.lastName }))); setSearched(true); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function read() {
    if (!selected || busy) return;
    setBusy(true); setHistory(null); setError("");
    try { setHistory(await apiFetch<MessagingInboundHistory>("/messaging/whatsapp/conversations/" + encodeURIComponent(selected))); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section className={box + " ph-no-capture"} data-sentry-mask>
    <h2 className="text-lg font-semibold">Guardian WhatsApp history</h2><p className="text-sm text-muted-foreground">Owner-only, audited, retained inbound text. This is not a free-form sending inbox.</p>
    <label className="block space-y-1 text-sm"><span>Search guardians</span><input className={input} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setParents([]); setSelected(""); setHistory(null); setSearched(false); }} /></label><Button variant="outline" disabled={busy || query.trim().length < 2} onClick={() => void search()}>Find guardians</Button>
    {searched && !parents.length && <p className="text-sm">No matching guardians returned.</p>}
    {!!parents.length && <><label className="block space-y-1 text-sm"><span>Select guardian</span><select className={input} value={selected} disabled={busy} onChange={e => { setSelected(e.target.value); setHistory(null); }}><option value="">Choose one</option>{parents.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label><Button disabled={busy || !selected} onClick={() => void read()}>View retained messages</Button></>}
    {busy && <p role="status" className="text-sm">Loading…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {history && <div className="space-y-2">{history.items.length === 0 && <p className="text-sm">No retained messages.</p>}{history.items.map(m => <article key={m.id} className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">{new Date(m.occurredAt).toLocaleString("en-NG",{timeZone:"Africa/Lagos"})}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.text}</p></article>)}{history.truncated && <p className="text-xs text-muted-foreground">Additional retained messages exist.</p>}</div>}
  </section>;
}
