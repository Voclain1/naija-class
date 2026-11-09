import { z } from "zod";

import { STUDENT_CORRECTION_FIELDS, type StudentCorrectionField } from "../students/student-correction.dto.js";
import { ASSISTANT_WORKFLOWS, type AssistantHelpHitDto, type AssistantWorkflow } from "./index.js";

// Model orchestration for the SchoolKit Assistant (2026-11-09,
// docs/modules/assistant-workspace.md, "Model orchestration").
//
// POST /assistant/workspace/turn. The browser sends the conversation it holds
// in memory and a STRUCTURED summary of its open tasks; the server runs one
// bounded, budgeted model turn with tools and answers with a reply and a list
// of ACTIONS, built by application code, that the browser applies to its task
// cards. Nothing here can approve: approval stays a separate, explicit control
// on the server's own preview, and no action carries an approval.
//
// What crosses to the model is defined in the module doc, field by field. In
// short: staff-typed text that passed the per-school detectors, the
// assistant's own earlier replies, task HANDLES (t1…t9) with statuses, term and
// class LABELS and counts. Never names, contacts, dates of birth, admission
// numbers, money, record ids, page content or form values.

/** Earlier messages resent each turn (user and assistant), newest last. */
export const ASSISTANT_TURN_MAX_MESSAGES = 12;
/** A single message the browser resends. Longer user text is refused, not cut. */
export const ASSISTANT_TURN_MAX_TEXT = 1_000;
/** Open tasks summarised per turn. */
export const ASSISTANT_TURN_MAX_TASKS = 9;

export const ASSISTANT_TASK_HANDLE = /^t[1-9]$/;

/** Where a task card is, as the browser reports it. Statuses only; no content. */
export const ASSISTANT_TASK_STATUSES = ["editing", "review", "confirming", "uncertain", "done", "closed"] as const;
export type AssistantTaskStatus = (typeof ASSISTANT_TASK_STATUSES)[number];

const uuid = z.string().uuid();

export const assistantTaskStateSchema = z
  .object({
    handle: z.string().regex(ASSISTANT_TASK_HANDLE),
    workflow: z.enum(ASSISTANT_WORKFLOWS),
    status: z.enum(ASSISTANT_TASK_STATUSES),
    /** The card's current scope, as ids. Resolved under the caller's tenant; another school's id resolves to nothing. */
    termId: uuid.nullable().optional(),
    classArmIds: z.array(uuid).max(20).optional(),
    overdueOnly: z.boolean().optional(),
    includePaymentPlans: z.boolean().optional(),
    placeLater: z.boolean().optional(),
    fields: z.array(z.enum(STUDENT_CORRECTION_FIELDS)).max(6).optional(),
    /** How many students the card holds (typed, picked or selected). A count only. */
    studentCount: z.number().int().min(0).max(500).optional(),
    runId: uuid.optional(),
    proposalId: uuid.optional(),
    campaignId: uuid.optional(),
  })
  .strict();
export type AssistantTaskState = z.infer<typeof assistantTaskStateSchema>;

// ---- Named student lookup (2026-11-09; docs/modules/assistant-workspace.md,
// "Named student lookup"). Names are resolved by the SERVER under the caller's
// tenant, permissions and teacher scope. The model sees opaque handles
// (s1…s9) and class labels only; names and records travel to the browser in
// actions and cards, which are never part of model history.

export const ASSISTANT_STUDENT_HANDLE = /^s[1-9]$/;
export const STUDENT_RECORD_SECTIONS = ["summary", "attendance", "results"] as const;
export type StudentRecordSection = (typeof STUDENT_RECORD_SECTIONS)[number];

/** A student the conversation found, by id. The server re-checks it against tenant and scope every turn. */
export const assistantStudentRefSchema = z
  .object({ handle: z.string().regex(ASSISTANT_STUDENT_HANDLE), studentId: z.string().uuid(), selected: z.boolean() })
  .strict();
export type AssistantStudentRef = z.infer<typeof assistantStudentRefSchema>;

/** One student a lookup found. Shown in the browser only; never sent to the model. */
export interface StudentMatchDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  classArmId: string | null;
  /** "JSS 2 · JSS 2A", this term. */
  classLabel: string | null;
  termId: string | null;
  status: string;
  /** "exact": every name part typed is one of the student's names; "similar": a close spelling. */
  match: "exact" | "similar";
}

