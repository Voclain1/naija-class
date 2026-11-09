import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  BaseError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PERMISSION_WILDCARD,
  STUDENT_CORRECTION_CONFLICT_CODES as C,
  STUDENT_CORRECTION_KIND,
  STUDENT_CORRECTION_TTL_MINUTES,
  UnauthorizedError,
  type PrepareStudentCorrectionsInput,
  type StudentCorrectionOutcomeDto,
  type StudentCorrectionProposalDto,
  type StudentCorrectionRowDto,
  type StudentCorrectionStatus,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { fingerprint } from "../../common/workflow/fingerprint";
import { expireWorkflowProposals } from "../../common/workflow/workflow-proposals";
import { computeCorrectionPreview, loadSnapshots, type CorrectionPreview, type CorrectionRows } from "./student-corrections-preview";

// Reviewed student-record corrections (docs/modules/student-corrections.md).
//
// prepare -> review (named before/after) -> confirm -> recover. One confirm
// transaction re-checks the person and the school, LOCKS the batch's student
// rows, recomputes the preview from them, and writes only if the fingerprint
// is unchanged: every update, its audit row and the COMPLETED marker commit
// together. A retry finds the outcome instead of writing again.
//
// No model call, no AI log. Values (names, dates, emails) never reach a log
// line or an audit row: audits list changed field NAMES, as PATCH does.

interface Payload {
  corrections: CorrectionRows;
  rows: StudentCorrectionRowDto[];
}

interface ProposalRow {
  id: string;
  status: StudentCorrectionStatus;
  requested_by: string;
  request_hash: string;
  preview_hash: string;
  payload: Payload | null;
  summary: CorrectionPreview["summary"];
  result: StudentCorrectionOutcomeDto | null;
  expires_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
}

