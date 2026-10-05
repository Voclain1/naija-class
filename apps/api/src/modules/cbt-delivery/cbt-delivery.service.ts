import * as crypto from "node:crypto";
import { promisify } from "node:util";

import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  CBT_PACK_KDF,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  cbtSyncSalt,
  normaliseCbtCode,
  type CbtAttemptSnapshot,
  type CbtPackDownloadDto,
  type CbtPackEnvelope,
  type CbtSyncBatch,
  type CbtSyncResultDto,
} from "@school-kit/types";

// ---------------------------------------------------------------------------
// Online exams (CBT2) — the two public endpoints a lab machine calls
// (docs/modules/cbt.md D3, D5, D6, D9). No staff session and no guard, on
// purpose: lab students have no accounts (D5). What stands in for one:
//
//   * DOWNLOAD needs the school's slug and the 6-character access code, and
//     returns only the encrypted envelope. Knowing both still reveals nothing
//     until the unlock code is typed (D3).
//   * SYNC needs every batch signed with HMAC-SHA256 under a key derived from
//     the UNLOCK code (cbt-web-crypto.ts `deriveSyncKey`). Only a machine the
//     invigilator unlocked holds it. A signed batch replayed later changes
//     nothing, because the server keeps the highest `seq` per (student,
//     machine) and a replay is never higher than what it already has.
//
// Pre-tenant: the school comes from its slug (`schools` has no RLS policy, as
// in the Result Checker); everything after runs under that school's GUC.
// No SECURITY DEFINER function.
//
// Kept in its own module so it can run alone as the exam-day service
// (`API_MODE=cbt-delivery`, CBT4), apart from fees and report cards.
// ---------------------------------------------------------------------------

const pbkdf2 = promisify(crypto.pbkdf2);

const NO_PACK = "No exam matches that code at this school. Check the access code on the invigilator sheet.";

/** Derived keys and frozen papers are cached; this bounds each cache. */
const CACHE_LIMIT = 500;

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

/** itemId → the option ids a student may choose for it. */
type AnswerSheet = Map<string, Set<string>>;

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
  return value;
}

@Injectable()
export class CbtDeliveryService {
  // PBKDF2 at 210,000 rounds costs tens of milliseconds; a lab syncs every
  // 30 seconds per machine, so the key is derived once per sitting.
  private readonly syncKeys = new Map<string, Buffer>();
  // A sitting is always on a FINAL paper, and FINAL papers are frozen, so the
  // options a student may pick never change for a given paper.
  private readonly sheets = new Map<string, AnswerSheet>();

  /** GET /cbt-delivery/:slug/packs/:accessCode */
  async downloadPack(slug: string, rawAccessCode: string): Promise<CbtPackDownloadDto> {
    const school = await this.resolveSchool(slug);
    const accessCode = normaliseCbtCode(rawAccessCode);
    if (!/^[A-Z2-9]{6}$/.test(accessCode)) throw new NotFoundError(NO_PACK);
    return withTenant(school.id, async (db) => {
      const sitting = await db.cbtSitting.findUnique({
        where: { schoolId_accessCode: { schoolId: school.id, accessCode } },
        select: { status: true, pack: true },
      });
      if (!sitting || sitting.status === "DRAFT" || !sitting.pack) throw new NotFoundError(NO_PACK);
      if (sitting.status === "CLOSED") {
        throw new ConflictError("SITTING_CLOSED", "This exam has been closed by the school.");
      }
      return { envelope: sitting.pack as unknown as CbtPackEnvelope };
    });
  }

  /** POST /cbt-delivery/:slug/sittings/:sittingId/answers */
  async sync(
    slug: string,
    sittingId: string,
    batch: CbtSyncBatch,
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): Promise<CbtSyncResultDto> {
    const school = await this.resolveSchool(slug);
    return withTenant(school.id, async (db) => {
      const sitting = await db.cbtSitting.findUnique({
        where: { id: sittingId },
        select: { id: true, status: true, unlockCode: true, paperId: true },
      });
      if (!sitting) throw new NotFoundError("That exam could not be found at this school.");

      // Signature first: nothing below is any of an unsigned caller's business.
      const key = await this.syncKey(sitting.id, sitting.unlockCode);
      if (!rawBody || !signature || !verify(key, rawBody, signature)) {
        throw new UnauthorizedError(
          "CBT_BAD_SIGNATURE",
          "These answers were not sent by a computer unlocked for this exam. Ask the invigilator to type the unlock code again.",
        );
      }
      // A published sitting can go back to draft only while no answers exist
      // (D2), so a draft here is a machine holding an old pack.
      if (sitting.status === "DRAFT") {
        throw new ConflictError("SITTING_NOT_PUBLISHED", "The school took this exam back. Download it again.");
      }
      // CLOSED still accepts: a machine that was offline at the close keeps
      // its answers, and the late arrival is plain from `last_received_at`
      // against the close time (D6 — flag, don't reject; CBT3 shows it).

      const candidates = new Map(
        (await db.cbtCandidate.findMany({ where: { sittingId }, select: { id: true, studentId: true } })).map((c) => [
          c.studentId,
          c.id,
        ]),
      );
      const sheet = await this.answerSheet(db, sitting.paperId);

      const results: CbtSyncResultDto["results"] = [];
      for (const attempt of batch.attempts) {
        const candidateId = candidates.get(attempt.studentId);
        const base = { studentId: attempt.studentId, seq: attempt.seq };
        if (!candidateId) {
          results.push({ ...base, outcome: "REJECTED", reason: "NOT_ON_REGISTER" });
          continue;
        }
        if (!answersFit(sheet, attempt.answers)) {
          results.push({ ...base, outcome: "REJECTED", reason: "UNKNOWN_ANSWER" });
          continue;
        }
        const stored = await this.store(db, school.id, sittingId, candidateId, batch.deviceId, attempt);
        results.push({ ...base, outcome: stored ? "STORED" : "ALREADY_STORED", reason: null });
      }
      return { results };
    });
  }