export const studentLookupQuerySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    classArmIds: z.array(z.string().uuid()).min(1).max(20).optional(),
  })
  .strict();
export type StudentLookupQuery = z.infer<typeof studentLookupQuerySchema>;

export interface StudentLookupResultDto {
  /** found: one exact match. several: more than one exact. similar: no exact, close spellings. none. */
  status: "found" | "several" | "similar" | "none";
  matches: StudentMatchDto[];
}

export const assistantTurnSchema = z
  .object({
    messages: z
      .array(
        z
          .object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(ASSISTANT_TURN_MAX_TEXT) })
          .strict(),
      )
      .min(1)
      .max(ASSISTANT_TURN_MAX_MESSAGES)
      .refine((m) => m[m.length - 1]?.role === "user", "The last message must be the person's."),
    tasks: z
      .array(assistantTaskStateSchema)
      .max(ASSISTANT_TURN_MAX_TASKS)
      .refine((t) => new Set(t.map((x) => x.handle)).size === t.length, "Each task handle may appear once.")
      .default([]),
    students: z
      .array(assistantStudentRefSchema)
      .max(9)
      .refine((t) => new Set(t.map((x) => x.handle)).size === t.length, "Each student handle may appear once.")
      .default([]),
  })
  .strict();
export type AssistantTurnInput = z.infer<typeof assistantTurnSchema>;

/**
 * What the browser does after a turn. Built by the server from validated tool
 * calls, never from the model's prose. `handle` names an existing task or a
 * new one (the next free t1…t9).
 */
export type AssistantTurnAction =
  | {
      kind: "invoices";
      handle: string;
      termId: string;
      classArmIds: string[];
      /** The server-prepared billing run (a preview), or null when it could not be prepared. */
      runId: string | null;
      problem: string | null;
    }
  | {
      kind: "reminders";
      handle: string;
      termId: string;
      /** The class by ID (enforced by the server at preview and confirm), or null for all classes. */
      classArmId: string | null;
      overdueOnly: boolean;
      includePaymentPlans: boolean;
      /** Select every matching family and ask the server for its preview. Approval stays separate. */
      autoPreview: boolean;
    }
  | { kind: "intake"; handle: string; termId: string | null; classArmId: string | null; placeLater: boolean }
  | { kind: "corrections"; handle: string; fields: StudentCorrectionField[] }
  /** Show a saved operation's authoritative state in a card (read only). */
  | { kind: "show"; workflow: AssistantWorkflow; runId?: string; proposalId?: string; campaignId?: string }
  | { kind: "help"; query: string; hits: AssistantHelpHitDto[] }
  /** A lookup's matches, with their handles: names for the browser only. `asked` is the name as the person typed it. */
  | { kind: "students"; asked: string; status: StudentLookupResultDto["status"]; matches: Array<StudentMatchDto & { handle: string }> }
  | { kind: "select-student"; handle: string; studentId: string }
  /** Show a section of a selected student's record, read by the browser from existing authorised endpoints. */
  | { kind: "student-record"; handle: string; studentId: string; section: StudentRecordSection };

export const ASSISTANT_TURN_OUTCOMES = [
  "answered",
  "blocked",
  "budget_exhausted",
  "rate_limited",
  "incomplete",
  "refused",
  "unavailable",
] as const;
export type AssistantTurnOutcome = (typeof ASSISTANT_TURN_OUTCOMES)[number];

export interface AssistantTurnDto {
  outcome: AssistantTurnOutcome;
  /** The assistant's reply, already checked by the server (money figures and long text removed). */
  reply: string;
  actions: AssistantTurnAction[];
  /** For "blocked": what was found in the text, as categories. Never the text itself. */
  blockedCategories: string[];
  /** Tool names called this turn, in order. Names only. */
  toolsUsed: string[];
}

/** Plain words for each detector category, for the person (never the matched text). */
export const ASSISTANT_BLOCK_LABELS: Record<string, string> = {
  "roster-name": "a name of someone at your school",
  "admission-number": "an admission number",
  email: "an email address",
  phone: "a phone number",
  "long-number": "a long ID-like number",
  "full-date": "a full date",
  "too-long": "a very long message",
  "pasted-rows": "pasted rows",
};
