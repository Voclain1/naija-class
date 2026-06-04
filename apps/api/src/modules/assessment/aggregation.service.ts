import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  computeClassAverages,
  computeClassPositions,
  computeSubjectPositions,
  type AggregateInput,
  type AggregateResultDto,
  type AggregateStatusResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const AUDIT_AGGREGATE = "assessment.aggregate";

// Phase 2 / Slice 4 — the position aggregation pass. A thin DB shell over the
// pure ranking functions (aggregation-rules.ts). Positions land on the
// materialized report-card PDFs, so correctness is paramount; the ranking math
// itself is exhaustively unit-tested (aggregation-rules.spec.ts), and this
// service is integration-tested for the DB concerns (the ENROLLED-roster
// denominator, the gate, idempotency, and the (j) narrow-pass invariant).
@Injectable()
export class AggregationService {
  // POST /assessments/aggregate. subjectId present → narrow (subjectPosition for
  // one subject); absent → full arm pass (every subject + overall classPosition).
  async aggregate(
    authCtx: AuthContext,
    input: AggregateInput,
    reqCtx: RequestContext,
  ): Promise<AggregateResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      // Term + arm must exist in-school (RLS scopes the lookups → null = 404).
      const term = await db.term.findUnique({ where: { id: input.termId }, select: { id: true } });
      if (!term) throw new NotFoundError("Term not found.");
      const arm = await db.classArm.findUnique({
        where: { id: input.classArmId },
        select: { id: true, classTeacherId: true },
      });
      if (!arm) throw new NotFoundError("Class arm not found.");

      await this.assertCanAggregate(db, authCtx, arm.classTeacherId);

      let result: AggregateResultDto;
      if (input.subjectId !== undefined) {
        const subject = await db.subject.findUnique({
          where: { id: input.subjectId },
          select: { id: true },
        });
        if (!subject) throw new NotFoundError("Subject not found.");
        result = await this.runSubjectNarrowPass(
          db,
          input.termId,
          input.classArmId,
          input.subjectId,
        );
      } else {
        result = await this.runFullArmPass(db, input.termId, input.classArmId);
      }

      await this.writeAudit(db, authCtx, reqCtx, input.classArmId, {
        termId: input.termId,
        classArmId: input.classArmId,
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
        studentCount: result.studentCount,
        updateCount: result.updateCount,
        mode: result.mode,
      });

