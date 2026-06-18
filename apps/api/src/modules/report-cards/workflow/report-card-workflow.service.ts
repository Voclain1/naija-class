import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type PrincipalNoteResultDto,
  type PrincipalNoteUpdateInput,
  type ReportCardArmActionInput,
  type ReportCardArmReopenInput,
  type ReportCardCommentUpdateInput,
  type ReportCardDto,
  type ReportCardTransitionResultDto,
} from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { REPORT_CARD_SELECT, ReportCardService, toReportCardDto } from "../report-card.service";
import { assertNoReleasedCards } from "./released-guard";
import { isArmFullySignedOff } from "./subject-reviewed-cascade";
import { assertAllInState, distinctStatuses } from "./transitions";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const AUDIT = {
  formReview: "report-card.form-review",
  // Matches the @Permissions key + the spec's audit-action list. (Renamed from
  // "report-card.approve" in slice-9 cp2 — audit action strings should match
  // permission names; the divergence was a trip hazard. A data migration
  // rewrites existing audit_logs rows.)
  approve: "report-card.principal-approve",
  release: "report-card.release",
  reopen: "report-card.reopen",
  comment: "report-card.comment",
} as const;

// ReportCardWorkflowService (Phase 2 / Slice 6) — the arm-batch approval state
// machine. Kept SEPARATE from ReportCardService (materialization/read/render) so
// the workflow concern is cohesive; the controller injects both. cp1 ships
// form-review + approve; cp2 adds release + reopen + comment editing here.
//
// Every transition is per (term, classArm): load all the arm's cards, assert
// they're all in a legal source state (else 409), then updateMany them together
// in one withTenant tx. Preconditions are re-checked INSIDE the tx (the spec's
// race answer).
@Injectable()
export class ReportCardWorkflowService {
  // ReportCardService injected for enqueueArmRenderInTx (release composes the
  // render enqueue in its own tx). No cycle: ReportCardService has no dependency
  // back on the workflow service.
  constructor(private readonly reportCards: ReportCardService) {}

  // POST /report-cards/arm/form-review — owner/admin OR the arm's FORM teacher.
  // DRAFT/SUBJECT_REVIEWED → FORM_REVIEWED. Re-verifies all subjects signed off
  // (so a stale SUBJECT_REVIEWED, after an un-sign-off, 409s here).
  async formReview(
    authCtx: AuthContext,
    input: ReportCardArmActionInput,
    reqCtx: RequestContext,
  ): Promise<ReportCardTransitionResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertOwnerAdminOrFormTeacher(db, authCtx, input.classArmId);

      const cards = await this.loadArmCards(db, input);
      assertAllInState(cards, ["DRAFT", "SUBJECT_REVIEWED"], "submit for form review");

      // Belt-and-braces precondition: every subject signed off RIGHT NOW. The
      // stored SUBJECT_REVIEWED can be stale (a subject got un-signed after the
      // eager cascade); this is where that 409s.
      if (!(await isArmFullySignedOff(db, input.termId, input.classArmId))) {
        throw new ConflictError(
          "SUBJECTS_NOT_SIGNED_OFF",
          "Every subject must be signed off before the arm can go to form review.",
        );
      }

