import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { hashPin, resolveResultPinKey } from "./result-pin-key";
import { RedeemRefusedError, ResultPinService, type RedeemVia } from "./result-pin.service";

// Result Checker PINs (Phase 8c / CP6b, docs/modules/phase-8.md §21.3–21.4).
// Real database, real RLS. Each test states one rule of the PIN lifecycle.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23496${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const ctx = (schoolId: string, userId: string) => ({ sessionId: "sess", userId, schoolId });
const KEY = resolveResultPinKey({ NODE_ENV: "test" });

describe("ResultPinService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const service = new ResultPinService(KEY);
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // A school with two terms and three students whose first-term cards are
  // RELEASED: A and B in PIN mode, C free. Second term: nothing released.
  async function seed(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Pins ${suffix}`,
        schoolSlug: `pins-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `pins-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });

    const f = await withTenant(schoolId, async (db) => {
      const teacher = await db.user.create({
        data: { schoolId, email: `pt-${suffix}-${runId}@example.test`, firstName: "T", lastName: "Teach" },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: teacher.id, roleId: teacherRole.id } });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${suffix}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const mkTerm = (sequence: number, name: string) =>
        db.term.create({
          data: { schoolId, academicYearId: year.id, sequence, name, startDate: new Date(`2025-${8 + sequence}-01`), endDate: new Date(`2025-${8 + sequence}-28`) },
          select: { id: true },
        });
      const term1 = await mkTerm(1, "First Term");
      const term2 = await mkTerm(2, "Second Term");
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "A", code: `pa-${suffix}-${runId}` },
        select: { id: true },
      });
      const students: string[] = [];
      for (const [i, mode] of (["PIN", "PIN", "FREE"] as const).entries()) {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `ADM-${suffix}-${i}`, firstName: `S${i}`, lastName: "Pin", dateOfBirth: new Date("2012-01-01"), gender: "FEMALE" },
          select: { id: true },
        });
        students.push(s.id);
        await db.reportCard.create({
          data: { schoolId, studentId: s.id, termId: term1.id, academicYearId: year.id, classArmId: arm.id, status: "RELEASED", releasedAt: new Date(), accessMode: mode },
        });
      }
      return { teacherId: teacher.id, term1: term1.id, term2: term2.id, a: students[0]!, b: students[1]!, c: students[2]! };
    });
    return { schoolId, ownerId: signed.user.id, ...f };
  }

  const redeem = (schoolId: string, studentId: string, termId: string, pin: string, via: RedeemVia = "CHECKER") =>
    withTenant(schoolId, (db) =>
      service.redeem(db, { schoolId, studentId, termId, pin, via, actorId: null, ipAddress: null }),
    );
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => "SUCCEEDED",
      (e: unknown) => (e instanceof RedeemRefusedError ? e.reason : `UNEXPECTED: ${String(e)}`),
    );

  it("generates 12-digit PINs with serials, returns them once and stores only keyed hashes", async () => {
    const f = await seed("gen");
    const owner = ctx(f.schoolId, f.ownerId);
    const first = await service.generateBatch(owner, { termId: f.term1, quantity: 25, maxUses: 5 }, reqCtx);
    expect(first.batch).toMatchObject({ number: 1, size: 25, maxUses: 5, termName: "First Term" });
    expect(first.pins).toHaveLength(25);
    expect(first.pins[0]!.serial).toBe("B1-0001");
    expect(first.pins.every((p) => /^\d{4} \d{4} \d{4}$/.test(p.pin))).toBe(true);
    expect(new Set(first.pins.map((p) => p.pin)).size).toBe(25);

    const stored = await withTenant(f.schoolId, (db) =>
      db.resultPin.findMany({ where: { batchId: first.batch.id }, select: { pinHash: true, serial: true } }),
    );
    const digits = first.pins.map((p) => p.pin.replace(/ /g, ""));
    // Keyed: the stored value is the HMAC under the server key, never the PIN.
    expect(stored.map((s) => s.pinHash).sort()).toEqual(digits.map((d) => hashPin(KEY, d)).sort());
    const everything = JSON.stringify(
      await withTenant(f.schoolId, async (db) => ({
        pins: await db.resultPin.findMany({}),
        audit: await db.auditLog.findMany({ where: { action: { startsWith: "result-pin." } } }),
      })),
    );
    for (const d of digits) expect(everything).not.toContain(d);

    const second = await service.generateBatch(owner, { termId: f.term2, quantity: 1, maxUses: 1 }, reqCtx);
    expect(second.batch.number).toBe(2);
    expect(second.pins[0]!.serial).toBe("B2-0001");
  }, 60_000);

  it("only an owner or admin may generate, and the term must be the school's", async () => {
    const f = await seed("gen-roles");
    await expect(
      service.generateBatch(ctx(f.schoolId, f.teacherId), { termId: f.term1, quantity: 1, maxUses: 5 }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const other = await seed("gen-other");
    await expect(
      service.generateBatch(ctx(other.schoolId, other.ownerId), { termId: f.term1, quantity: 1, maxUses: 5 }, reqCtx),
    ).rejects.toBeInstanceOf(NotFoundError);
  }, 60_000);

  it("binds on first redemption, unlocks the term, and then opens only that student's result", async () => {
    const f = await seed("bind");
    const { pins } = await service.generateBatch(ctx(f.schoolId, f.ownerId), { termId: f.term1, quantity: 1, maxUses: 5 }, reqCtx);
    const pin = pins[0]!.pin;

    expect(await redeem(f.schoolId, f.a, f.term1, pin)).toEqual({ kind: "redeemed", usesLeft: 4 });
    const after = await withTenant(f.schoolId, async (db) => ({
      pin: await db.resultPin.findFirstOrThrow({ select: { boundStudentId: true, uses: true } }),
      unlock: await db.resultUnlock.findFirst({ where: { studentId: f.a, termId: f.term1 }, select: { via: true } }),
    }));
    expect(after.pin).toEqual({ boundStudentId: f.a, uses: 1 });
    expect(after.unlock).toEqual({ via: "CHECKER" });

    expect(await refusal(redeem(f.schoolId, f.b, f.term1, pin))).toBe("PIN_OTHER_STUDENT");
  }, 60_000);

  it("refuses the wrong term, a malformed or unknown PIN, an unreleased card — and a FREE card takes no use", async () => {
    const f = await seed("refuse");
    const owner = ctx(f.schoolId, f.ownerId);
    const t1 = (await service.generateBatch(owner, { termId: f.term1, quantity: 1, maxUses: 5 }, reqCtx)).pins[0]!.pin;
    const t2 = (await service.generateBatch(owner, { termId: f.term2, quantity: 1, maxUses: 5 }, reqCtx)).pins[0]!.pin;

    expect(await refusal(redeem(f.schoolId, f.a, f.term1, t2))).toBe("PIN_WRONG_TERM");
    expect(await refusal(redeem(f.schoolId, f.a, f.term1, "1234"))).toBe("PIN_INVALID");
    expect(await refusal(redeem(f.schoolId, f.a, f.term1, "0000 0000 0000"))).toBe("PIN_INVALID");
    expect(await refusal(redeem(f.schoolId, f.a, f.term2, t2))).toBe("NOT_RELEASED");

    expect(await redeem(f.schoolId, f.c, f.term1, t1)).toEqual({ kind: "free" });
    const uses = await withTenant(f.schoolId, (db) => db.resultPin.findMany({ select: { uses: true, boundStudentId: true } }));
    expect(uses.every((u) => u.uses === 0 && u.boundStudentId === null)).toBe(true);
  }, 60_000);

  it("the checker takes a use every time until none are left; a portal takes one only to unlock (D57)", async () => {
    const f = await seed("uses");
    const pin = (await service.generateBatch(ctx(f.schoolId, f.ownerId), { termId: f.term1, quantity: 1, maxUses: 2 }, reqCtx)).pins[0]!.pin;

    // Portal first: one use to unlock, then none however often it is opened.
    expect(await redeem(f.schoolId, f.a, f.term1, pin, "GUARDIAN")).toEqual({ kind: "redeemed", usesLeft: 1 });
    expect(await redeem(f.schoolId, f.a, f.term1, pin, "STUDENT")).toEqual({ kind: "already-unlocked" });
    expect(await redeem(f.schoolId, f.a, f.term1, pin, "GUARDIAN")).toEqual({ kind: "already-unlocked" });

    // The checker counts every view, even on an unlocked term.
    expect(await redeem(f.schoolId, f.a, f.term1, pin)).toEqual({ kind: "redeemed", usesLeft: 0 });
    expect(await refusal(redeem(f.schoolId, f.a, f.term1, pin))).toBe("PIN_USED_UP");
  }, 60_000);

  it("two checks racing for the last use: exactly one wins", async () => {
    const f = await seed("race");
    const pin = (await service.generateBatch(ctx(f.schoolId, f.ownerId), { termId: f.term1, quantity: 1, maxUses: 1 }, reqCtx)).pins[0]!.pin;
    const results = await Promise.all([
      refusal(redeem(f.schoolId, f.a, f.term1, pin)),
      refusal(redeem(f.schoolId, f.a, f.term1, pin)),
      refusal(redeem(f.schoolId, f.a, f.term1, pin)),
    ]);
    expect(results.filter((r) => r === "SUCCEEDED")).toHaveLength(1);
    const row = await withTenant(f.schoolId, (db) => db.resultPin.findFirstOrThrow({ select: { uses: true } }));
    expect(row.uses).toBe(1);
  }, 60_000);

  it("voiding a PIN or its batch stops new redemptions, but unlocks already made stand", async () => {
    const f = await seed("void");
    const owner = ctx(f.schoolId, f.ownerId);
    const batch = await service.generateBatch(owner, { termId: f.term1, quantity: 2, maxUses: 5 }, reqCtx);
    const [used, spare] = batch.pins as [{ serial: string; pin: string }, { serial: string; pin: string }];
    await redeem(f.schoolId, f.a, f.term1, used.pin);

    await service.voidPin(owner, used.serial.toLowerCase(), reqCtx);
    expect(await refusal(redeem(f.schoolId, f.a, f.term1, used.pin))).toBe("PIN_INVALID");
    const unlock = await withTenant(f.schoolId, (db) => db.resultUnlock.count({ where: { studentId: f.a } }));
    expect(unlock).toBe(1); // the family keeps what they paid for

    await service.voidBatch(owner, batch.batch.id, reqCtx);
    expect(await refusal(redeem(f.schoolId, f.b, f.term1, spare.pin))).toBe("PIN_INVALID");
    await expect(service.voidBatch(owner, batch.batch.id, reqCtx)).rejects.toMatchObject({ code: "PIN_BATCH_ALREADY_VOIDED" });

    const list = await service.listBatches(owner);
    expect(list.data[0]).toMatchObject({ redeemedCount: 1, voidedCount: 1, voidedAt: expect.any(Date) });
    expect(JSON.stringify(list)).not.toContain(used.pin.replace(/ /g, ""));

    const audits = await withTenant(f.schoolId, (db) =>
      db.auditLog.findMany({ where: { action: { startsWith: "result-pin." } }, select: { action: true } }),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(
      ["result-pin.batch-generate", "result-pin.batch-void", "result-pin.redeem", "result-pin.void"].sort(),
    );
  }, 60_000);

  it("a PIN from one school opens nothing at another, even for the same admission-number shape", async () => {
    const a = await seed("ten-a");
    const b = await seed("ten-b");
    const pin = (await service.generateBatch(ctx(a.schoolId, a.ownerId), { termId: a.term1, quantity: 1, maxUses: 5 }, reqCtx)).pins[0]!.pin;
    expect(await refusal(redeem(b.schoolId, b.a, b.term1, pin))).toBe("PIN_INVALID");
  }, 60_000);
});
