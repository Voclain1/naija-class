import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type ArmChargesStudentDto,
  type ListArmChargesInput,
  type ListStudentChargesInput,
  type RaiseStudentChargeInput,
  type StudentChargeDto,
  type StudentChargeKind,
  type VoidStudentChargeInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// Phase 9 / CP5.1 — student charges (F2, docs/modules/phase-9.md §13).
//
// THE ONE PLACE `student_charges` IS WRITTEN. Transport (and later library and
// hostel) raise, re-price and void their charges by calling the in-transaction
// methods below with their own `db`; invoice generation bills and releases
// them the same way. student-charge-writes.spec.ts fails on a write anywhere
// else, as no-accent-borders.spec.ts does for styles.
//
// A charge is OPEN until an invoice carries it (BILLED, set in the same
// transaction that creates the invoice), or VOID with a reason. Only an OPEN
// charge can be voided or re-priced: a billed amount is on an invoice a parent
// has received, and never changes. Every write is audited with amounts and
// ids, never the description.

const MANAGE_ROLES = ["owner", "admin", "bursar"] as const;

const AUDIT = {
  raise: "charge.raise",
  reprice: "charge.reprice",
  void: "charge.void",
  bill: "charge.bill",
  release: "charge.release",
} as const;

/** Who is acting, for the audit row. `userId` null only for system work. */
export interface ChargeActor {
  schoolId: string;
  userId: string | null;
  ipAddress: string | null;
}

export interface RaiseChargeArgs {
  studentId: string;
  termId: string;
  kind: StudentChargeKind;
  description: string;
  amount: number; // kobo
  sourceModule?: string;
  sourceId?: string;
}

export interface ChargeSource {
  sourceModule: string;
  sourceId: string;
}

/** An OPEN charge read for billing onto an invoice. */
export interface OpenCharge {
  id: string;
  kind: StudentChargeKind;
  description: string;
  amount: number;
}

type ChargeRow = Prisma.StudentChargeGetPayload<{ include: { invoice: { select: { sequence: true } } } }>;

@Injectable()
export class StudentChargeService {
  // ─── Staff routes ──────────────────────────────────────────────────────────

