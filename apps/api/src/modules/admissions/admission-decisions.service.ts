import { Injectable } from "@nestjs/common";

import { withTenant, type Prisma, type PrismaClient } from "@school-kit/db";
import {
  ADMISSION_OPEN_STATUSES,
  ADMISSION_STATUS_LABEL,
  ConflictError,
  NotFoundError,
  sickbayDayOf,
  sickbayMomentFrom,
  ValidationError,
  type AdmissionStatus,
  type AdmitApplicationInput,
  type AdmitApplicationResultDto,
  type BookAdmissionAssessmentInput,
  type OfferAdmissionInput,
  type RecordAdmissionAcceptanceInput,
  type RejectAdmissionInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { linkOrCreatePrimaryGuardianInTx } from "../guardians/guardians.service.js";
import { createStudentInTx } from "../students/students.service.js";
import { AdmissionMailService } from "./admission-mail.service.js";

// Phase 9 / CP7.2 — moving an application to a decision (docs/modules/
// phase-9.md §16 CP7-D4, D5; owner's answers §16.8).
//
//   SUBMITTED → UNDER_REVIEW → OFFERED → OFFER_ACCEPTED → ADMITTED,
//   with REJECTED or WITHDRAWN from any open state.
//
// Every move is ONE conditional update on the expected status, so two people
// acting at once cannot both succeed (the second is told the application's
// new status). The family's email goes after the change is saved.
//
// Who: owner, admin and the optional Admissions officer handle applications
// up to an accepted offer. ADMIT creates the student, so it is owner and admin
// only (`admission.admit`): the admin clears the child into a class (§16.8).

const ADMISSION_ROLES = ["owner", "admin", "admission_officer"] as const;
const ADMIT_ROLES = ["owner", "admin"] as const;

interface RequestContext {
  ipAddress: string | null;
}

type Db = PrismaClient;

@Injectable()
export class AdmissionDecisionsService {
  constructor(private readonly mail: AdmissionMailService) {}

  /** New → Under review. No email: the family hears at the next real step. */
  async review(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    await withTenant(authCtx.schoolId, (db) => move(db, authCtx, id, ["SUBMITTED"], "UNDER_REVIEW", {}, "admission.review", req));
  }

  /** Book, or change, the assessment. A new application moves to Under review. */
  async bookAssessment(authCtx: AuthContext, id: string, input: BookAdmissionAssessmentInput, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    if (input.day < sickbayDayOf(new Date())) throw new ValidationError("The assessment cannot be in the past.");
    const at = new Date(sickbayMomentFrom(input.day, input.time));
    const changed = await withTenant(authCtx.schoolId, async (db) => {
      const current = await load(db, authCtx.schoolId, id);
      if (current.status !== "SUBMITTED" && current.status !== "UNDER_REVIEW") throw stale(current.status);
      await move(
        db,
        authCtx,
        id,
        [current.status],
        "UNDER_REVIEW",
        { assessmentKind: input.kind, assessmentAt: at, assessmentNote: input.note ?? null },
        "admission.assessment",
        req,
        { kind: input.kind, changed: current.assessmentAt !== null },
      );
      return current.assessmentAt !== null;
    });
    await this.mail.send(authCtx.schoolId, id, { kind: "ASSESSMENT", changed });
  }

  /** Offer a place, with the letter the family sees in full (§16.8 answer 2). */
  async offer(authCtx: AuthContext, id: string, input: OfferAdmissionInput, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    await withTenant(authCtx.schoolId, (db) =>
      move(db, authCtx, id, ["SUBMITTED", "UNDER_REVIEW"], "OFFERED", { offerLetter: input.letter, offeredAt: new Date() }, "admission.offer", req),
    );
    await this.mail.send(authCtx.schoolId, id, { kind: "OFFERED" });
  }

  /** Not successful. The school's note reaches the family only when typed. */
  async reject(authCtx: AuthContext, id: string, input: RejectAdmissionInput, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    await withTenant(authCtx.schoolId, (db) =>
      move(db, authCtx, id, [...ADMISSION_OPEN_STATUSES], "REJECTED", { decisionNote: input.note ?? null }, "admission.reject", req),
    );
    await this.mail.send(authCtx.schoolId, id, { kind: "REJECTED" });
  }

  /** Withdrawn by the school, when the family asks. */
  async withdraw(authCtx: AuthContext, id: string, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    await withTenant(authCtx.schoolId, (db) => move(db, authCtx, id, [...ADMISSION_OPEN_STATUSES], "WITHDRAWN", {}, "admission.withdraw", req, { by: "SCHOOL" }));
    await this.mail.send(authCtx.schoolId, id, { kind: "WITHDRAWN", by: "SCHOOL" });
  }

  /**
   * The family accepted by phone or in person. The tickbox is the record that
   * they saw the complete letter first (§16.8 answer 2).
   */
  async recordAcceptance(authCtx: AuthContext, id: string, _input: RecordAdmissionAcceptanceInput, req: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    await withTenant(authCtx.schoolId, (db) =>
      move(db, authCtx, id, ["OFFERED"], "OFFER_ACCEPTED", { acceptedAt: new Date(), acceptedByUserId: authCtx.userId }, "admission.accept", req, {
        via: "SCHOOL",
        familySawLetter: true,
      }),
    );
  }

  /**
   * Admit: in ONE transaction, the application becomes ADMITTED, the student
   * is created and placed through the same internals as a student typed in
   * (the plan's cap, the admission-number rule, the unique number), and the
   * parent is linked (an existing guardian with that email) or created. Any
   * failure leaves none of it.
   */
  async admit(authCtx: AuthContext, id: string, input: AdmitApplicationInput, req: RequestContext): Promise<AdmitApplicationResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIT_ROLES);
    const result = await withTenant(authCtx.schoolId, async (db) => {
      const app = await db.admissionApplication.findFirst({
        where: { id, schoolId: authCtx.schoolId },
        select: {
          status: true,
          childFirstName: true,
          childLastName: true,
          dateOfBirth: true,
          gender: true,
          guardianFirstName: true,
          guardianLastName: true,
          guardianRelationship: true,
          guardianPhone: true,
          guardianEmail: true,
          answers: true,
        },
      });
      if (!app) throw new NotFoundError("Application not found.");
      if (app.status !== "OFFER_ACCEPTED") {
        throw new ConflictError(
          "ADMISSION_NOT_ACCEPTED",
          app.status === "OFFERED"
            ? "The family has not accepted the offer yet. Record their acceptance first."
            : `This application is ${ADMISSION_STATUS_LABEL[app.status].toLowerCase()}, so it cannot be admitted.`,
        );
      }
      const now = new Date();
      // Claim first: a second admin pressing Admit at the same moment waits on
      // this row and then finds it already admitted.
      const claimed = await db.admissionApplication.updateMany({
        where: { id, schoolId: authCtx.schoolId, status: "OFFER_ACCEPTED" },
        data: { status: "ADMITTED", statusChangedAt: now, admittedAt: now, admittedByUserId: authCtx.userId },
      });
      if (claimed.count !== 1) throw new ConflictError("ADMISSION_CHANGED", "Someone else has just changed this application. Reload it.");

      const field = fieldValues(app.answers);
      const reqCtx = { ipAddress: req.ipAddress, userAgent: null };
      const student = await createStudentInTx(
        db,
        authCtx,
        {
          firstName: app.childFirstName,
          middleName: field("middleName")?.slice(0, 60) ?? null,
          lastName: app.childLastName,
          dateOfBirth: app.dateOfBirth,
          gender: app.gender,
          address: field("homeAddress")?.slice(0, 500) ?? null,
          religion: field("religion")?.slice(0, 40) ?? null,
          stateOfOrigin: field("stateOfOrigin")?.slice(0, 40) ?? null,
          admittedAt: now,
          ...(input.admissionNumber ? { admissionNumber: input.admissionNumber } : {}),
          enrollment: { termId: input.termId, classArmId: input.classArmId },
        },
        reqCtx,
      );
      const guardian = await linkOrCreatePrimaryGuardianInTx(
        db,
        authCtx,
        student.id,
        {
          firstName: app.guardianFirstName,
          lastName: app.guardianLastName,
          relationship: app.guardianRelationship,
          phone: app.guardianPhone,
          email: app.guardianEmail,
          address: field("homeAddress")?.slice(0, 500) ?? null,
        },
        reqCtx,
      );
      await db.admissionApplication.update({ where: { id }, data: { studentId: student.id } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "admission.admit",
          entityType: "admission_application",
          entityId: id,
          ipAddress: req.ipAddress,
          metadata: { from: "OFFER_ACCEPTED", to: "ADMITTED", studentId: student.id, guardianId: guardian.guardianId, linkedExistingGuardian: guardian.linkedExisting },
        },
      });
      return {
        studentId: student.id,
        admissionNumber: student.admissionNumber,
        guardianId: guardian.guardianId,
        linkedExistingGuardian: guardian.linkedExisting,
      };
    });
    await this.mail.send(authCtx.schoolId, id, { kind: "ADMITTED", admissionNumber: result.admissionNumber });
    return result;
  }
}

