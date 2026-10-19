import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";

import { AuthService } from "../auth/auth.service";
import { idCardToken } from "./id-card-token";
import { IdCardsService, formatCardNumber, lagosToday, verdictFor } from "./id-cards.service";

// ID cards (docs/modules/id-cards-and-store.md §3), against real Postgres:
// one active card per person per session, reissue replaces, the QR check
// says what a scan should say, and nothing beyond the card's front leaves.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Cards ${label} ${runId}`,
      schoolSlug: `cards-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `cards-${label}-${runId}@example.test`,
      ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({
    where: { id: signed.school.id },
    data: { status: "ACTIVE", onboardingStep: 5, address: "12 Allen Avenue, Ikeja", phone: "08030000000" },
  });
  return { schoolId: signed.school.id, ownerId: signed.user.id, slug: `cards-${label}-${runId}` };
}

describe("IdCardsService (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "id-cards-"));
  const service = new IdCardsService(new StorageService(new FilesystemStorageDriver(storageRoot)));
  const schoolIds = new Set<string>();
  let A: { schoolId: string; ownerId: string; slug: string; adminId: string; teacherId: string; child: string; yearId: string };
  let B: { schoolId: string; ownerId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: "2026/2027", startDate: day("2026-09-01"), endDate: day("2099-07-31"), isCurrent: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1 Gold", code: `ic-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key, schoolId: null }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const u = await db.user.create({ data: { schoolId, email: `ic-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: u.id, roleId: await role(key) } });
        return u.id;
      };
      const child = await db.student.create({
        data: { schoolId, admissionNumber: `IC-${runId}`, firstName: "Amara", lastName: "Obi", dateOfBirth: day("2013-05-06"), gender: "FEMALE", address: "4 Secret Close" },
      });
      await db.enrollment.create({ data: { schoolId, studentId: child.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" } });
      return {
        ...a,
        adminId: await staff("admin"),
        teacherId: await staff("teacher"),
        child: child.id,
        yearId: year.id,
      };
    });
    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = b;
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  let cardId: string;

  it("issues one card per student for the current session, and not twice", async () => {
    const first = await service.issue(ctx(A.schoolId, A.adminId), { kind: "STUDENT", holderIds: [A.child] }, reqCtx);
    expect(first).toEqual({ issued: 1, skipped: 0 });
    const again = await service.issue(ctx(A.schoolId, A.adminId), { kind: "STUDENT", holderIds: [A.child] }, reqCtx);
    expect(again).toEqual({ issued: 0, skipped: 1 });
    const list = await service.list(ctx(A.schoolId, A.adminId), { kind: "STUDENT" });
    const row = list.data.find((r) => r.holderId === A.child)!;
    expect(list.academicYear?.label).toBe("2026/2027");
    expect(row).toMatchObject({ name: "Amara Obi", detail: "JSS1 Gold", hasPhoto: false });
    expect(row.card?.cardNumber).toBe("ID-2026-00001");
    cardId = row.card!.id;
  });

  it("issues staff cards with the next number", async () => {
    await service.issue(ctx(A.schoolId, A.ownerId), { kind: "STAFF", holderIds: [A.teacherId] }, reqCtx);
    const staff = await service.list(ctx(A.schoolId, A.ownerId), { kind: "STAFF" });
    const row = staff.data.find((r) => r.holderId === A.teacherId)!;
    expect(row.card?.cardNumber).toBe("ID-2026-00002");
    expect(row.detail).toBe("Teacher");
  });

  it("prints only what the card shows: no date of birth or home address", async () => {
    const printed = await service.print(ctx(A.schoolId, A.adminId), [cardId]);
    expect(printed.school).toMatchObject({ address: "12 Allen Avenue, Ikeja", phone: "08030000000" });
    expect(printed.cards[0]).toMatchObject({ name: "Amara Obi", number: `IC-${runId}`, validFor: "2026/2027" });
    expect(printed.cards[0]!.verifyUrl).toContain(`/id/${A.slug}.${cardId}.`);
    const text = JSON.stringify(printed);
    expect(text).not.toContain("2013-05-06");
    expect(text).not.toContain("Secret Close");
  });

  it("a teacher cannot list, issue or print", async () => {
    await expect(service.list(ctx(A.schoolId, A.teacherId), { kind: "STUDENT" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.issue(ctx(A.schoolId, A.teacherId), { kind: "STUDENT", holderIds: [A.child] }, reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.print(ctx(A.schoolId, A.teacherId), [cardId])).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("another school cannot see or issue for this child", async () => {
    await expect(service.print(ctx(B.schoolId, B.ownerId), [cardId])).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.issue(ctx(B.schoolId, B.ownerId), { kind: "STUDENT", holderIds: [A.child] }, reqCtx),
    ).rejects.toBeInstanceOf(ValidationError); // B has no session, so nothing is read at all
  });

  it("the QR check says valid, with the front's details only", async () => {
    const check = await service.verify(idCardToken(A.slug, cardId));
    expect(check).toMatchObject({ verdict: "VALID", name: "Amara Obi", detail: "JSS1 Gold", kind: "STUDENT" });
    expect(JSON.stringify(check)).not.toContain(`IC-${runId}`);
  });

  it("a forged or wrong-school code is refused", async () => {
    await expect(service.verify(`${A.slug}.${cardId}.AAAAAAAAAAAAAAAAAAAAAA`)).rejects.toBeInstanceOf(NotFoundError);
    const otherSlug = (await basePrisma.school.findUniqueOrThrow({ where: { id: B.schoolId } })).slug;
    await expect(service.verify(idCardToken(otherSlug, cardId))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("reissuing a lost card replaces it; the old code then says replaced", async () => {
    const fresh = await service.reissue(ctx(A.schoolId, A.adminId), cardId, "Lost on the bus", reqCtx);
    expect((await service.verify(idCardToken(A.slug, cardId))).verdict).toBe("REPLACED");
    expect((await service.verify(idCardToken(A.slug, fresh.id))).verdict).toBe("VALID");
    const audit = await withTenant(A.schoolId, (db) => db.auditLog.findFirst({ where: { action: "id-card.reissue", entityId: fresh.id } }));
    expect(audit?.metadata).toMatchObject({ replaces: "ID-2026-00001", cardNumber: "ID-2026-00003" });
    await expect(service.cancel(ctx(A.schoolId, A.adminId), cardId, "x", reqCtx)).rejects.toBeInstanceOf(ValidationError);

    const mine = await service.mineAsStudent(A.schoolId, A.child);
    expect(mine.card?.id).toBe(fresh.id);

    await service.cancel(ctx(A.schoolId, A.adminId), fresh.id, "Left the school", reqCtx);
    expect((await service.verify(idCardToken(A.slug, fresh.id))).verdict).toBe("CANCELLED");
    expect((await service.mineAsStudent(A.schoolId, A.child)).card).toBeNull();
  });

  it("a staff member sees their own card", async () => {
    const mine = await service.mineAsStaff(ctx(A.schoolId, A.teacherId));
    expect(mine.card?.cardNumber).toBe("ID-2026-00002");
  });
});

describe("ID card rules", () => {
  it("a card past its session reads expired", () => {
    expect(verdictFor("ACTIVE", "2027-07-31", "2027-07-31")).toBe("VALID");
    expect(verdictFor("ACTIVE", "2027-07-31", "2027-08-01")).toBe("EXPIRED");
    expect(verdictFor("CANCELLED", "2099-01-01", "2027-01-01")).toBe("CANCELLED");
  });

  it("numbers by session year and running count; Lagos date is UTC+1", () => {
    expect(formatCardNumber(day("2026-09-01"), 42)).toBe("ID-2026-00042");
    expect(lagosToday(new Date("2026-10-19T23:30:00.000Z"))).toBe("2026-10-20");
  });
});
