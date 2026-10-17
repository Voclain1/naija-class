import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, sickbayDayOf, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentChargeService } from "../finance/student-charge.service";
import { TeacherScopeService } from "../teacher-scope/teacher-scope.service";
import { boarderLabels, HostelHouseService } from "./hostel-house.service";
import { HostelService } from "./hostel.service";

// Phase 9 / CP6b.2 — what a house master keeps (docs/modules/phase-9.md §15
// CP6b-D4, D5, D7, D8; owner's answers §15.8), against real Postgres. House
// masters see only their own hostels; the sickbay tells them only "sent home
// today"; the visitor log is theirs and admin's; a parent sees the child's bed
// and the house masters' names, nothing more.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

interface Fixture {
  schoolId: string;
  adminId: string;
  bursarId: string;
  teacherId: string;
  otherTeacherId: string;
  houseMasterId: string;
  yearId: string;
  termId: string;
  armId: string;
}

describe("HostelHouseService (integration)", () => {
  const hostels = new HostelService(new StudentChargeService());
  const house = new HostelHouseService();
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Boarding ${label} ${runId}`,
        schoolSlug: `boarding-${label}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `boarding-${label}-${runId}@example.test`,
        ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
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
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `bd-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string, tag = key) => {
        const user = await db.user.create({ data: { schoolId, email: `bd-${label}-${tag}-${runId}@example.test`, firstName: tag, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        adminId: await staff("admin"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        otherTeacherId: await staff("teacher", "teacher2"),
        houseMasterId: await staff("house_master"),
        yearId: year.id,
        termId: term.id,
        armId: arm.id,
      };
    });
  }

  async function boarder(f: Fixture, hostelRoomId: string): Promise<string> {
    n += 1;
    const id = await withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `BD-${n}-${runId}`, firstName: "Obi", lastName: `Boarder${n}`, dateOfBirth: day("2012-01-01"), gender: "MALE" },
      });
      await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId: f.termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      return s.id;
    });
    await hostels.placeStudent(admin(f), { studentId: id, termId: f.termId, roomId: hostelRoomId }, reqCtx);
    return id;
  }

  const admin = (f: Fixture) => ctx(f.schoolId, f.adminId);

  async function hostel(f: Fixture, masters: string[] = []) {
    n += 1;
    const h = await hostels.createHostel(admin(f), { name: `House ${n}`, forGender: "BOYS" }, reqCtx);
    const withRoom = await hostels.createRoom(admin(f), h.id, { name: "Room 1", beds: 6 }, reqCtx);
    if (masters.length) await hostels.setHouseMasters(admin(f), h.id, { userIds: masters }, reqCtx);
    return { id: h.id, name: h.name, roomId: withRoom.rooms[0]!.id };
  }

  async function sickbayVisit(f: Fixture, studentId: string, at: Date, opts: { sentHome: boolean; withdrawn?: boolean }) {
    await withTenant(f.schoolId, (db) =>
      db.sickbayVisit.create({
        data: {
          schoolId: f.schoolId,
          studentId,
          visitedAt: at,
          complaint: "Headache and fever",
          actionTaken: "Paracetamol",
          sentHome: opts.sentHome,
          recordedBy: f.adminId,
          withdrawnAt: opts.withdrawn ? new Date() : null,
          withdrawnBy: opts.withdrawn ? f.adminId : null,
        },
      }),
    );
  }

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ── Who keeps which hostel ───────────────────────────────────────────────

  describe("house masters", () => {
    it("see only the hostels they keep; owner and admin see every one; the bursar is refused", async () => {
      const mine = await hostel(A, [A.teacherId]);
      const theirs = await hostel(A, [A.houseMasterId]);
      await boarder(A, mine.roomId);

      const forTeacher = await house.myHostels(ctx(A.schoolId, A.teacherId));
      expect(forTeacher.map((h) => h.id)).toEqual([mine.id]);
      expect(forTeacher[0]).toMatchObject({ name: mine.name, forGender: "BOYS", boarders: 1 });
      expect((await house.myHostels(ctx(A.schoolId, A.houseMasterId))).map((h) => h.id)).toEqual([theirs.id]);
      expect(await house.myHostels(ctx(A.schoolId, A.otherTeacherId))).toEqual([]);
      const forAdmin = (await house.myHostels(admin(A))).map((h) => h.id);
      expect(forAdmin).toEqual(expect.arrayContaining([mine.id, theirs.id]));

      await expect(house.myHostels(ctx(A.schoolId, A.bursarId))).rejects.toBeInstanceOf(ForbiddenError);
      // Another hostel is not found, not forbidden.
      await expect(house.boarders(ctx(A.schoolId, A.teacherId), theirs.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(house.visits(ctx(A.schoolId, A.otherTeacherId), mine.id, {})).rejects.toBeInstanceOf(NotFoundError);
    });

    it("tells the teacher scope whether the teacher keeps a hostel", async () => {
      await hostel(A, [A.teacherId]);
      const scope = new TeacherScopeService();
      expect((await scope.getMyScope(ctx(A.schoolId, A.teacherId))).housesHostels).toBe(true);
      expect((await scope.getMyScope(ctx(A.schoolId, A.otherTeacherId))).housesHostels).toBe(false);
    });

    it("never reaches another school's hostel", async () => {
      const h = await hostel(A, [A.teacherId]);
      await expect(house.boarders(admin(B), h.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── The boarder list and the sickbay ─────────────────────────────────────

  describe("boarders", () => {
    it("lists this term's boarders by room and bed, flagging only a child the sickbay sent home today", async () => {
      const h = await hostel(A, [A.teacherId]);
      const [home, stayed, withdrawn, yesterday] = [await boarder(A, h.roomId), await boarder(A, h.roomId), await boarder(A, h.roomId), await boarder(A, h.roomId)];
      const now = new Date();
      await sickbayVisit(A, home, now, { sentHome: true });
      await sickbayVisit(A, stayed, now, { sentHome: false });
      await sickbayVisit(A, withdrawn, now, { sentHome: true, withdrawn: true });
      await sickbayVisit(A, yesterday, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), { sentHome: true });

      const list = await house.boarders(ctx(A.schoolId, A.teacherId), h.id);
      expect(list.term).toMatchObject({ id: A.termId, name: "This Term" });
      expect(list.boarders.map((b) => b.bedNumber)).toEqual([1, 2, 3, 4]);
      const flag = new Map(list.boarders.map((b) => [b.studentId, b.sentHomeToday]));
      expect(flag.get(home)).toBe(true);
      expect(flag.get(stayed)).toBe(false);
      expect(flag.get(withdrawn)).toBe(false);
      expect(flag.get(yesterday)).toBe(false);
      expect(list.boarders[0]).toMatchObject({ classArm: "JSS1A", roomName: "Room 1" });
      // Never the complaint, the action or a medicine.
      const text = JSON.stringify(list);
      expect(text).not.toMatch(/Headache|Paracetamol|complaint|actionTaken|medication/i);
    });

    it("labels a boarder on the sickbay page with their hostel and room", async () => {
      const h = await hostel(A);
      const kid = await boarder(A, h.roomId);
      const labels = await withTenant(A.schoolId, (db) => boarderLabels(db, A.schoolId, [kid, "00000000-0000-0000-0000-000000000000"]));
      expect(labels.get(kid)).toBe(`${h.name}, Room 1`);
      expect(labels.size).toBe(1);
    });
  });

  // ── The visitor log ──────────────────────────────────────────────────────

  describe("visitor log", () => {
    it("logs a visitor to a boarder, records when they left once, and lists the day", async () => {
      const h = await hostel(A, [A.houseMasterId]);
      const kid = await boarder(A, h.roomId);
      const hm = ctx(A.schoolId, A.houseMasterId);
      const arrived = new Date(Date.now() - 60 * 60 * 1000);

      const v = await house.logVisit(hm, h.id, { studentId: kid, visitorName: "Ngozi Eze", relationship: "Aunt", phone: "08031234567", arrivedAt: arrived.toISOString() }, reqCtx);
      expect(v).toMatchObject({ studentId: kid, visitorName: "Ngozi Eze", relationship: "Aunt", phone: "08031234567", leftAt: null, loggedByName: "house_master Staff" });

      await expect(house.visitLeft(hm, v.id, { leftAt: new Date(arrived.getTime() - 60_000).toISOString() }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
      const left = await house.visitLeft(hm, v.id, {}, reqCtx);
      expect(left.leftAt).not.toBeNull();
      await expect(house.visitLeft(hm, v.id, {}, reqCtx)).rejects.toBeInstanceOf(ConflictError);

      // The visit's own Lagos day: an hour ago can be yesterday just after midnight.
      expect((await house.visits(hm, h.id, { day: sickbayDayOf(arrived) })).map((x) => x.id)).toContain(v.id);
      expect(await house.visits(hm, h.id, { day: "2020-01-01" })).toEqual([]);
      // Admin sees every hostel's log.
      expect((await house.visits(admin(A), h.id, { day: sickbayDayOf(arrived) })).map((x) => x.id)).toContain(v.id);

      const audit = await withTenant(A.schoolId, (db) => db.auditLog.findFirstOrThrow({ where: { entityId: v.id, action: "hostel.visit.log" } }));
      // The visitor's contact details stay out of the audit row.
      expect(JSON.stringify(audit.metadata)).not.toMatch(/Ngozi|0803/);
    });

    it("refuses a visit to a child who is not a boarder here, a future arrival, and another hostel's log", async () => {
      const h = await hostel(A, [A.houseMasterId]);
      const other = await hostel(A);
      const elsewhere = await boarder(A, other.roomId);
      const hm = ctx(A.schoolId, A.houseMasterId);
      await expect(house.logVisit(hm, h.id, { studentId: elsewhere, visitorName: "X", relationship: "Uncle" }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
      const kid = await boarder(A, h.roomId);
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await expect(house.logVisit(hm, h.id, { studentId: kid, visitorName: "X", relationship: "Uncle", arrivedAt: future }, reqCtx)).rejects.toBeInstanceOf(ValidationError);

      const v = await house.logVisit(admin(A), other.id, { studentId: elsewhere, visitorName: "Bola", relationship: "Father" }, reqCtx);
      await expect(house.visitLeft(hm, v.id, {}, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
      await expect(house.deleteVisit(hm, v.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("removes an entry logged by mistake, audited", async () => {
      const h = await hostel(A, [A.teacherId]);
      const kid = await boarder(A, h.roomId);
      const t = ctx(A.schoolId, A.teacherId);
      const v = await house.logVisit(t, h.id, { studentId: kid, visitorName: "Wrong", relationship: "Mother" }, reqCtx);
      await house.deleteVisit(t, v.id, reqCtx);
      expect((await house.visits(t, h.id, {})).map((x) => x.id)).not.toContain(v.id);
      expect(await withTenant(A.schoolId, (db) => db.auditLog.count({ where: { entityId: v.id, action: "hostel.visit.delete" } }))).toBe(1);
    });
  });

  // ── Families ─────────────────────────────────────────────────────────────

  describe("families", () => {
    async function guardianFor(f: Fixture, studentId: string) {
      return withTenant(f.schoolId, async (db) => {
        const g = await db.guardian.create({ data: { schoolId: f.schoolId, firstName: "Ngozi", lastName: "Parent", relationship: "MOTHER", phone: "08039999998" } });
        await db.studentGuardian.create({ data: { schoolId: f.schoolId, studentId, guardianId: g.id, isPrimary: true } });
        return g.id;
      });
    }

    it("shows a parent their own child's hostel, room, bed and house masters, and nothing about visitors", async () => {
      const h = await hostel(A, [A.teacherId, A.houseMasterId]);
      const kid = await boarder(A, h.roomId);
      await house.logVisit(admin(A), h.id, { studentId: kid, visitorName: "Secret Visitor", relationship: "Uncle" }, reqCtx);
      const guardianId = await guardianFor(A, kid);
      const g = { sessionId: "s", schoolId: A.schoolId, guardianId };

      const card = await house.hostelForGuardian(g, kid);
      expect(card).toEqual({
        termName: "This Term",
        hostelName: h.name,
        roomName: "Room 1",
        bedNumber: 1,
        houseMasters: ["house_master Staff", "teacher Staff"],
      });
      expect(JSON.stringify(card)).not.toMatch(/Secret|phone/i);

      // Another child, another school, and a child with no bed.
      const other = await boarder(A, h.roomId);
      await expect(house.hostelForGuardian(g, other)).rejects.toThrow();
      await expect(house.hostelForGuardian({ sessionId: "s", schoolId: B.schoolId, guardianId }, kid)).rejects.toThrow();
      const day1 = await withTenant(A.schoolId, async (db) => {
        const s = await db.student.create({
          data: { schoolId: A.schoolId, admissionNumber: `BD-day-${runId}`, firstName: "Day", lastName: "Pupil", dateOfBirth: day("2012-01-01"), gender: "MALE" },
        });
        await db.studentGuardian.create({ data: { schoolId: A.schoolId, studentId: s.id, guardianId, isPrimary: true } });
        return s.id;
      });
      expect(await house.hostelForGuardian(g, day1)).toBeNull();
    });
  });
});