async function load(db: Db, schoolId: string, id: string) {
  const row = await db.admissionApplication.findFirst({ where: { id, schoolId }, select: { status: true, assessmentAt: true } });
  if (!row) throw new NotFoundError("Application not found.");
  return row;
}

function stale(status: AdmissionStatus): ConflictError {
  return new ConflictError("ADMISSION_CHANGED", `This application is now ${ADMISSION_STATUS_LABEL[status].toLowerCase()}. Reload it.`);
}

/** One status move, conditional on the expected status, with its audit row. */
async function move(
  db: Db,
  authCtx: AuthContext,
  id: string,
  from: readonly AdmissionStatus[],
  to: AdmissionStatus,
  data: Prisma.AdmissionApplicationUpdateManyMutationInput,
  action: string,
  req: RequestContext,
  extra: Record<string, unknown> = {},
): Promise<AdmissionStatus> {
  const before = await load(db, authCtx.schoolId, id);
  const changed = await db.admissionApplication.updateMany({
    where: { id, schoolId: authCtx.schoolId, status: { in: [...from] } },
    data: { ...data, status: to, ...(before.status !== to ? { statusChangedAt: new Date() } : {}) },
  });
  if (changed.count !== 1) throw stale(before.status);
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action,
      entityType: "admission_application",
      entityId: id,
      ipAddress: req.ipAddress,
      // Statuses and kinds only: nothing the applicant typed.
      metadata: { from: before.status, to, ...extra } as Prisma.InputJsonValue,
    },
  });
  return before.status;
}

/** A built-in field's answer, from the application's stored answers. */
export function fieldValues(answers: unknown): (key: string) => string | undefined {
  const fields = ((answers ?? {}) as { fields?: { key?: string; value?: string }[] }).fields ?? [];
  return (key) => fields.find((f) => f.key === key)?.value || undefined;
}