  async list(authCtx: AuthContext, query: ListStudentChargesInput): Promise<StudentChargeDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.studentCharge.findMany({
        where: {
          schoolId: authCtx.schoolId,
          studentId: query.studentId,
          ...(query.termId ? { termId: query.termId } : {}),
        },
        include: { invoice: { select: { sequence: true } } },
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toDto);
    });
  }

  /**
   * The class's enrolled students for the term, each with their charges for
   * it — the same roster the invoice preview already shows a bursar.
   */
  async listForArm(authCtx: AuthContext, query: ListArmChargesInput): Promise<ArmChargesStudentDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const enrollments = await db.enrollment.findMany({
        where: { schoolId: authCtx.schoolId, termId: query.termId, classArmId: query.classArmId, status: "ENROLLED" },
        select: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
        orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
      });
      const studentIds = enrollments.map((e) => e.student.id);
      const rows = studentIds.length
        ? await db.studentCharge.findMany({
            where: { schoolId: authCtx.schoolId, termId: query.termId, studentId: { in: studentIds } },
            include: { invoice: { select: { sequence: true } } },
            orderBy: { createdAt: "asc" },
          })
        : [];
      const byStudent = new Map<string, StudentChargeDto[]>();
      for (const row of rows) {
        const list = byStudent.get(row.studentId) ?? [];
        list.push(toDto(row));
        byStudent.set(row.studentId, list);
      }
      return enrollments.map(({ student }) => ({
        studentId: student.id,
        studentName: `${student.firstName} ${student.lastName}`.trim() || null,
        admissionNumber: student.admissionNumber,
        charges: byStudent.get(student.id) ?? [],
      }));
    });
  }

  /** Adding a charge by hand is always kind OTHER (CP5-D5). */
  async raiseByHand(
    authCtx: AuthContext,
    input: RaiseStudentChargeInput,
    reqCtx: { ipAddress: string | null },
  ): Promise<StudentChargeDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, (db) =>
      this.raise(db, { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress }, {
        studentId: input.studentId,
        termId: input.termId,
        kind: "OTHER",
        description: input.description,
        amount: input.amount,
      }),
    );
  }

  async voidCharge(
    authCtx: AuthContext,
    id: string,
    input: VoidStudentChargeInput,
    reqCtx: { ipAddress: string | null },
  ): Promise<StudentChargeDto> {
    await assertUserActiveAndHasOneOf(authCtx, MANAGE_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.studentCharge.findFirst({ where: { id, schoolId: authCtx.schoolId } });
      if (!row) throw new NotFoundError("Charge not found.");
      if (row.status !== "OPEN") throw notOpen(row.status);
      const updated = await this.voidOpen(db, { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress }, id, input.reason);
      if (!updated) throw notOpen("BILLED");
      return updated;
    });
  }

  // ─── In-transaction methods for other modules ─────────────────────────────

  async raise(db: PrismaClient, actor: ChargeActor, args: RaiseChargeArgs): Promise<StudentChargeDto> {
    const [student, term] = await Promise.all([
      db.student.findFirst({ where: { id: args.studentId, schoolId: actor.schoolId }, select: { id: true } }),
      db.term.findFirst({ where: { id: args.termId, schoolId: actor.schoolId }, select: { id: true } }),
    ]);
    if (!student) throw new NotFoundError("Student not found.");
    if (!term) throw new NotFoundError("Term not found.");

    let row: ChargeRow;
    try {
      row = await db.studentCharge.create({
        data: {
          schoolId: actor.schoolId,
          studentId: args.studentId,
          termId: args.termId,
          kind: args.kind,
          description: args.description,
          amount: args.amount,
          sourceModule: args.sourceModule ?? null,
          sourceId: args.sourceId ?? null,
          createdBy: actor.userId,
        },
        include: { invoice: { select: { sequence: true } } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictError("CHARGE_ALREADY_RAISED", "This record already has a charge.");
      }
      throw e;
    }
    await audit(db, actor, AUDIT.raise, row.id, {
      studentId: row.studentId,
      termId: row.termId,
      kind: row.kind,
      amount: row.amount,
      sourceModule: row.sourceModule,
    });
    return toDto(row);
  }

  /**
   * Re-prices the source's live charge if it is still OPEN. "billed" means
   * the charge is on an invoice and kept its amount; "none" means there is no
   * live charge for the source.
   */
  async reprice(
    db: PrismaClient,
    actor: ChargeActor,
    args: ChargeSource & { amount: number; description?: string },
  ): Promise<"repriced" | "billed" | "none"> {
    const row = await liveForSource(db, actor.schoolId, args);
    if (!row) return "none";
    if (row.status === "BILLED") return "billed";
    const { count } = await db.studentCharge.updateMany({
      where: { id: row.id, status: "OPEN" },
      data: { amount: args.amount, ...(args.description ? { description: args.description } : {}) },
    });
    if (count === 0) return "billed";
    if (row.amount !== args.amount || (args.description && args.description !== row.description)) {
      await audit(db, actor, AUDIT.reprice, row.id, { from: row.amount, to: args.amount, sourceModule: row.sourceModule });
    }
    return "repriced";
  }

  /** Voids the source's live charge if it is still OPEN; a billed one stays. */
  async voidBySource(
    db: PrismaClient,
    actor: ChargeActor,
    args: ChargeSource & { reason: string },
  ): Promise<"voided" | "billed" | "none"> {
    const row = await liveForSource(db, actor.schoolId, args);
    if (!row) return "none";
    if (row.status === "BILLED") return "billed";
    return (await this.voidOpen(db, actor, row.id, args.reason)) ? "voided" : "billed";
  }

  /** The student's OPEN charges for the term, oldest first, for an invoice. */
  async openForBilling(db: PrismaClient, schoolId: string, studentId: string, termId: string): Promise<OpenCharge[]> {
    return db.studentCharge.findMany({
      where: { schoolId, studentId, termId, status: "OPEN" },
      select: { id: true, kind: true, description: true, amount: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Marks the charges BILLED on the invoice. The update is conditional on
   * each still being OPEN; if any is not (another run billed or voided it
   * first), it throws, rolling back the caller's transaction and the invoice
   * with it. A charge can therefore never sit on two invoices.
   */
  async markBilled(db: PrismaClient, actor: ChargeActor, chargeIds: string[], invoiceId: string): Promise<void> {
    if (chargeIds.length === 0) return;
    const { count } = await db.studentCharge.updateMany({
      where: { id: { in: chargeIds }, schoolId: actor.schoolId, status: "OPEN" },
      data: { status: "BILLED", invoiceId },
    });
    if (count !== chargeIds.length) {
      throw new ConflictError(
        "CHARGE_NOT_OPEN",
        "A charge changed while the invoice was being issued. Nothing was issued; please try again.",
      );
    }
    for (const id of chargeIds) await audit(db, actor, AUDIT.bill, id, { invoiceId });
  }

  /** Cancelling an invoice returns its charges to OPEN (CP5-D4). */
  async releaseFromInvoice(db: PrismaClient, actor: ChargeActor, invoiceId: string): Promise<number> {
    const rows = await db.studentCharge.findMany({
      where: { schoolId: actor.schoolId, invoiceId, status: "BILLED" },
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    await db.studentCharge.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "OPEN", invoiceId: null },
    });
    for (const { id } of rows) await audit(db, actor, AUDIT.release, id, { invoiceId });
    return rows.length;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async voidOpen(db: PrismaClient, actor: ChargeActor, id: string, reason: string): Promise<StudentChargeDto | null> {
    const { count } = await db.studentCharge.updateMany({
      where: { id, schoolId: actor.schoolId, status: "OPEN" },
      data: { status: "VOID", voidReason: reason, voidedBy: actor.userId, voidedAt: new Date() },
    });
    if (count === 0) return null;
    const row = await db.studentCharge.findUniqueOrThrow({ where: { id }, include: { invoice: { select: { sequence: true } } } });
    await audit(db, actor, AUDIT.void, id, { studentId: row.studentId, termId: row.termId, amount: row.amount });
    return toDto(row);
  }
}

async function liveForSource(db: PrismaClient, schoolId: string, source: ChargeSource) {
  return db.studentCharge.findFirst({
    where: { schoolId, sourceModule: source.sourceModule, sourceId: source.sourceId, status: { not: "VOID" } },
  });
}

function notOpen(status: string): ConflictError {
  return status === "BILLED"
    ? new ConflictError(
        "CHARGE_BILLED",
        "This charge is on an invoice the parent has received. Cancel that invoice first if it is unpaid, or give a refund.",
      )
    : new ConflictError("CHARGE_VOID", "This charge has already been voided.");
}

async function audit(
  db: PrismaClient,
  actor: ChargeActor,
  action: string,
  entityId: string,
  metadata: Record<string, string | number | null>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: actor.schoolId,
      userId: actor.userId,
      action,
      entityType: "student_charge",
      entityId,
      ipAddress: actor.ipAddress,
      metadata,
    },
  });
}

function toDto(row: ChargeRow): StudentChargeDto {
  return {
    id: row.id,
    studentId: row.studentId,
    termId: row.termId,
    kind: row.kind,
    description: row.description,
    amount: row.amount,
    status: row.status,
    sourceModule: row.sourceModule,
    invoiceId: row.invoiceId,
    onSupplementaryInvoice: (row.invoice?.sequence ?? 0) > 0,
    voidReason: row.voidReason,
    voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