      const fromStatus = distinctStatuses(cards).join(",");
      await db.reportCard.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        data: { status: "FORM_REVIEWED", formReviewedAt: new Date(), formReviewedBy: authCtx.userId },
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.formReview, input, fromStatus, "FORM_REVIEWED", cards.length);
      return { status: "FORM_REVIEWED", cardCount: cards.length };
    });
  }

  // POST /report-cards/arm/approve — owner/admin only.
  // FORM_REVIEWED → PRINCIPAL_APPROVED.
  async approve(
    authCtx: AuthContext,
    input: ReportCardArmActionInput,
    reqCtx: RequestContext,
  ): Promise<ReportCardTransitionResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
      if (!arm) throw new NotFoundError("Class arm not found.");

      const cards = await this.loadArmCards(db, input);
      assertAllInState(cards, ["FORM_REVIEWED"], "approve");

      const fromStatus = distinctStatuses(cards).join(",");
      await db.reportCard.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        data: {
          status: "PRINCIPAL_APPROVED",
          principalApprovedAt: new Date(),
          principalApprovedBy: authCtx.userId,
        },
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.approve, input, fromStatus, "PRINCIPAL_APPROVED", cards.length);
      return { status: "PRINCIPAL_APPROVED", cardCount: cards.length };
    });
  }

  // POST /report-cards/arm/release — owner/admin only. PRINCIPAL_APPROVED →
  // RELEASED + enqueue per-card render jobs, ALL IN ONE TX. If the enqueue throws
  // (Redis down), the whole transition rolls back — no RELEASED-with-no-pending-
  // render window. Render FAILURES after commit do NOT roll back RELEASED:
  // release is the academic decision, the PDF is its artifact (the worker flips
  // pdfStatus → FAILED individually and the UI offers Regenerate).
  async release(
    authCtx: AuthContext,
    input: ReportCardArmActionInput,
    reqCtx: RequestContext,
  ): Promise<ReportCardTransitionResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const result: ReportCardTransitionResultDto = await withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({ where: { id: input.termId }, select: { id: true } });
      if (!term) throw new NotFoundError("Term not found.");
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
      if (!arm) throw new NotFoundError("Class arm not found.");

      const cards = await this.loadArmCards(db, input);
      assertAllInState(cards, ["PRINCIPAL_APPROVED"], "release");

      await db.reportCard.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        data: { status: "RELEASED", releasedAt: new Date(), pdfStatus: "PENDING" },
      });

      // Compose the slice-5 enqueue in THIS tx. Throws here roll the release back.
      const enqueuedCount = await this.reportCards.enqueueArmRenderInTx(
        db,
        authCtx.schoolId,
        authCtx.userId,
        input.termId,
        input.classArmId,
      );

      await this.writeAuditMeta(db, authCtx, reqCtx, AUDIT.release, input.classArmId, {
        termId: input.termId,
        classArmId: input.classArmId,
        fromStatus: "PRINCIPAL_APPROVED",
        toStatus: "RELEASED",
        cardCount: cards.length,
        enqueuedCount,
      });
      return { status: "RELEASED", cardCount: cards.length };
    });

    // Wake the render worker machine after the tx commits (Fly scale-to-zero).
    // Jobs wait in the BullMQ queue during cold start (~5–30 s); acceptable for
    // batch rendering. Fire-and-forget: errors here don't fail the release.
    const renderWorkerUrl = process.env.RENDER_WORKER_URL;
    if (renderWorkerUrl) {
      fetch(`${renderWorkerUrl}/health`).catch(() => {});
    }

    return result;
  }

  // POST /report-cards/arm/reopen — OWNER ONLY (admin excluded per spec; the
  // dedicated principal role is deferred). Audited rollback to DRAFT from ANY
  // non-DRAFT state. Clears the workflow timestamps for a clean re-walk;
  // PRESERVES the PDF artifact (generatedAt / artifactUrl / pdfStatus) — the R2
  // blob stays at its deterministic path and a re-release overwrites it.
  async reopen(
    authCtx: AuthContext,
    input: ReportCardArmReopenInput,
    reqCtx: RequestContext,
  ): Promise<ReportCardTransitionResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
      if (!arm) throw new NotFoundError("Class arm not found.");

      const cards = await db.reportCard.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: { id: true, status: true, pdfStatus: true },
      });
      if (cards.length === 0) {
        throw new ConflictError("NO_REPORT_CARDS", "No report cards to reopen — build the arm first.");
      }

      // Race guard: never reopen while a render is mid-flight (the worker would
      // otherwise write GENERATED onto a card we just rolled to DRAFT).
      if (cards.some((c) => c.pdfStatus === "GENERATING")) {
        throw new ConflictError(
          "ARM_RENDER_IN_FLIGHT",
          "Cannot reopen while a PDF render is in progress; retry shortly.",
        );
      }

      const fromStatuses = [...new Set(cards.map((c) => c.status))].sort();
      await db.reportCard.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        data: {
          status: "DRAFT",
          formReviewedAt: null,
          formReviewedBy: null,
          principalApprovedAt: null,
          principalApprovedBy: null,
          releasedAt: null,
          // PRESERVE: generatedAt, artifactUrl, pdfStatus — not touched.
        },
      });

      await this.writeAuditMeta(db, authCtx, reqCtx, AUDIT.reopen, input.classArmId, {
        termId: input.termId,
        classArmId: input.classArmId,
        fromStatuses,
        toStatus: "DRAFT",
        reason: input.reason,
        cardCount: cards.length,
      });
      return { status: "DRAFT", cardCount: cards.length };
    });
  }

  // PATCH /report-cards/:id — per-card form-teacher comment. owner/admin OR the
  // arm's form teacher. Editable ONLY in DRAFT / SUBJECT_REVIEWED (Q5 matrix).
  async editFormTeacherComment(
    authCtx: AuthContext,
    reportCardId: string,
    input: ReportCardCommentUpdateInput,
    reqCtx: RequestContext,
  ): Promise<ReportCardDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const card = await db.reportCard.findUnique({
        where: { id: reportCardId },
        select: { id: true, studentId: true, termId: true, classArmId: true, status: true },
      });
      if (!card) throw new NotFoundError("Report card not found.");
      await this.assertOwnerAdminOrFormTeacher(db, authCtx, card.classArmId);

      if (card.status !== "DRAFT" && card.status !== "SUBJECT_REVIEWED") {
        throw new ConflictError(
          "COMMENT_NOT_EDITABLE",
          "The form teacher's comment can only be edited while the arm is in DRAFT or SUBJECT_REVIEWED.",
        );
      }
      // Defence-in-depth: the state gate already excludes RELEASED, but run the
      // immutability guard too so a future state-gate bug can't slip an edit
      // onto a released card.
      await assertNoReleasedCards(db, card.termId, [card.studentId]);

      const updated = await db.reportCard.update({
        where: { id: reportCardId },
        data: { formTeacherComment: input.formTeacherComment },
        select: REPORT_CARD_SELECT,
      });

      await this.writeAuditMeta(db, authCtx, reqCtx, AUDIT.comment, reportCardId, {
        reportCardId,
        field: "formTeacherComment",
        termId: card.termId,
        classArmId: card.classArmId,
      });
      return toReportCardDto(updated);
    });
  }

  // PUT /report-cards/arm/principal-note — owner/admin only. The arm-term note,
  // fanned out identically onto EVERY card in (term, arm). Editable ONLY in
  // FORM_REVIEWED (Q5 matrix).
  async editPrincipalNote(
    authCtx: AuthContext,
    input: PrincipalNoteUpdateInput,
    reqCtx: RequestContext,
  ): Promise<PrincipalNoteResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
      if (!arm) throw new NotFoundError("Class arm not found.");

      const cards = await this.loadArmCards(db, input);
      // State gate (Q5): FORM_REVIEWED only. Uses COMMENT_NOT_EDITABLE (a comment
      // edit, not a workflow transition) — consistent with formTeacherComment.
      if (cards.length === 0) {
        throw new ConflictError("NO_REPORT_CARDS", "No report cards to annotate — build the arm first.");
      }
      if (cards.some((card) => card.status !== "FORM_REVIEWED")) {
        throw new ConflictError(
          "COMMENT_NOT_EDITABLE",
          "The principal's note can only be edited while the arm is in FORM_REVIEWED.",
        );
      }
      // Defence-in-depth immutability guard (RELEASED excluded by the gate above).
      const studentIds = await this.armStudentIds(db, input);
      await assertNoReleasedCards(db, input.termId, studentIds);

      await db.reportCard.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        data: { principalNote: input.principalNote },
      });

      await this.writeAuditMeta(db, authCtx, reqCtx, AUDIT.comment, input.classArmId, {
        termId: input.termId,
        classArmId: input.classArmId,
        field: "principalNote",
        cardCount: cards.length,
      });
      return { cardCount: cards.length };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private loadArmCards(db: TenantDb, input: { termId: string; classArmId: string }) {
    return db.reportCard.findMany({
      where: { termId: input.termId, classArmId: input.classArmId },
      select: { id: true, status: true },
    });
  }

  private async armStudentIds(db: TenantDb, input: { termId: string; classArmId: string }): Promise<string[]> {
    const rows = await db.reportCard.findMany({
      where: { termId: input.termId, classArmId: input.classArmId },
      select: { studentId: true },
    });
    return rows.map((r) => r.studentId);
  }

  // owner/admin manage any arm; a teacher only the arm they FORM-teach. A
  // stranger teacher gets 404 (mirrors ReportCardService.assertCanReadArm — we
  // don't reveal arms outside the caller's scope).
  private async assertOwnerAdminOrFormTeacher(
    db: TenantDb,
    authCtx: AuthContext,
    classArmId: string,
  ): Promise<void> {
    const arm = await db.classArm.findUnique({
      where: { id: classArmId },
      select: { id: true, classTeacherId: true },
    });
    if (!arm) throw new NotFoundError("Class arm not found.");

    const roleKeys = (
      await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: { role: { select: { key: true } } },
      })
    ).map((g) => g.role.key);

    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;
    if (roleKeys.includes("teacher") && arm.classTeacherId === authCtx.userId) return;
    throw new NotFoundError("Class arm not found.");
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    action: string,
    input: ReportCardArmActionInput,
    fromStatus: string,
    toStatus: string,
    cardCount: number,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "report_card",
        entityId: input.classArmId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          termId: input.termId,
          classArmId: input.classArmId,
          fromStatus,
          toStatus,
          cardCount,
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  // Generic audit writer for the cp2 actions whose metadata shapes differ from
  // the form-review/approve pair (release adds enqueuedCount; reopen adds
  // reason + fromStatuses; comment adds field).
  private async writeAuditMeta(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "report_card",
        entityId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}
