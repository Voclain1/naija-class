import { z } from "zod";

// Phase 9 / CP8.1 — private messaging between families and the school
// (docs/modules/phase-9.md §17, owner's answers §17.8). A parent writes to ONE
// recipient, about one of their children or in general; only that recipient,
// anyone it is passed to and anyone who has written in it see it. No AI.

export const messageRecipientValues = ["CLASS_TEACHER", "BURSAR", "PRINCIPAL", "HEAD_TEACHER", "ADMIN", "OFFICE"] as const;
export type MessageRecipient = (typeof messageRecipientValues)[number];

export const MESSAGE_LIMITS = {
  subject: 120,
  body: 2000,
  /** New conversations a guardian may start in a Lagos day. */
  newPerDay: 5,
  /** Messages a guardian may send in an hour. */
  perHour: 30,
  /** A conversation with no new message for this long is closed. */
  closeAfterDays: 30,
  /** SMS "you have a reply" alerts a school may send in a Lagos day. */
  smsPerDay: 50,
} as const;

/** The recipient as a family reads it. The class teacher's label follows the child's stage. */
export function messageRecipientLabel(recipient: MessageRecipient, opts: { secondary?: boolean; schoolName?: string } = {}): string {
  switch (recipient) {
    case "CLASS_TEACHER":
      return opts.secondary ? "Form teacher" : "Class teacher";
    case "BURSAR":
      return "Bursar";
    case "PRINCIPAL":
      return "Principal";
    case "HEAD_TEACHER":
      return "Head teacher";
    case "ADMIN":
      return "School admin";
    case "OFFICE":
      return opts.schoolName ? `${opts.schoolName} office` : "School office";
  }
}

const text = (min: number, max: number, empty: string) => z.string().trim().min(min, empty).max(max);

// ─── The family's side ─────────────────────────────────────────────────────

/** One recipient the family may choose, for one child or in general. */
export interface MessageRecipientOptionDto {
  recipient: MessageRecipient;
  label: string;
  /** The class teacher's name; the others are a role, held by one or more. */
  name: string | null;
}

export const startMessageSchema = z.object({
  studentId: z.string().uuid().nullable().default(null),
  recipient: z.enum(messageRecipientValues),
  subject: text(1, MESSAGE_LIMITS.subject, "Write a subject."),
  body: text(1, MESSAGE_LIMITS.body, "Write your message."),
});
export type StartMessageInput = z.infer<typeof startMessageSchema>;

export const replyMessageSchema = z.object({
  body: text(1, MESSAGE_LIMITS.body, "Write your message."),
});
export type ReplyMessageInput = z.infer<typeof replyMessageSchema>;

export interface MessageDto {
  id: string;
  /** The family's own messages are "You" on their side. */
  mine: boolean;
  /** "Mrs Okafor, Form teacher", "<School> office", or the parent's name. */
  author: string;
  body: string;
  sentAt: string | Date;
}

export interface MessageThreadSummaryDto {
  id: string;
  subject: string;
  /** "Form teacher", "Bursar", … ; for staff, the family and child. */
  withLabel: string;
  childName: string | null;
  status: "OPEN" | "CLOSED";
  lastMessageAt: string | Date;
  lastMessageBy: "GUARDIAN" | "STAFF";
  unread: boolean;
}

export interface PortalMessageThreadDto extends MessageThreadSummaryDto {
  messages: MessageDto[];
  /** The school has opened the family's latest message. */
  seen: boolean;
  closedAt: string | Date | null;
}

export interface PortalMessageListDto {
  items: MessageThreadSummaryDto[];
  unread: number;
}

// ─── The school's side ─────────────────────────────────────────────────────

export const listMessagesSchema = z.object({
  box: z.enum(["OPEN", "CLOSED"]).default("OPEN"),
});
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;

export interface StaffMessageThreadSummaryDto extends MessageThreadSummaryDto {
  guardianName: string;
  /** Who the conversation is addressed (or passed) to, in words. */
  addressedTo: string[];
  handledBy: string | null;
}

export interface StaffMessageListDto {
  items: StaffMessageThreadSummaryDto[];
  unread: number;
}

export interface StaffMessageThreadDto extends StaffMessageThreadSummaryDto {
  guardian: { id: string; name: string; phone: string; relationship: string };
  child: { id: string; name: string; className: string | null } | null;
  messages: (MessageDto & { writtenBy: string | null })[];
  passes: { to: string; by: string; at: string | Date }[];
  closedAt: string | Date | null;
  /** Recipients this conversation can still be passed to. */
  passOptions: MessageRecipientOptionDto[];
  canClose: boolean;
}

export const passMessageSchema = z.object({ recipient: z.enum(messageRecipientValues) });
export type PassMessageInput = z.infer<typeof passMessageSchema>;

export const markHandledSchema = z.object({ handled: z.boolean() });
export type MarkHandledInput = z.infer<typeof markHandledSchema>;

/** The school office starts a conversation with one parent (§17.8 answer 2). */
export const officeStartMessageSchema = z.object({
  guardianId: z.string().uuid("Choose the parent."),
  studentId: z.string().uuid().nullable().default(null),
  subject: text(1, MESSAGE_LIMITS.subject, "Write a subject."),
  body: text(1, MESSAGE_LIMITS.body, "Write your message."),
});
export type OfficeStartMessageInput = z.infer<typeof officeStartMessageSchema>;

export const searchMessageGuardiansSchema = z.object({ q: z.string().trim().min(2, "Type at least two letters.").max(60) });
export type SearchMessageGuardiansInput = z.infer<typeof searchMessageGuardiansSchema>;

export interface MessageGuardianOptionDto {
  id: string;
  name: string;
  phone: string;
  children: { id: string; name: string }[];
}

// ─── Settings → Messaging: who holds the appointed roles ──────────────────

export const messagingRoleKeys = ["principal", "head_teacher", "inbox_officer"] as const;
export type MessagingRoleKey = (typeof messagingRoleKeys)[number];

export interface MessagingStaffDto {
  id: string;
  name: string;
  /** Their own roles, in words. */
  roles: string[];
  principal: boolean;
  headTeacher: boolean;
  inboxOfficer: boolean;
}

export const setMessagingRolesSchema = z.object({
  principalIds: z.array(z.string().uuid()).max(5),
  headTeacherIds: z.array(z.string().uuid()).max(5),
  inboxOfficerIds: z.array(z.string().uuid()).max(20),
});
export type SetMessagingRolesInput = z.infer<typeof setMessagingRolesSchema>;
