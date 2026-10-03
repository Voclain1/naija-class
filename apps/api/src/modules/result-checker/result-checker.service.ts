import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type ResultCheckerCheckInput,
  type ResultCheckerResultDto,
  type ResultCheckerSchoolDto,
} from "@school-kit/types";

import { LoginLockoutService, lockoutIdentity } from "../../common/auth/login-lockout";
import { StorageService } from "../../common/storage";
import { ReleasedResultsService } from "../report-cards/released-results.service";
import { RedeemRefusedError, ResultPinService, type RedeemRefusal } from "./result-pin.service";

// The public Result Checker (Phase 8c / CP6b, docs/modules/phase-8.md §21.5).
//
// PUBLIC and pre-login. The threat model is the student login's: admission
// numbers are sequential and school slugs are public, so this endpoint must
// not become a roster oracle. Three things carry that:
//
// 1. ONE ANSWER FOR ALMOST EVERY FAILURE. Unknown school, unknown admission
//    number, malformed or wrong PIN, a PIN for another student or term, an
//    unreleased card, a FREE card — all the same 4xx, code and message. The
//    single exception is a valid PIN already bound to THIS student with no uses
//    left: its holder has proved possession of the card, so telling them it is
//    spent tells them nothing they could not read off their own receipts.
//
// 2. THE LOCKOUT (login-lockout.ts), keyed on the slug and admission number AS
//    TYPED, under its own `checker` namespace, checked before any lookup and
//    counted for identities that do not exist — exactly as student sign-in
//    does. Plus the per-IP throttle on the controller.
//
// 3. NOTHING BEFORE THE PIN. The term selector is school-level (getSchool), and
//    no response says anything about a student until both the admission number
//    and the PIN have matched.
//
// No SECURITY DEFINER function (§21.0): the only pre-tenant read is `schools`
// by slug, which has no RLS policy. Everything after it runs under withTenant.

/** Presigned PDF URLs from the checker live 5 minutes (D50). */
export const CHECKER_PDF_URL_TTL_SECONDS = 5 * 60;

const NO_MATCH_MESSAGE =
  "We couldn't find results for those details. Check the admission number, the PIN and the term. " +
  "If your school made these results free, they are in the parent portal and the app.";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type CheckOutcome =
  | { ok: true; value: ResultCheckerResultDto }
  | { ok: false; reason: RedeemRefusal | "NO_STUDENT" | "FREE"; studentId: string | null };

@Injectable()
export class ResultCheckerService {
  constructor(
    private readonly pins: ResultPinService,
    private readonly releasedResults: ReleasedResultsService,
    private readonly storage: StorageService,
    private readonly lockout: LoginLockoutService,
  ) {}

  // GET /result-checker/:slug — the school's name and the terms that have PIN
  // results to check. School-level only. Slugs are public (they are
  // subdomains), so an unknown one is an ordinary 404.
  async getSchool(slug: string): Promise<ResultCheckerSchoolDto> {
    const school = await this.resolveSchool(slug);
    if (!school) throw new NotFoundError("There is no result checker at this address.");

    return withTenant(school.id, async (db) => {
      const released = await db.reportCard.findMany({
        where: { status: "RELEASED", accessMode: "PIN" },
        distinct: ["termId"],
        select: { termId: true },
      });
      const terms = await db.term.findMany({
        where: { id: { in: released.map((r) => r.termId) } },
        select: { id: true, name: true, sequence: true, academicYear: { select: { label: true, startDate: true } } },
      });
      terms.sort(
        (a, b) =>
          b.academicYear.startDate.getTime() - a.academicYear.startDate.getTime() || b.sequence - a.sequence,
      );
      return {
        schoolName: school.name,
        terms: terms.map((t) => ({ termId: t.id, termName: t.name, academicYearLabel: t.academicYear.label })),
      };
    });
  }

  // POST /result-checker/:slug/check
  async check(slug: string, input: ResultCheckerCheckInput, ctx: RequestContext): Promise<ResultCheckerResultDto> {
    const identity = lockoutIdentity("checker", slug, input.admissionNumber);
    await this.lockout.check(identity);

    const school = await this.resolveSchool(slug);
    if (!school) {
      await this.lockout.recordFailure(identity);
      throw noMatch();
    }

    // The attempt runs in one transaction and RETURNS its failure rather than
    // throwing it, so the failure's audit row (below) is not rolled back with
    // it — and a refused redemption writes nothing at all.
    const outcome = await withTenant(school.id, async (db): Promise<CheckOutcome> => {
      const student = await db.student.findFirst({
        where: { admissionNumber: input.admissionNumber },
        select: { id: true },
      });
      if (!student) return { ok: false, reason: "NO_STUDENT", studentId: null };

      let usesLeft: number;
      try {
        const redeemed = await this.pins.redeem(db, {
          schoolId: school.id,
          studentId: student.id,
          termId: input.termId,
          pin: input.pin,
          via: "CHECKER",
          actorId: null,
          ipAddress: ctx.ipAddress,
        });
        // A FREE card is read in the portals; the checker never shows it,
        // or an admission number alone would open it.
        if (redeemed.kind !== "redeemed") return { ok: false, reason: "FREE", studentId: student.id };
        usesLeft = redeemed.usesLeft;
      } catch (e) {
        if (e instanceof RedeemRefusedError) return { ok: false, reason: e.reason, studentId: student.id };
        throw e;
      }

      // Read through THE shared reader, which passes its access-mode gate on
      // the unlock redeem() just wrote — the same gate the portals use.
      const result = await this.releasedResults.getForStudent(db, student.id, input.termId);
      const card = await db.reportCard.findFirstOrThrow({
        where: { studentId: student.id, termId: input.termId },
        select: { pdfStatus: true },
      });
      const pdfUrl =
        card.pdfStatus === "GENERATED"
          ? await this.storage.signUrl(
              school.id,
              { kind: "report-card", termId: input.termId, studentId: student.id },
              CHECKER_PDF_URL_TTL_SECONDS,
            )
          : null;
      return { ok: true, value: { result, pdfUrl, usesLeft } };
    });

    if (outcome.ok) {
      await this.lockout.clear(identity);
      return outcome.value;
    }

    await this.lockout.recordFailure(identity);
    await withTenant(school.id, (db) =>
      db.auditLog.create({
        data: {
          schoolId: school.id,
          userId: null,
          action: "result-checker.check-failed",
          entityType: "student",
          entityId: outcome.studentId,
          ipAddress: ctx.ipAddress,
          // The internal reason is for the school's audit trail only; the
          // response below never carries it. Never the PIN.
          metadata: { admissionNumber: input.admissionNumber, termId: input.termId, reason: outcome.reason },
        },
      }),
    );

    if (outcome.reason === "PIN_USED_UP") {
      throw new ValidationError("PIN_USED_UP", "This PIN has been used as many times as it allows.");
    }
    throw noMatch();
  }

  private resolveSchool(slug: string) {
    // `schools` is the tenant table and carries no RLS policy, so this read
    // needs no tenant and no SECURITY DEFINER function (§21.0).
    return basePrisma.school.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, name: true },
    });
  }
}

function noMatch(): ValidationError {
  return new ValidationError("RESULT_CHECK_NO_MATCH", NO_MATCH_MESSAGE);
}
