import { Injectable } from "@nestjs/common";

import { withTenant, type Prisma } from "@school-kit/db";
import { ConflictError, type AcademicCalendarInput } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
}

export const AUDIT_CALENDAR_CREATE = "academic-calendar.create";

// Creates a school's first AcademicYear plus its three Terms, atomically.
//
// WHY THIS EXISTS. docs/modules/academic-calendar-bootstrap.md (#198) — a
// school with no current term cannot enroll, invoice, or mark a register. The
// 2026-08-21 production census found 36 of 42 real schools (86%) in that
// state.
//
// WHY ONE TRANSACTION AND NOT FIVE CALLS. The half-built states are exactly
// the states this fix exists to eliminate: a year with no terms, or a year
// whose terms exist but none is flagged current, is just as unusable as no
// year at all — and NO_CURRENT was 11 of the 36 stuck schools in production,
// so it is a real failure mode and not a theoretical one. Making it
// unconstructible beats detecting it later.
//
// TWO CALLERS, deliberately sharing this one method:
//   - SchoolsService.applyStep5 — schools still in the onboarding wizard.
//   - POST /schools/me/academic-calendar — schools that already completed
//     onboarding and are stuck (23 of the 36 in production).
// The census found those populations comparable in size, so neither path is a
// secondary case and neither gets its own copy of this logic.
@Injectable()
export class AcademicCalendarService {
  // Runs inside a caller-supplied transaction. Same contract as
  // applySchoolDefaults(): the CALLER owns the transaction and the RLS GUC,
  // this owns only what gets written into it. Deliberately does NOT call
  // withTenant() itself — withTenant opens its own basePrisma.$transaction,
  // and Prisma does not support nested interactive transactions, so doing so
  // from applyStep5 (already inside one) would HANG rather than fail.
  async createInTransaction(
    tx: Prisma.TransactionClient,
    schoolId: string,
    userId: string,
    input: AcademicCalendarInput,
    ipAddress: string | null,
  ): Promise<{ academicYearId: string; currentTermId: string }> {
    // Guard, not an upsert. This method is for a school that has no calendar;
    // a school that already has one is expressing a different intent (editing
    // its calendar) and must go through the academic-years/terms CRUD, which
    // audits per-entity and enforces its own rules. Silently adding a second
    // year here would also break the "one current year" invariant in a way
    // the caller never asked for.
    const existingYears = await tx.academicYear.count();
    if (existingYears > 0) {
      throw new ConflictError(
        "ACADEMIC_CALENDAR_EXISTS",
        "This school already has an academic year. Edit it in Settings → Academic instead.",
      );
    }

    const year = await tx.academicYear.create({
      data: {
        schoolId,
        label: input.yearLabel,
        startDate: input.yearStartDate,
        endDate: input.yearEndDate,
        isCurrent: true,
      },
      select: { id: true },
    });

    // The partial unique index `terms_school_id_current_key` permits only ONE
    // is_current term per school. Nothing else can hold it here (we just
    // asserted zero years, and Term requires a year), but the terms are
    // created with isCurrent resolved per row rather than flipped afterwards,
    // so the constraint is never transiently violated mid-transaction — the
    // same ordering hazard dev-seed.ts documents at its own term loop.
    const ordered = [...input.terms].sort((a, b) => a.sequence - b.sequence);
    let currentTermId = "";
    for (const t of ordered) {
      const isCurrent = t.sequence === input.currentTermSequence;
      const term = await tx.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: t.sequence,
          name: t.name,
          startDate: t.startDate,
          endDate: t.endDate,
          isCurrent,
        },
        select: { id: true },
      });
      if (isCurrent) currentTermId = term.id;
    }

    await tx.auditLog.create({
      data: {
        schoolId,
        userId,
        action: AUDIT_CALENDAR_CREATE,
        entityType: "academic_year",
        entityId: year.id,
        ipAddress,
        metadata: {
          yearLabel: input.yearLabel,
          yearStartDate: input.yearStartDate.toISOString(),
          yearEndDate: input.yearEndDate.toISOString(),
          currentTermSequence: input.currentTermSequence,
          terms: ordered.map((t) => ({
            sequence: t.sequence,
            name: t.name,
            startDate: t.startDate.toISOString(),
            endDate: t.endDate.toISOString(),
          })),
        },
      },
    });

    return { academicYearId: year.id, currentTermId };
  }

  // POST /schools/me/academic-calendar — the recovery path for schools that
  // finished onboarding before this shipped, reached from the in-app prompt.
  //
  // Owner/admin only: this defines the calendar every enrollment, invoice and
  // register will hang off. Deliberately NOT extended to bursar even though a
  // bursar is blocked by the missing calendar too — being blocked by a
  // decision is not authority to make it.
  async createForSchool(
    authCtx: AuthContext,
    input: AcademicCalendarInput,
    reqCtx: RequestContext,
  ): Promise<{ academicYearId: string; currentTermId: string }> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, (db) =>
      this.createInTransaction(db, authCtx.schoolId, authCtx.userId, input, reqCtx.ipAddress),
    );
  }

  // Backs the in-app prompt. "Stuck" is defined as no is_current term, which
  // is the same predicate the census script buckets on and the same condition
  // every date-scoped finance and roster query silently returns nothing for.
  async getCalendarStatus(authCtx: AuthContext): Promise<{ needsCalendar: boolean }> {
    return withTenant(authCtx.schoolId, async (db) => {
      const currentTerms = await db.term.count({ where: { isCurrent: true } });
      return { needsCalendar: currentTerms === 0 };
    });
  }
}
