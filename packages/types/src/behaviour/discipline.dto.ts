import { z } from "zod";

// Phase 9 / CP2.3 — discipline actions (docs/modules/phase-9.md §9 CP2-D3,
// CP2-D4).
//
// A teacher PROPOSES, an owner or admin DECIDES (approve, or reject with a
// reason), and an action is WITHDRAWN rather than deleted.
//
// The staff shapes carry the reason. The PORTAL shape (`PortalDisciplineNoticeDto`)
// is separate on purpose and has no field for a reason, a note, an incident or
// who proposed it: there is no way for a family-facing route to return them,
// because the type it must return cannot hold them.
//
// C15 holds: no AI anywhere in discipline.

export const DISCIPLINE_ACTION_TYPES = ["WARNING", "DETENTION", "SUSPENSION", "EXCLUSION"] as const;
export type DisciplineActionType = (typeof DISCIPLINE_ACTION_TYPES)[number];

export const DISCIPLINE_ACTION_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type DisciplineActionStatus = (typeof DISCIPLINE_ACTION_STATUSES)[number];

/** The two types a parent is told about, on approval only (CP2-D4). */
export const DISCIPLINE_NOTIFIED_TYPES = ["SUSPENSION", "EXCLUSION"] as const;
export type DisciplineNotifiedType = (typeof DISCIPLINE_NOTIFIED_TYPES)[number];

export const DISCIPLINE_REASON_MAX = 1000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist.");

/**
 * Proposing one. The dates follow the type, as the database CHECK does:
 * a warning has none, a detention one day, a suspension a first and last day,
 * an exclusion a first day.
 */
export const createDisciplineActionSchema = z
  .object({
    studentId: z.string().uuid(),
    type: z.enum(DISCIPLINE_ACTION_TYPES),
    startOn: isoDate.optional(),
    endOn: isoDate.optional(),
    reason: z.string().trim().min(1, "Say why.").max(DISCIPLINE_REASON_MAX),
    recordId: z.string().uuid().optional(),
    incidentId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (path: "startOn" | "endOn", message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    switch (value.type) {
      case "WARNING":
        if (value.startOn) need("startOn", "A warning has no date.");
        if (value.endOn) need("endOn", "A warning has no date.");
        break;
      case "DETENTION":
        if (!value.startOn) need("startOn", "Choose the day of the detention.");
        if (value.endOn) need("endOn", "A detention is one day.");
        break;
      case "SUSPENSION":
        if (!value.startOn) need("startOn", "Choose the first day.");
        if (!value.endOn) need("endOn", "Choose the last day.");
        if (value.startOn && value.endOn && value.endOn < value.startOn) {
          need("endOn", "The last day cannot be before the first.");
        }
        break;
      case "EXCLUSION":
        if (!value.startOn) need("startOn", "Choose the first day.");
        if (value.endOn) need("endOn", "An exclusion has a first day only.");
        break;
    }
  });
export type CreateDisciplineActionInput = z.infer<typeof createDisciplineActionSchema>;

/** Approving, or rejecting with a reason. */
export const decideDisciplineActionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    reason: z.string().trim().max(DISCIPLINE_REASON_MAX).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "REJECT" && !value.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Say why it is rejected." });
    }
  });
export type DecideDisciplineActionInput = z.infer<typeof decideDisciplineActionSchema>;

export const disciplineListQuerySchema = z
  .object({
    studentId: z.string().uuid().optional(),
    status: z.enum(DISCIPLINE_ACTION_STATUSES).optional(),
  })
  .strict();
export type DisciplineListQuery = z.infer<typeof disciplineListQuerySchema>;

/** Staff-only. Carries the reason; never returned to a family. */
export interface DisciplineActionDto {
  id: string;
  studentId: string;
  studentName: string;
  type: DisciplineActionType;
  /** ISO date, or null for a warning. */
  startOn: string | null;
  /** ISO date; a suspension's last day only. */
  endOn: string | null;
  reason: string;
  status: DisciplineActionStatus;
  recordId: string | null;
  incidentId: string | null;
  proposedByName: string | null;
  proposedAt: string | Date;
  decidedByName: string | null;
  decidedAt: string | Date | null;
  decisionReason: string | null;
  withdrawnAt: string | Date | null;
  /**
   * True when the same person proposed and decided it: the owner's own
   * proposal, approved when made (CP2-D3). Shown as one line, "Proposed and
   * approved by …", rather than two.
   */
  approvedOnProposal: boolean;
  /** How many guardians were sent the notice (approved suspensions and exclusions). */
  guardiansNotified: number;
  /** The viewer may approve or reject it now (never their own proposal). */
  canDecide: boolean;
  /** The viewer may withdraw it now. */
  canWithdraw: boolean;
}

export interface DisciplineListResponse {
  data: DisciplineActionDto[];
}

// ---------------------------------------------------------------------------
// Parent side (CP2-D4). Only approved suspensions and exclusions, and only the
// action, the dates and when it was decided. No reason, note, incident or
// proposer: this type has no field for them.
// ---------------------------------------------------------------------------

export interface PortalDisciplineNoticeDto {
  id: string;
  type: DisciplineNotifiedType;
  startOn: string;
  /** A suspension's last day; null for an exclusion. */
  endOn: string | null;
  /** ISO date the school approved it. */
  decidedOn: string;
  /** ISO date it was withdrawn, or null. A withdrawn notice still shows, marked. */
  withdrawnOn: string | null;
}

export interface PortalDisciplineNoticeListResponse {
  data: PortalDisciplineNoticeDto[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Oct 2026" from "2026-10-20", with no timezone involved. */
export function formatDisciplineDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "20 Oct" when the year matches the end date's, else the full date. */
function formatShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}

/**
 * The words for a parent: "Suspended from 20 Oct to 22 Oct 2026" or
 * "Excluded from 20 Oct 2026". Shared by the SMS, the parent website and the
 * app so the three never disagree.
 */
export function describeDisciplineNotice(n: { type: DisciplineNotifiedType; startOn: string; endOn: string | null }): string {
  if (n.type === "SUSPENSION" && n.endOn) {
    const sameYear = n.startOn.slice(0, 4) === n.endOn.slice(0, 4);
    const from = sameYear ? formatShort(n.startOn) : formatDisciplineDate(n.startOn);
    return `Suspended from ${from} to ${formatDisciplineDate(n.endOn)}`;
  }
  return `Excluded from ${formatDisciplineDate(n.startOn)}`;
}

/** Staff-facing label for a type, with its dates. */
export function describeDisciplineAction(a: { type: DisciplineActionType; startOn: string | null; endOn: string | null }): string {
  switch (a.type) {
    case "WARNING":
      return "Warning";
    case "DETENTION":
      return a.startOn ? `Detention on ${formatDisciplineDate(a.startOn)}` : "Detention";
    case "SUSPENSION":
      return a.startOn ? describeDisciplineNotice({ type: "SUSPENSION", startOn: a.startOn, endOn: a.endOn }).replace("Suspended", "Suspension") : "Suspension";
    case "EXCLUSION":
      return a.startOn ? `Exclusion from ${formatDisciplineDate(a.startOn)}` : "Exclusion";
  }
}
