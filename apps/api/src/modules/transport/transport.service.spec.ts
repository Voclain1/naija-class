import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service";
import { StudentChargeService } from "../finance/student-charge.service";
import { StudentsService } from "../students/students.service";
import { removeTransportAfterWithdrawal, TransportService } from "./transport.service";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13 CP5-D7/D8), against
// real Postgres. The money first: a place raises exactly one charge at the
// route's fee, a move keeps one charge, a removal or a free route voids only a
// waiting charge, and a fee change never touches a billed one. Then capacity,
// the next-term copy, withdrawal, and who may do what.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const FEE = 3_500_000; // ₦35,000 a term

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Transport ${label} ${runId}`,
      schoolSlug: `transport-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `transport-${label}-${runId}@example.test`,
      ownerPhone: `+23495${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  adminId: string;
  bursarId: string;
  teacherId: string;
  yearId: string;
  termId: string;
  nextTermId: string;
  pastTermId: string;
  armId: string;
}

describe("TransportService (integration)", () => {
  const charges = new StudentChargeService();
  const transport = new TransportService(charges);
  const invoices = new InvoiceGenerationService(undefined, charges);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const s = await makeSchool(label);
    schoolIds.add(s.schoolId);
    const schoolId = s.schoolId;
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") },
      });
      const past = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "Past Term", startDate: day("2025-09-01"), endDate: day("2025-12-15") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 2, name: "This Term", startDate: day("2026-01-05"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const next = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 3, name: "Next Term", startDate: day("2099-01-05"), endDate: day("2099-04-01") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `tr-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const user = await db.user.create({ data: { schoolId, email: `tr-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        ownerId: s.ownerId,
        adminId: await staff("admin"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        yearId: year.id,
        termId: term.id,
        nextTermId: next.id,
        pastTermId: past.id,
        armId: arm.id,
      };
    });
  }

  async function student(f: Fixture): Promise<string> {
    n += 1;
    return withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `TR-${n}-${runId}`, firstName: "Ada", lastName: `Rider${n}`, dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
      });
      await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId: f.termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      return s.id;
    });
  }

  const admin = (f: Fixture) => ctx(f.schoolId, f.adminId);

  async function route(f: Fixture, opts: { seats?: number | null; fee?: number; stops?: string[] } = {}) {
    n += 1;
    const vehicle =
      opts.seats === null
        ? null
        : await transport.createVehicle(admin(f), { plate: `lag ${n}-${runId}`, seats: opts.seats ?? 14 }, reqCtx);
    const driver = await transport.createDriver(admin(f), { name: `Driver ${n}`, phone: "08031234567" }, reqCtx);
    const r = await transport.createRoute(admin(f), { name: `Route ${n}`, vehicleId: vehicle?.id ?? null, driverId: driver.id }, reqCtx);
    const withStops = await transport.setStops(admin(f), r.id, { stops: (opts.stops ?? ["Lekki", "Ajah"]).map((name) => ({ name })) }, reqCtx);
    if (opts.fee) await transport.setFee(admin(f), r.id, { fee: opts.fee }, reqCtx);
    return { ...withStops, vehicleId: vehicle?.id ?? null };
  }

  async function place(f: Fixture, studentId: string, r: { id: string; stops: { id: string }[] }, termId = f.termId) {
    return transport.createPlace(admin(f), { studentId, termId, routeId: r.id, stopId: r.stops[0]!.id }, reqCtx);
  }

  async function chargesOf(f: Fixture, studentId: string) {
    return withTenant(f.schoolId, (db) =>
      db.studentCharge.findMany({ where: { studentId }, orderBy: { createdAt: "asc" } }),
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

  // ── Records ──────────────────────────────────────────────────────────────

  describe("vehicles, drivers and routes", () => {
    it("keeps plates upper case and unique in the school", async () => {
      const v = await transport.createVehicle(admin(A), { plate: " kja 123 xy ", seats: 18, description: "White Coaster" }, reqCtx);
      expect(v).toMatchObject({ plate: "KJA 123 XY", seats: 18, description: "White Coaster", routeCount: 0 });
      await expect(transport.createVehicle(admin(A), { plate: "KJA 123 XY", seats: 5 }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      // Another school may use the same plate.
      await expect(transport.createVehicle(admin(B), { plate: "KJA 123 XY", seats: 5 }, reqCtx)).resolves.toBeTruthy();
    });

    it("works out whether a driver's licence is valid, expiring or expired", async () => {
      const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
      const states: string[] = [];
      for (const expiry of [iso(90), iso(10), iso(-1), null]) {
        const d = await transport.createDriver(admin(A), { name: "Musa", phone: "08030000000", licenceExpiry: expiry }, reqCtx);
        states.push(d.licenceState);
      }
      expect(states).toEqual(["VALID", "EXPIRING", "EXPIRED", "NOT_RECORDED"]);
    });

    it("keeps stops in order, keeps their ids, and refuses to drop one a child uses", async () => {
      const r = await route(A, { stops: ["Lekki", "Ajah", "Sangotedo"] });
      expect(r.stops.map((s) => s.name)).toEqual(["Lekki", "Ajah", "Sangotedo"]);
      const [lekki, ajah, sango] = r.stops;
      const reordered = await transport.setStops(admin(A), r.id, {
        stops: [{ id: sango!.id, name: "Sangotedo", pickupMinute: 395 }, { id: lekki!.id, name: "Lekki Phase 1" }, { name: "VGC" }],
      }, reqCtx);
      expect(reordered.stops.map((s) => [s.name, s.position, s.pickupMinute])).toEqual([
        ["Sangotedo", 0, 395],
        ["Lekki Phase 1", 1, null],
        ["VGC", 2, null],
      ]);
      expect(reordered.stops[0]!.id).toBe(sango!.id);
      expect(reordered.stops.some((s) => s.id === ajah!.id)).toBe(false);

      const kid = await student(A);
      await transport.createPlace(admin(A), { studentId: kid, termId: A.termId, routeId: r.id, stopId: lekki!.id }, reqCtx);
      await expect(
        transport.setStops(admin(A), r.id, { stops: [{ id: sango!.id, name: "Sangotedo" }] }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
      // A route with children on it cannot be deleted.
      await expect(transport.deleteRoute(admin(A), r.id, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuses a vehicle smaller than the children already on a route this term", async () => {
      const r = await route(A, { seats: 2 });
      await place(A, await student(A), r);
      await place(A, await student(A), r);
      await expect(transport.updateVehicle(admin(A), r.vehicleId!, { seats: 1 }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      const small = await transport.createVehicle(admin(A), { plate: `SMALL-${runId}`, seats: 1 }, reqCtx);
      await expect(transport.updateRoute(admin(A), r.id, { vehicleId: small.id }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      await expect(transport.updateVehicle(admin(A), r.vehicleId!, { seats: 3 }, reqCtx)).resolves.toMatchObject({ seats: 3 });
    });

    it("lets owner and admin manage, the bursar read and set fees, and a teacher nothing", async () => {
      const r = await route(A);
      await expect(transport.listRoutes(ctx(A.schoolId, A.bursarId), { termId: A.termId })).resolves.toBeTruthy();
      await expect(transport.createVehicle(ctx(A.schoolId, A.bursarId), { plate: "X1", seats: 3 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(transport.setFee(ctx(A.schoolId, A.bursarId), r.id, { fee: 100 }, reqCtx)).resolves.toBeTruthy();
      await expect(transport.setFee(ctx(A.schoolId, A.ownerId), r.id, { fee: 200 }, reqCtx)).resolves.toBeTruthy();
      await expect(transport.listRoutes(ctx(A.schoolId, A.teacherId), {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(transport.setFee(ctx(A.schoolId, A.teacherId), r.id, { fee: 1 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const kid = await student(A);
      await expect(
        transport.createPlace(ctx(A.schoolId, A.bursarId), { studentId: kid, termId: A.termId, routeId: r.id, stopId: r.stops[0]!.id }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("another school sees none of it (RLS)", async () => {
      const r = await route(A);
      expect((await transport.listRoutes(admin(B), {})).some((x) => x.id === r.id)).toBe(false);
      await expect(transport.getRoute(admin(B), r.id, {})).rejects.toBeInstanceOf(NotFoundError);
      const theirs = await student(B);
      await expect(place(A, theirs, r)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── Places and charges ───────────────────────────────────────────────────

  describe("putting a child on a route", () => {
    it("raises one TRANSPORT charge at the route's fee, and a free route raises none", async () => {
      const paid = await route(A, { fee: FEE });
      const free = await route(A);
      const kid = await student(A);
      const other = await student(A);
      const p = await place(A, kid, paid);
      expect(p).toMatchObject({ studentId: kid, routeId: paid.id, stopName: "Lekki", charge: { status: "OPEN", amount: FEE } });
      const [c] = await chargesOf(A, kid);
      expect(c).toMatchObject({ kind: "TRANSPORT", amount: FEE, termId: A.termId, sourceModule: "transport", sourceId: p.id, status: "OPEN" });
      expect(c!.description).toBe(`Transport — ${paid.name}`);

      await place(A, other, free);
      expect(await chargesOf(A, other)).toEqual([]);

      // One route per child per term.
      await expect(place(A, kid, free)).rejects.toBeInstanceOf(ConflictError);
      // The stop must belong to the route.
      const k3 = await student(A);
      await expect(
        transport.createPlace(admin(A), { studentId: k3, termId: A.termId, routeId: paid.id, stopId: free.stops[0]!.id }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("never takes more children than the vehicle has seats, and none without a vehicle", async () => {
      const r = await route(A, { seats: 2 });
      await place(A, await student(A), r);
      await place(A, await student(A), r);
      await expect(place(A, await student(A), r)).rejects.toMatchObject({ code: "ROUTE_FULL" });
      // A full route this term still has room next term.
      await expect(place(A, await student(A), r, A.nextTermId)).resolves.toBeTruthy();

      const noVehicle = await route(A, { seats: null });
      await expect(place(A, await student(A), noVehicle)).rejects.toMatchObject({ code: "ROUTE_FULL" });
    });

    it("gives the last seat to exactly one of two at once", async () => {
      const r = await route(A, { seats: 1 });
      const [k1, k2] = [await student(A), await student(A)];
      const results = await Promise.allSettled([place(A, k1, r), place(A, k2, r)]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const places = await transport.listPlaces(admin(A), r.id, { termId: A.termId });
      expect(places).toHaveLength(1);
    });

    it("moving keeps one charge: a waiting one takes the new fee, a billed one stays, a free route voids it", async () => {
      const a = await route(A, { fee: FEE });
      const b = await route(A, { fee: 5_000_000 });
      const free = await route(A);
      const kid = await student(A);
      const p = await place(A, kid, a);

      // Same route, another stop: nothing about the money changes.
      await transport.movePlace(admin(A), p.id, { routeId: a.id, stopId: a.stops[1]!.id }, reqCtx);
      expect((await chargesOf(A, kid)).map((c) => [c.status, c.amount])).toEqual([["OPEN", FEE]]);

      const moved = await transport.movePlace(admin(A), p.id, { routeId: b.id, stopId: b.stops[0]!.id }, reqCtx);
      expect(moved.charge).toEqual({ status: "OPEN", amount: 5_000_000 });
      expect((await chargesOf(A, kid)).map((c) => [c.status, c.amount, c.description])).toEqual([["OPEN", 5_000_000, `Transport — ${b.name}`]]);

      await transport.movePlace(admin(A), p.id, { routeId: free.id, stopId: free.stops[0]!.id }, reqCtx);
      expect((await chargesOf(A, kid)).map((c) => c.status)).toEqual(["VOID"]);

      // Back to a paid route: a fresh charge.
      await transport.movePlace(admin(A), p.id, { routeId: a.id, stopId: a.stops[0]!.id }, reqCtx);
      expect((await chargesOf(A, kid)).map((c) => [c.status, c.amount])).toEqual([["VOID", 5_000_000], ["OPEN", FEE]]);

      // Billed: a move leaves it alone.
      await invoices.generateForArm(ctx(A.schoolId, A.bursarId), { termId: A.termId, classArmId: A.armId }, reqCtx);
      await transport.movePlace(admin(A), p.id, { routeId: b.id, stopId: b.stops[0]!.id }, reqCtx);
      expect((await chargesOf(A, kid)).map((c) => [c.status, c.amount])).toEqual([["VOID", 5_000_000], ["BILLED", FEE]]);
    });

    it("a move to a full route is refused", async () => {
      const full = await route(A, { seats: 1 });
      const other = await route(A);
      await place(A, await student(A), full);
      const p = await place(A, await student(A), other);
      await expect(transport.movePlace(admin(A), p.id, { routeId: full.id, stopId: full.stops[0]!.id }, reqCtx)).rejects.toMatchObject({ code: "ROUTE_FULL" });
    });

    it("removing a child voids a waiting charge and leaves a billed one", async () => {
      const r = await route(A, { fee: FEE });
      const waiting = await student(A);
      const pw = await place(A, waiting, r);
      await transport.removePlace(admin(A), pw.id, reqCtx);
      expect((await chargesOf(A, waiting)).map((c) => [c.status, c.voidReason])).toEqual([["VOID", "Removed from the route"]]);
      expect(await transport.listPlaces(admin(A), r.id, { termId: A.termId })).toEqual([]);

      const billed = await student(A);
      const pb = await place(A, billed, r);
      await invoices.generateForArm(ctx(A.schoolId, A.bursarId), { termId: A.termId, classArmId: A.armId }, reqCtx);
      await transport.removePlace(admin(A), pb.id, reqCtx);
      expect((await chargesOf(A, billed)).map((c) => c.status)).toEqual(["BILLED"]);
    });
  });

  // ── The route's fee ──────────────────────────────────────────────────────

  describe("changing a route's fee", () => {
    it("re-prices waiting charges for this and later terms only, never a billed one", async () => {
      const f = await setUp(`fee${n}`);
      const r = await route(f, { fee: FEE });
      const billedKid = await student(f);
      await place(f, billedKid, r);
      await invoices.generateForArm(ctx(f.schoolId, f.bursarId), { termId: f.termId, classArmId: f.armId }, reqCtx);
      const waitingKid = await student(f);
      await place(f, waitingKid, r);
      const nextKid = await student(f);
      await place(f, nextKid, r, f.nextTermId);
      const pastKid = await student(f);
      await place(f, pastKid, r, f.pastTermId);

      const result = await transport.setFee(admin(f), r.id, { fee: 4_000_000 }, reqCtx);
      expect(result).toMatchObject({ repriced: 2, raised: 0, voided: 0, keptBilled: 1 });
      expect(result.route.fee).toBe(4_000_000);
      expect((await chargesOf(f, billedKid)).map((c) => c.amount)).toEqual([FEE]);
      expect((await chargesOf(f, waitingKid)).map((c) => c.amount)).toEqual([4_000_000]);
      expect((await chargesOf(f, nextKid)).map((c) => c.amount)).toEqual([4_000_000]);
      // A past term is history: its charge keeps the old fee.
      expect((await chargesOf(f, pastKid)).map((c) => c.amount)).toEqual([FEE]);

      const freed = await transport.setFee(admin(f), r.id, { fee: 0 }, reqCtx);
      expect(freed).toMatchObject({ voided: 2, keptBilled: 1 });
      expect((await chargesOf(f, waitingKid)).map((c) => c.status)).toEqual(["VOID"]);

      const paidAgain = await transport.setFee(admin(f), r.id, { fee: 1_000_000 }, reqCtx);
      expect(paidAgain).toMatchObject({ raised: 2, keptBilled: 1 });
      expect((await chargesOf(f, waitingKid)).map((c) => [c.status, c.amount])).toEqual([["VOID", 4_000_000], ["OPEN", 1_000_000]]);

      const audit = await withTenant(f.schoolId, (db) => db.auditLog.findMany({ where: { entityId: r.id, action: "transport.route.fee" } }));
      expect(audit).toHaveLength(4); // the fixture's own fee, then three changes
    });
  });

  // ── Next term and withdrawal ─────────────────────────────────────────────

  describe("copying to next term and withdrawal", () => {
    it("copies children to the same stops next term, within capacity, raising next term's charges", async () => {
      const f = await setUp(`copy${n}`);
      const r = await route(f, { fee: FEE, seats: 2 });
      const [k1, k2] = [await student(f), await student(f)];
      await transport.createPlace(admin(f), { studentId: k1, termId: f.termId, routeId: r.id, stopId: r.stops[1]!.id }, reqCtx);
      await place(f, k2, r);
      const other = await route(f, { seats: 5 });
      const leaver = await student(f);
      await place(f, leaver, other);
      await withTenant(f.schoolId, (db) => db.student.update({ where: { id: leaver }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } }));
      // Someone already on the full route next term takes one of its two seats.
      const early = await student(f);
      await place(f, early, r, f.nextTermId);

      const result = await transport.copyPlaces(admin(f), { fromTermId: f.termId, toTermId: f.nextTermId }, reqCtx);
      expect(result).toEqual({ copied: 1, alreadyPlaced: 0, routeFull: 1, leftSchool: 1 });
      const next = await transport.listPlaces(admin(f), r.id, { termId: f.nextTermId });
      expect(next.map((p) => p.studentId).sort()).toEqual([early, k1].sort());
      expect(next.find((p) => p.studentId === k1)!.stopId).toBe(r.stops[1]!.id);
      expect((await chargesOf(f, k1)).map((c) => [c.termId, c.amount])).toEqual([[f.termId, FEE], [f.nextTermId, FEE]]);

      // Copying again changes nothing.
      expect(await transport.copyPlaces(admin(f), { fromTermId: f.termId, toTermId: f.nextTermId }, reqCtx)).toMatchObject({ copied: 0, alreadyPlaced: 1 });
    });

    it("withdrawal removes places in terms that start later and voids their waiting charges", async () => {
      const r = await route(A, { fee: FEE });
      const kid = await student(A);
      await place(A, kid, r);
      await place(A, kid, r, A.nextTermId);
      await withTenant(A.schoolId, (db) =>
        removeTransportAfterWithdrawal(db, { schoolId: A.schoolId, userId: A.adminId, ipAddress: null }, kid, new Date()),
      );
      const left = await withTenant(A.schoolId, (db) => db.transportAssignment.findMany({ where: { studentId: kid } }));
      expect(left.map((p) => p.termId)).toEqual([A.termId]);
      expect((await chargesOf(A, kid)).map((c) => [c.termId, c.status])).toEqual([[A.termId, "OPEN"], [A.nextTermId, "VOID"]]);
    });

    it("withdrawing a student through the student page frees next term's seat", async () => {
      const r = await route(A, { fee: FEE });
      const kid = await student(A);
      await place(A, kid, r, A.nextTermId);
      await new StudentsService().withdraw(ctx(A.schoolId, A.ownerId), kid, {}, { ...reqCtx, userAgent: null });
      expect(await withTenant(A.schoolId, (db) => db.transportAssignment.count({ where: { studentId: kid } }))).toBe(0);
      expect((await chargesOf(A, kid)).map((c) => c.status)).toEqual(["VOID"]);
    });

    it("the student page reads this term's route and stop", async () => {
      const r = await route(A, { stops: ["Ikoyi"] });
      const kid = await student(A);
      await place(A, kid, r);
      await expect(transport.studentTransport(admin(A), kid)).resolves.toMatchObject({ termId: A.termId, routeName: r.name, stopName: "Ikoyi" });
      await expect(transport.studentTransport(admin(A), await student(A))).resolves.toBeNull();
    });
  });

  // ── CP5.3: the daily list and parents ────────────────────────────────────

  describe("the daily route list and parents", () => {
    async function guardianFor(f: Fixture, studentId: string, phone: string, isPrimary = true) {
      return withTenant(f.schoolId, async (db) => {
        const g = await db.guardian.create({ data: { schoolId: f.schoolId, firstName: "Ngozi", lastName: "Parent", relationship: "MOTHER", phone } });
        await db.studentGuardian.create({ data: { schoolId: f.schoolId, studentId, guardianId: g.id, isPrimary } });
        return g.id;
      });
    }

    it("lists the day's children stop by stop, with class and the primary guardian's phone", async () => {
      const f = await setUp(`daily${n}`);
      const r = await route(f, { stops: ["Lekki", "Ajah"] });
      const atAjah = await student(f);
      const atLekki = await student(f);
      await transport.createPlace(admin(f), { studentId: atAjah, termId: f.termId, routeId: r.id, stopId: r.stops[1]!.id }, reqCtx);
      await transport.createPlace(admin(f), { studentId: atLekki, termId: f.termId, routeId: r.id, stopId: r.stops[0]!.id }, reqCtx);
      await guardianFor(f, atLekki, "08030000001", false);
      await guardianFor(f, atLekki, "08030000002", true);
      // Next term's place is not on today's list.
      await place(f, await student(f), r, f.nextTermId);

      const list = await transport.dailyList(admin(f), r.id, { date: "2026-03-02" });
      expect(list).toMatchObject({ date: "2026-03-02", termId: f.termId, termName: "This Term", total: 2 });
      expect(list.route).toMatchObject({ id: r.id, name: r.name, driverPhone: "08031234567" });
      expect(list.stops.map((s) => [s.name, s.children.map((c) => c.studentId)])).toEqual([
        ["Lekki", [atLekki]],
        ["Ajah", [atAjah]],
      ]);
      expect(list.stops[0]!.children[0]).toMatchObject({ classArm: "JSS1A", guardianPhone: "08030000002" });
      expect(list.stops[1]!.children[0]!.guardianPhone).toBeNull();

      // The read is audited: it carries phone numbers.
      const audit = await withTenant(f.schoolId, (db) => db.auditLog.findMany({ where: { entityId: r.id, action: "transport.daily_list.read" } }));
      expect(audit).toHaveLength(1);
    });

    it("leaves out a child who has left the school or the class", async () => {
      const f = await setUp(`left${n}`);
      const r = await route(f);
      const [stays, withdrawn, unenrolled] = [await student(f), await student(f), await student(f)];
      for (const kid of [stays, withdrawn, unenrolled]) await place(f, kid, r);
      await withTenant(f.schoolId, async (db) => {
        await db.student.update({ where: { id: withdrawn }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
        await db.enrollment.updateMany({ where: { studentId: unenrolled }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
      });
      const list = await transport.dailyList(admin(f), r.id, { date: "2026-03-02" });
      expect(list.stops.flatMap((s) => s.children.map((c) => c.studentId))).toEqual([stays]);
    });

    it("a date outside every term has no children, and a teacher may not read the list", async () => {
      const r = await route(A);
      const list = await transport.dailyList(admin(A), r.id, { date: "2025-12-25" });
      expect(list).toMatchObject({ termId: null, total: 0 });
      expect(list.stops.every((s) => s.children.length === 0)).toBe(true);
      await expect(transport.dailyList(ctx(A.schoolId, A.teacherId), r.id, { date: "2026-03-02" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(transport.dailyList(ctx(A.schoolId, A.bursarId), r.id, { date: "2026-03-02" })).resolves.toBeTruthy();
    });

    it("a parent sees their own child's route, stop, driver and bus this term, and no one else's", async () => {
      const r = await route(A, { stops: ["Ikoyi"] });
      const kid = await student(A);
      const other = await student(A);
      await place(A, kid, r);
      await place(A, other, r);
      const guardianId = await guardianFor(A, kid, "08039999999");
      const g = { sessionId: "s", schoolId: A.schoolId, guardianId };
      const seen = await transport.transportForGuardian(g, kid);
      expect(seen).toMatchObject({ termName: "This Term", routeName: r.name, stopName: "Ikoyi", driverName: expect.any(String), driverPhone: "08031234567" });
      expect(seen!.vehiclePlate).toMatch(/^LAG /);
      await expect(transport.transportForGuardian(g, other)).rejects.toThrow();
      await expect(transport.transportForGuardian({ sessionId: "s", schoolId: B.schoolId, guardianId }, kid)).rejects.toThrow();
      // A child with no place this term.
      const noBus = await student(A);
      await withTenant(A.schoolId, (db) => db.studentGuardian.create({ data: { schoolId: A.schoolId, studentId: noBus, guardianId, isPrimary: true } }));
      await expect(transport.transportForGuardian(g, noBus)).resolves.toBeNull();
    });
  });
});
