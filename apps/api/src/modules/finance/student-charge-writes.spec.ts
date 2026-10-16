import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Phase 9 / CP5.1 — student charges are written in ONE place
// (docs/modules/phase-9.md §13 CP5-D1): StudentChargeService. Transport,
// library and hostel call its in-transaction methods; invoice generation bills
// and releases through it. This scans the API source for any other write to
// the table, through Prisma or raw SQL, and fails, as no-accent-borders.spec.ts
// does for styles. Reads elsewhere are fine.

const SRC = join(__dirname, "..", "..");
const ALLOWED = new Set(["modules/finance/student-charge.service.ts"]);

const PRISMA_WRITE = /\bstudentCharge\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\b/;
const SQL_WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?student_charges"?/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.(spec|test)\.ts$/.test(name) ? [path] : [];
  });
}

describe("student_charges has one writer", () => {
  it("only StudentChargeService writes the table", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path).replace(/\\/g, "/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => {
        const text = readFileSync(join(SRC, rel), "utf8");
        return PRISMA_WRITE.test(text) || SQL_WRITE.test(text);
      });
    expect(offenders).toEqual([]);
  });

  it("the scan does catch a write", () => {
    expect(PRISMA_WRITE.test("await db.studentCharge.updateMany({")).toBe(true);
    expect(PRISMA_WRITE.test("db.studentCharge\n  .create({")).toBe(true);
    expect(SQL_WRITE.test('UPDATE "student_charges" SET')).toBe(true);
    expect(PRISMA_WRITE.test("db.studentCharge.findMany({")).toBe(false);
  });
});
