import { randomInt } from "node:crypto";

import type { Prisma, PrismaClient } from "@school-kit/db";
import {
  admissionCapacity,
  admissionCounterScope,
  admissionNumberPattern,
  fillAdmissionNumber,
  highestExistingValue,
  parseAdmissionFormat,
  ConflictError,
  ValidationError,
  type AdmissionNumberOrder,
  type ParsedFormat,
} from "@school-kit/types";

// Admission numbers assigned by SchoolKit (docs/modules/admission-numbers.md).
//
// Called inside the student-create transaction, with the tenant client, so a
// number is only ever used by a student that was actually created:
//   - in order: one upsert per count, `last_value + k … RETURNING`, which
//     row-locks the count until the transaction ends, so two admins adding at
//     once queue on it rather than sharing a number;
//   - random: random digits, checked against the roll.
// Either way a number someone already typed by hand is skipped, not reused.

type Db = Prisma.TransactionClient | PrismaClient;

export interface Numbering {
  format: ParsedFormat;
  order: AdmissionNumberOrder;
}

/** The school's numbering, or null when it types its own numbers. */
export async function loadNumbering(db: Db, schoolId: string): Promise<Numbering | null> {
  const school = await db.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { admissionNumberMode: true, admissionNumberFormat: true, admissionNumberOrder: true },
  });
  if (school.admissionNumberMode !== "AUTO" || !school.admissionNumberFormat) return null;
  const parsed = parseAdmissionFormat(school.admissionNumberFormat, school.admissionNumberOrder);
  // The format was checked when it was saved; one that no longer reads (a
  // rule tightened since) must not number anyone with a guess.
  if (!parsed.ok) {
    throw new ValidationError("ADMISSION_FORMAT_INVALID", `The school's admission number format needs fixing in Settings: ${parsed.error}`);
  }
  return { format: parsed.format, order: school.admissionNumberOrder };
}

/** The calendar year in Lagos: the year of admission (D2). */
export function admissionYear(at: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric" }).format(at));
}

/**
 * Numbers for `requests`, in order. `taken` holds numbers typed in the same
 * request, so a generated number never collides with one of them either.
 */
export async function assignAdmissionNumbers(
  db: Db,
  schoolId: string,
  numbering: Numbering,
  requests: { classCode?: string }[],
  options: { year?: number; taken?: Set<string> } = {},
): Promise<string[]> {
  const year = options.year ?? admissionYear();
  const taken = new Set(options.taken ?? []);
  if (numbering.order === "CLASS" && requests.some((r) => !r.classCode)) {
    throw new ValidationError(
      "ADMISSION_NUMBER_NEEDS_CLASS",
      "Your school numbers students per class, so choose a class or type the admission number.",
    );
  }

  const result: string[] = new Array(requests.length);
  if (numbering.order === "RANDOM") {
    for (let i = 0; i < requests.length; i++) {
      result[i] = await randomNumber(db, numbering.format, year, taken);
      taken.add(result[i]!);
    }
    return result;
  }

  // In order: one count per scope, asked for all of its numbers at once.
  const byScope = new Map<string, { classCode?: string; indexes: number[] }>();
  requests.forEach((r, i) => {
    const scope = admissionCounterScope(numbering.format, { year, classCode: r.classCode });
    const group = byScope.get(scope) ?? { classCode: r.classCode, indexes: [] };
    group.indexes.push(i);
    byScope.set(scope, group);
  });
  for (const [scope, group] of byScope) {
    const numbers = await nextInOrder(db, schoolId, numbering.format, scope, { year, classCode: group.classCode }, group.indexes.length, taken);
    group.indexes.forEach((index, k) => {
      result[index] = numbers[k]!;
      taken.add(numbers[k]!);
    });
  }
  return result;
}

async function nextInOrder(
  db: Db,
  schoolId: string,
  format: ParsedFormat,
  scope: string,
  fill: { year: number; classCode?: string },
  count: number,
  taken: Set<string>,
): Promise<string[]> {
  const out: string[] = [];
  let needed = count;
  // Normally one round: a typed number sitting where the count goes is rare,
  // and each round takes exactly as many more as were found in the way.
  for (let round = 0; needed > 0; round++) {
    if (round > 20) throw exhausted();
    const last = await advanceCounter(db, schoolId, format, scope, fill, needed);
    if (last > admissionCapacity(format)) throw exhausted();
    const candidates: string[] = [];
    for (let v = last - needed + 1; v <= last; v++) candidates.push(fillAdmissionNumber(format, { ...fill, value: v }));
    const existing = new Set(
      (await db.student.findMany({ where: { admissionNumber: { in: candidates } }, select: { admissionNumber: true } })).map(
        (s) => s.admissionNumber,
      ),
    );
    for (const c of candidates) {
      if (existing.has(c) || taken.has(c)) continue;
      out.push(c);
    }
    needed = count - out.length;
  }
  return out;
}

/** Moves the count on by `k` and returns its new last value. */
async function advanceCounter(
  db: Db,
  schoolId: string,
  format: ParsedFormat,
  scope: string,
  fill: { year: number; classCode?: string },
  k: number,
): Promise<number> {
  const updated = await db.$queryRaw<{ last_value: number }[]>`
    UPDATE admission_number_counters
       SET last_value = last_value + ${k}, updated_at = now()
     WHERE school_id = ${schoolId} AND scope = ${scope}
     RETURNING last_value`;
  if (updated[0]) return updated[0].last_value;

  // The first number in this count: carry on from the register, so turning
  // numbering on mid-year follows on from …/0147 rather than reusing 0001.
  const pattern = admissionNumberPattern(format, fill);
  const all = await db.student.findMany({ select: { admissionNumber: true } });
  const seed = highestExistingValue(
    all.map((s) => s.admissionNumber),
    pattern,
  );
  // Two first adds at once: the second waits on the first's row and adds on.
  const inserted = await db.$queryRaw<{ last_value: number }[]>`
    INSERT INTO admission_number_counters (school_id, scope, last_value)
    VALUES (${schoolId}, ${scope}, ${seed + k})
    ON CONFLICT (school_id, scope)
      DO UPDATE SET last_value = admission_number_counters.last_value + ${k}, updated_at = now()
    RETURNING last_value`;
  return inserted[0]!.last_value;
}

async function randomNumber(db: Db, format: ParsedFormat, year: number, taken: Set<string>): Promise<string> {
  const capacity = admissionCapacity(format);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidates = Array.from({ length: 8 }, () => fillAdmissionNumber(format, { year, value: randomInt(1, capacity + 1) }));
    const existing = new Set(
      (await db.student.findMany({ where: { admissionNumber: { in: candidates } }, select: { admissionNumber: true } })).map(
        (s) => s.admissionNumber,
      ),
    );
    const free = candidates.find((c) => !existing.has(c) && !taken.has(c));
    if (free) return free;
  }
  // Forty misses in a row means the format is nearly full.
  throw exhausted();
}

function exhausted(): ConflictError {
  return new ConflictError(
    "ADMISSION_NUMBERS_EXHAUSTED",
    "Your admission number format has run out of numbers. Add another N to it in Settings → Admission numbers.",
  );
}

/** A class arm's level code, for numbering per class. */
export async function classCodeForArm(db: Db, classArmId: string): Promise<string | undefined> {
  const arm = await db.classArm.findUnique({
    where: { id: classArmId },
    select: { classLevel: { select: { code: true } } },
  });
  return arm?.classLevel.code;
}
