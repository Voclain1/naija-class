"use client";

import Link from "next/link";
import { Bell, History, Mail, MessageCircle, RefreshCw, ShieldCheck, Smartphone, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DeliveryState, MessagingChannel, MessagingDeliveryPage, MessagingOverview, MessagingPaidPreferences, MessagingWalletPage } from "@school-kit/types";
import { PageHeader } from "@/components/layout/page-primitives";
import { Button } from "@/components/ui/button";
import { WalletFunding } from "@/components/messaging/wallet-funding";
import { apiFetch, ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";

const CHANNELS = {
  EMAIL: { label: "Email", icon: Mail, description: "Invoices, invitations and school updates." },
  PUSH: { label: "App notifications", icon: Bell, description: "Notifications in the SchoolKit app." },
  SMS: { label: "SMS", icon: Smartphone, description: "Wallet-backed messages via Termii." },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, description: "Messages from your school's own WhatsApp account." },
} satisfies Record<MessagingChannel, { label: string; icon: typeof Mail; description: string }>;

const BLOCKERS: Record<string, string> = {
  CHANNEL_DISABLED: "Channel is switched off",
  PROVIDER_UNAVAILABLE: "Provider is not ready",
  PRICE_MISSING: "Verified pricing is not configured",
  INSUFFICIENT_CREDIT: "Insufficient messaging credit",
  SPENDING_LIMIT: "Spending limit reached",
  TEMPLATE_NOT_APPROVED: "Template approval required",
  ONBOARDING_DISABLED: "WhatsApp onboarding is not available yet",
  SHARED_SENDER_NOT_AUTHORIZED: "Shared sender is not authorised",
  RECIPIENT_UNVERIFIED: "Recipient's phone is not verified",
  CONSENT_MISSING: "Guardian consent is required",
  OPTED_OUT: "Guardian opted out",
  PROVIDER_DISABLED: "Provider is disabled",
  EMERGENCY_STOP: "Messaging is paused by SchoolKit",
};

const DELIVERY: Record<DeliveryState, string> = {
  QUEUED: "Queued", SENDING: "Sending", ACCEPTED: "Accepted by provider",
  SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed",
  UNKNOWN: "Outcome unknown", CANCELLED: "Cancelled", DEAD_LETTER: "Needs review", BLOCKED: "Blocked",
};

type Catalogue = {
  connected: boolean;
  available: boolean;
  truncated?: boolean;
  templates: { id: string; name: string; language: string; category: string; approval: string }[];
};
type Health = { status: "DISCONNECTED" | "CONNECTED" | "UNHEALTHY"; billing: "SCHOOL_OWNED" | null };
type Tab = "overview" | "wallet" | "history" | "whatsapp";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" }, { key: "wallet", label: "SMS wallet" },
  { key: "history", label: "Delivery history" }, { key: "whatsapp", label: "WhatsApp" },
];
const panel = "rounded-2xl border bg-card p-4 shadow-sm sm:p-6";

