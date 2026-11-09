import { z } from "zod";

// Durable fee reminder campaigns (2026-11-09, docs/modules/reminder-campaigns.md).
//
//   PREPARE  POST /finance/reminder-campaigns/proposals              -> a reviewed preview
//   REFRESH  POST /finance/reminder-campaigns/proposals/:id/refresh  -> a new preview, old one retired
//   CONFIRM  POST /finance/reminder-campaigns/proposals/:id/confirm  -> the campaign (exactly once)
//   STATUS   GET  /finance/reminder-campaigns/:campaignId            -> progress and per-send outcomes
//   HALT     POST /finance/reminder-campaigns/:campaignId/halt       -> stop before the next send
//   RESUME   POST /finance/reminder-campaigns/:campaignId/resume     -> send what was never attempted
//
// Messages use the existing fee-reminder templates. No model is involved.
// POST /finance/debtors/remind is unchanged and not behind this feature.

export const REMINDER_CAMPAIGN_KIND = "fee-reminder-campaign";
export const REMINDER_TEMPLATE_VERSION = "fee-reminder@1";
export const REMINDER_CAMPAIGN_TTL_MINUTES = 30;
export const MAX_REMINDER_CAMPAIGN_STUDENTS = 500;

export const prepareReminderCampaignSchema = z
  .object({
    /** A UUID made once per reviewed selection; reused on retries of this prepare. */
    clientRequestId: z.string().uuid(),
    termId: z.string().uuid(),
    /** The explicit selection. Resolved by the server; another school's ids are "not found". */
    studentIds: z
      .array(z.string().uuid())
      .min(1)
      .max(MAX_REMINDER_CAMPAIGN_STUDENTS)
      .refine((ids) => new Set(ids).size === ids.length, "Each student may be selected once."),
    options: z
      .object({
        /** Default false: a student with a payment plan on any outstanding invoice is excluded. */
        includePaymentPlans: z.boolean().default(false),
        /** Default false. When true, a student with no OVERDUE invoice this term is excluded. */
        overdueOnly: z.boolean().default(false),
      })
      .strict()
      .default({ includePaymentPlans: false, overdueOnly: false }),
  })
  .strict();
export type PrepareReminderCampaignInput = z.infer<typeof prepareReminderCampaignSchema>;

