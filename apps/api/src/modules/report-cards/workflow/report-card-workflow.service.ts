import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type ReportCardArmActionInput,
  type ReportCardTransitionResultDto,
} from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../../common/auth/role-check";
import { isArmFullySignedOff } from "./subject-reviewed-cascade";
import { assertAllInState, distinctStatuses } from "./transitions";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const AUDIT = {
  formReview: "report-card.form-review",
  approve: "report-card.approve",
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

  // =========================================================================
  // Internals
  // =========================================================================

  private loadArmCards(db: TenantDb, input: ReportCardArmActionInput) {
    return db.reportCard.findMany({
      where: { termId: input.termId, classArmId: input.classArmId },
      select: { id: true, status: true },
    });
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
}