  // -------------------------------------------------------------------------

  /**
   * Insert, or replace with a HIGHER seq — in one statement, so two batches
   * from the same machine racing each other cannot put an older snapshot over
   * a newer one. A submitted attempt is final. Returns whether a row changed.
   */
  private async store(
    db: Db,
    schoolId: string,
    sittingId: string,
    candidateId: string,
    deviceId: string,
    a: CbtAttemptSnapshot,
  ): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO cbt_attempts (
        id, school_id, sitting_id, candidate_id, device_id, seq, answers, answered_count,
        started_at, submitted_at, extra_minutes, focus_losses, first_received_at, last_received_at
      ) VALUES (
        gen_random_uuid()::text, ${schoolId}, ${sittingId}, ${candidateId}, ${deviceId}, ${a.seq},
        ${JSON.stringify(a.answers)}::jsonb, ${Object.keys(a.answers).length},
        (${a.startedAt}::timestamptz AT TIME ZONE 'UTC'),
        (${a.submittedAt}::timestamptz AT TIME ZONE 'UTC'),
        ${a.extraMinutes}, ${a.focusLosses},
        (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      )
      ON CONFLICT (candidate_id, device_id) DO UPDATE SET
        seq              = EXCLUDED.seq,
        answers          = EXCLUDED.answers,
        answered_count   = EXCLUDED.answered_count,
        started_at       = EXCLUDED.started_at,
        submitted_at     = EXCLUDED.submitted_at,
        extra_minutes    = EXCLUDED.extra_minutes,
        focus_losses     = EXCLUDED.focus_losses,
        last_received_at = EXCLUDED.last_received_at
      WHERE cbt_attempts.seq < EXCLUDED.seq AND cbt_attempts.submitted_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }

  private async syncKey(sittingId: string, unlockCode: string): Promise<Buffer> {
    const cacheKey = `${sittingId}:${unlockCode}`;
    const hit = this.syncKeys.get(cacheKey);
    if (hit) return hit;
    const key = await pbkdf2(
      normaliseCbtCode(unlockCode),
      cbtSyncSalt(sittingId),
      CBT_PACK_KDF.iterations,
      CBT_PACK_KDF.keyLengthBits / 8,
      "sha256",
    );
    return remember(this.syncKeys, cacheKey, key);
  }

  private async answerSheet(db: Db, paperId: string): Promise<AnswerSheet> {
    const hit = this.sheets.get(paperId);
    if (hit) return hit;
    const items = await db.examPaperItem.findMany({
      where: { paperId },
      select: { id: true, question: { select: { type: true, options: { select: { id: true } } } } },
    });
    const sheet: AnswerSheet = new Map(
      items
        .filter((i) => i.question.type === "MULTIPLE_CHOICE")
        .map((i) => [i.id, new Set(i.question.options.map((o) => o.id))]),
    );
    return remember(this.sheets, paperId, sheet);
  }

  private async resolveSchool(slug: string): Promise<{ id: string }> {
    // `schools` is the tenant table and carries no RLS policy.
    const school = await basePrisma.school.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, suspendedAt: true },
    });
    if (!school) throw new NotFoundError(NO_PACK);
    // Suspension blocks every sign-in (platform-admin D6); sitting an exam is one.
    if (school.suspendedAt) {
      throw new ForbiddenError("SCHOOL_SUSPENDED", "This school's account is suspended. Please contact the school.");
    }
    return school;
  }
}

function verify(key: Buffer, body: Buffer, signature: string): boolean {
  const expected = crypto.createHmac("sha256", key).update(body).digest();
  const given = Buffer.from(signature, "base64");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Every answer is an option of a multiple-choice item on this paper. */
function answersFit(sheet: AnswerSheet, answers: Record<string, string>): boolean {
  return Object.entries(answers).every(([itemId, optionId]) => sheet.get(itemId)?.has(optionId) ?? false);
}
