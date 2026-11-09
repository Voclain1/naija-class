import type { PrepareStudentCorrectionsInput, StudentCorrectionProposalDto } from "@school-kit/types";
import { ApiError } from "@/lib/api-client";
import { correctionsApi } from "./api";
export interface CorrectionState { phase: "idle" | "preparing" | "prepare-error" | "review" | "confirming" | "checking" | "unknown" | "refresh-needed" | "refresh-error" | "refreshing" | "completed"; proposal: StudentCorrectionProposalDto | null; message: string | null }
const initial: CorrectionState = { phase: "idle", proposal: null, message: null };
const conflicts = new Set(["CORRECTION_PREVIEW_MISMATCH", "CORRECTION_PREVIEW_STALE", "CORRECTION_EXPIRED", "CORRECTION_RETRY"]);
const text = (e: unknown) => e instanceof ApiError ? e.message : "Could not get a confirmed response. Check your connection and try again.";
export class CorrectionSession {
  private state = initial; private listeners = new Set<() => void>(); private input: PrepareStudentCorrectionsInput | null = null;
  private working = false; private disposed = false; private id: string | null = null; private refreshId: string | null = null;
  constructor(private api = correctionsApi, private uuid = () => crypto.randomUUID()) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(patch: Partial<CorrectionState>) { if (!this.disposed) { this.state = { ...this.state, ...patch }; this.listeners.forEach((fn) => fn()); } }
  dispose() { this.disposed = true; this.input = null; this.listeners.clear(); }
  cancel() { if (!this.working && ["review", "prepare-error", "refresh-needed", "refresh-error", "completed"].includes(this.state.phase)) { this.input = null; this.id = null; this.refreshId = null; this.set(initial); } }
  async start(corrections: PrepareStudentCorrectionsInput["corrections"]) {
    if (this.disposed || this.working || this.state.phase !== "idle") return;
    this.input = { clientRequestId: this.uuid(), corrections: structuredClone(corrections) }; await this.prepare();
  }
  private accept(p: StudentCorrectionProposalDto) {
    if (this.disposed) return;
    this.id = p.id;
    if (p.status === "COMPLETED") {
      const o = p.outcome; const ids = this.input ? new Set(this.input.corrections.map((r) => r.studentId)) : null;
      if (!o || !Number.isSafeInteger(o.updatedCount) || o.updatedCount < 0 || o.updatedCount !== o.students.length || new Set(o.students.map((s) => s.studentId)).size !== o.students.length || (ids && o.students.some((s) => !ids.has(s.studentId)))) { this.set({ phase: "unknown", proposal: p, message: "The completed result could not be verified. Check the original review; do not apply these corrections again." }); return; }
      this.set({ phase: "completed", proposal: p, message: null }); return;
    }
    if (p.status === "EXPIRED" || Date.parse(p.expiresAt) <= Date.now()) this.set({ phase: "refresh-needed", proposal: p, message: "This review expired. Refresh it; if its values were cleared, return to the editor and prepare a new review." });
    else this.set({ phase: "review", proposal: p, message: null });
  }
  async prepare() {
    if (this.disposed || this.working || !this.input || !["idle", "prepare-error"].includes(this.state.phase)) return;
    this.working = true; this.set({ phase: "preparing", message: null });
    try { this.accept(await this.api.prepare(this.input)); } catch (e) { this.set({ phase: "prepare-error", message: text(e) }); } finally { this.working = false; }
  }
  async recover(id: string) {
    if (this.disposed || this.working) return;
    this.id = id; this.working = true; this.set({ phase: "checking", message: null });
    try { this.accept(await this.api.get(id)); } catch (e) { this.set({ phase: "unknown", message: `The original review could not be checked. Do not start another save after an uncertain confirmation. ${text(e)}` }); } finally { this.working = false; }
  }
  async check() { if (this.id) await this.recover(this.id); }
  async confirm() {
    const p = this.state.proposal;
    if (this.disposed || this.working || this.state.phase !== "review" || !p?.canConfirm) return;
    if (Date.parse(p.expiresAt) <= Date.now()) { this.set({ phase: "refresh-needed", message: "This review expired. Refresh and check the values again." }); return; }
    this.working = true; this.set({ phase: "confirming", message: null });
    try { this.accept(await this.api.confirm(p.id, p.previewHash)); }
    catch (e) {
      if (e instanceof ApiError && (conflicts.has(e.code) || (e.status > 0 && e.status < 500))) this.set({ phase: "refresh-needed", message: e.message });
      else { this.set({ phase: "checking", message: "Checking the original review after the lost save response…" }); try { this.accept(await this.api.get(p.id)); } catch { this.set({ phase: "unknown", message: "These corrections may already have been applied. Check the original review; do not prepare another batch." }); } }
    } finally { this.working = false; }
  }
  async refresh() {
    const p = this.state.proposal;
    if (this.disposed || this.working || !p || !(["refresh-needed", "refresh-error"].includes(this.state.phase) || (this.state.phase === "review" && Date.parse(p.expiresAt) <= Date.now()))) return;
    this.working = true; this.refreshId ??= this.uuid(); this.set({ phase: "refreshing", message: null });
    try {
      let next: StudentCorrectionProposalDto;
      try { next = await this.api.refresh(p.id, this.refreshId); }
      catch (e) {
        if (e instanceof ApiError && e.code === "CORRECTION_ALREADY_CONFIRMED") { this.accept(await this.api.get(p.id)); return; }
        if (!(e instanceof ApiError) || e.code !== "CORRECTION_EXPIRED" || !this.input) throw e;
        next = await this.api.prepare({ ...this.input, clientRequestId: this.refreshId });
      }
      this.refreshId = null; this.accept(next);
    } catch (e) { this.set({ phase: "refresh-error", message: text(e) }); } finally { this.working = false; }
  }
}
