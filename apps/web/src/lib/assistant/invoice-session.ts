import type { BillingRunDto, BillingRunInput } from "@school-kit/types";
import { ApiError } from "@/lib/api-client";
import { invoiceRunApi } from "./api";

// One term-invoice run in the assistant (docs/modules/assistant-workspace.md,
// assistant-billing.md). The server owns the preview and its hash; approval
// is a separate request that re-checks everything. A lost approval response
// reads the SAME run: it never prepares or approves again on its own.

export type InvoicePhase = "idle" | "preparing" | "prepare-error" | "review" | "approving" | "checking" | "unknown" | "stale" | "done";
export interface InvoiceState { phase: InvoicePhase; run: BillingRunDto | null; message: string | null }
type Api = Pick<typeof invoiceRunApi, "prepare" | "get" | "approve">;
const staleCodes = new Set(["BILLING_PREVIEW_CHANGED", "BILLING_EXPIRED", "BILLING_RESULT_CHANGED", "BILLING_RETRY", "BILLING_BLOCKED"]);
const text = (e: unknown) => (e instanceof ApiError ? e.message : "Could not get a reliable response. Check your connection.");

export class InvoiceRunSession {
  private state: InvoiceState = { phase: "idle", run: null, message: null };
  private listeners = new Set<() => void>();
  private input: BillingRunInput | null = null;
  private working = false;
  private disposed = false;
  constructor(private api: Api = invoiceRunApi, private onRun: (run: BillingRunDto) => void = () => {}) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(phase: InvoicePhase, run = this.state.run, message: string | null = null) {
    if (this.disposed) return;
    this.state = { phase, run, message };
    if (run) this.onRun(run);
    this.listeners.forEach((fn) => fn());
  }
  dispose() { this.disposed = true; this.listeners.clear(); this.input = null; }

  async prepare(input: BillingRunInput) {
    if (this.disposed || this.working || !["idle", "prepare-error", "stale"].includes(this.state.phase)) return;
    this.input = structuredClone(input);
    this.working = true; this.set("preparing", null);
    try { this.accept(await this.api.prepare(this.input)); }
    catch (e) { this.set("prepare-error", null, text(e)); }
    finally { this.working = false; }
  }
  /** A fresh preview of the same selection, after the person asks for it. */
  async refresh() {
    if (!this.input || this.state.phase !== "stale") return;
    await this.prepare(this.input);
  }
  private accept(run: BillingRunDto) {
    if (run.status === "COMPLETED") { this.set("done", run); return; }
    if (Date.parse(run.expiresAt) <= Date.now()) { this.set("stale", run, "This preview expired. Prepare a fresh one and review it again."); return; }
    this.set("review", run);
  }
  async approve() {
    const run = this.state.run;
    if (this.disposed || this.working || this.state.phase !== "review" || !run || run.blockers.length > 0) return;
    this.working = true; this.set("approving");
    try { this.accept(await this.api.approve(run.id, run.previewHash)); }
    catch (e) {
      if (e instanceof ApiError && staleCodes.has(e.code)) this.set("stale", run, e.message);
      else if (e instanceof ApiError && e.status > 0 && e.status < 500) this.set("stale", run, e.message);
      else { this.set("checking", run, "The approval response was lost. Checking the original run…"); await this.read(run.id); }
    } finally { this.working = false; }
  }
  private async read(id: string) {
    try { this.accept(await this.api.get(id)); }
    catch { this.set("unknown", this.state.run, "Whether these invoices were issued is not confirmed. Check this original run; do not prepare another."); }
  }
  /** Re-reads the original run (after a lost response, or from a reference). */
  async check(id = this.state.run?.id) {
    if (this.disposed || this.working || !id) return;
    this.working = true; this.set("checking");
    try { await this.read(id); } finally { this.working = false; }
  }
}