      return result;
    });
  }

  // GET /assessments/aggregate/status — when were positions last computed.
  async getStatus(
    authCtx: AuthContext,
    termId: string,
    classArmId: string,
  ): Promise<AggregateStatusResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({
        where: { id: classArmId },
        select: { id: true, classTeacherId: true },
      });
      if (!arm) throw new NotFoundError("Class arm not found.");
      await this.assertCanAggregate(db, authCtx, arm.classTeacherId);

      const rows = await db.assessment.findMany({
        where: { termId, classArmId },
        select: { subjectId: true, positionsComputedAt: true, classPosition: true },
      });

      // perSubject: latest positionsComputedAt per subject (narrow OR full pass).
      const bySubject = new Map<string, Date | null>();
      for (const r of rows) {
        if (!bySubject.has(r.subjectId)) bySubject.set(r.subjectId, null);
        const current = bySubject.get(r.subjectId) ?? null;
        if (r.positionsComputedAt && (!current || r.positionsComputedAt > current)) {
          bySubject.set(r.subjectId, r.positionsComputedAt);
        }
      }
      const perSubject = [...bySubject.entries()].map(([subjectId, lastComputedAt]) => ({
        subjectId,
        lastComputedAt,
      }));

      // overall: latest positionsComputedAt among rows that carry a classPosition
      // (only a FULL pass sets classPosition).
      let overall: Date | null = null;
      for (const r of rows) {
        if (r.classPosition !== null && r.positionsComputedAt) {
          if (!overall || r.positionsComputedAt > overall) overall = r.positionsComputedAt;
        }
      }

      return { perSubject, overall };
    });
  }

  // Run the FULL arm pass inside a tx the CALLER owns (composability). The
  // public aggregate()/getStatus() above open their own withTenant for direct
  // HTTP callers; a SERVICE composing aggregation inside its own transaction
  // (slice 5's report-card build) calls this with its db handle — atomic, no
  // nested-tx deadlock. The caller is responsible for tenancy + authorization
  // (build is owner/admin-gated; the db handle is already RLS-scoped).
  async aggregateArmInTx(
    db: TenantDb,
    termId: string,
    classArmId: string,
  ): Promise<AggregateResultDto> {
    return this.runFullArmPass(db, termId, classArmId);
  }

  // =========================================================================
  // Internals
  // =========================================================================

  // Owner/admin may aggregate any arm. A teacher may aggregate ONLY the arm they
  // are the form teacher of (positions are an arm-level concern). Anyone else →
  // 404 (not 403 — the arm should appear not to exist, matching teacher-scope).
  private async assertCanAggregate(
    db: TenantDb,
    authCtx: AuthContext,
    classTeacherId: string | null,
  ): Promise<void> {
    const roleKeys = (
      await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: { role: { select: { key: true } } },
      })
    ).map((g) => g.role.key);

    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;
    if (roleKeys.includes("teacher") && classTeacherId === authCtx.userId) return;
    throw new NotFoundError("Class arm not found.");
  }

  // The load-bearing denominator: the LIVE roster of students whose enrollment in
  // (term, arm) is status=ENROLLED. Withdrawn/transferred/graduated students are
  // excluded (phase-2.md "read the roster live"); their Assessment rows, if any,
  // get their positions nulled by the passes below.
  private async loadEnrolledStudentIds(
    db: TenantDb,
    termId: string,
    classArmId: string,
  ): Promise<string[]> {
    const enrollments = await db.enrollment.findMany({
      where: { termId, classArmId, status: "ENROLLED" },
      select: { studentId: true },
    });
    return enrollments.map((e) => e.studentId);
  }

  // SUBJECT-NARROW pass: subjectPosition for ONE subject. This method MUST NOT
  // compute or touch classPosition — a narrow pass recomputes only the one
  // column (the (j) invariant: compute scopes narrower than write scopes). The
  // `data` below deliberately omits classPosition.
  private async runSubjectNarrowPass(
    db: TenantDb,
    termId: string,
    classArmId: string,
    subjectId: string,
  ): Promise<AggregateResultDto> {
    const enrolled = new Set(await this.loadEnrolledStudentIds(db, termId, classArmId));
    const rows = await db.assessment.findMany({
      where: { termId, subjectId, classArmId },
      select: { id: true, studentId: true, totalScore: true },
    });

    const positions = computeSubjectPositions(
      rows
        .filter((r) => enrolled.has(r.studentId))
        .map((r) => ({ studentId: r.studentId, totalScore: r.totalScore })),
    );

    const now = new Date();
    for (const r of rows) {
      const subjectPosition = enrolled.has(r.studentId)
        ? positions.get(r.studentId) ?? null
        : null; // withdrawn etc. → no rank
      await db.assessment.update({
        where: { id: r.id },
        data: { subjectPosition, positionsComputedAt: now },
        // classPosition intentionally NOT set — narrow pass owns only this column.
      });
    }

    return { mode: "subject", studentCount: enrolled.size, updateCount: rows.length };
  }

  // FULL arm pass: every subject's subjectPosition + the overall classPosition
  // (average-based, denormalized identically onto every one of a student's
  // subject rows for the term).
  private async runFullArmPass(
    db: TenantDb,
    termId: string,
    classArmId: string,
  ): Promise<AggregateResultDto> {
    const enrolled = new Set(await this.loadEnrolledStudentIds(db, termId, classArmId));
    const rows = await db.assessment.findMany({
      where: { termId, classArmId },
      select: { id: true, studentId: true, subjectId: true, totalScore: true },
    });

    // Per-subject positions (enrolled only; others → null).
    const subjectPositionByRow = new Map<string, number | null>();
    const rowsBySubject = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = rowsBySubject.get(r.subjectId) ?? [];
      list.push(r);
      rowsBySubject.set(r.subjectId, list);
    }
    for (const [, subjectRows] of rowsBySubject) {
      const positions = computeSubjectPositions(
        subjectRows
          .filter((r) => enrolled.has(r.studentId))
          .map((r) => ({ studentId: r.studentId, totalScore: r.totalScore })),
      );
      for (const r of subjectRows) {
        subjectPositionByRow.set(
          r.id,
          enrolled.has(r.studentId) ? positions.get(r.studentId) ?? null : null,
        );
      }
    }

    // Overall class positions: average each enrolled student's subject totals.
    const totalsByStudent = new Map<string, number[]>();
    for (const r of rows) {
      if (!enrolled.has(r.studentId)) continue;
      const list = totalsByStudent.get(r.studentId) ?? [];
      list.push(r.totalScore);
      totalsByStudent.set(r.studentId, list);
    }
    const classPositions = computeClassPositions(computeClassAverages(totalsByStudent));

    const now = new Date();
    for (const r of rows) {
      const classPosition = enrolled.has(r.studentId)
        ? classPositions.get(r.studentId) ?? null
        : null;
      await db.assessment.update({
        where: { id: r.id },
        data: {
          subjectPosition: subjectPositionByRow.get(r.id) ?? null,
          classPosition,
          positionsComputedAt: now,
        },
      });
    }

    return { mode: "full", studentCount: enrolled.size, updateCount: rows.length };
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    classArmId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action: AUDIT_AGGREGATE,
        entityType: "assessment",
        entityId: classArmId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}
