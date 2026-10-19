import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AssetsService } from "./assets.service";
import { StorePricesService } from "./store-prices.service";
import { dedupeLabels, lagosDayStart, StoreService, lowStockItemCount } from "./store.service";

// The Store and the asset register (docs/modules/id-cards-and-store.md §4),
// against real Postgres: stock is the ledger's sum, nothing leaves that is not
// there, a sale bills the child, a stock take adjusts only when approved, the
// roles hold what the owner decided (answer 5), and nothing crosses schools.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Store ${label} ${runId}`,
      schoolSlug: `store-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `store-${label}-${runId}@example.test`,
      ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

describe("StoreService (integration)", () => {
  const store = new StoreService();
  const assets = new AssetsService();
  const schoolIds = new Set<string>();
  let A: {
    schoolId: string;
    ownerId: string;
    adminId: string;
    keeperId: string;
    bursarId: string;
    teacherId: string;
    child: string;
    termId: string;
  };
  let B: { schoolId: string; ownerId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: "2026/2027", startDate: day("2026-09-01"), endDate: day("2027-07-31"), isCurrent: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key, schoolId: null }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const u = await db.user.create({ data: { schoolId, email: `st-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: u.id, roleId: await role(key) } });
        return u.id;
      };
      const child = await db.student.create({
        data: { schoolId, admissionNumber: `ST-${runId}`, firstName: "Amara", lastName: "Obi", dateOfBirth: day("2013-05-06"), gender: "FEMALE" },
      });
      return {
        ...a,
        adminId: await staff("admin"),
        keeperId: await staff("storekeeper"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        child: child.id,
        termId: term.id,
      };
    });
    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = b;
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  let blazer: { id: string; size10: string; size12: string };
  let chalk: { id: string; variant: string };

  describe("items and the ledger", () => {
    it("the storekeeper adds an item with sizes, and one without", async () => {
      const item = await store.createItem(
        ctx(A.schoolId, A.keeperId),
        { name: "Blazer", code: "BLZ", category: "UNIFORM", unit: "piece", reorderLevel: 5, sellPrice: 1_500_000, variants: ["Size 10", "size 10", "Size 12"] },
        reqCtx,
      );
      expect(item.variants.map((v) => v.label)).toEqual(["Size 10", "Size 12"]);
      blazer = { id: item.id, size10: item.variants[0]!.id, size12: item.variants[1]!.id };
      const plain = await store.createItem(
        ctx(A.schoolId, A.keeperId),
        { name: "Chalk", category: "STATIONERY", unit: "box", reorderLevel: 0, variants: [] },
        reqCtx,
      );
      expect(plain.variants).toHaveLength(1);
      expect(plain.variants[0]!.label).toBeNull();
      chalk = { id: plain.id, variant: plain.variants[0]!.id };
    });

    it("refuses a second item with the same code, whatever its case", async () => {
      await expect(
        store.createItem(ctx(A.schoolId, A.keeperId), { name: "Other", code: "blz", category: "OTHER", unit: "piece", reorderLevel: 0, variants: [] }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("receiving adds stock and sets the average cost", async () => {
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: blazer.size10, quantity: 10, unitCost: 1_000_000, supplier: "Ikeja Tailors" }, reqCtx);
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: blazer.size10, quantity: 10, unitCost: 1_200_000 }, reqCtx);
      const item = await store.getItem(ctx(A.schoolId, A.bursarId), blazer.id);
      const v = item.variants.find((x) => x.id === blazer.size10)!;
      expect(v.onHand).toBe(20);
      expect(v.averageCost).toBe(1_100_000);
      expect(item.stockValue).toBe(20 * 1_100_000);
    });

    it("issues to a member of staff, and never more than is there", async () => {
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "ISSUE", variantId: blazer.size10, quantity: 2, userId: A.teacherId }, reqCtx);
      await expect(
        store.record(ctx(A.schoolId, A.keeperId), { kind: "ISSUE", variantId: blazer.size10, quantity: 99, department: "Sports" }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        store.record(ctx(A.schoolId, A.keeperId), { kind: "WRITE_OFF", variantId: blazer.size12, quantity: 1, reason: "Torn" }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("the ledger cannot be edited or deleted", async () => {
      await expect(
        withTenant(A.schoolId, (db) => db.storeMovement.updateMany({ where: { variantId: blazer.size10 }, data: { quantity: 1000 } })),
      ).rejects.toThrow(/append-only/);
      await expect(
        withTenant(A.schoolId, (db) => db.storeMovement.deleteMany({ where: { variantId: blazer.size10 } })),
      ).rejects.toThrow(/append-only/);
    });
  });

  describe("selling bills the child", () => {
    it("the bursar sells; the child gets a store charge for this term", async () => {
      const sale = await store.record(ctx(A.schoolId, A.bursarId), { kind: "SELL", variantId: blazer.size10, quantity: 2, studentId: A.child }, reqCtx);
      expect(sale).toMatchObject({ kind: "SELL", quantity: -2, unitPrice: 1_500_000, billed: true });
      expect(sale.party).toBe(`Amara Obi (ST-${runId})`);
      const charges = await withTenant(A.schoolId, (db) => db.studentCharge.findMany({ where: { studentId: A.child } }));
      expect(charges).toHaveLength(1);
      expect(charges[0]).toMatchObject({ kind: "STORE", amount: 3_000_000, termId: A.termId, sourceModule: "store", sourceId: sale.id });
      expect(charges[0]!.description).toBe("Blazer (Size 10) × 2");
    });

    it("the storekeeper cannot sell, and an unpriced item cannot be sold", async () => {
      await expect(
        store.record(ctx(A.schoolId, A.keeperId), { kind: "SELL", variantId: blazer.size10, quantity: 1, studentId: A.child }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: chalk.variant, quantity: 3 }, reqCtx);
      await expect(
        store.record(ctx(A.schoolId, A.bursarId), { kind: "SELL", variantId: chalk.variant, quantity: 1, studentId: A.child }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("a child who has left cannot be sold to", async () => {
      await withTenant(A.schoolId, (db) => db.student.update({ where: { id: A.child }, data: { status: "WITHDRAWN" } }));
      try {
        await expect(
          store.record(ctx(A.schoolId, A.bursarId), { kind: "SELL", variantId: blazer.size10, quantity: 1, studentId: A.child }, reqCtx),
        ).rejects.toMatchObject({ code: "STUDENT_LEFT" });
      } finally {
        await withTenant(A.schoolId, (db) => db.student.update({ where: { id: A.child }, data: { status: "ACTIVE" } }));
      }
    });

    it("the bursar cannot change items or receive stock", async () => {
      await expect(store.updateItem(ctx(A.schoolId, A.bursarId), blazer.id, { reorderLevel: 1 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        store.record(ctx(A.schoolId, A.bursarId), { kind: "RECEIVE", variantId: blazer.size10, quantity: 1 }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("a teacher has no store at all", async () => {
      await expect(store.listItems(ctx(A.schoolId, A.teacherId), {})).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("sales show in the sales report", async () => {
      const report = await store.salesReport(ctx(A.schoolId, A.bursarId), {});
      expect(report.totalAmount).toBe(3_000_000);
      expect(report.rows[0]).toMatchObject({ itemName: "Blazer", variantLabel: "Size 10", quantity: 2 });
    });
  });

  describe("low stock", () => {
    it("an item at or below its reorder level is low, and counted on the dashboard", async () => {
      // 20 received − 2 issued − 2 sold = 16 > 5.
      expect((await store.listItems(ctx(A.schoolId, A.adminId), { low: "true" })).map((i) => i.id)).not.toContain(blazer.id);
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "WRITE_OFF", variantId: blazer.size10, quantity: 11, reason: "Flood in the store" }, reqCtx);
      const low = await store.listItems(ctx(A.schoolId, A.adminId), { low: "true" });
      expect(low.map((i) => i.id)).toEqual([blazer.id]);
      expect(await withTenant(A.schoolId, (db) => lowStockItemCount(db))).toBe(1);
    });
  });

  describe("stock takes", () => {
    let takeId: string;

    it("counts, submits, and changes nothing until approved", async () => {
      const take = await store.startStockTake(ctx(A.schoolId, A.keeperId), {}, reqCtx);
      takeId = take.id;
      await expect(store.startStockTake(ctx(A.schoolId, A.keeperId), {}, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      const line = take.lineItems.find((l) => l.itemName === "Blazer" && l.variantLabel === "Size 10")!;
      expect(line.expected).toBe(5);
      const saved = await store.saveCounts(ctx(A.schoolId, A.keeperId), takeId, { counts: [{ lineId: line.id, counted: 3 }] });
      expect(saved.lineItems.find((l) => l.id === line.id)!.difference).toBe(-2);
      await store.submitStockTake(ctx(A.schoolId, A.keeperId), takeId, reqCtx);
      const item = await store.getItem(ctx(A.schoolId, A.keeperId), blazer.id);
      expect(item.variants.find((v) => v.id === blazer.size10)!.onHand).toBe(5);
    });

    it("the storekeeper cannot approve their own count; the bursar can", async () => {
      await expect(store.approveStockTake(ctx(A.schoolId, A.keeperId), takeId, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      // A double click: two approves at once adjust the stock once, not twice.
      const both = await Promise.allSettled([
        store.approveStockTake(ctx(A.schoolId, A.bursarId), takeId, reqCtx),
        store.approveStockTake(ctx(A.schoolId, A.bursarId), takeId, reqCtx),
      ]);
      expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const approved = (both.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ status: string }>).value;
      expect(approved.status).toBe("APPROVED");
      const adjusts = await withTenant(A.schoolId, (db) => db.storeMovement.count({ where: { stockTakeId: takeId } }));
      expect(adjusts).toBe(1);
      const item = await store.getItem(ctx(A.schoolId, A.keeperId), blazer.id);
      expect(item.variants.find((v) => v.id === blazer.size10)!.onHand).toBe(3);
      expect(item.movements[0]).toMatchObject({ kind: "ADJUST", quantity: -2 });
    });
  });

  describe("the price list for parents", () => {
    const prices = new StorePricesService();
    const parent = (schoolId: string) => ({ sessionId: "s", guardianId: "g", schoolId });

    it("shows priced items by size, available or not, and never a count; unpriced items are left out", async () => {
      const list = await prices.forParent(parent(A.schoolId));
      expect(list.shown).toBe(true);
      expect(list.items.map((i) => i.name)).toEqual(["Blazer"]); // Chalk has no selling price
      expect(list.items[0]!.sizes).toEqual([
        { label: "Size 10", price: 1_500_000, available: true },
        { label: "Size 12", price: 1_500_000, available: false },
      ]);
      expect(JSON.stringify(list)).not.toMatch(/onHand|stockValue|averageCost/);
    });

    it("owner and admin switch it off; the storekeeper and bursar cannot; parents then see nothing", async () => {
      await expect(prices.updateSettings(ctx(A.schoolId, A.keeperId), { pricesForParents: false }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(prices.updateSettings(ctx(A.schoolId, A.bursarId), { pricesForParents: false }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await prices.settings(ctx(A.schoolId, A.keeperId))).toEqual({ pricesForParents: true });
      await prices.updateSettings(ctx(A.schoolId, A.adminId), { pricesForParents: false }, reqCtx);
      expect(await prices.forParent(parent(A.schoolId))).toEqual({ shown: false, items: [] });
      await prices.updateSettings(ctx(A.schoolId, A.ownerId), { pricesForParents: true }, reqCtx);
      expect((await prices.forParent(parent(A.schoolId))).shown).toBe(true);
    });

    it("another school's parents see their own school's list only", async () => {
      expect(await prices.forParent(parent(B.schoolId))).toEqual({ shown: true, items: [] });
    });
  });

  describe("another school", () => {
    it("sees none of it and cannot move its stock", async () => {
      expect(await store.listItems(ctx(B.schoolId, B.ownerId), {})).toEqual([]);
      await expect(store.getItem(ctx(B.schoolId, B.ownerId), blazer.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        store.record(ctx(B.schoolId, B.ownerId), { kind: "RECEIVE", variantId: blazer.size10, quantity: 1 }, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("the asset register", () => {
    let projector: string;

    it("the storekeeper adds an asset; moves and condition changes become history", async () => {
      const added = await assets.create(
        ctx(A.schoolId, A.keeperId),
        { tag: "SKA/ICT/001", name: "Epson projector", category: "AUDIO_VISUAL", location: "Library", condition: "GOOD", status: "IN_USE", purchaseCost: 45_000_000, purchaseDate: "2025-01-15" },
        reqCtx,
      );
      projector = added.id;
      const moved = await assets.update(
        ctx(A.schoolId, A.keeperId),
        projector,
        { location: "JSS 2 classroom", assignedToUserId: A.teacherId, condition: "FAIR", note: "For CBT practice" },
        reqCtx,
      );
      expect(moved.assignedTo).toBe("teacher Staff");
      expect(moved.events.map((e) => e.kind).sort()).toEqual(["ADDED", "ASSIGNED", "CONDITION", "MOVED"]);
      expect(moved.events.find((e) => e.kind === "MOVED")).toMatchObject({ fromValue: "Library", toValue: "JSS 2 classroom" });
    });

    it("refuses a duplicate tag; the bursar reads but cannot change it", async () => {
      await expect(
        assets.create(ctx(A.schoolId, A.adminId), { tag: "ska/ict/001", name: "Copy", category: "ICT", condition: "GOOD", status: "IN_USE" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
      expect((await assets.list(ctx(A.schoolId, A.bursarId), {})).totalCost).toBe(45_000_000);
      await expect(assets.update(ctx(A.schoolId, A.bursarId), projector, { location: "Office" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("disposing takes it off the register's total and freezes it", async () => {
      await assets.dispose(ctx(A.schoolId, A.adminId), projector, { disposedOn: "2026-10-19", reason: "Burnt out" }, reqCtx);
      expect((await assets.list(ctx(A.schoolId, A.adminId), {})).data).toEqual([]);
      expect((await assets.list(ctx(A.schoolId, A.adminId), { status: "DISPOSED" })).data).toHaveLength(1);
      await expect(assets.update(ctx(A.schoolId, A.adminId), projector, { location: "Store" }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
      await expect(assets.get(ctx(B.schoolId, B.ownerId), projector)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("store helpers", () => {
  it("keeps one of each size, ignoring case", () => {
    expect(dedupeLabels(["Size 8", " size 8", "", "Size 10"])).toEqual(["Size 8", "Size 10"]);
  });

  it("a report day starts at midnight in Lagos", () => {
    expect(lagosDayStart("2026-10-19").toISOString()).toBe("2026-10-18T23:00:00.000Z");
    expect(lagosDayStart("2026-10-19", 1).toISOString()).toBe("2026-10-19T23:00:00.000Z");
  });
});