type Db = PrismaClient;
const FEATURE = "student-corrections" as const;
const ADMIN_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class StudentCorrectionsService {
  private readonly logger = new Logger(StudentCorrectionsService.name);

  constructor(private readonly features: FeatureSwitchesService) {}

  async available(auth: AuthContext): Promise<{ enabled: boolean }> {
    return { enabled: await this.features.isOn(auth.schoolId, FEATURE) };
  }

  async prepare(auth: AuthContext, input: PrepareStudentCorrectionsInput, ip: string | null): Promise<StudentCorrectionProposalDto> {
    const requestHash = fingerprint(input.corrections);
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        await expireWorkflowProposals(db, auth.schoolId, new Date(), STUDENT_CORRECTION_KIND);
        const existing = await this.findByClientRequest(db, auth, input.clientRequestId);
        if (existing) return this.dtoFor(existing, requestHash);
        return this.insertProposal(db, auth, input.clientRequestId, requestHash, input.corrections, ip);
      }, { timeoutMs: 30_000, label: "student-corrections-prepare" });
    } catch (e) {
      this.failSafely(auth, "prepare", e);
    }
  }

  /** Status and outcome, for the requester, whatever the switch says. */
  async get(auth: AuthContext, id: string): Promise<StudentCorrectionProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: false });
        await expireWorkflowProposals(db, auth.schoolId, new Date(), STUDENT_CORRECTION_KIND);
        return this.dto(await this.load(db, auth, id, false));
      }, { label: "student-corrections-get" });
    } catch (e) {
      this.failSafely(auth, "read", e);
    }
  }

  async confirm(auth: AuthContext, id: string, previewHash: string, ip: string | null): Promise<StudentCorrectionProposalDto> {
    let row: ProposalRow;
    try {
      row = await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        const proposal = await this.load(db, auth, id, true);
        if (proposal.preview_hash !== previewHash) {
          throw new ConflictError(C.previewMismatch, "This is not the review you saw. Open it again.");
        }
        if (proposal.status === "COMPLETED") return proposal;
        if (proposal.status === "EXPIRED" || proposal.expires_at.getTime() <= Date.now() || !proposal.payload) {
          throw new ConflictError(C.expired, "This review expired. Refresh it, check it again, then confirm.");
        }
        const { corrections } = proposal.payload;
        // Lock every affected student, then compare with what was reviewed.
        const snapshots = await loadSnapshots(db, auth.schoolId, corrections.map((c) => c.studentId), true);
        const fresh = await computeCorrectionPreview(db, auth.schoolId, corrections, snapshots);
        if (fresh.previewHash !== proposal.preview_hash) {
          throw new ConflictError(C.stale, "A record in this batch changed since you reviewed it. Refresh, check again, then confirm. Nothing was changed.");
        }
        if (!fresh.canConfirm) throw new ConflictError(C.blocked, "This review has problems to fix first. Nothing was changed.");
        for (const w of fresh.writes) {
          await this.write(db, auth, w, proposal.id, ip);
        }
        const outcome: StudentCorrectionOutcomeDto = {
          updatedCount: fresh.writes.length,
          students: fresh.writes.map((w) => ({ studentId: w.studentId, changed: w.changed })),
        };
        return this.markCompleted(db, auth, proposal.id, outcome, ip);
      }, { timeoutMs: 60_000, retryConnectionErrors: false, label: "student-corrections-confirm" });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2002" || code === "P2034" || code === "P2028") {
        throw new ConflictError(C.retry, "Another change landed at the same time. Nothing was changed. Refresh and confirm again.");
      }
      this.failSafely(auth, "confirm", e);
    }
    return this.respond(row);
  }

  async refresh(auth: AuthContext, id: string, clientRequestId: string, ip: string | null): Promise<StudentCorrectionProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        const old = await this.load(db, auth, id, true);
        const already = await this.findByClientRequest(db, auth, clientRequestId);
        if (already) return this.dto(already);
        if (old.status === "COMPLETED") throw new ConflictError(C.alreadyConfirmed, "This batch was already applied. Open its outcome instead.");
        if (!old.payload) throw new ConflictError(C.expired, "This review expired and its values were cleared. Prepare it again.");
        await db.$executeRaw`
          UPDATE workflow_proposals SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
           WHERE school_id = ${auth.schoolId} AND id = ${old.id} AND status = 'PENDING'`;
        return this.insertProposal(db, auth, clientRequestId, old.request_hash, old.payload.corrections, ip, old.id);
      }, { timeoutMs: 30_000, label: "student-corrections-refresh" });
    } catch (e) {
      this.failSafely(auth, "refresh", e);
    }
  }

  // ---------------------------------------------------------------------

  private async insertProposal(
    db: Db, auth: AuthContext, clientRequestId: string, requestHash: string, corrections: CorrectionRows, ip: string | null, refreshedFrom?: string,
  ): Promise<StudentCorrectionProposalDto> {
    const snapshots = await loadSnapshots(db, auth.schoolId, corrections.map((c) => c.studentId), false);
    const preview = await computeCorrectionPreview(db, auth.schoolId, corrections, snapshots);
    const id = randomUUID();
    const expires = new Date(Date.now() + STUDENT_CORRECTION_TTL_MINUTES * 60_000);
    const payload: Payload = { corrections, rows: preview.rows };
    const [row] = await db.$queryRaw<ProposalRow[]>`
      INSERT INTO workflow_proposals
        (id, school_id, kind, requested_by, client_request_id, request_hash, preview_hash, payload, summary, expires_at)
      VALUES (${id}, ${auth.schoolId}, ${STUDENT_CORRECTION_KIND}, ${auth.userId}, ${clientRequestId}, ${requestHash},
              ${preview.previewHash}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(preview.summary)}::jsonb, ${expires})
      ON CONFLICT (school_id, kind, requested_by, client_request_id) DO NOTHING
      RETURNING *`;
    if (!row) {
      const winner = await this.findByClientRequest(db, auth, clientRequestId);
      if (!winner) throw new ConflictError(C.retry, "Prepare this batch again.");
      return this.dtoFor(winner, requestHash);
    }
    await this.audit(db, auth, id, "student-corrections.prepare", ip, {
      rows: preview.summary.counts.rows, toUpdate: preview.summary.counts.toUpdate, ...(refreshedFrom ? { refreshedFrom } : {}),
    });
    return this.dto(row);
  }

  /** One student's update and its audit row (field names only, as PATCH writes). */
  private async write(db: Db, auth: AuthContext, w: CorrectionPreview["writes"][number], proposalId: string, ip: string | null): Promise<void> {
    await db.student.update({ where: { id: w.studentId, schoolId: auth.schoolId }, data: w.data });
    await db.auditLog.create({
      data: {
        schoolId: auth.schoolId, userId: auth.userId, action: "student.update", entityType: "student", entityId: w.studentId,
        ipAddress: ip, metadata: { changed: w.changed, via: "student-corrections", proposalId },
      },
    });
  }

  /** The durable marker, in the write transaction. Clears the values. */
  private async markCompleted(db: Db, auth: AuthContext, id: string, outcome: StudentCorrectionOutcomeDto, ip: string | null): Promise<ProposalRow> {
    const [row] = await db.$queryRaw<ProposalRow[]>`
      UPDATE workflow_proposals
         SET status = 'COMPLETED', confirmed_by = ${auth.userId}, confirmed_at = CURRENT_TIMESTAMP,
             result = ${JSON.stringify(outcome)}::jsonb, payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
       WHERE school_id = ${auth.schoolId} AND id = ${id} AND status = 'PENDING'
       RETURNING *`;
    if (!row) throw new ConflictError(C.retry, "This review changed while it was being applied. Nothing was changed.");
    await this.audit(db, auth, id, "student-corrections.confirm", ip, { updated: outcome.updatedCount });
    return row;
  }

  /** After commit; separate so a lost response is a testable case. */
  private respond(row: ProposalRow): StudentCorrectionProposalDto {
    return this.dto(row);
  }

  private async findByClientRequest(db: Db, auth: AuthContext, clientRequestId: string): Promise<ProposalRow | null> {
    const rows = await db.$queryRaw<ProposalRow[]>`
      SELECT * FROM workflow_proposals
       WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_CORRECTION_KIND}
         AND requested_by = ${auth.userId} AND client_request_id = ${clientRequestId}`;
    return rows[0] ?? null;
  }

  private async load(db: Db, auth: AuthContext, id: string, lock: boolean): Promise<ProposalRow> {
    const rows = lock
      ? await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_CORRECTION_KIND} AND id = ${id} AND requested_by = ${auth.userId}
           FOR UPDATE`
      : await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_CORRECTION_KIND} AND id = ${id} AND requested_by = ${auth.userId}`;
    if (!rows[0]) throw new NotFoundError("Correction review not found.");
    return rows[0];
  }

  /**
   * School live, switch on (writes), person active, an owner or admin role
   * (as PATCH /students/:id), and both student.read and student.update.
   * Locked FOR SHARE so a revocation cannot land halfway through a confirm.
   */
  private async access(db: Db, auth: AuthContext, opts: { write: boolean }): Promise<void> {
    const [school] = await db.$queryRaw<{ ok: boolean; feature_switches: unknown }[]>`
      SELECT (status = 'ACTIVE' AND suspended_at IS NULL) AS ok, feature_switches FROM schools WHERE id = ${auth.schoolId} FOR SHARE`;
    if (!school?.ok) throw new ForbiddenError("School access is unavailable.");
    if (opts.write && !this.features.isOnFromStored(FEATURE, school.feature_switches)) {
      throw new ForbiddenError("Reviewed student corrections are switched off for this school.");
    }
    const grants = await db.$queryRaw<{ is_active: boolean; key: string; permissions: unknown }[]>`
      SELECT u.is_active, r.key, r.permissions FROM users u
        JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.school_id = ${auth.schoolId} AND u.id = ${auth.userId}
       FOR SHARE OF u, ur, r`;
    if (!grants.length || grants.some((g) => !g.is_active)) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
    const held = new Set(grants.flatMap((g) => (Array.isArray(g.permissions) ? (g.permissions as string[]) : [])));
    const permitted = held.has(PERMISSION_WILDCARD) || (held.has("student.read") && held.has("student.update"));
    if (!permitted || !grants.some((g) => ADMIN_ROLES.has(g.key))) throw new ForbiddenError("Not permitted.");
  }

  private dtoFor(row: ProposalRow, requestHash: string): StudentCorrectionProposalDto {
    if (row.request_hash !== requestHash) {
      throw new ConflictError(C.requestIdReused, "This request id was already used for a different batch. Use a new id.");
    }
    return this.dto(row);
  }

  private dto(row: ProposalRow): StudentCorrectionProposalDto {
    const expired = row.status === "EXPIRED" || (row.status === "PENDING" && row.expires_at.getTime() <= Date.now());
    const status: StudentCorrectionStatus = expired ? "EXPIRED" : row.status;
    const s = row.summary;
    return {
      id: row.id,
      status,
      previewHash: row.preview_hash,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      confirmedAt: row.confirmed_at?.toISOString() ?? null,
      counts: s.counts,
      batchErrors: s.batchErrors,
      canConfirm: status === "PENDING" && s.batchErrors.length === 0 && s.counts.withErrors === 0,
      rows: status === "PENDING" ? (row.payload?.rows ?? []) : [],
      dataCleared: row.payload === null,
      outcome: row.result,
    };
  }

  private async audit(db: Db, auth: AuthContext, id: string, action: string, ip: string | null, metadata: Record<string, string | number>) {
    // Counts and ids only: never a name, a date of birth or an email.
    await db.auditLog.create({
      data: { schoolId: auth.schoolId, userId: auth.userId, action, entityType: "workflow_proposal", entityId: id, ipAddress: ip, metadata: { via: "student-corrections", proposalId: id, ...metadata } },
    });
  }

  private failSafely(auth: AuthContext, operation: string, error: unknown): never {
    if (error instanceof BaseError) throw error;
    // Driver errors can quote names, dates or emails. Never log them.
    this.logger.error(`Student corrections ${operation} failed: school=${auth.schoolId}; details omitted`);
    throw new InternalError("The correction could not finish. Open the review to check its status before retrying.");
  }
}
