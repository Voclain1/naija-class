import type { PrepareReminderCampaignInput, ReminderCampaignDto, ReminderCampaignProposalDto } from "@school-kit/types";
import { ApiError } from "@/lib/api-client";
import { durableCampaignApi } from "./durable-api";
export interface DurableState {
  phase: "idle" | "preparing" | "prepare-error" | "review" | "confirming" | "recovering" | "unknown" | "refresh-needed" | "refresh-error" | "refreshing" | "live" | "status-loading" | "status-error" | "acting";
  proposal: ReminderCampaignProposalDto | null; campaign: ReminderCampaignDto | null; campaignId: string | null; message: string | null;
}
const initial: DurableState = { phase: "idle", proposal: null, campaign: null, campaignId: null, message: null };
const conflicts = new Set(["REMINDER_PREVIEW_MISMATCH", "REMINDER_PREVIEW_STALE", "REMINDER_PREVIEW_EXPIRED"]);
const text = (e: unknown) => e instanceof ApiError ? e.message : "Could not get a confirmed response. Check your connection and try again.";
export class DurableCampaignSession {
  private state = initial; private listeners = new Set<() => void>(); private working = false; private disposed = false;
  private input: PrepareReminderCampaignInput | null = null; private refreshId: string | null = null; private proposalId: string | null = null;
  constructor(private api = durableCampaignApi, private uuid = () => crypto.randomUUID()) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<DurableState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); } }
  dispose() { this.disposed = true; this.input = null; this.listeners.clear(); }
  async start(input: Omit<PrepareReminderCampaignInput, "clientRequestId">) {
    if (this.disposed || this.state.phase !== "idle") return;
    this.input = { ...structuredClone(input), clientRequestId: this.uuid() }; await this.prepare();
  }
  async prepare() {
    if (this.disposed || this.working || !this.input || !["idle", "prepare-error"].includes(this.state.phase)) return;
    this.working = true; this.set({ phase: "preparing", message: null });
    try { await this.acceptProposal(await this.api.prepare(this.input)); }
    catch (e) { this.set({ phase: "prepare-error", message: text(e) }); }
    finally { this.working = false; }
  }
  private async acceptProposal(p: ReminderCampaignProposalDto) {
    if (this.disposed) return;
    this.proposalId = p.id; this.set({ proposal: p });
    if (p.campaignId) { this.set({ campaignId: p.campaignId }); await this.readCampaign(p.campaignId); }
    else if (p.status === "EXPIRED" || Date.parse(p.expiresAt) <= Date.now()) this.set({ phase: "refresh-needed", message: "This preview expired. Refresh it and review again, or start a new selection if its rows were cleared." });
    else this.set({ phase: "review", message: null });
  }
  private async readCampaign(id: string) {
    try { const c = await this.api.campaign(id); this.set({ phase: "live", campaign: c, campaignId: c.id, message: null }); }
    catch (e) { this.set({ phase: "status-error", campaignId: id, message: text(e) }); }
  }
  async recoverProposal(id: string) {
    if (this.disposed || this.working) return;
    this.proposalId = id; this.working = true; this.set({ phase: "recovering", message: null });
    try { await this.acceptProposal(await this.api.proposal(id)); }
    catch (e) { this.set({ phase: "unknown", message: `The original preview could not be checked. Do not prepare another run after an uncertain confirmation. ${text(e)}` }); }
    finally { this.working = false; }
  }
  async check() { if (this.state.campaignId) await this.loadCampaign(this.state.campaignId); else if (this.proposalId) await this.recoverProposal(this.proposalId); }
  async loadCampaign(id: string) {
    if (this.disposed || this.working) return;
    this.working = true; this.set({ phase: "status-loading", campaignId: id });
    try { await this.readCampaign(id); } finally { this.working = false; }
  }
  async confirm() {
    const p = this.state.proposal;
    if (this.disposed || this.working || this.state.phase !== "review" || !p?.canConfirm) return;
    if (Date.parse(p.expiresAt) <= Date.now()) { this.set({ phase: "refresh-needed", message: "This preview expired. Refresh and review again." }); return; }
    this.working = true; this.set({ phase: "confirming", message: null });
    try { const c = await this.api.confirm(p.id, p.previewHash); this.set({ phase: "live", campaign: c, campaignId: c.id }); }
    catch (e) {
      if (e instanceof ApiError && conflicts.has(e.code)) this.set({ phase: "refresh-needed", message: e.message });
      else if (e instanceof ApiError && e.status > 0 && e.status < 500) this.set({ phase: "refresh-needed", message: e.message });
      else {
        this.set({ phase: "recovering", message: "Checking the original proposal after the lost confirmation response…" });
        try { await this.acceptProposal(await this.api.proposal(p.id)); }
        catch { this.set({ phase: "unknown", message: "Confirmation may already have succeeded. Check this original preview; do not prepare another run." }); }
      }
    } finally { this.working = false; }
  }
  async refresh() {
    const p = this.state.proposal;
    if (this.disposed || this.working || !p || !(["refresh-needed", "refresh-error"].includes(this.state.phase) || (this.state.phase === "review" && Date.parse(p.expiresAt) <= Date.now()))) return;
    this.working = true; this.refreshId ??= this.uuid(); this.set({ phase: "refreshing", message: null });
    try {
      const next = await this.api.refresh(p.id, this.refreshId);
      this.refreshId = null; await this.acceptProposal(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "REMINDER_ALREADY_CONFIRMED") {
        try { await this.acceptProposal(await this.api.proposal(p.id)); } catch { this.set({ phase: "unknown", message: "This preview was already confirmed. Check its original outcome." }); }
      } else this.set({ phase: "refresh-error", message: text(e) });
    } finally { this.working = false; }
  }
  async act(action: "halt" | "resume") {
    const c = this.state.campaign;
    if (this.disposed || this.working || this.state.phase !== "live" || !c || (action === "resume" && c.status !== "HALTED") || (action === "halt" && c.status !== "RUNNING")) return;
    this.working = true; this.set({ phase: "acting", message: null });
    try { const next = await this.api[action](c.id); this.set({ phase: "live", campaign: next }); }
    catch { await this.readCampaign(c.id); }
    finally { this.working = false; }
  }
}
