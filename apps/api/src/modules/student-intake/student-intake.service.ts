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
  STUDENT_INTAKE_CONFLICT_CODES as C,
  STUDENT_INTAKE_KIND,
  STUDENT_INTAKE_TTL_MINUTES,
  INTAKE_DUPLICATE_RULE,
  UnauthorizedError,
  type PrepareStudentIntakeInput,
  type StudentIntakeOutcomeDto,
  type StudentIntakeProposalDto,
  type StudentIntakeStatus,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { assignAdmissionNumbers } from "../students/admission-numbers";
import { insertStudentBatchInTx, type RequestContext } from "../students/students.service";
import {
  computeIntakePreview,
  normaliseInput,
  sha256,
  stableStringify,
  toWritableRow,
  type IntakeSummary,
  type StoredInput,
} from "./student-intake-preview";

// Reviewed student intake (docs/modules/student-intake-proposals.md).
//
// prepare -> review -> confirm -> recover. The server owns the proposal: the
// school, the requester, the kind, the placement and the rows are fixed at
// prepare and cannot be altered by the client afterwards. Confirm recomputes
// the preview in the write transaction and writes only if it is unchanged;
// the students, enrolments, audit rows and the COMPLETED marker commit
// together or not at all, so a retry after a lost response finds the outcome
// instead of writing twice.
//
// No model call, no guardian invitation, no notification, no AI log. Row data
// is never logged; errors are reported without their driver detail.

interface Payload {
  input: StoredInput;
}

interface ProposalRow {
  id: string;
  school_id: string;
  kind: string;
  requested_by: string;
  confirmed_by: string | null;
  status: StudentIntakeStatus;
  client_request_id: string;
  request_hash: string;
  preview_hash: string;
  payload: Payload | null;
  summary: IntakeSummary & { rows?: StudentIntakeProposalDto["rows"] };
  result: StudentIntakeOutcomeDto | null;
  expires_at: Date;
  created_at: Date;
  confirmed_at: Date | null;
  data_cleared_at: Date | null;
}

type Db = PrismaClient;
const ADMIN_ROLES = new Set(["owner", "admin"]);

@Injectable()
export class StudentIntakeService {
  private readonly logger = new Logger(StudentIntakeService.name);

  constructor(private readonly features: FeatureSwitchesService) {}

  async available(auth: AuthContext): Promise<{ enabled: boolean }> {
    return { enabled: await this.features.isOn(auth.schoolId, "student-intake") };
  }

