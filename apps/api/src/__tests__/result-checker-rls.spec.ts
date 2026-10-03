import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

// Phase 8c / CP6b — Result Checker tables are ordinary tenant tables
// (docs/modules/phase-8.md §21.1): result_pin_batches, result_pins,
// result_unlocks. Real Postgres, as the runtime role, because the claims are
// properties of the database:
//   - a read with no GUC sees nothing;
//   - a school sees only its own rows;
//   - a cross-tenant write is rejected by WITH CHECK — with a control write
//     under the correct GUC succeeding, so the rejection is not passing for
//     the wrong reason.
// And the property the whole checker leans on (§21.0): a PIN hash that exists
// at school A is invisible from school B's tenant, so no SECURITY DEFINER
// lookup is needed to keep schools apart.

describe("Phase 8c CP6b — result checker RLS", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA = "";
  let schoolB = "";
  let termA = "";
  let yearA = "";
  let batchA = "";

  beforeAll(async () => {
    schoolA = (await basePrisma.school.create({ data: { name: "RC A", slug: `rc-a-${runId}` }, select: { id: true } })).id;
    schoolB = (await basePrisma.school.create({ data: { name: "RC B", slug: `rc-b-${runId}` }, select: { id: true } })).id;
    await withTenant(schoolA, async (db) => {
      yearA = (await db.academicYear.create({
        data: { schoolId: schoolA, label: "Y", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      })).id;
      termA = (await db.term.create({
        data: { schoolId: schoolA, academicYearId: yearA, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      })).id;
      batchA = (await db.resultPinBatch.create({
        data: { schoolId: schoolA, academicYearId: yearA, termId: termA, number: 1, size: 1, maxUses: 5, createdBy: "spec" },
        select: { id: true },
      })).id;
      await db.resultPin.create({
        data: { schoolId: schoolA, batchId: batchA, serial: "B1-0001", pinHash: `hash-${runId}` },
      });
      await db.resultUnlock.create({
        data: { schoolId: schoolA, studentId: `student-${runId}`, termId: termA, pinId: "pin", via: "CHECKER" },
      });
    });
  });

  afterAll(async () => {
    await withTenant(schoolA, async (db) => {
      await db.resultUnlock.deleteMany({});
      await db.resultPin.deleteMany({});
      await db.resultPinBatch.deleteMany({});
      await db.term.deleteMany({});
      await db.academicYear.deleteMany({});
    });
    for (const id of [schoolA, schoolB]) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  it("with no GUC the runtime role sees no rows in any of the three tables", async () => {
    expect(await basePrisma.resultPinBatch.count()).toBe(0);
    expect(await basePrisma.resultPin.count()).toBe(0);
    expect(await basePrisma.resultUnlock.count()).toBe(0);
  });

  it("school B sees none of school A's rows — including a PIN hash it is handed", async () => {
    const seen = await withTenant(schoolB, async (db) => ({
      batches: await db.resultPinBatch.count(),
      pins: await db.resultPin.count(),
      unlocks: await db.resultUnlock.count(),
      byHash: await db.resultPin.findFirst({ where: { pinHash: `hash-${runId}` } }),
    }));
    expect(seen).toEqual({ batches: 0, pins: 0, unlocks: 0, byHash: null });

    const own = await withTenant(schoolA, async (db) => ({
      batches: await db.resultPinBatch.count(),
      pins: await db.resultPin.count(),
      unlocks: await db.resultUnlock.count(),
    }));
    expect(own).toEqual({ batches: 1, pins: 1, unlocks: 1 });
  });

  it("a write naming another school is rejected by WITH CHECK; the same write for the right school succeeds", async () => {
    const asB = (fn: Parameters<typeof withTenant>[1]) => withTenant(schoolB, fn);

    await expect(
      asB((db) =>
        db.resultPinBatch.create({
          data: { schoolId: schoolA, academicYearId: yearA, termId: termA, number: 99, size: 1, maxUses: 5, createdBy: "x" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asB((db) => db.resultPin.create({ data: { schoolId: schoolA, batchId: batchA, serial: "X-1", pinHash: `x-${runId}` } })),
    ).rejects.toThrow();
    await expect(
      asB((db) =>
        db.resultUnlock.create({ data: { schoolId: schoolA, studentId: "s", termId: termA, pinId: "p", via: "GUARDIAN" } }),
      ),
    ).rejects.toThrow();

    // Control: the same shapes under the right GUC are accepted.
    await withTenant(schoolA, async (db) => {
      const b = await db.resultPinBatch.create({
        data: { schoolId: schoolA, academicYearId: yearA, termId: termA, number: 2, size: 1, maxUses: 5, createdBy: "x" },
      });
      await db.resultPin.create({ data: { schoolId: schoolA, batchId: b.id, serial: "B2-0001", pinHash: `ok-${runId}` } });
      await db.resultUnlock.create({ data: { schoolId: schoolA, studentId: "s2", termId: termA, pinId: "p", via: "GUARDIAN" } });
    });
  });
});
