import type { PrepareStudentIntakeInput, StudentIntakeOutcomeDto, StudentIntakeProposalDto } from "@school-kit/types";
import { ApiError } from "@/lib/api-client";
import { intakeApi } from "./intake-api";

export type IntakePhase = "idle" | "preparing" | "prepare-error" | "review" | "confirming" | "checking" | "unknown" | "refresh-needed" | "refreshing" | "refresh-error";
export interface IntakeState { phase: IntakePhase; proposal: StudentIntakeProposalDto | null; message: string | null }
type Api = Pick<typeof intakeApi, "prepare" | "get" | "confirm" | "refresh">;
const idle: IntakeState = { phase: "idle", proposal: null, message: null };
const refreshCodes = new Set(["INTAKE_PREVIEW_STALE", "INTAKE_PREVIEW_MISMATCH", "INTAKE_EXPIRED", "INTAKE_RETRY"]);
const message = (e: unknown) => e instanceof ApiError ? e.message : "Could not get a reliable response. Check your connection and try again.";

/** In-memory, single-batch transaction UI. A lost confirm NEVER starts a new prepare. */
export class IntakeSession {
  private state: IntakeState = idle;
  private listeners = new Set<() => void>();
  private input: PrepareStudentIntakeInput | null = null;
  private resolve: ((outcome: StudentIntakeOutcomeDto | null) => void) | null = null;
  private working = false;
  private disposed = false;
  private refreshId: string | null = null;
  constructor(private api: Api = intakeApi, private uuid: () => string = () => crypto.randomUUID()) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(phase: IntakePhase, proposal = this.state.proposal, text: string | null = null) {
    if (this.disposed) return;
    this.state = { phase, proposal, message: text }; this.listeners.forEach((fn) => fn());
  }
  start(input: Omit<PrepareStudentIntakeInput, "clientRequestId">): Promise<StudentIntakeOutcomeDto | null> {
    if (this.disposed || this.resolve) throw new Error("An intake is already open.");
    this.input = { ...structuredClone(input), clientRequestId: this.uuid() };
    const result = new Promise<StudentIntakeOutcomeDto | null>((resolve) => { this.resolve = resolve; });
    void this.prepare(); return result;
  }
  private finish(outcome: StudentIntakeOutcomeDto | null) {
    const resolve = this.resolve; this.resolve = null; this.input = null; this.refreshId = null;
    this.set("idle", null); resolve?.(outcome);
  }
  cancel() {
    if (["review", "prepare-error", "refresh-needed", "refresh-error"].includes(this.state.phase) && !this.working) this.finish(null);
  }
  dispose() { this.disposed = true; this.finish(null); this.listeners.clear(); }
  private accept(p: StudentIntakeProposalDto) {
    if (p.status === "COMPLETED") {
      const o = p.outcome; const n = this.input?.students.length;
      const indexes = o?.students.map((s) => s.index);
      if (!o || n === undefined || o.createdCount !== n || o.students.length !== n || new Set(indexes).size !== n || o.students.some((s) => s.index < 0 || s.index >= n || !s.studentId)) {
        this.set("unknown", p, "The server reported completion but its result could not be verified. Check the roster; do not start another intake."); return;
      }
      this.finish(o); return;
    }
    if (p.status === "EXPIRED" || Date.parse(p.expiresAt) <= Date.now()) this.set("refresh-needed", p, "This preview has expired. Refresh and review again before saving.");
    else this.set("review", p);
  }
  async prepare() {
    if (this.disposed || this.working || !this.input || !["idle", "prepare-error"].includes(this.state.phase)) return;
    this.working = true; this.set("preparing", null);
    try { const p = await this.api.prepare(this.input); if (!this.disposed) this.accept(p); }
    catch (e) { this.set("prepare-error", null, message(e)); }
    finally { this.working = false; }
  }
  async confirm() {
    const p = this.state.proposal;
    if (this.disposed || this.working || this.state.phase !== "review" || !p?.canConfirm) return;
    if (Date.parse(p.expiresAt) <= Date.now()) { this.set("refresh-needed", p, "This preview expired. Refresh and review again."); return; }
    this.working = true; this.set("confirming");
    try { const next = await this.api.confirm(p.id, p.previewHash); if (!this.disposed) this.accept(next); }
    catch (e) {
      if (e instanceof ApiError && refreshCodes.has(e.code)) this.set("refresh-needed", p, e.message);
      else if (e instanceof ApiError && e.status > 0 && e.status < 500) this.set("refresh-needed", p, e.message);
      else {
        // Confirmation may already have committed. Read the same proposal only.
        this.set("checking", p, "The save response was lost. Checking the original intake…");
        await this.readOutcome(p.id);
      }
    } finally { this.working = false; }
  }
  private async readOutcome(id: string) {
    try { const p = await this.api.get(id); if (!this.disposed) this.accept(p); }
    catch { this.set("unknown", this.state.proposal, "The save outcome is not confirmed. Check the original intake below; do not enter these students again."); }
  }
  async check() {
    if (this.disposed || this.working || this.state.phase !== "unknown" || !this.state.proposal) return;
    this.working = true; this.set("checking");
    try { await this.readOutcome(this.state.proposal!.id); } finally { this.working = false; }
  }
  async refresh() {
    const p = this.state.proposal;
    if (this.disposed || this.working || !p || !(["refresh-needed", "refresh-error"].includes(this.state.phase) || (this.state.phase === "review" && Date.parse(p.expiresAt) <= Date.now()))) return;
    this.working = true; this.refreshId ??= this.uuid(); this.set("refreshing");
    try {
      let next: StudentIntakeProposalDto;
      try { next = await this.api.refresh(p.id, this.refreshId); }
      catch (e) {
        if (e instanceof ApiError && e.code === "INTAKE_ALREADY_CONFIRMED") { await this.readOutcome(p.id); return; }
        // An expired payload cannot be refreshed; create a new preview from the
        // same in-memory rows only after the server explicitly says EXPIRED.
        if (!(e instanceof ApiError) || e.code !== "INTAKE_EXPIRED" || !this.input) throw e;
        next = await this.api.prepare({ ...this.input, clientRequestId: this.refreshId });
      }
      if (!this.disposed) { this.refreshId = null; this.accept(next); }
    } catch (e) { this.set("refresh-error", p, message(e)); }
    finally { this.working = false; }
  }
}