  // ---------------------------------------------------------------------
  // PREPARE. Idempotent on (school, kind, requester, clientRequestId).
  // ---------------------------------------------------------------------
  async prepare(auth: AuthContext, input: PrepareStudentIntakeInput, ip: string | null): Promise<StudentIntakeProposalDto> {
    const stored = normaliseInput(input);
    const requestHash = sha256(stableStringify(stored));
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        await this.expireStale(db, auth.schoolId);
        const existing = await this.findByClientRequest(db, auth, input.clientRequestId);
        if (existing) return this.dtoFor(existing, requestHash);
        return this.insertProposal(db, auth, input.clientRequestId, requestHash, stored, ip);
      }, { timeoutMs: 30_000, label: "student-intake-prepare" });
    } catch (e) {
      this.failSafely(auth, "prepare", e);
    }
  }

  // ---------------------------------------------------------------------
  // STATUS / OUTCOME. Readable by the requester whatever the switch says,
  // so a confirmed outcome can always be recovered.
  // ---------------------------------------------------------------------
  async get(auth: AuthContext, id: string): Promise<StudentIntakeProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: false });
        await this.expireStale(db, auth.schoolId);
        const row = await this.load(db, auth, id, false);
        return this.dto(row);
      }, { label: "student-intake-get" });
    } catch (e) {
      this.failSafely(auth, "read", e);
    }
  }

  // ---------------------------------------------------------------------
  // CONFIRM. One transaction: re-check access, lock the proposal, return an
  // existing outcome, or recompute, write and mark COMPLETED together.
  // ---------------------------------------------------------------------
  async confirm(auth: AuthContext, id: string, previewHash: string, reqCtx: RequestContext): Promise<StudentIntakeProposalDto> {
    let row: ProposalRow;
    try {
      row = await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        const proposal = await this.load(db, auth, id, true);
        if (proposal.preview_hash !== previewHash) {
          throw new ConflictError(C.previewMismatch, "This is not the preview you reviewed. Open the proposal again and review it.");
        }
        // A retry after a lost response: the outcome, never a second write.
        if (proposal.status === "COMPLETED") return proposal;
        if (proposal.status === "EXPIRED" || proposal.expires_at.getTime() <= Date.now() || !proposal.payload) {
          throw new ConflictError(C.expired, "This preview expired. Refresh it, review it again, then confirm.");
        }
        const fresh = await computeIntakePreview(db, auth.schoolId, proposal.payload.input);
        if (fresh.previewHash !== proposal.preview_hash) {
          throw new ConflictError(C.stale, "Something in this preview changed since you reviewed it. Refresh it, review it again, then confirm. Nothing was added.");
        }
        if (!fresh.canConfirm) {
          throw new ConflictError(C.blocked, "This preview has problems to fix first. Nothing was added.");
        }
        const outcome = await this.write(db, auth, proposal, fresh.write, reqCtx);
        return this.markCompleted(db, auth, proposal.id, outcome, reqCtx);
      }, { timeoutMs: 60_000, retryConnectionErrors: false, label: "student-intake-confirm" });
    } catch (e) {
      const code = (e as { code?: string }).code;
      const meta = (e as { meta?: { code?: string; driverAdapterError?: { cause?: { code?: string; originalCode?: string } } } }).meta;
      const pgCode = meta?.code ?? meta?.driverAdapterError?.cause?.code ?? meta?.driverAdapterError?.cause?.originalCode;
      // A number typed by someone else a moment ago, or another write racing
      // this one: the whole transaction rolled back. Not retried here.
      if (code === "P2002" || code === "P2034" || ["40001", "40P01", "23505"].includes(pgCode ?? "")) {
        throw new ConflictError(C.retry, "Another change landed at the same time. Nothing was added. Refresh the preview and confirm again.");
      }
      this.failSafely(auth, "confirm", e);
    }
    return this.respond(row);
  }

  // ---------------------------------------------------------------------
  // REFRESH. A new proposal from the same stored rows; the old one is retired
  // so only one live proposal exists for the batch. Idempotent on the new
  // clientRequestId.
  // ---------------------------------------------------------------------
  async refresh(auth: AuthContext, id: string, clientRequestId: string, ip: string | null): Promise<StudentIntakeProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, { write: true });
        const old = await this.load(db, auth, id, true);
        const already = await this.findByClientRequest(db, auth, clientRequestId);
        if (already) return this.dtoFor(already, already.request_hash);
        if (old.status === "COMPLETED") {
          throw new ConflictError(C.alreadyConfirmed, "This batch was already confirmed. Open its outcome instead.");
        }
        if (!old.payload) {
          throw new ConflictError(C.expired, "This batch's rows were cleared when it expired. Prepare it again from your rows.");
        }
        const stored = old.payload.input;
        await this.retire(db, auth.schoolId, old.id);
        return this.insertProposal(db, auth, clientRequestId, old.request_hash, stored, ip, old.id);
      }, { timeoutMs: 30_000, label: "student-intake-refresh" });
    } catch (e) {
      this.failSafely(auth, "refresh", e);
    }
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async insertProposal(
    db: Db, auth: AuthContext, clientRequestId: string, requestHash: string, stored: StoredInput,
    ip: string | null, refreshedFrom?: string,
  ): Promise<StudentIntakeProposalDto> {
    const preview = await computeIntakePreview(db, auth.schoolId, stored);
    const id = randomUUID();
    const expires = new Date(Date.now() + STUDENT_INTAKE_TTL_MINUTES * 60_000);
    // `summary` carries no row data; the rows' problems live with the rows.
    const payload: Payload & { rows: StudentIntakeProposalDto["rows"] } = { input: stored, rows: preview.rows };
    const inserted = await db.$queryRaw<ProposalRow[]>`
      INSERT INTO workflow_proposals
        (id, school_id, kind, requested_by, client_request_id, request_hash, preview_hash, payload, summary, expires_at)
      VALUES (${id}, ${auth.schoolId}, ${STUDENT_INTAKE_KIND}, ${auth.userId}, ${clientRequestId}, ${requestHash},
              ${preview.previewHash}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(preview.summary)}::jsonb, ${expires})
      ON CONFLICT (school_id, kind, requested_by, client_request_id) DO NOTHING
      RETURNING *
    `;
    if (!inserted[0]) {
      // The same clientRequestId, prepared concurrently: answer with that one.
      const winner = await this.findByClientRequest(db, auth, clientRequestId);
      if (!winner) throw new ConflictError(C.retry, "Prepare this batch again.");
      return this.dtoFor(winner, requestHash);
    }
    await this.audit(db, auth, id, "student-intake.prepare", ip, {
      rows: preview.summary.counts.rows,
      rowsWithErrors: preview.summary.counts.withErrors,
      placement: preview.summary.placement.mode,
      ...(refreshedFrom ? { refreshedFrom } : {}),
    });
    return this.dto(inserted[0]);
  }

  /** Students, then enrolments, through the same writer as POST /students/bulk. */
  private async write(
    db: Db, auth: AuthContext, proposal: ProposalRow,
    resolved: Awaited<ReturnType<typeof computeIntakePreview>>["write"], reqCtx: RequestContext,
  ): Promise<StudentIntakeOutcomeDto> {
    const rows = proposal.payload!.input.students.map(toWritableRow);
    const numbers = rows.map((r) => r.admissionNumber ?? null);
    const blanks = numbers.flatMap((n, i) => (n ? [] : [i]));
    if (blanks.length > 0) {
      // Preview showed these as "assigned on confirm"; the numbering was
      // part of the fingerprint, so it is the numbering the person reviewed.
      const assigned = await assignAdmissionNumbers(
        db, auth.schoolId, resolved.numbering!,
        blanks.map(() => ({ classCode: resolved.placement?.classCode })),
        { taken: new Set(numbers.filter((n): n is string => !!n)) },
      );
      blanks.forEach((i, k) => { numbers[i] = assigned[k]!; });
    }
    const attribution = { via: "student-intake", proposalId: proposal.id };
    const inserted = await insertStudentBatchInTx(db, auth, rows, numbers as string[], resolved.placement, reqCtx, {
      student: attribution, enrollment: attribution,
    });
    return {
      createdCount: inserted.length,
      enrolledCount: inserted.filter((r) => r.enrollmentId).length,
      students: inserted.map((r, index) => ({
        index, studentId: r.student.id, admissionNumber: r.student.admissionNumber, enrollmentId: r.enrollmentId,
      })),
    };
  }

  /** The durable marker, in the same transaction as the write. Clears the rows. */
  private async markCompleted(db: Db, auth: AuthContext, id: string, outcome: StudentIntakeOutcomeDto, reqCtx: RequestContext): Promise<ProposalRow> {
    const [row] = await db.$queryRaw<ProposalRow[]>`
      UPDATE workflow_proposals
         SET status = 'COMPLETED', confirmed_by = ${auth.userId}, confirmed_at = CURRENT_TIMESTAMP,
             result = ${JSON.stringify(outcome)}::jsonb, payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
       WHERE school_id = ${auth.schoolId} AND id = ${id} AND status = 'PENDING'
       RETURNING *
    `;
    if (!row) throw new ConflictError(C.retry, "This proposal changed while it was being confirmed. Nothing was added.");
    await this.audit(db, auth, id, "student-intake.confirm", reqCtx.ipAddress, {
      created: outcome.createdCount, enrolled: outcome.enrolledCount,
    });
    return row;
  }

  /** After commit. Kept separate so a lost response is a testable case. */
  private respond(row: ProposalRow): StudentIntakeProposalDto {
    return this.dto(row);
  }

  private async retire(db: Db, schoolId: string, id: string): Promise<void> {
    await db.$executeRaw`
      UPDATE workflow_proposals
         SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
       WHERE school_id = ${schoolId} AND id = ${id} AND status = 'PENDING'
    `;
  }

  /** Expired proposals lose their rows. Also run hourly by the sweeper. */
  private async expireStale(db: Db, schoolId: string): Promise<void> {
    await expireStudentIntakeProposals(db, schoolId);
  }

  private async findByClientRequest(db: Db, auth: AuthContext, clientRequestId: string): Promise<ProposalRow | null> {
    const rows = await db.$queryRaw<ProposalRow[]>`
      SELECT * FROM workflow_proposals
       WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_INTAKE_KIND}
         AND requested_by = ${auth.userId} AND client_request_id = ${clientRequestId}
    `;
    return rows[0] ?? null;
  }

  /** The requester's own proposal, or 404 (another person's reads as absent). */
  private async load(db: Db, auth: AuthContext, id: string, lock: boolean): Promise<ProposalRow> {
    const rows = lock
      ? await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_INTAKE_KIND} AND id = ${id} AND requested_by = ${auth.userId}
           FOR UPDATE`
      : await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${STUDENT_INTAKE_KIND} AND id = ${id} AND requested_by = ${auth.userId}`;
    if (!rows[0]) throw new NotFoundError("Proposal not found.");
    return rows[0];
  }

  /**
   * School live, switch on (for writes), person active and holding
   * student.create through an owner or admin role. Grants are locked FOR
   * SHARE so a revocation cannot land halfway through a confirm.
   */
  private async access(db: Db, auth: AuthContext, opts: { write: boolean }): Promise<void> {
    const [school] = await db.$queryRaw<{ ok: boolean; feature_switches: unknown }[]>`
      SELECT (status = 'ACTIVE' AND suspended_at IS NULL) AS ok, feature_switches
        FROM schools WHERE id = ${auth.schoolId} FOR SHARE
    `;
    if (!school || !school.ok) throw new ForbiddenError("School access is unavailable.");
    if (opts.write && !this.features.isOnFromStored("student-intake", school.feature_switches)) {
      throw new ForbiddenError("Reviewed student intake is switched off for this school.");
    }
    const grants = await db.$queryRaw<{ is_active: boolean; key: string; permissions: unknown }[]>`
      SELECT u.is_active, r.key, r.permissions FROM users u
        JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.school_id = ${auth.schoolId} AND u.id = ${auth.userId}
       FOR SHARE OF u, ur, r
    `;
    if (!grants.length || grants.some((g) => !g.is_active)) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
    const held = new Set(grants.flatMap((g) => (Array.isArray(g.permissions) ? (g.permissions as string[]) : [])));
    const permitted = held.has(PERMISSION_WILDCARD) || held.has("student.create");
    if (!permitted || !grants.some((g) => ADMIN_ROLES.has(g.key))) throw new ForbiddenError("Not permitted.");
  }

  private dtoFor(row: ProposalRow, requestHash: string): StudentIntakeProposalDto {
    if (row.request_hash !== requestHash) {
      throw new ConflictError(C.requestIdReused, "This request id was already used for a different batch. Use a new id.");
    }
    return this.dto(row);
  }

  private dto(row: ProposalRow): StudentIntakeProposalDto {
    const expired = row.status === "EXPIRED" || (row.status === "PENDING" && row.expires_at.getTime() <= Date.now());
    const status: StudentIntakeStatus = expired ? "EXPIRED" : row.status;
    const payload = row.payload as (Payload & { rows?: StudentIntakeProposalDto["rows"] }) | null;
    const rows = status === "PENDING" ? (payload?.rows ?? []) : [];
    const s = row.summary;
    return {
      id: row.id,
      status,
      previewHash: row.preview_hash,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      confirmedAt: row.confirmed_at?.toISOString() ?? null,
      placement: s.placement,
      counts: s.counts,
      batchErrors: s.batchErrors,
      batchWarnings: s.batchWarnings,
      canConfirm: status === "PENDING" && s.batchErrors.length === 0 && s.counts.withErrors === 0,
      rows,
      dataCleared: row.payload === null,
      duplicateRule: INTAKE_DUPLICATE_RULE,
      outcome: row.result,
    };
  }

  private async audit(db: Db, auth: AuthContext, id: string, action: string, ip: string | null, metadata: Record<string, string | number>) {
    // Counts and ids only: never a name, a date of birth or a row.
    await db.auditLog.create({
      data: {
        schoolId: auth.schoolId, userId: auth.userId, action,
        entityType: "workflow_proposal", entityId: id, ipAddress: ip,
        metadata: { via: "student-intake", proposalId: id, ...metadata },
      },
    });
  }

  private failSafely(auth: AuthContext, operation: string, error: unknown): never {
    if (error instanceof BaseError) throw error;
    // A raw-query or validation failure can carry row values (names, dates)
    // in its detail. Never hand that exception to the logger or Sentry.
    this.logger.error(`Student intake ${operation} failed: school=${auth.schoolId}; details omitted`);
    throw new InternalError("The student intake could not finish. Open the proposal to check its status before retrying.");
  }
}

/**
 * Marks a school's expired intake proposals EXPIRED and clears their rows.
 * Shared by the service (on every touch) and the hourly sweeper.
 */
export async function expireStudentIntakeProposals(db: Db, schoolId: string, now: Date = new Date()): Promise<number> {
  return db.$executeRaw`
    UPDATE workflow_proposals
       SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
     WHERE school_id = ${schoolId} AND kind = ${STUDENT_INTAKE_KIND}
       AND status = 'PENDING' AND expires_at <= ${now}
  `;
}
