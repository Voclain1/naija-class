import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  RESERVED_SLUGS,
  SCHOOL_ADDRESS_LIMITS,
  SCHOOL_ADDRESS_RE,
} from "@school-kit/types";

// Changing a school's address (docs/modules/school-addresses.md, 2026-10-22).
//
// One path for both callers: the school's owner, inside the limits, and
// SchoolKit's operator from the platform admin, who is not limited and whose
// changes never use up the school's allowance. Either way the old code moves to
// school_previous_addresses and keeps leading to the school.
//
// Every change runs behind ONE advisory lock, so two schools can never race for
// the same code; the triggers in the migration are the backstop.

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AddressAllowance {
  /** Inside the free window: the change is not counted. */
  free: boolean;
  freeUntil: Date | null;
  changesLeft: number;
  nextChangeAt: Date | null;
  blockedReason: string | null;
}

/**
 * Pure: what the owner may do now. Free while the school is still onboarding or
 * younger than `freeDays`; after that, `perYear` counted changes in any 12
 * months, at least `minDaysBetween` apart.
 */
export function addressAllowance(input: {
  status: string;
  createdAt: Date;
  /** retiredAt of the school's COUNTED changes. */
  counted: Date[];
  now: Date;
}): AddressAllowance {
  const { freeDays, perYear, minDaysBetween } = SCHOOL_ADDRESS_LIMITS;
  const freeEnds = new Date(input.createdAt.getTime() + freeDays * DAY_MS);
  if (input.status === "ONBOARDING" || input.now < freeEnds) {
    return { free: true, freeUntil: input.status === "ONBOARDING" ? null : freeEnds, changesLeft: perYear, nextChangeAt: null, blockedReason: null };
  }
  const yearAgo = new Date(input.now.getTime() - 365 * DAY_MS);
  const inYear = input.counted.filter((d) => d > yearAgo).sort((a, b) => a.getTime() - b.getTime());
  const changesLeft = Math.max(0, perYear - inYear.length);
  const last = inYear[inYear.length - 1];
  const gapEnds = last ? new Date(last.getTime() + minDaysBetween * DAY_MS) : null;

  if (changesLeft === 0) {
    const oldest = inYear[0]!;
    const nextChangeAt = new Date(oldest.getTime() + 365 * DAY_MS);
    return {
      free: false,
      freeUntil: null,
      changesLeft,
      nextChangeAt,
      blockedReason: `Your school has changed its address ${perYear} times in the last 12 months. Ask SchoolKit if it must change sooner.`,
    };
  }
  if (gapEnds && input.now < gapEnds) {
    return {
      free: false,
      freeUntil: null,
      changesLeft,
      nextChangeAt: gapEnds,
      blockedReason: `Your school changed its address recently: changes are at least ${minDaysBetween} days apart.`,
    };
  }
  return { free: false, freeUntil: null, changesLeft, nextChangeAt: null, blockedReason: null };
}

export type AddressActor =
  | { kind: "OWNER"; userId: string }
  | { kind: "PLATFORM"; userId: string };

export interface AddressChangeResult {
  from: string;
  to: string;
  counted: boolean;
}

export async function changeSchoolAddress(schoolId: string, code: string, actor: AddressActor, now = new Date()): Promise<AddressChangeResult> {
  if (!SCHOOL_ADDRESS_RE.test(code)) {
    throw new ValidationError(
      "SCHOOL_ADDRESS_INVALID",
      "Use 3 to 30 letters, numbers and hyphens, starting and ending with a letter or number.",
    );
  }
  if (RESERVED_SLUGS.has(code)) {
    throw new ValidationError("SCHOOL_ADDRESS_RESERVED", "That address is kept for SchoolKit. Please choose another.");
  }

  try {
    return await withTenant(schoolId, async (db) => {
      await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('school-address'))`);
      const school = await db.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { slug: true, status: true, createdAt: true },
      });
      if (school.slug === code) {
        throw new ConflictError("SCHOOL_ADDRESS_UNCHANGED", "That is already your school's address.");
      }

      let counted = false;
      if (actor.kind === "OWNER") {
        const rows = await db.schoolPreviousAddress.findMany({
          where: { schoolId, countsTowardLimit: true },
          select: { retiredAt: true },
        });
        const allowance = addressAllowance({
          status: school.status,
          createdAt: school.createdAt,
          counted: rows.map((r) => r.retiredAt),
          now,
        });
        if (allowance.blockedReason) throw new ForbiddenError("SCHOOL_ADDRESS_LIMIT", allowance.blockedReason);
        counted = !allowance.free;
      }

      const [holder, old] = await Promise.all([
        db.school.findUnique({ where: { slug: code }, select: { id: true } }),
        db.schoolPreviousAddress.findUnique({ where: { slug: code }, select: { id: true, schoolId: true } }),
      ]);
      if (holder || (old && old.schoolId !== schoolId)) {
        throw new ConflictError("SCHOOL_ADDRESS_TAKEN", "Another school uses that address. Please choose another.");
      }
      // Going back to one of its own earlier codes: it becomes current again.
      if (old) await db.schoolPreviousAddress.delete({ where: { id: old.id } });

      await db.schoolPreviousAddress.create({
        data: { schoolId, slug: school.slug, retiredBy: actor.userId, countsTowardLimit: counted, retiredAt: now },
      });
      await db.school.update({ where: { id: schoolId }, data: { slug: code } });
      return { from: school.slug, to: code, counted };
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError("SCHOOL_ADDRESS_TAKEN", "Another school uses that address. Please choose another.");
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return true;
    if (err.code === "P2010" && /23505|unique_violation/.test(String(err.message))) return true;
  }
  return /23505|unique_violation|belong(s|ed) to another school/.test(String((err as Error)?.message ?? ""));
}
