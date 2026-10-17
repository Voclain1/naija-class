import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentChargeService } from "../finance/student-charge.service";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service";
import { HostelService, removeHostelBedsAfterWithdrawal } from "./hostel.service";

// Phase 9 / CP6b.1 — hostels, rooms and beds (docs/modules/phase-9.md §15,
// owner's answers §15.8), against real Postgres. The beds first: no double
// booking under concurrency, boys' and girls' hostels enforced. Then the money,
// as transport: one HOSTEL charge per bed at the hostel's fee, re-priced only
// while waiting, voided on removal, kept once billed; the fee stands for next
// term until changed. Then house masters, withdrawal and who may do what.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const FEE = 15_000_000; // ₦150,000 a term

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  adminId: string;
  bursarId: string;
  teacherId: string;
  houseMasterId: string;
  yearId: string;
  termId: string;
  nextTermId: string;
  armId: string;
}

describe("HostelService (integration)", () => {
  const charges = new StudentChargeService();
  const hostels = new HostelService(charges);
  const invoices = new InvoiceGenerationService(undefined, charges);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Hostel ${label} ${runId}`,
        schoolSlug: `hostel-${label}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `hostel-${label}-${runId}@example.test`,
        ownerPhone: `+23498${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "This Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const next = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 2, name: "Next Term", startDate: day("2099-01-05"), endDate: day("2099-04-01") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `hs-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const user = await db.user.create({ data: { schoolId, email: `hs-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        ownerId: signed.user.id,
        adminId: await staff("admin"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        houseMasterId: await staff("house_master"),
        yearId: year.id,
        termId: term.id,
        nextTermId: next.id,
        armId: arm.id,
      };
    });
  }

  async function student(f: Fixture, gender: "MALE" | "FEMALE" | "OTHER" = "MALE"): Promise<string> {
    n += 1;
    return withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `HS-${n}-${runId}`, firstName: "Obi", lastName: `Boarder${n}`, dateOfBirth: day("2012-01-01"), gender },
      });
      await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId: f.termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      return s.id;
    });
  }

  const admin = (f: Fixture) => ctx(f.schoolId, f.adminId);

  /** A hostel with one room of `beds` beds, charging `fee`. */
  async function hostel(f: Fixture, opts: { gender?: "BOYS" | "GIRLS"; beds?: number; fee?: number } = {}) {
    n += 1;
    const h = await hostels.createHostel(admin(f), { name: `House ${n}`, forGender: opts.gender ?? "BOYS" }, reqCtx);
    const withRoom = await hostels.createRoom(admin(f), h.id, { name: "Room 1", beds: opts.beds ?? 4 }, reqCtx);
    if (opts.fee) await hostels.setFee(admin(f), h.id, { fee: opts.fee }, reqCtx);
    return { ...withRoom, roomId: withRoom.rooms[0]!.id };
  }

  const chargesOf = (f: Fixture, studentId: string) =>
    withTenant(f.schoolId, (db) => db.studentCharge.findMany({ where: { studentId, kind: "HOSTEL" }, orderBy: { createdAt: "asc" } }));

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ── Beds ─────────────────────────────────────────────────────────────────

  describe("beds", () => {
    it("gives the first free bed, or the one asked for, and never one bed or one child twice in a term", async () => {
      const h = await hostel(A, { beds: 3 });
      const [k1, k2, k3] = [await student(A), await student(A), await student(A)];
      expect(await hostels.placeStudent(admin(A), { studentId: k1, termId: A.termId, roomId: h.roomId }, reqCtx)).toMatchObject({ bedNumber: 1, roomName: "Room 1" });
      expect(await hostels.placeStudent(admin(A), { studentId: k2, termId: A.termId, roomId: h.roomId, bedNumber: 3 }, reqCtx)).toMatchObject({ bedNumber: 3 });
      expect(await hostels.placeStudent(admin(A), { studentId: k3, termId: A.termId, roomId: h.roomId }, reqCtx)).toMatchObject({ bedNumber: 2 });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A), termId: A.termId, roomId: h.roomId, bedNumber: 3 }, reqCtx)).rejects.toMatchObject({ code: "BED_TAKEN" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A), termId: A.termId, roomId: h.roomId }, reqCtx)).rejects.toMatchObject({ code: "ROOM_FULL" });
      await expect(hostels.placeStudent(admin(A), { studentId: k1, termId: A.termId, roomId: (await hostel(A)).roomId }, reqCtx)).rejects.toMatchObject({ code: "ALREADY_PLACED" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A), termId: A.termId, roomId: (await hostel(A, { beds: 2 })).roomId, bedNumber: 5 }, reqCtx)).rejects.toMatchObject({ code: "NO_SUCH_BED" });
    });

    it("gives the last bed to exactly one of two staff placing at once", async () => {
      const h = await hostel(A, { beds: 1 });
      const [k1, k2] = [await student(A), await student(A)];
      const results = await Promise.allSettled([
        hostels.placeStudent(admin(A), { studentId: k1, termId: A.termId, roomId: h.roomId }, reqCtx),
        hostels.placeStudent(ctx(A.schoolId, A.ownerId), { studentId: k2, termId: A.termId, roomId: h.roomId }, reqCtx),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    });

    it("keeps boys and girls in their own hostels, and asks for a recorded gender", async () => {
      const boys = await hostel(A, { gender: "BOYS" });
      const girls = await hostel(A, { gender: "GIRLS" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A, "FEMALE"), termId: A.termId, roomId: boys.roomId }, reqCtx)).rejects.toMatchObject({ code: "WRONG_HOSTEL" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A, "MALE"), termId: A.termId, roomId: girls.roomId }, reqCtx)).rejects.toMatchObject({ code: "WRONG_HOSTEL" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A, "OTHER"), termId: A.termId, roomId: girls.roomId }, reqCtx)).rejects.toMatchObject({ code: "GENDER_NOT_SET" });
      await expect(hostels.placeStudent(admin(A), { studentId: await student(A, "FEMALE"), termId: A.termId, roomId: girls.roomId }, reqCtx)).resolves.toBeTruthy();
      // A hostel with boarders keeps its gender.
      await expect(hostels.updateHostel(admin(A), girls.id, { forGender: "BOYS" }, reqCtx)).rejects.toMatchObject({ code: "HOSTEL_HAS_BOARDERS" });
    });

    it("refuses to shrink a room below its boarders, or delete a room or hostel that has them", async () => {
      const h = await hostel(A, { beds: 4 });
      await hostels.placeStudent(admin(A), { studentId: await student(A), termId: A.termId, roomId: h.roomId, bedNumber: 3 }, reqCtx);
      await expect(hostels.updateRoom(admin(A), h.roomId, { beds: 2 }, reqCtx)).rejects.toMatchObject({ code: "ROOM_TOO_SMALL" });
      await expect(hostels.updateRoom(admin(A), h.roomId, { beds: 3, name: "Dorm A" }, reqCtx)).resolves.toMatchObject({ rooms: [{ name: "Dorm A", beds: 3 }] });
      await expect(hostels.deleteRoom(admin(A), h.roomId, reqCtx)).rejects.toMatchObject({ code: "ROOM_IN_USE" });
      await expect(hostels.deleteHostel(admin(A), h.id, reqCtx)).rejects.toMatchObject({ code: "HOSTEL_IN_USE" });
      const empty = await hostel(A);
      await hostels.deleteHostel(admin(A), empty.id, reqCtx);
      await expect(hostels.getHostel(admin(A), empty.id, {})).rejects.toBeInstanceOf(NotFoundError);
    });

    it("does not place a child who has left", async () => {
      const h = await hostel(A);
      const kid = await student(A);
      await withTenant(A.schoolId, (db) => db.student.update({ where: { id: kid }, data: { status: "WITHDRAWN" } }));
      await expect(hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: h.roomId }, reqCtx)).rejects.toMatchObject({ code: "STUDENT_LEFT" });
    });
  });

  // ── Money (F2) ───────────────────────────────────────────────────────────

  describe("fees", () => {
    it("a bed raises one HOSTEL charge at the hostel's fee; a free hostel raises none", async () => {
      const paid = await hostel(A, { fee: FEE });
      const kid = await student(A);
      const bed = await hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: paid.roomId }, reqCtx);
      expect(bed.charge).toEqual({ status: "OPEN", amount: FEE });
      const rows = await chargesOf(A, kid);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ termId: A.termId, amount: FEE, sourceModule: "hostel", sourceId: bed.id, description: `Hostel — ${paid.name}` });

      const free = await hostel(A);
      const other = await student(A);
      expect((await hostels.placeStudent(admin(A), { studentId: other, termId: A.termId, roomId: free.roomId }, reqCtx)).charge).toBeNull();
    });

    it("a move keeps one charge, re-priced while waiting; removal voids a waiting one", async () => {
      const cheap = await hostel(A, { fee: FEE });
      const dear = await hostel(A, { fee: FEE * 2 });
      const kid = await student(A);
      const bed = await hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: cheap.roomId }, reqCtx);
      const moved = await hostels.moveStudent(admin(A), bed.id, { roomId: dear.roomId }, reqCtx);
      expect(moved).toMatchObject({ hostelId: dear.id, bedNumber: 1, charge: { status: "OPEN", amount: FEE * 2 } });
      expect(await chargesOf(A, kid)).toHaveLength(1);
      await hostels.removeStudent(admin(A), bed.id, reqCtx);
      expect((await chargesOf(A, kid)).map((c) => c.status)).toEqual(["VOID"]);
    });

    it("once billed, a charge keeps its amount through a fee change, a move and a removal", async () => {
      const f = await setUp(`billed${n}`);
      const h = await hostel(f, { fee: FEE });
      const kid = await student(f);
      const bed = await hostels.placeStudent(admin(f), { studentId: kid, termId: f.termId, roomId: h.roomId }, reqCtx);
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      const result = await hostels.setFee(ctx(f.schoolId, f.bursarId), h.id, { fee: FEE * 3 }, reqCtx);
      expect(result).toMatchObject({ keptBilled: 1, repriced: 0 });
      const other = await hostel(f, { fee: FEE * 5 });
      expect((await hostels.moveStudent(admin(f), bed.id, { roomId: other.roomId }, reqCtx)).charge).toEqual({ status: "BILLED", amount: FEE });
      await hostels.removeStudent(admin(f), bed.id, reqCtx);
      expect((await chargesOf(f, kid)).map((c) => [c.status, c.amount])).toEqual([["BILLED", FEE]]);
    });

    it("a fee change re-prices waiting charges this term and next; the fee stands for the next term until changed", async () => {
      const h = await hostel(A, { fee: FEE });
      const kid = await student(A);
      await hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: h.roomId }, reqCtx);
      const copied = await hostels.copyBeds(admin(A), { fromTermId: A.termId, toTermId: A.nextTermId }, reqCtx);
      expect(copied.copied).toBeGreaterThanOrEqual(1);
      expect((await chargesOf(A, kid)).map((c) => [c.termId, c.amount])).toEqual([
        [A.termId, FEE],
        [A.nextTermId, FEE],
      ]);
      const result = await hostels.setFee(admin(A), h.id, { fee: FEE + 500_000 }, reqCtx);
      expect(result.repriced).toBe(2);
      expect((await chargesOf(A, kid)).every((c) => c.amount === FEE + 500_000)).toBe(true);
    });
  });

  // ── Next term and withdrawal ──────────────────────────────────────────────

  describe("next term and withdrawal", () => {
    it("copies each boarder to the same bed where it is free, and leaves out those who have left", async () => {
      const f = await setUp(`copy${n}`);
      const h = await hostel(f, { beds: 3 });
      const [stays, left, blocked] = [await student(f), await student(f), await student(f)];
      await hostels.placeStudent(admin(f), { studentId: stays, termId: f.termId, roomId: h.roomId, bedNumber: 1 }, reqCtx);
      await hostels.placeStudent(admin(f), { studentId: left, termId: f.termId, roomId: h.roomId, bedNumber: 2 }, reqCtx);
      await hostels.placeStudent(admin(f), { studentId: blocked, termId: f.termId, roomId: h.roomId, bedNumber: 3 }, reqCtx);
      await withTenant(f.schoolId, (db) => db.student.update({ where: { id: left }, data: { status: "WITHDRAWN" } }));
      // Someone already holds bed 3 next term.
      await hostels.placeStudent(admin(f), { studentId: await student(f), termId: f.nextTermId, roomId: h.roomId, bedNumber: 3 }, reqCtx);

      const result = await hostels.copyBeds(admin(f), { fromTermId: f.termId, toTermId: f.nextTermId }, reqCtx);
      expect(result).toEqual({ copied: 1, alreadyPlaced: 0, bedTaken: 1, leftSchool: 1 });
      const next = await hostels.listBeds(admin(f), h.id, { termId: f.nextTermId });
      expect(next.find((b) => b.studentId === stays)?.bedNumber).toBe(1);
      // Copying again changes nothing.
      expect(await hostels.copyBeds(admin(f), { fromTermId: f.termId, toTermId: f.nextTermId }, reqCtx)).toEqual({ copied: 0, alreadyPlaced: 1, bedTaken: 1, leftSchool: 1 });
    });

    it("withdrawal clears later terms' beds and voids their waiting charges, keeping this term's", async () => {
      const h = await hostel(A, { fee: FEE });
      const kid = await student(A);
      const now = await hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: h.roomId }, reqCtx);
      const later = await hostels.placeStudent(admin(A), { studentId: kid, termId: A.nextTermId, roomId: h.roomId }, reqCtx);
      const removed = await withTenant(A.schoolId, (db) =>
        removeHostelBedsAfterWithdrawal(db, { schoolId: A.schoolId, userId: A.adminId, ipAddress: null }, kid, day("2026-11-01"), charges),
      );
      expect(removed).toBe(1);
      const beds = await withTenant(A.schoolId, (db) => db.hostelBed.findMany({ where: { studentId: kid } }));
      expect(beds.map((b) => b.id)).toEqual([now.id]);
      const rows = await chargesOf(A, kid);
      expect(rows.find((c) => c.sourceId === later.id)?.status).toBe("VOID");
      expect(rows.find((c) => c.sourceId === now.id)?.status).toBe("OPEN");
    });
  });

  // ── House masters and who ─────────────────────────────────────────────────

  describe("house masters and who may do what", () => {
    it("takes house masters from teachers and House masters only", async () => {
      const h = await hostel(A);
      const candidates = await hostels.houseMasterCandidates(admin(A));
      const ids = candidates.map((c) => c.id);
      expect(ids).toEqual(expect.arrayContaining([A.teacherId, A.houseMasterId]));
      expect(ids).not.toContain(A.bursarId);
      const updated = await hostels.setHouseMasters(admin(A), h.id, { userIds: [A.teacherId, A.houseMasterId] }, reqCtx);
      expect(updated.houseMasters.map((m) => m.id).sort()).toEqual([A.teacherId, A.houseMasterId].sort());
      await expect(hostels.setHouseMasters(admin(A), h.id, { userIds: [A.bursarId] }, reqCtx)).rejects.toMatchObject({ code: "NOT_A_HOUSE_MASTER" });
      await expect(hostels.setHouseMasters(admin(A), h.id, { userIds: [B.teacherId] }, reqCtx)).rejects.toMatchObject({ code: "NOT_A_HOUSE_MASTER" });
    });

    it("lets the bursar read and set fees but not manage; teachers and House masters cannot reach the admin pages", async () => {
      const h = await hostel(A);
      const bursar = ctx(A.schoolId, A.bursarId);
      await expect(hostels.listHostels(bursar, {})).resolves.toBeTruthy();
      await expect(hostels.setFee(bursar, h.id, { fee: 100 }, reqCtx)).resolves.toBeTruthy();
      await expect(hostels.createHostel(bursar, { name: "No", forGender: "BOYS" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      for (const userId of [A.teacherId, A.houseMasterId]) {
        await expect(hostels.listHostels(ctx(A.schoolId, userId), {})).rejects.toBeInstanceOf(ForbiddenError);
        await expect(hostels.placeStudent(ctx(A.schoolId, userId), { studentId: await student(A), termId: A.termId, roomId: h.roomId }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("shows the student's bed this term, and keeps one school's hostels from another", async () => {
      const h = await hostel(A);
      const kid = await student(A);
      await hostels.placeStudent(admin(A), { studentId: kid, termId: A.termId, roomId: h.roomId }, reqCtx);
      expect(await hostels.studentHostel(admin(A), kid)).toMatchObject({ termName: "This Term", hostelName: h.name, roomName: "Room 1", bedNumber: 1 });
      expect(await hostels.studentHostel(admin(A), await student(A))).toBeNull();
      await expect(hostels.getHostel(admin(B), h.id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(hostels.placeStudent(admin(B), { studentId: await student(B), termId: B.termId, roomId: h.roomId }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
