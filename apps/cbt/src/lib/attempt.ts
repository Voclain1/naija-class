import type { CbtAttemptSnapshot, CbtPackEnvelope, CbtPackPayload, CbtPackQuestion, PaperVersion } from "@school-kit/types";

// One student's attempt on this machine (docs/modules/cbt.md D5–D7). Pure: the
// screens hold it, the local store saves it after every change, and the sync
// sends it. Every change raises `seq`, so the server can always tell which of
// two copies is newer and never needs a diff.
//
// The clock is wall time from the student's start, like a paper exam (D6): a
// power cut does not stop it. The invigilator can add time on this machine.

export interface LocalAttempt {
  /** `${sittingId}:${studentId}` */
  key: string;
  sittingId: string;
  studentId: string;
  version: PaperVersion;
  seq: number;
  startedAt: string;
  submittedAt: string | null;
  extraMinutes: number;
  focusLosses: number;
  /** itemId → optionId */
  answers: Record<string, string>;
  /** The question on screen, so a resumed attempt opens where it stopped. */
  current: number;
}

export const attemptKey = (sittingId: string, studentId: string) => `${sittingId}:${studentId}`;

export function startAttempt(sittingId: string, studentId: string, version: PaperVersion, now: Date): LocalAttempt {
  return {
    key: attemptKey(sittingId, studentId),
    sittingId,
    studentId,
    version,
    // 1, not 0: the start itself is worth sending, so staff see "Sitting".
    seq: 1,
    startedAt: now.toISOString(),
    submittedAt: null,
    extraMinutes: 0,
    focusLosses: 0,
    answers: {},
    current: 0,
  };
}

const bump = (a: LocalAttempt, change: Partial<LocalAttempt>): LocalAttempt => ({ ...a, ...change, seq: a.seq + 1 });

export function choose(a: LocalAttempt, itemId: string, optionId: string): LocalAttempt {
  if (a.submittedAt || a.answers[itemId] === optionId) return a;
  return bump(a, { answers: { ...a.answers, [itemId]: optionId } });
}

/** Moving between questions is not an answer, so it does not need sending. */
export function goTo(a: LocalAttempt, index: number): LocalAttempt {
  return { ...a, current: index };
}

export function noteFocusLoss(a: LocalAttempt): LocalAttempt {
  return a.submittedAt ? a : bump(a, { focusLosses: a.focusLosses + 1 });
}

export function addExtraTime(a: LocalAttempt, minutes: number): LocalAttempt {
  return bump(a, { extraMinutes: Math.min(600, a.extraMinutes + minutes) });
}

export function submit(a: LocalAttempt, now: Date): LocalAttempt {
  return a.submittedAt ? a : bump(a, { submittedAt: now.toISOString() });
}

export function deadlineMs(a: LocalAttempt, durationMinutes: number): number {
  return Date.parse(a.startedAt) + (durationMinutes + a.extraMinutes) * 60_000;
}

export function remainingMs(a: LocalAttempt, durationMinutes: number, now: Date): number {
  return Math.max(0, deadlineMs(a, durationMinutes) - now.getTime());
}

/** "39:05", or "1:02:09" past the hour. */
export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** No one may BEGIN after the latest start; someone already sitting carries on. */
export function startWindowClosed(envelope: Pick<CbtPackEnvelope, "windowEndsAt">, now: Date): boolean {
  return now.getTime() > Date.parse(envelope.windowEndsAt);
}

export function toSnapshot(a: LocalAttempt): CbtAttemptSnapshot {
  return {
    studentId: a.studentId,
    seq: a.seq,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    extraMinutes: a.extraMinutes,
    focusLosses: a.focusLosses,
    answers: a.answers,
  };
}

export interface NumberedQuestion extends CbtPackQuestion {
  sectionTitle: string;
  sectionInstructions: string | null;
}

/** The student's version, flattened in order, each question carrying its section. */
export function questionsFor(payload: CbtPackPayload, version: PaperVersion): NumberedQuestion[] {
  return (payload.versions[version] ?? []).flatMap((section) =>
    section.questions.map((q) => ({ ...q, sectionTitle: section.title, sectionInstructions: section.instructions })),
  );
}

export const answeredCount = (a: LocalAttempt) => Object.keys(a.answers).length;

/** The student's admission number as typed → the register's entry, ignoring case and spaces. */
export function findCandidate(payload: CbtPackPayload, typed: string) {
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const want = norm(typed);
  return want ? (payload.candidates.find((c) => norm(c.admissionNumber) === want) ?? null) : null;
}
