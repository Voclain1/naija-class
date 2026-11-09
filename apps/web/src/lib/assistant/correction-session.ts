import type { PrepareStudentCorrectionsInput, StudentCorrectionProposalDto } from "@school-kit/types";
import { ApiError } from "@/lib/api-client";
import { correctionApi } from "./api";

// One batch of student-record corrections (docs/modules/student-corrections.md).
// The server's before/after preview is what the person confirms. A lost
// confirmation reads the ORIGINAL proposal; a stale preview needs a fresh,
// explicitly requested refresh and a new review.

export type CorrectionPhase = "idle" | "preparing" | "prepare-error" | "review" | "confirming" | "checking" | "unknown" | "refresh-needed" | "refreshing" | "refresh-error" | "done";
export interface CorrectionState { phase: CorrectionPhase; proposal: StudentCorrectionProposalDto | null; message: string | null }
type Api = Pick<typeof correctionApi, "prepare" | "get" | "confirm" | "refresh">;
const refreshCodes = new Set(["CORRECTION_PREVIEW_STALE", "CORRECTION_PREVIEW_MISMATCH", "CORRECTION_EXPIRED", "CORRECTION_RETRY"]);
const text = (e: unknown) => (e instanceof ApiError ? e.message : "Could not get a reliable response. Check your connection.");

export class CorrectionSession {
  private state: CorrectionState = { phase: "idle", proposal: null, message: null };
  private listeners = new Set<() => void>();
  private input: PrepareStudentCorrectionsInput | null = null;
  private refreshId: string | null = null;
  private working = false;
  private disposed = false;
  constructor(private api: Api = correctionApi, private uuid: () => string = () => crypto.randomUUID(), private onProposal: (p: StudentCorrectionProposalDto) => void = () => {}) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(phase: CorrectionPhase, proposal = this.state.proposal, message: string | null = null) {
    if (this.disposed) return;
    this.state = { phase, proposal, message };
    if (proposal) this.onProposal(proposal);
    this.listeners.forEach((fn) => fn());
  }
  dispose() { this.disposed = true; this.listeners.clear(); this.input = null; }

  /** Prepares once per batch; a retry of the same prepare reuses its clientRequestId. */
  async prepare(corrections?: PrepareStudentCorrectionsInput["corrections"]) {
    if (this.disposed || this.working || !["idle", "prepare-error"].includes(this.state.phase)) return;
    if (corrections) this.input = { clientRequestId: this.uuid(), corrections: structuredClone(corrections) };
    if (!this.input) return;
    this.working = true; this.set("preparing", null);
    try { this.accept(await this.api.prepare(this.input)); }
    catch (e) { this.set("prepare-error", null, text(e)); }
    finally { this.working = false; }
  }
  private accept(p: StudentCorrectionProposalDto) {
    if (p.status === "COMPLETED") { this.set("done", p); return; }
    if (p.status === "EXPIRED" || Date.parse(p.expiresAt) <= Date.now()) { this.set("refresh-needed", p, "This preview expired. Refresh it and review again."); return; }
    this.set("review", p);
  }
  async confirm() {
    const p = this.state.proposal;
    if (this.disposed || this.working || this.state.phase !== "review" || !p?.canConfirm) return;
    this.working = true; this.set("confirming");
    try { this.accept(await this.api.confirm(p.id, p.previewHash)); }
    catch (e) {
      if (e instanceof ApiError && refreshCodes.has(e.code)) this.set("refresh-needed", p, e.message);
      else if (e instanceof ApiError && e.status > 0 && e.status < 500) this.set("refresh-needed", p, e.message);
      else { this.set("checking", p, "The confirmation response was lost. Checking the original corrections…"); await this.read(p.id); }
    } finally { this.working = false; }
  }
  private async read(id: string) {
    try { this.accept(await this.api.get(id)); }
    catch { this.set("unknown", this.state.proposal, "Whether these corrections were applied is not confirmed. Check the original review; do not prepare them again."); }
  }
  async check(id = this.state.proposal?.id) {
    if (this.disposed || this.working || !id) return;
    this.working = true; this.set("checking");
    try { await this.read(id); } finally { this.working = false; }
  }
  async refresh() {
    const p = this.state.proposal;
    if (this.disposed || this.working || !p || !["refresh-needed", "refresh-error"].includes(this.state.phase)) return;
    this.working = true; this.refreshId ??= this.uuid(); this.set("refreshing");
    try {
      const next = await this.api.refresh(p.id, this.refreshId);
      this.refreshId = null; this.accept(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "CORRECTION_ALREADY_CONFIRMED") await this.read(p.id);
      else if (e instanceof ApiError && e.code === "CORRECTION_EXPIRED" && this.input) {
        // The values were cleared on expiry: a new prepare from the same in-memory edits.
        this.state = { ...this.state, phase: "idle" };
        this.input = { ...this.input, clientRequestId: this.refreshId! };
        this.refreshId = null; this.working = false;
        await this.prepare();
        return;
      } else this.set("refresh-error", p, text(e));
    } finally { this.working = false; }
  }
}