export const confirmReminderCampaignSchema = z.object({ previewHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export type ConfirmReminderCampaignInput = z.infer<typeof confirmReminderCampaignSchema>;

export const refreshReminderCampaignSchema = z.object({ clientRequestId: z.string().uuid() }).strict();
export type RefreshReminderCampaignInput = z.infer<typeof refreshReminderCampaignSchema>;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Why a selected student will not be reminded. ELIGIBLE means they will be. */
export const REMINDER_ELIGIBILITY = [
  "ELIGIBLE",
  "NOT_FOUND",
  "NO_BALANCE",
  "ON_PAYMENT_PLAN",
  "NOT_OVERDUE",
  "NO_GUARDIAN",
  "NO_CONTACT",
] as const;
export type ReminderEligibility = (typeof REMINDER_ELIGIBILITY)[number];

export const REMINDER_BATCH_ERROR_CODES = ["TERM_NOT_FOUND", "NO_CHANNEL", "NOTHING_TO_SEND"] as const;
export type ReminderBatchErrorCode = (typeof REMINDER_BATCH_ERROR_CODES)[number];

export const REMINDER_BATCH_WARNING_CODES = [
  /** Between 21:00 and 06:00 Lagos: sends wait until 06:00. */
  "QUIET_HOURS_HOLD",
  /** SMS will go out under SchoolKit's sender name: the school's own is not approved. */
  "SMS_SENDER_SCHOOLKIT",
  /** Email is switched on but not set up on the server, or switched off: no emails. */
  "EMAIL_UNAVAILABLE",
  /** SMS is switched on but not set up on the server, or switched off. */
  "SMS_UNAVAILABLE",
  /** Some selected students share a guardian: that guardian gets one reminder per child. */
  "SHARED_GUARDIANS",
] as const;
export type ReminderBatchWarningCode = (typeof REMINDER_BATCH_WARNING_CODES)[number];

export interface ReminderProblem<C extends string> {
  code: C;
  message: string;
  details?: Record<string, number | string>;
}

export interface ReminderCampaignStudentPreview {
  studentId: string;
  /** Null when the id is not a student of this school. */
  name: string | null;
  admissionNumber: string | null;
  classLabel: string | null;
  /** Outstanding across the term's open invoices, in kobo, computed by the server. */
  balance: number;
  invoiceCount: number;
  earliestDueDate: string | null;
  onPaymentPlan: boolean;
  overdue: boolean;
  eligibility: ReminderEligibility;
  /** Planned slots if eligible: one email per guardian with a usable address, one push-or-SMS. */
  planned: { emailGuardians: number; mobile: "PUSH_OR_SMS" | "PUSH_ONLY" | "SMS_ONLY" | "NONE" };
}

export interface ReminderChannelState {
  email: { enabled: boolean; configured: boolean };
  sms: { enabled: boolean; configured: boolean; sender: "SCHOOL" | "SCHOOLKIT" };
  push: { enabled: boolean };
}

export type ReminderProposalStatus = "PENDING" | "CONFIRMED" | "EXPIRED";

export interface ReminderCampaignProposalDto {
  id: string;
  status: ReminderProposalStatus;
  previewHash: string;
  expiresAt: string;
  createdAt: string;
  termId: string;
  termLabel: string | null;
  templateVersion: string;
  options: { includePaymentPlans: boolean; overdueOnly: boolean };
  channels: ReminderChannelState;
  counts: { selected: number; eligible: number; excluded: Record<Exclude<ReminderEligibility, "ELIGIBLE">, number>; plannedSends: number };
  batchErrors: ReminderProblem<ReminderBatchErrorCode>[];
  batchWarnings: ReminderProblem<ReminderBatchWarningCode>[];
  canConfirm: boolean;
  /** Present while PENDING; empty once confirmed or expired (rows cleared). */
  students: ReminderCampaignStudentPreview[];
  dataCleared: boolean;
  /** Set once confirmed. */
  campaignId: string | null;
  /** Plain statement of what a send result can and cannot mean. */
  limits: string;
}

// ---------------------------------------------------------------------------
// Campaign status
// ---------------------------------------------------------------------------

export type ReminderCampaignStatus = "RUNNING" | "HALTED" | "COMPLETED";

export const REMINDER_HALT_REASONS = [
  "HALTED_BY_REQUESTER",
  "FEATURE_OFF",
  "SCHOOL_UNAVAILABLE",
  "CONFIRMER_ACCESS_REVOKED",
  "NO_CHANNEL",
] as const;
export type ReminderHaltReason = (typeof REMINDER_HALT_REASONS)[number];

/**
 * One planned send, as the person sees it:
 *  - ACCEPTED: the provider (Resend, Termii) or SchoolKit's push queue took it.
 *    Not proof of delivery, and never proof the parent read it.
 *  - SKIPPED: deliberately not sent (paid, plan, no contact, channel off); see `reason`.
 *  - FAILED: the provider refused it; nothing was sent.
 *  - UNKNOWN: the request may have been accepted (no answer, timeout, interrupted).
 *    Never retried automatically; check with the family before sending again.
 *  - NOT_REQUESTED: the campaign was halted before this send was attempted.
 *  - PENDING / SENDING: still to do / in flight now.
 */
export type ReminderSendOutcome = "PENDING" | "SENDING" | "ACCEPTED" | "SKIPPED" | "FAILED" | "UNKNOWN" | "NOT_REQUESTED";

export interface ReminderCampaignSendDto {
  guardianId: string;
  /** The planned slot: an email to this guardian, or one push-or-SMS for the child. */
  slot: "EMAIL" | "MOBILE";
  channelUsed: "EMAIL" | "PUSH" | "SMS" | null;
  outcome: ReminderSendOutcome;
  reason: string | null;
  finishedAt: string | null;
}

export interface ReminderCampaignDto {
  id: string;
  proposalId: string;
  termId: string;
  status: ReminderCampaignStatus;
  haltReason: ReminderHaltReason | null;
  templateVersion: string;
  createdAt: string;
  haltedAt: string | null;
  completedAt: string | null;
  /** True while sends are held for quiet hours (21:00–06:00 Lagos). */
  heldForQuietHours: boolean;
  counts: Record<ReminderSendOutcome, number>;
  /** One entry per student, with that student's sends. */
  students: { studentId: string; name: string | null; admissionNumber: string | null; sends: ReminderCampaignSendDto[] }[];
  limits: string;
}

export const REMINDER_CAMPAIGN_LIMITS =
  "Accepted means the email or SMS provider, or SchoolKit's app-alert queue, took the message. " +
  "It does not prove delivery or that a parent read it. A send marked unknown may have gone out: " +
  "it is never retried automatically. Siblings are reminded separately.";

export const REMINDER_CAMPAIGN_CONFLICT_CODES = {
  previewMismatch: "REMINDER_PREVIEW_MISMATCH",
  stale: "REMINDER_PREVIEW_STALE",
  expired: "REMINDER_PREVIEW_EXPIRED",
  blocked: "REMINDER_PREVIEW_BLOCKED",
  alreadyConfirmed: "REMINDER_ALREADY_CONFIRMED",
  requestIdReused: "REMINDER_REQUEST_ID_REUSED",
  notHalted: "REMINDER_CAMPAIGN_NOT_HALTED",
  stillOff: "REMINDER_CAMPAIGN_FEATURE_OFF",
} as const;
