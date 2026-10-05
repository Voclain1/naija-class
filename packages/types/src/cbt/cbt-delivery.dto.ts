import { z } from "zod";

import type { CbtPackEnvelope } from "./cbt-pack.js";

// Online exams (CBT2) — the two public delivery endpoints (docs/modules/cbt.md
// D6, D9). No staff session: a lab machine downloads with the school's slug
// and the access code, and signs every batch of answers with a key only an
// unlocked machine holds (cbt-web-crypto.ts).

/** The request header carrying the batch's HMAC (base64). */
export const CBT_SIGNATURE_HEADER = "x-cbt-signature";

/** A machine sends at most this many students' attempts in one batch. */
export const CBT_SYNC_MAX_ATTEMPTS = 100;

/** GET /cbt-delivery/:slug/packs/:accessCode */
export interface CbtPackDownloadDto {
  envelope: CbtPackEnvelope;
}

const id = z.string().min(1).max(64);

export const cbtAttemptSnapshotSchema = z
  .object({
    studentId: id,
    // Goes up by one every time the machine saves; the highest one wins.
    seq: z.number().int().min(0).max(1_000_000),
    startedAt: z.string().datetime(),
    submittedAt: z.string().datetime().nullable(),
    extraMinutes: z.number().int().min(0).max(600),
    focusLosses: z.number().int().min(0).max(100_000),
    // { itemId: optionId } — every answer so far, not a diff.
    answers: z.record(id, id).refine((a) => Object.keys(a).length <= 500, "Too many answers."),
  })
  .strict();
export type CbtAttemptSnapshot = z.infer<typeof cbtAttemptSnapshotSchema>;

export const cbtSyncBatchSchema = z
  .object({
    deviceId: z.string().uuid(),
    attempts: z.array(cbtAttemptSnapshotSchema).min(1).max(CBT_SYNC_MAX_ATTEMPTS),
  })
  .strict();
export type CbtSyncBatch = z.infer<typeof cbtSyncBatchSchema>;

/**
 * STORED: this snapshot is now the server's copy. ALREADY_STORED: the server
 * holds this one or a later one (a repeat — nothing to do). REJECTED: never
 * going to be accepted (not on the register, or an answer that is not on the
 * paper); the machine stops sending it and keeps its own copy.
 */
export type CbtSyncOutcome = "STORED" | "ALREADY_STORED" | "REJECTED";

export interface CbtSyncResultDto {
  results: { studentId: string; seq: number; outcome: CbtSyncOutcome; reason: string | null }[];
}
