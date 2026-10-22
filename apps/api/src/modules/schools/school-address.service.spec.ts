import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { addressAllowance, changeSchoolAddress } from "../../common/slug/school-address-change.js";
import { currentSchoolCode, resolveSchoolCode } from "../../common/slug/school-code.js";
import { generateUniqueSchoolSlug } from "../../common/slug/school-slug.js";
import { AuthService } from "../auth/auth.service.js";
import { SchoolAddressService } from "./school-address.service.js";

// School web addresses (docs/modules/school-addresses.md). Real database.

const runId = Math.random().toString(36).slice(2, 8);
const auth = new AuthService();
const schoolIds = new Set<string>();
const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
let phoneCounter = 0;
const phone = () => `+23481${String(++phoneCounter % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const DAY = 24 * 60 * 60 * 1000;

afterAll(async () => {
  for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
});

async function makeSchool(suffix: string, opts: { ageDays?: number; status?: "ACTIVE" | "ONBOARDING" } = {}) {
  const signed = await auth.signupOwner(
    {
      schoolName: `Addr ${suffix} ${runId}`,
      schoolSlug: `addr-${suffix}-${runId}`,
      ownerFirstName: "Amaka",
      ownerLastName: "Boss",
      ownerEmail: `addr-${suffix}-${runId}@example.test`,
      ownerPhone: phone(),
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    reqCtx,
  );
  schoolIds.add(signed.school.id);
  await basePrisma.school.update({
    where: { id: signed.school.id },
    data: {
      status: opts.status ?? "ACTIVE",
      onboardingStep: 5,
      createdAt: new Date(Date.now() - (opts.ageDays ?? 60) * DAY),
    },
  });
  return { schoolId: signed.school.id, ownerId: signed.user.id, slug: `addr-${suffix}-${runId}` };
}

const ctx = (schoolId: string, userId: string) => ({ sessionId: "sess", userId, schoolId });

describe("addressAllowance (the limits)", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const old = new Date("2026-01-01T00:00:00Z");

  it("is free while onboarding, and for the first 30 days", () => {
    expect(addressAllowance({ status: "ONBOARDING", createdAt: old, counted: [], now }).free).toBe(true);
    const young = addressAllowance({ status: "ACTIVE", createdAt: new Date(now.getTime() - 10 * DAY), counted: [], now });
    expect(young.free).toBe(true);
    expect(young.freeUntil).not.toBeNull();
  });

  it("then allows two counted changes in 12 months, 30 days apart", () => {
    expect(addressAllowance({ status: "ACTIVE", createdAt: old, counted: [], now })).toMatchObject({ free: false, changesLeft: 2, blockedReason: null });
    const recent = addressAllowance({ status: "ACTIVE", createdAt: old, counted: [new Date(now.getTime() - 5 * DAY)], now });
    expect(recent.changesLeft).toBe(1);
    expect(recent.blockedReason).toMatch(/recently/);
    expect(addressAllowance({ status: "ACTIVE", createdAt: old, counted: [new Date(now.getTime() - 40 * DAY)], now }).blockedReason).toBeNull();
    const used = addressAllowance({ status: "ACTIVE", createdAt: old, counted: [new Date(now.getTime() - 200 * DAY), new Date(now.getTime() - 40 * DAY)], now });
    expect(used.changesLeft).toBe(0);
    expect(used.blockedReason).toMatch(/2 times/);
    expect(used.nextChangeAt).not.toBeNull();
    // A change more than a year ago no longer counts.
    expect(addressAllowance({ status: "ACTIVE", createdAt: old, counted: [new Date(now.getTime() - 400 * DAY)], now }).changesLeft).toBe(2);
  });
});

describe("changing a school's address (integration)", () => {
  const svc = new SchoolAddressService();

  it("the owner changes it; the old code moves to history and still finds the school everywhere", async () => {
    const a = await makeSchool("move");
    const next = `newcode-${runId}`;
    const dto = await svc.change(ctx(a.schoolId, a.ownerId), next, reqCtx);
    expect(dto.code).toBe(next);
    expect(dto.host).toBe(`${next}.schoolkit.ng`);
    expect(dto.previousCodes).toEqual([a.slug]);

    expect(await resolveSchoolCode(a.slug)).toEqual({ schoolId: a.schoolId, slug: next, previous: true });
    expect(await resolveSchoolCode(next.toUpperCase())).toEqual({ schoolId: a.schoolId, slug: next, previous: false });
    expect(await currentSchoolCode(` ${a.slug} `)).toBe(next);
    expect(await currentSchoolCode("no-such-school-xyz")).toBe("no-such-school-xyz");

    const audit = await withTenant(a.schoolId, (db) =>
      db.auditLog.findFirst({ where: { schoolId: a.schoolId, action: "school.address.change" }, select: { metadata: true } }),
    );
    expect(audit?.metadata).toMatchObject({ from: a.slug, to: next, counted: true });
  });

  it("an admin can see the address but not change it", async () => {
    const a = await makeSchool("admin");
    const adminId = await withTenant(a.schoolId, async (db) => {
      const role = await db.role.findFirstOrThrow({ where: { key: "admin" }, select: { id: true } });
      const user = await db.user.create({
        data: { schoolId: a.schoolId, email: `addr-second-admin-${runId}@example.test`, firstName: "Ade", lastName: "Admin" },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return user.id;
    });
    const seen = await svc.get(ctx(a.schoolId, adminId));
    expect(seen.code).toBe(a.slug);
    expect(seen.canChange).toBe(false);
    await expect(svc.change(ctx(a.schoolId, adminId), `admin-try-${runId}`, reqCtx)).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("a code another school holds, now or before, is refused; a school may take back its own old code", async () => {
    const a = await makeSchool("owner-a");
    const b = await makeSchool("owner-b");
    await expect(svc.change(ctx(a.schoolId, a.ownerId), b.slug, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_TAKEN" });

    const bNew = `b-moved-${runId}`;
    await changeSchoolAddress(b.schoolId, bNew, { kind: "PLATFORM", userId: b.ownerId });
    // b's old code is still b's: nobody else may have it, and sign-up skips it.
    await expect(svc.change(ctx(a.schoolId, a.ownerId), b.slug, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_TAKEN" });
    expect((await svc.check(ctx(a.schoolId, a.ownerId), b.slug)).status).toBe("TAKEN");
    expect(await generateUniqueSchoolSlug(`addr owner-b ${runId}`)).not.toBe(b.slug);

    // b takes its old code back: it is current again, and the newer one retires.
    await changeSchoolAddress(b.schoolId, b.slug, { kind: "PLATFORM", userId: b.ownerId });
    expect(await resolveSchoolCode(b.slug)).toMatchObject({ schoolId: b.schoolId, previous: false });
    expect(await resolveSchoolCode(bNew)).toMatchObject({ schoolId: b.schoolId, previous: true });
  });

  it("reserved, malformed and unchanged codes are refused", async () => {
    const a = await makeSchool("rules");
    await expect(svc.change(ctx(a.schoolId, a.ownerId), "portal", reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_RESERVED" });
    await expect(svc.change(ctx(a.schoolId, a.ownerId), "ab", reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_INVALID" });
    await expect(svc.change(ctx(a.schoolId, a.ownerId), "bad--code", reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_INVALID" });
    await expect(svc.change(ctx(a.schoolId, a.ownerId), a.slug, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_UNCHANGED" });
    expect((await svc.check(ctx(a.schoolId, a.ownerId), "cbt")).status).toBe("RESERVED");
    expect((await svc.check(ctx(a.schoolId, a.ownerId), a.slug)).status).toBe("CURRENT");
    expect((await svc.check(ctx(a.schoolId, a.ownerId), `free-${runId}`)).status).toBe("AVAILABLE");
  });

  it("limits: free in the first 30 days; then a second change inside 30 days is refused; SchoolKit's changes never count", async () => {
    const young = await makeSchool("young", { ageDays: 5 });
    await svc.change(ctx(young.schoolId, young.ownerId), `young-1-${runId}`, reqCtx);
    await svc.change(ctx(young.schoolId, young.ownerId), `young-2-${runId}`, reqCtx);
    const yDto = await svc.get(ctx(young.schoolId, young.ownerId));
    expect(yDto.canChange).toBe(true);
    expect(yDto.changesLeft).toBe(2);

    const older = await makeSchool("older");
    await svc.change(ctx(older.schoolId, older.ownerId), `older-1-${runId}`, reqCtx);
    await expect(svc.change(ctx(older.schoolId, older.ownerId), `older-2-${runId}`, reqCtx)).rejects.toMatchObject({ code: "SCHOOL_ADDRESS_LIMIT" });
    await changeSchoolAddress(older.schoolId, `older-platform-${runId}`, { kind: "PLATFORM", userId: older.ownerId });
    const oDto = await svc.get(ctx(older.schoolId, older.ownerId));
    expect(oDto.changesLeft).toBe(1);
    expect(oDto.canChange).toBe(false);
    expect(oDto.nextChangeAt).not.toBeNull();
  });
});

describe("the database keeps codes apart (triggers and RLS)", () => {
  it("a school cannot be given another school's old code, even by a direct update", async () => {
    const a = await makeSchool("trig-a");
    const b = await makeSchool("trig-b");
    await changeSchoolAddress(a.schoolId, `trig-a-new-${runId}`, { kind: "PLATFORM", userId: a.ownerId });
    await expect(basePrisma.school.update({ where: { id: b.schoolId }, data: { slug: a.slug } })).rejects.toThrow();
  });

  it("history is readable without a school, but written only under the school's own GUC", async () => {
    const a = await makeSchool("rls-a");
    const b = await makeSchool("rls-b");
    await changeSchoolAddress(a.schoolId, `rls-a-new-${runId}`, { kind: "PLATFORM", userId: a.ownerId });
    expect(await basePrisma.schoolPreviousAddress.findUnique({ where: { slug: a.slug } })).not.toBeNull();
    await expect(
      withTenant(b.schoolId, (db) => db.schoolPreviousAddress.create({ data: { schoolId: a.schoolId, slug: `forged-${runId}` } })),
    ).rejects.toThrow();
    const deleted = await withTenant(b.schoolId, (db) => db.schoolPreviousAddress.deleteMany({ where: { slug: a.slug } }));
    expect(deleted.count).toBe(0);
  });
});

describe("the school's public front page data", () => {
  it("resolves an old code to the school's current one, and shows only the school's own public details", async () => {
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const { SchoolPublicService } = await import("./school-public.service.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const storage = new StorageService(
      new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-addr-${runId}`), { baseUrl: "http://localhost:4000/api/v1", secret: "s" }),
    );
    const svc = new SchoolPublicService(storage);

    const a = await makeSchool("public");
    await basePrisma.school.update({ where: { id: a.schoolId }, data: { phone: "+2348012345678", email: "office@example.test", address: "1 School Road, Enugu" } });
    const next = `public-new-${runId}`;
    await changeSchoolAddress(a.schoolId, next, { kind: "PLATFORM", userId: a.ownerId });

    const dto = await svc.get(a.slug.toUpperCase());
    expect(dto).toMatchObject({ code: next, name: `Addr public ${runId}`, phone: "+2348012345678", email: "office@example.test", address: "1 School Road, Enugu", resultChecker: false });
    expect(Object.keys(dto).sort()).toEqual(["address", "admissionsOpen", "code", "email", "logoUrl", "motto", "name", "phone", "resultChecker", "website"]);
    // Nothing on the website yet: no sections beyond the basics.
    expect(dto.website).toMatchObject({ cover: null, about: null, events: [], announcements: [], leaders: [], preview: false });

    await expect(svc.get(`nobody-${runId}`)).rejects.toMatchObject({ httpStatus: 404 });
    await basePrisma.school.update({ where: { id: a.schoolId }, data: { suspendedAt: new Date() } });
    await expect(svc.get(next)).rejects.toMatchObject({ httpStatus: 404 });
  });
});
