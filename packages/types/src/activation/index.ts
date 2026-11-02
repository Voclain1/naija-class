// Getting started (2026-10-30, docs/modules/activation.md): how far each school
// has got after signing up, the setup reminder emails sent to its owner, and
// what happened to them. Read by the platform admin only.

/**
 * A school's stage, 1 to 6, from live counts. Each stage includes the ones
 * before it, except "In use", which any real work reaches.
 */
export type ActivationStage = 1 | 2 | 3 | 4 | 5 | 6;

export const ACTIVATION_STAGES: { stage: ActivationStage; label: string; detail: string }[] = [
  { stage: 1, label: "Signed up", detail: "Has not finished the setup wizard." },
  { stage: 2, label: "Set up", detail: "Finished the wizard; no students yet." },
  { stage: 3, label: "Students added", detail: "Has students, but none in a class this term." },
  { stage: 4, label: "Students in classes", detail: "Students are in classes; no teacher invited yet." },
  { stage: 5, label: "Staff invited", detail: "Teachers invited; no register, invoice or score yet." },
  { stage: 6, label: "In use", detail: "Has marked a register, issued an invoice or entered a score." },
];

export function activationStageLabel(stage: ActivationStage): string {
  return ACTIVATION_STAGES.find((s) => s.stage === stage)?.label ?? "";
}

export interface ActivationCounts {
  /** The setup wizard is finished (school status ACTIVE). */
  setUp: boolean;
  students: number;
  /** Students enrolled in the current term. */
  enrolled: number;
  /** Teachers with an account, plus live teacher invitations. */
  staff: number;
  /** A register marked, an invoice issued or a score entered. */
  inUse: boolean;
}

export function activationStage(c: ActivationCounts): ActivationStage {
  if (c.inUse) return 6;
  if (!c.setUp) return 1;
  if (c.enrolled > 0) return c.staff > 0 ? 5 : 4;
  return c.students > 0 ? 3 : 2;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days since a moment, rounded down. */
export function daysSince(iso: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS));
}

/** Stuck: a week or more since sign-up, and no students in a class yet. */
export const STUCK_AFTER_DAYS = 7;

export function isStuck(stage: ActivationStage, signedUpAt: string | Date, now: Date = new Date()): boolean {
  return stage <= 3 && daysSince(signedUpAt, now) >= STUCK_AFTER_DAYS;
}

/** The three setup reminders, in order. */
export type ActivationEmailKind = "FIRST" | "SECOND" | "THIRD";
export const ACTIVATION_EMAIL_KINDS: ActivationEmailKind[] = ["FIRST", "SECOND", "THIRD"];

export type ActivationEmailStatus = "SENT" | "DELIVERED" | "BOUNCED" | "COMPLAINED" | "FAILED";

/**
 * When the next reminder is due, or null when none is.
 *
 * A reminder goes only while the school has not reached stage 4 (students in
 * classes), its owner has not stopped them, and fewer than three have gone.
 * - FIRST: two days after sign-up.
 * - SECOND: seven days after sign-up, and at least five after the first.
 * - THIRD: 21 days after sign-up, and at least seven after the second.
 *
 * The "after the previous one" floors are what space out schools that signed
 * up long before reminders existed: they get the first at once, then the
 * others five and seven days apart.
 */
export function nextActivationEmail(input: {
  stage: ActivationStage;
  signedUpAt: Date;
  stopped: boolean;
  sent: { kind: ActivationEmailKind; sentAt: Date }[];
  now: Date;
}): { kind: ActivationEmailKind; dueAt: Date } | null {
  if (input.stopped || input.stage >= 4) return null;
  const sentAt = (k: ActivationEmailKind) => input.sent.find((s) => s.kind === k)?.sentAt ?? null;
  const signup = input.signedUpAt.getTime();
  const first = sentAt("FIRST");
  const second = sentAt("SECOND");
  let next: { kind: ActivationEmailKind; dueAt: Date };
  if (!first) next = { kind: "FIRST", dueAt: new Date(signup + 2 * DAY_MS) };
  else if (!second) next = { kind: "SECOND", dueAt: new Date(Math.max(signup + 7 * DAY_MS, first.getTime() + 5 * DAY_MS)) };
  else if (!sentAt("THIRD")) next = { kind: "THIRD", dueAt: new Date(Math.max(signup + 21 * DAY_MS, second.getTime() + 7 * DAY_MS)) };
  else return null;
  return next.dueAt.getTime() <= input.now.getTime() ? next : null;
}

/** Where a link in a setup reminder goes. A fixed list, never a URL from the link. */
export const ACTIVATION_LINK_TARGETS = ["next-step", "setup-call", "smart-import", "help"] as const;
export type ActivationLinkTarget = (typeof ACTIVATION_LINK_TARGETS)[number];

export interface PlatformActivationEmailDto {
  kind: ActivationEmailKind;
  sentAt: string;
  status: ActivationEmailStatus;
  clickCount: number;
  firstClickedAt: string | null;
  stageAtSend: ActivationStage;
}

export interface PlatformActivationSchoolDto {
  schoolId: string;
  name: string;
  slug: string;
  signedUpAt: string;
  stage: ActivationStage;
  stuck: boolean;
  students: number;
  enrolled: number;
  staff: number;
  /** The owner, or the invited owner when the invitation is not accepted yet. */
  owner: {
    name: string;
    email: string;
    phone: string | null;
    lastLoginAt: string | null;
    invitePending: boolean;
  } | null;
  setupCallBooked: boolean;
  emailsStopped: boolean;
  emails: PlatformActivationEmailDto[];
  /** The school is further on than when its latest reminder went; null with no reminder. */
  movedSinceEmail: boolean | null;
}

export interface PlatformActivationSummaryDto {
  schools: number;
  byStage: Record<ActivationStage, number>;
  stuck: number;
  emailsSent: number;
  emailsDelivered: number;
  /** Reminders with at least one click. */
  emailsClicked: number;
  /** Schools emailed at least once that have since moved on a stage. */
  schoolsMovedAfterEmail: number;
  schoolsEmailed: number;
  emailsStopped: number;
}

export interface PlatformActivationDto {
  /** When the schools were read; the API keeps the answer for five minutes. */
  generatedAt: string;
  summary: PlatformActivationSummaryDto;
  schools: PlatformActivationSchoolDto[];
}

/** Digits wa.me accepts: Nigerian numbers starting 0 become 234…; null when it cannot be a phone. */
export function whatsappDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0") && d.length === 11) d = `234${d.slice(1)}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}