function message(error: unknown) {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function dateLabel(value: string) {
  return new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" });
}

function Status({ label, good = false }: { label: string; good?: boolean }) {
  return <span className={good ? "inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300" : "inline-flex rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"}>{label}</span>;
}

function Notice({ children }: { children: string }) {
  return <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{children}</p>;
}

export default function CommunicationPage() {
  const { school, user, status, roles, permissions } = useAuth();
  const owner = roles.some((role) => role.key === "owner");
  const allowed = roles.some((role) => role.key === "owner" || role.key === "admin") && hasPermission(permissions, "notification-preferences.read");
  if (status === "loading") return <p role="status" className="p-4 text-sm text-muted-foreground">Loading communication settings…</p>;
  if (!allowed || !school || !user) return <div className="space-y-4"><PageHeader title="Communication centre" subtitle="Manage school notifications." /><p className={panel}>You do not have access to this page.</p></div>;
  return <Workspace key={school.id + ":" + user.id} canFund={owner && hasPermission(permissions, "messaging-wallet.top-up")} fundingKey={"sk:messaging-funding:" + school.id + ":" + user.id} canManage={owner && hasPermission(permissions, "messaging-paid.manage")} canCancel={hasPermission(permissions, "notification-preferences.update")} canManageWhatsApp={owner && hasPermission(permissions, "messaging-whatsapp.manage")} />;
}

function Workspace({ canManage, canCancel, canManageWhatsApp, canFund, fundingKey }: { canManage: boolean; canCancel: boolean; canManageWhatsApp: boolean; canFund: boolean; fundingKey: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [overview, setOverview] = useState<MessagingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MessagingPaidPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const next = await apiFetch<MessagingOverview>("/messaging/overview", { signal });
      if (!signal?.aborted) { setOverview(next); setDraft(next.paidPreferences ?? null); }
    } catch (e) { if (!signal?.aborted) { setOverview(null); setDraft(null); setError(message(e)); } }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

  const dirty = !!draft && !!overview?.paidPreferences && (draft.paidWhatsAppEnabled !== overview.paidPreferences.paidWhatsAppEnabled || draft.walletSmsEnabled !== overview.paidPreferences.walletSmsEnabled);
  async function save() {
    if (!draft || busy || !canManage || !dirty) return;
    if (!window.confirm("Save paid messaging preferences? Enabling a channel permits eligible automatic messages when all provider and platform controls are ready.")) return;
    setBusy(true); setFeedback(""); setError(null);
    try {
      await apiFetch<MessagingPaidPreferences>("/messaging/preferences", { method: "PATCH", body: draft });
      setFeedback("Messaging preferences saved. Provider readiness is checked separately.");
      setRevision((n) => n + 1);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 pb-8">
      <PageHeader title="Communication centre" subtitle="Keep families informed, review delivery and manage messaging costs." />
      <section className="flex flex-col gap-4 rounded-2xl bg-[#0E5C43] p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-100">School communications</p><h2 className="text-xl font-semibold sm:text-2xl">Every message, accounted for.</h2><p className="mt-2 max-w-xl text-sm text-emerald-50">Manage the channels your school uses to reach parents. Paid messaging requires verified providers, consent and spending controls.</p></div>
        <Button asChild variant="secondary"><Link href="/finance/reminders">Open fee reminders</Link></Button>
      </section>
      <div className="flex flex-wrap items-center gap-2" aria-label="Communication sections">
        {TABS.map((item) => <Button key={item.key} type="button" variant={tab === item.key ? "default" : "outline"} aria-pressed={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</Button>)}
        <Button type="button" variant="ghost" className="ml-auto" disabled={loading || busy || dirty} onClick={() => setRevision((n) => n + 1)}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {feedback && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{feedback}</p>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Updating communication details…</p>}
      {!overview && !loading && <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>Retry</Button>}
      {overview && tab === "overview" && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overview.providers.map((provider) => {
            const item = CHANNELS[provider.channel]; const Icon = item.icon;
            return <section key={provider.channel} className={panel}>
              <div className="flex flex-wrap items-start justify-between gap-2"><Icon className="h-10 w-10 rounded-xl bg-primary/10 p-2 text-primary" /><Status label={provider.ready ? "Ready" : "Not ready"} good={provider.ready} /></div>
              <h3 className="mt-4 font-semibold">{item.label}</h3><p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              {!!provider.blockers.length && <ul className="mt-3 space-y-1 text-xs text-muted-foreground">{provider.blockers.map((blocker) => <li key={blocker}>• {BLOCKERS[blocker] ?? blocker}</li>)}</ul>}
            </section>;
          })}
        </div>
        {overview.legacySms && <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Existing SMS service</h2><Status label={overview.legacySms.ready ? "Ready for eligible messages" : "Not ready"} good={overview.legacySms.ready} /></div><p className="mt-2 text-sm text-muted-foreground">Provider: {overview.legacySms.configured ? "configured" : "not configured"} · Release: {overview.legacySms.release} · Spending authorization: {overview.legacySms.financiallyAuthorized ? "configured" : "not configured"}. Each actual send is checked separately.</p></section>}
        <section className={panel}>
          <h2 className="text-lg font-semibold">Automatic paid notifications</h2>
          <p className="mt-1 text-sm text-muted-foreground">Only a school owner can change these preferences. Switching on a preference does not activate a provider or approve a template.</p>
          {draft ? <div className="mt-4 space-y-3">
            <label className="flex items-start gap-3 rounded-xl border p-4"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={draft.paidWhatsAppEnabled} disabled={!canManage || busy || loading} onChange={(e) => setDraft({ ...draft, paidWhatsAppEnabled: e.target.checked })} /><span><span className="block font-medium">School-owned WhatsApp</span><span className="text-sm text-muted-foreground">Meta bills your school directly.</span></span></label>
            <label className="flex items-start gap-3 rounded-xl border p-4"><input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={draft.walletSmsEnabled} disabled={!canManage || busy || loading} onChange={(e) => setDraft({ ...draft, walletSmsEnabled: e.target.checked })} /><span><span className="block font-medium">Wallet-backed SMS</span><span className="text-sm text-muted-foreground">Eligible paid messages use your messaging balance.</span></span></label>
            {canManage && <Button disabled={!dirty || busy || loading} onClick={() => void save()}>{busy ? "Saving…" : "Save preferences"}</Button>}
          </div> : <p className="mt-4 text-sm text-muted-foreground">Paid preferences are not available.</p>}
        </section>
        <section className={panel}><h2 className="text-lg font-semibold">Existing communication settings</h2><p className="mt-1 text-sm text-muted-foreground">Manage email, app alerts, legacy SMS and staff who answer parent messages in their existing settings.</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" asChild><Link href="/settings/notifications">Notification settings</Link></Button><Button variant="outline" asChild><Link href="/settings/messaging">Parent inbox roles</Link></Button></div></section>
      </>}
      {overview && tab === "wallet" && <WalletPanel overview={overview} canFund={canFund} fundingKey={fundingKey} onChecked={() => void refresh()} />}
      {overview && tab === "history" && <HistoryPanel canCancel={canCancel} key={revision} />}
      {overview && tab === "whatsapp" && <WhatsAppPanel overview={overview} canManage={canManageWhatsApp} onChange={() => setRevision((n) => n + 1)} />}
      <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" /> Provider acceptance is not proof of delivery. Unknown outcomes must be reconciled rather than automatically resent.</p>
    </main>
  );
}

function WalletPanel({ overview, canFund, fundingKey, onChecked }: { overview: MessagingOverview; canFund: boolean; fundingKey: string; onChecked: () => void }) {
  const [page, setPage] = useState<MessagingWalletPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<MessagingWalletPage>("/messaging/wallet/transactions", { signal: controller.signal }).then(setPage).catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [revision]);
  async function more() {
    if (!page?.nextCursor || busy) return;
    setBusy(true); setError(null);
    try { const next = await apiFetch<MessagingWalletPage>("/messaging/wallet/transactions?cursor=" + encodeURIComponent(page.nextCursor)); setPage({ ...next, items: [...page.items, ...next.items] }); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl bg-[#0E5C43] p-5 text-white"><Wallet className="h-6 w-6" /><p className="mt-4 text-sm text-emerald-100">Available SMS credit</p><p className="mt-1 break-all text-3xl font-semibold tabular-nums">{formatKobo(BigInt(overview.wallet.availableKobo))}</p>{overview.wallet.lowBalance === true && <p className="mt-2 text-sm">Balance is low.</p>}</section>
      <section className={panel}><p className="text-sm text-muted-foreground">Reserved for messages</p><p className="mt-2 break-all text-3xl font-semibold tabular-nums">{formatKobo(BigInt(overview.wallet.reservedKobo))}</p><p className="mt-2 text-sm text-muted-foreground">Held until confirmed provider charges are reconciled.</p></section>
    </div>
    {canFund ? <WalletFunding availability={overview.topUps} storageKey={fundingKey} onChecked={() => { setRevision((n) => n + 1); onChecked(); }} /> : <section className={panel}><h2 className="font-semibold">Wallet funding</h2><p className="mt-1 text-sm text-muted-foreground">Only an authorised school owner can fund this wallet.</p></section>}
    <section className={panel}><h2 className="text-lg font-semibold">Transaction history</h2>
      {error && <div className="mt-3 space-y-2"><Notice>{error}</Notice><Button variant="outline" size="sm" onClick={() => { setError(null); setRevision((n) => n + 1); }}>Reload transactions</Button></div>}
      {!page && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading transactions…</p>}
      {page?.items.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No messaging transactions yet.</p>}
      <ul className="mt-2 divide-y">{page?.items.map((entry) => <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{{ TOP_UP: "Top-up", RESERVE: "Reserved", SETTLE: "Settled", RELEASE: "Released" }[entry.kind]}</p><p className="text-xs text-muted-foreground">{dateLabel(entry.createdAt)}</p></div><div className="text-right"><p className="font-semibold tabular-nums">{formatKobo(BigInt(entry.amountKobo))}</p>{entry.releasedKobo && <p className="text-xs text-muted-foreground">Released: {formatKobo(BigInt(entry.releasedKobo))}</p>}</div></li>)}</ul>
      {page?.nextCursor && <Button variant="outline" disabled={busy} onClick={() => void more()}>{busy ? "Loading…" : "Load more"}</Button>}
    </section>
  </div>;
}

function HistoryPanel({ canCancel }: { canCancel: boolean }) {
  const [page, setPage] = useState<MessagingDeliveryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<MessagingDeliveryPage>("/messaging/deliveries", { signal: controller.signal }).then(setPage).catch((e: unknown) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [revision]);
  async function more() {
    if (!page?.nextCursor || busy) return;
    setBusy(true); setError(null);
    try { const next = await apiFetch<MessagingDeliveryPage>("/messaging/deliveries?cursor=" + encodeURIComponent(page.nextCursor)); setPage({ ...next, items: [...page.items, ...next.items] }); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    if (busy || !canCancel || !window.confirm("Cancel this queued message? A message already claimed by the provider cannot be recalled.")) return;
    setBusy(true); setError(null); setFeedback("");
    try { await apiFetch("/messaging/deliveries/" + encodeURIComponent(id) + "/cancel", { method: "POST" }); setFeedback("Queued message cancelled."); setRevision((n) => n + 1); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className={panel}>
    <div className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">Paid message delivery history</h2></div>
    <p className="mt-1 text-sm text-muted-foreground">This list covers the unified paid messaging queue, not all previous emails or app notifications.</p>
    {error && <div className="mt-3 space-y-2"><Notice>{error}</Notice><Button variant="outline" size="sm" onClick={() => { setError(null); setRevision((n) => n + 1); }}>Reload history</Button></div>}
    {feedback && <p role="status" className="mt-2 text-sm">{feedback}</p>}
    {!page && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading deliveries…</p>}
    {page?.items.length === 0 && <p className="mt-4 text-sm text-muted-foreground">No paid message deliveries yet.</p>}
    <ul className="mt-3 divide-y">{page?.items.map((entry) => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-3 py-4 text-sm">
      <div className="min-w-0"><p className="font-medium">{CHANNELS[entry.channel].label}</p><p className="text-xs text-muted-foreground">Created {dateLabel(entry.createdAt)} · Updated {dateLabel(entry.updatedAt)}</p><p className="break-all text-xs text-muted-foreground">{entry.id}</p>{entry.reasonCode && <p className="mt-1 break-all text-xs text-muted-foreground">{BLOCKERS[entry.reasonCode] ?? entry.reasonCode}</p>}</div>
      <div className="space-y-2 text-right"><Status label={DELIVERY[entry.state] ?? entry.state} good={entry.state === "DELIVERED" || entry.state === "READ"} />{entry.estimatedKobo !== undefined && <p className="text-xs text-muted-foreground">Estimate: {formatKobo(BigInt(entry.estimatedKobo))}</p>}{canCancel && entry.state === "QUEUED" && <Button variant="outline" size="sm" disabled={busy} onClick={() => void cancel(entry.id)}>Cancel queued message</Button>}</div>
    </li>)}</ul>
    {page?.nextCursor && <Button variant="outline" disabled={busy} onClick={() => void more()}>{busy ? "Loading…" : "Load more"}</Button>}
  </section>;
}

function WhatsAppPanel({ overview, canManage, onChange }: { overview: MessagingOverview; canManage: boolean; onChange: () => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const status = overview.whatsapp.status;
  async function inspect() {
    setBusy(true); setError(null); setHealth(null); setCatalogue(null);
    try {
      const [nextHealth, nextCatalogue] = await Promise.all([apiFetch<Health>("/messaging/whatsapp/connection/health"), apiFetch<Catalogue>("/messaging/whatsapp/templates")]);
      setHealth(nextHealth); setCatalogue(nextCatalogue);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!canManage || busy || !window.confirm("Disconnect this school's WhatsApp account? Queued WhatsApp messages will be cancelled and existing guardian WhatsApp consent grants invalidated.")) return;
    setBusy(true); setError(null); setFeedback("");
    try {
      const result = await apiFetch<{ status: "DISCONNECTED"; revocationPending: boolean }>("/messaging/whatsapp/connection", { method: "DELETE" });
      setHealth(null); setCatalogue(null); setFeedback(result.revocationPending ? "Disconnected locally. Provider token revocation still needs confirmation." : "WhatsApp disconnected."); onChange();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Your school's WhatsApp account</h2><Status label={(health?.status ?? status).toLowerCase().replace(/^./, (c) => c.toUpperCase())} good={(health?.status ?? status) === "CONNECTED"} /></div>
      <p className="mt-2 text-sm text-muted-foreground">Use your school's own business identity. Meta charges your school directly. Connecting and sending are separate steps and require platform approval.</p>
      {status === "DISCONNECTED" && <p className="mt-4 rounded-xl bg-muted p-3 text-sm">Account connection is not available in this interface yet. Existing email and app notifications can still be managed in notification settings.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || status === "DISCONNECTED"} onClick={() => void inspect()}>{busy ? "Working…" : "Check account and templates"}</Button>
        {canManage && status !== "DISCONNECTED" && <Button variant="destructive" disabled={busy} onClick={() => void disconnect()}>Disconnect</Button>}
      </div>
      {error && <div className="mt-3"><Notice>{error}</Notice></div>}
      {feedback && <p role="status" className="mt-3 text-sm">{feedback}</p>}
    </section>
    <section className={panel}><h2 className="text-lg font-semibold">Message templates</h2><p className="mt-1 text-sm text-muted-foreground">Provider approval alone does not authorise a template for automatic dispatch. SchoolKit also checks the exact language, content and billing category.</p>
      {catalogue && !catalogue.available && <p className="mt-3 text-sm text-muted-foreground">The provider catalogue is unavailable. Approval cannot be confirmed.</p>}
      {catalogue?.truncated && <p className="mt-3 text-sm text-muted-foreground">Only part of the provider catalogue is available.</p>}
      <ul className="mt-3 divide-y">{(catalogue?.available ? catalogue.templates : overview.templates.map((t) => ({ ...t, id: t.name, category: null }))).map((t) => <li key={t.id} className="flex flex-wrap items-start justify-between gap-2 py-3"><div><p className="text-sm font-medium">{t.name.replaceAll("_", " ")}</p><p className="text-xs text-muted-foreground">{t.language ?? "Language not verified"}{t.category && " · " + t.category}</p></div><Status label={t.approval === "UNKNOWN" ? "Not verified" : t.approval.toLowerCase()} /></li>)}</ul>
      {catalogue?.available && catalogue.templates.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No matching templates on this account.</p>}
    </section>
  </div>;
}
