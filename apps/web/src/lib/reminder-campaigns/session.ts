import type { NotificationPreferenceDto, SendRemindersInput, SendRemindersResult } from "@school-kit/types";
import { reminderAudience, reminderBatches, validReminderResult, MAX_REMINDER_CAMPAIGN_STUDENTS, type ReminderFilters, type ReminderStudent } from "./audience";
import { listDebtors, sendReminders } from "@/lib/finance/finance-api";
import { getNotificationPreferences } from "@/lib/notifications/notifications-api";
import { ApiError } from "@/lib/api-client";

export type BatchState = { studentIds: string[]; status: "waiting" | "sending" | "confirmed" | "uncertain"; result?: SendRemindersResult };
export interface CampaignState {
  phase: "idle" | "loading" | "review" | "load-error" | "sending" | "done" | "uncertain";
  recipients: ReminderStudent[]; batches: BatchState[]; removed: number;
  channels: NotificationPreferenceDto | null; message: string | null;
}
export interface CampaignRequest { termId: string; termLabel: string; studentIds: string[]; filters: ReminderFilters; canReadChannels: boolean; canReadGuardians?: boolean }
const empty: CampaignState = { phase: "idle", recipients: [], batches: [], removed: 0, channels: null, message: null };
const defaultApi = { list: listDebtors, send: sendReminders, channels: getNotificationPreferences };

/** Local run journal only. No server dedupe exists: never retry an uncertain send. */
export class ReminderCampaignSession {
  private state = empty;
  private request: CampaignRequest | null = null;
  private listeners = new Set<() => void>();
  private working = false;
  private disposed = false;
  constructor(private api: typeof defaultApi = defaultApi) {}
  snapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(update: Partial<CampaignState>) { if (this.disposed) return; this.state = { ...this.state, ...update }; this.listeners.forEach((fn) => fn()); }
  async open(request: CampaignRequest) {
    if (this.disposed || this.working || this.state.phase !== "idle") return;
    this.request = structuredClone(request); await this.load();
  }
  async load() {
    if (this.disposed || this.working || !this.request || !["idle", "load-error"].includes(this.state.phase)) return;
    this.working = true; this.set({ phase: "loading", message: null });
    try {
      const [rows, channels] = await Promise.all([this.api.list(this.request.termId), this.request.canReadChannels ? this.api.channels() : Promise.resolve(null)]);
      if (this.disposed) return;
      const ids = new Set(this.request.studentIds);
      const recipients = reminderAudience(rows, this.request.filters).filter((s) => ids.has(s.studentId));
      if (recipients.length > MAX_REMINDER_CAMPAIGN_STUDENTS) throw new Error("Too many students in this run. Choose up to 500.");
      this.set({ phase: "review", recipients, channels, removed: ids.size - recipients.length, batches: reminderBatches(recipients.map((s) => s.studentId)).map((studentIds) => ({ studentIds, status: "waiting" })) });
    } catch (e) { this.set({ phase: "load-error", message: e instanceof ApiError ? e.message : "Could not prepare the review. No reminders have been requested." }); }
    finally { this.working = false; }
  }
  close() {
    if (this.working || !["review", "load-error", "done"].includes(this.state.phase)) return;
    this.request = null; this.set(empty);
  }
  async send() {
    if (this.disposed || this.working || this.state.phase !== "review" || !this.request || !this.state.recipients.length) return;
    const c = this.state.channels;
    if (c && !c.emailEnabled && !c.smsEnabled && !c.pushEnabled) return;
    this.working = true; this.set({ phase: "sending", message: null });
    for (let index = 0; index < this.state.batches.length; index++) {
      if (this.disposed) break;
      const batch = this.state.batches[index]!;
      this.batch(index, { status: "sending" });
      const input: SendRemindersInput = { termId: this.request.termId, studentIds: [...batch.studentIds] };
      try {
        const result = await this.api.send(input);
        if (this.disposed) break;
        if (!validReminderResult(result, batch.studentIds.length)) throw new Error("Unverified result");
        this.batch(index, { status: "confirmed", result });
        if (result.noChannel) {
          this.set({ phase: "done", message: "No delivery channel is available. The remaining batches were not requested. Ask your administrator to check notification settings and provider setup." });
          this.working = false; return;
        }
      } catch {
        this.batch(index, { status: "uncertain" });
        this.set({ phase: "uncertain", message: "The last batch has no confirmed result. Some reminders may already have been sent. Remaining batches were not requested. Do not send this run again or reload to retry; check with your school administrator first." });
        this.working = false; return;
      }
    }
    this.working = false;
    if (!this.disposed) this.set({ phase: "done" });
  }
  private batch(index: number, patch: Partial<BatchState>) {
    this.set({ batches: this.state.batches.map((batch, i) => i === index ? { ...batch, ...patch } : batch) });
  }
  dispose() { this.disposed = true; this.request = null; this.listeners.clear(); }
}
