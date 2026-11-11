import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, createStoreOrderSchema } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service";
import { StoreOrdersService } from "./store-orders.service";
import { StorePricesService } from "./store-prices.service";
import { StoreService } from "./store.service";

// Store orders (docs/modules/store-orders.md), against real Postgres: one
// checkout for many items, billed the way the school decided (fees invoice,
// store invoice, or paid at the counter by staff and walk-in buyers); stock
// leaves only at hand-over; a form sent twice makes one order; packs and a
// whole class in one go; cancelling undoes the bill; nothing crosses schools.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const isoDaysFromNow = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
};

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Orders ${label} ${runId}`,
      schoolSlug: `orders-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `orders-${label}-${runId}@example.test`,
      ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

describe("StoreOrdersService (integration)", () => {
  const store = new StoreService();
  const orders = new StoreOrdersService();
  const settings = new StorePricesService();
  const invoices = new InvoiceGenerationService();
  const schoolIds = new Set<string>();
  let A: {
    schoolId: string;
    ownerId: string;
    keeperId: string;
    bursarId: string;
    teacherId: string;
    armId: string;
    termId: string;
    kids: string[];
  };
  let B: { schoolId: string; ownerId: string };
  let shirt: { id: string; s8: string; s10: string };
  let book: { id: string; v: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const start = isoDaysFromNow(-30);
      const end = isoDaysFromNow(60);
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: start, endDate: end, isCurrent: true },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: start, endDate: end, isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1 Gold", code: `jss1g-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key, schoolId: null }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const u = await db.user.create({ data: { schoolId, email: `so-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: u.id, roleId: await role(key) } });
        return u.id;
      };
      const kids: string[] = [];
      for (const [i, name] of ["Ada", "Bayo", "Chidi"].entries()) {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `SO-${i}-${runId}`, firstName: name, lastName: "Pupil", dateOfBirth: new Date("2013-05-06"), gender: "FEMALE" },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED", enrolledAt: start },
        });
        kids.push(s.id);
      }
      return {
        ...a,
        keeperId: await staff("storekeeper"),
        bursarId: await staff("bursar"),
        teacherId: await staff("teacher"),
        armId: arm.id,
        termId: term.id,
        kids,
      };
    });
    B = await makeSchool("b");
    schoolIds.add(B.schoolId);

    const s = await store.createItem(
      ctx(A.schoolId, A.keeperId),
      { name: "Shirt", category: "UNIFORM", unit: "piece", reorderLevel: 0, sellPrice: 500_000, variants: ["Size 8", "Size 10"] },
      reqCtx,
    );
    shirt = { id: s.id, s8: s.variants[0]!.id, s10: s.variants[1]!.id };
    const b = await store.createItem(
      ctx(A.schoolId, A.keeperId),
      { name: "Maths textbook", category: "TEXTBOOK", unit: "copy", reorderLevel: 0, sellPrice: 300_000, variants: [] },
      reqCtx,
    );
    book = { id: b.id, v: b.variants[0]!.id };
    await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: shirt.s8, quantity: 5, unitCost: 300_000 }, reqCtx);
    await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: book.v, quantity: 20, unitCost: 200_000 }, reqCtx);
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const onHand = async (variantId: string) =>
    (await store.getItem(ctx(A.schoolId, A.ownerId), variantId === book.v ? book.id : shirt.id)).variants.find((v) => v.id === variantId)!;

  describe("checkout", () => {
    it("one order for many items goes on the fees invoice by default, and hands over only what is ticked", async () => {
      const order = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        {
          idempotencyKey: randomUUID(),
          buyer: { kind: "STUDENT", studentId: A.kids[0]! },
          lines: [
            { variantId: shirt.s8, quantity: 2, collectNow: true },
            { variantId: shirt.s10, quantity: 1, collectNow: false }, // none in stock: a pre-order
            { variantId: book.v, quantity: 1, collectNow: true },
          ],
        },
        reqCtx,
      );
      expect(order.billing).toBe("FEES_INVOICE");
      expect(order.number).toMatch(/^SO-\d{6}$/);
      expect(order.total).toBe(2 * 500_000 + 500_000 + 300_000);
      expect(order.toCollect).toBe(1);
      expect(order.invoice).toBeNull();
      const charges = await withTenant(A.schoolId, (db) =>
        db.studentCharge.findMany({ where: { studentId: A.kids[0]!, sourceModule: "store-order" } }),
      );
      expect(charges).toHaveLength(3);
      expect(charges.every((c) => c.status === "OPEN" && c.kind === "STORE" && c.termId === A.termId)).toBe(true);
      expect((await onHand(shirt.s8)).onHand).toBe(3);
      expect((await onHand(shirt.s10)).toCollect).toBe(1);
      expect((await onHand(book.v)).onHand).toBe(19);

      // The hand-over shows in the item's history with the order's number.
      const item = await store.getItem(ctx(A.schoolId, A.keeperId), shirt.id);
      expect(item.movements.find((m) => m.kind === "SELL")!.orderNumber).toBe(order.number);
    });

    it("refuses to hand over what is not on the shelf, and takes no money or stock when it does", async () => {
      await expect(
        orders.createOrder(
          ctx(A.schoolId, A.bursarId),
          { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[1]! }, lines: [{ variantId: shirt.s10, quantity: 1, collectNow: true }] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      const charges = await withTenant(A.schoolId, (db) => db.studentCharge.count({ where: { studentId: A.kids[1]! } }));
      expect(charges).toBe(0);
    });

    it("prices a cart for the till without writing anything, and says what is wrong in words", async () => {
      const ok = await orders.previewOrder(ctx(A.schoolId, A.bursarId), {
        lines: [
          { variantId: book.v, quantity: 2, collectNow: true },
          { variantId: shirt.s10, quantity: 1, collectNow: false },
        ],
      });
      expect(ok.total).toBe(2 * 300_000 + 500_000);
      expect(ok.lines.every((l) => l.problem === null)).toBe(true);
      const bad = await orders.previewOrder(ctx(A.schoolId, A.bursarId), { lines: [{ variantId: shirt.s10, quantity: 1, collectNow: true }] });
      expect(bad.total).toBeNull();
      expect(bad.lines[0]!.problem).toMatch(/Hand over now/);
      await expect(
        orders.previewOrder(ctx(A.schoolId, A.keeperId), { lines: [{ variantId: book.v, quantity: 1, collectNow: false }] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("the same form sent twice makes one order", async () => {
      const key = randomUUID();
      const input = { idempotencyKey: key, buyer: { kind: "WALK_IN" as const, name: "Mrs Bello" }, counter: { method: "CASH" as const }, lines: [{ variantId: book.v, quantity: 1, collectNow: true }] };
      const first = await orders.createOrder(ctx(A.schoolId, A.bursarId), input, reqCtx);
      const again = await orders.createOrder(ctx(A.schoolId, A.bursarId), input, reqCtx);
      expect(again.id).toBe(first.id);
      expect(again.replayed).toBe(true);
      expect(first.replayed).toBe(false);
      expect((await onHand(book.v)).onHand).toBe(18);
    });

    it("a walk-in buyer and a member of staff pay at the counter: no invoice, no charge", async () => {
      const walkIn = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "WALK_IN", name: null }, counter: { method: "POS", reference: "T-991" }, lines: [{ variantId: book.v, quantity: 2, collectNow: true }] },
        reqCtx,
      );
      expect(walkIn.billing).toBe("COUNTER");
      expect(walkIn.buyerName).toBe("Walk-in buyer");
      expect(walkIn.counterMethod).toBe("POS");
      const staffOrder = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "STAFF", userId: A.teacherId }, counter: { method: "BANK_TRANSFER" }, lines: [{ variantId: book.v, quantity: 1, collectNow: true }] },
        reqCtx,
      );
      expect(staffOrder.buyerName).toBe("teacher Staff");
      const item = await store.getItem(ctx(A.schoolId, A.keeperId), book.id);
      expect(item.movements.some((m) => m.party === "Walk-in buyer")).toBe(true);
    });

    it("the request shape keeps students billed and everyone else paying", () => {
      const base = { idempotencyKey: randomUUID(), lines: [{ variantId: book.v, quantity: 1, collectNow: true }] };
      expect(createStoreOrderSchema.safeParse({ ...base, buyer: { kind: "WALK_IN" } }).success).toBe(false);
      expect(createStoreOrderSchema.safeParse({ ...base, buyer: { kind: "STUDENT", studentId: A.kids[0] }, counter: { method: "CASH" } }).success).toBe(false);
      expect(
        createStoreOrderSchema.safeParse({ ...base, buyer: { kind: "WALK_IN" }, counter: { method: "CASH" }, billing: "STORE_INVOICE" }).success,
      ).toBe(false);
    });

    it("only sellers sell: the storekeeper and a teacher are refused", async () => {
      for (const who of [A.keeperId, A.teacherId]) {
        await expect(
          orders.createOrder(
            ctx(A.schoolId, who),
            { idempotencyKey: randomUUID(), buyer: { kind: "WALK_IN" }, counter: { method: "CASH" }, lines: [{ variantId: book.v, quantity: 1, collectNow: true }] },
            reqCtx,
          ),
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("billing as the school decides", () => {
    it("a seller cannot choose a store invoice until the school allows it", async () => {
      await expect(
        orders.createOrder(
          ctx(A.schoolId, A.bursarId),
          { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[1]! }, billing: "STORE_INVOICE", lines: [{ variantId: book.v, quantity: 1, collectNow: true }] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("only the owner and admins change how the store bills", async () => {
      await expect(settings.updateSettings(ctx(A.schoolId, A.bursarId), { sellerMayChooseBilling: true }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      const s = await settings.updateSettings(ctx(A.schoolId, A.ownerId), { billingDefault: "STORE_INVOICE", sellerMayChooseBilling: true }, reqCtx);
      expect(s).toEqual({ pricesForParents: true, billingDefault: "STORE_INVOICE", sellerMayChooseBilling: true });
      const c = await orders.checkoutContext(ctx(A.schoolId, A.bursarId));
      expect(c).toEqual({ billingDefault: "STORE_INVOICE", sellerMayChooseBilling: true, mayRecordPayment: true });
    });

    it("a store invoice is issued at once, before any fees invoice, carrying exactly the order", async () => {
      const order = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[1]! }, lines: [{ variantId: book.v, quantity: 2, collectNow: true }] },
        reqCtx,
      );
      expect(order.billing).toBe("STORE_INVOICE");
      expect(order.invoice).toMatchObject({ totalDue: 600_000, totalPaid: 0, status: "ISSUED" });
      const inv = await withTenant(A.schoolId, (db) => db.invoice.findUniqueOrThrow({ where: { id: order.invoice!.id } }));
      expect(inv.sequence).toBe(1);
      expect(inv.classArmId).toBe(A.armId);
      const billed = await withTenant(A.schoolId, (db) => db.studentCharge.findMany({ where: { invoiceId: inv.id } }));
      expect(billed.map((c) => c.status)).toEqual(["BILLED"]);

      // The fees invoice made later is still sequence 0 and does not carry it.
      const gen = await invoices.generateForArm(ctx(A.schoolId, A.ownerId), { classArmId: A.armId, termId: A.termId }, reqCtx);
      expect(gen.created).toBeGreaterThan(0);
      const feeInvoice = await withTenant(A.schoolId, (db) =>
        db.invoice.findFirstOrThrow({ where: { studentId: A.kids[1]!, termId: A.termId, sequence: 0 } }),
      );
      expect(feeInvoice.totalDue).toBe(0);
    });

    it("with the choice allowed, the seller can still put an order on the fees invoice", async () => {
      const order = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[2]! }, billing: "FEES_INVOICE", lines: [{ variantId: book.v, quantity: 1, collectNow: false }] },
        reqCtx,
      );
      expect(order.billing).toBe("FEES_INVOICE");
      expect(order.invoice).toBeNull();
    });
  });

  describe("collection", () => {
    it("hands over what is owed when it arrives, never more", async () => {
      const [order] = await orders.listOrders(ctx(A.schoolId, A.keeperId), { toCollect: "true", studentId: A.kids[0]! });
      const full = await orders.getOrder(ctx(A.schoolId, A.keeperId), order!.id);
      const line = full.lines.find((l) => l.toCollect > 0)!;
      await expect(
        orders.collect(ctx(A.schoolId, A.keeperId), full.id, { lines: [{ lineId: line.id, quantity: 1 }] }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError); // Size 10 not delivered yet
      await store.record(ctx(A.schoolId, A.keeperId), { kind: "RECEIVE", variantId: shirt.s10, quantity: 4 }, reqCtx);
      await expect(
        orders.collect(ctx(A.schoolId, A.keeperId), full.id, { lines: [{ lineId: line.id, quantity: 2 }] }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
      const after = await orders.collect(ctx(A.schoolId, A.keeperId), full.id, { lines: [{ lineId: line.id, quantity: 1 }] }, reqCtx);
      expect(after.toCollect).toBe(0);
      expect((await onHand(shirt.s10)).onHand).toBe(3);
      expect((await onHand(shirt.s10)).toCollect).toBe(0);
      const left = await orders.listOrders(ctx(A.schoolId, A.keeperId), { toCollect: "true", studentId: A.kids[0]! });
      expect(left).toHaveLength(0);
    });

    it("a teacher cannot hand over", async () => {
      const [order] = await orders.listOrders(ctx(A.schoolId, A.ownerId), { toCollect: "true" });
      await expect(
        orders.collect(ctx(A.schoolId, A.teacherId), order!.id, { lines: [{ lineId: randomUUID(), quantity: 1 }] }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("cancelling", () => {
    it("voids the open charges of a fees-invoice order nothing of which was handed over", async () => {
      const [order] = await orders.listOrders(ctx(A.schoolId, A.bursarId), { studentId: A.kids[2]! });
      const done = await orders.cancel(ctx(A.schoolId, A.bursarId), order!.id, { reason: "Wrong child" }, reqCtx);
      expect(done.status).toBe("CANCELLED");
      expect(done.toCollect).toBe(0);
      const charges = await withTenant(A.schoolId, (db) => db.studentCharge.findMany({ where: { studentId: A.kids[2]!, sourceModule: "store-order" } }));
      expect(charges.every((c) => c.status === "VOID")).toBe(true);
    });

    it("cancels an unpaid store invoice with the order, in one step", async () => {
      const order = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[2]! }, lines: [{ variantId: book.v, quantity: 1, collectNow: false }] },
        reqCtx,
      );
      await orders.cancel(ctx(A.schoolId, A.bursarId), order.id, { reason: "Changed mind" }, reqCtx);
      const inv = await withTenant(A.schoolId, (db) => db.invoice.findUniqueOrThrow({ where: { id: order.invoice!.id } }));
      expect(inv.status).toBe("CANCELLED");
      const open = await withTenant(A.schoolId, (db) =>
        db.studentCharge.count({ where: { studentId: A.kids[2]!, status: "OPEN" } }),
      );
      expect(open).toBe(0);
    });

    it("refuses once something was handed over", async () => {
      const [order] = await orders.listOrders(ctx(A.schoolId, A.bursarId), { studentId: A.kids[0]! });
      await expect(orders.cancel(ctx(A.schoolId, A.bursarId), order!.id, { reason: "x" }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("refuses once a fees-invoice order is on an invoice", async () => {
      await settings.updateSettings(ctx(A.schoolId, A.ownerId), { billingDefault: "FEES_INVOICE" }, reqCtx);
      const order = await orders.createOrder(
        ctx(A.schoolId, A.bursarId),
        { idempotencyKey: randomUUID(), buyer: { kind: "STUDENT", studentId: A.kids[2]! }, lines: [{ variantId: book.v, quantity: 1, collectNow: false }] },
        reqCtx,
      );
      await invoices.billWaitingCharges(ctx(A.schoolId, A.ownerId), { termId: A.termId }, reqCtx);
      await expect(orders.cancel(ctx(A.schoolId, A.bursarId), order.id, { reason: "x" }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      expect((await orders.getOrder(ctx(A.schoolId, A.bursarId), order.id)).status).toBe("ACTIVE");
    });
  });

  describe("packs and a whole class", () => {
    let packId: string;

    it("the storekeeper saves a pack; names are unique", async () => {
      const pack = await orders.savePack(
        ctx(A.schoolId, A.keeperId),
        null,
        { name: "JSS1 starter pack", items: [{ itemId: shirt.id, quantity: 2 }, { itemId: book.id, quantity: 1 }] },
        reqCtx,
      );
      packId = pack.id;
      expect(pack.items).toHaveLength(2);
      expect(pack.fixedTotal).toBe(2 * 500_000 + 300_000); // both sizes cost the same
      await expect(
        orders.savePack(ctx(A.schoolId, A.keeperId), null, { name: "jss1 STARTER pack", items: [{ itemId: book.id, quantity: 1 }] }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
      await expect(
        orders.savePack(ctx(A.schoolId, A.bursarId), null, { name: "Other", items: [{ itemId: book.id, quantity: 1 }] }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("sells the pack to the class, each child in their size, waiting to be collected", async () => {
      const preview = await orders.previewClassSale(ctx(A.schoolId, A.bursarId), { classArmId: A.armId, packId });
      expect(preview.children).toHaveLength(3);
      expect(preview.children.every((c) => !c.alreadyBought)).toBe(true);

      const key = randomUUID();
      const children = A.kids.slice(0, 2).map((studentId, i) => ({ studentId, sizes: [{ itemId: shirt.id, variantId: i === 0 ? shirt.s8 : shirt.s10 }] }));
      await expect(
        orders.createClassSale(ctx(A.schoolId, A.bursarId), { idempotencyKey: randomUUID(), classArmId: A.armId, packId, children: [{ studentId: A.kids[0]!, sizes: [] }] }, reqCtx),
      ).rejects.toBeInstanceOf(ValidationError); // the shirt needs a size
      const before = (await onHand(shirt.s8)).onHand;
      const sale = await orders.createClassSale(ctx(A.schoolId, A.bursarId), { idempotencyKey: key, classArmId: A.armId, packId, children }, reqCtx);
      expect(sale).toMatchObject({ orders: 2, total: 2 * 1_300_000, replayed: false });
      const again = await orders.createClassSale(ctx(A.schoolId, A.bursarId), { idempotencyKey: key, classArmId: A.armId, packId, children }, reqCtx);
      expect(again).toMatchObject({ orders: 2, replayed: true });
      expect((await onHand(shirt.s8)).onHand).toBe(before); // nothing handed over yet
      expect((await onHand(shirt.s8)).toCollect).toBe(2);

      const listed = await orders.listOrders(ctx(A.schoolId, A.keeperId), { classSaleId: key });
      expect(listed.map((o) => o.packName)).toEqual(["JSS1 starter pack", "JSS1 starter pack"]);
      const after = await orders.previewClassSale(ctx(A.schoolId, A.bursarId), { classArmId: A.armId, packId });
      expect(after.children.filter((c) => c.alreadyBought)).toHaveLength(2);
    });

    it("refuses a child who is not in the class", async () => {
      const outsider = await withTenant(A.schoolId, (db) =>
        db.student.create({ data: { schoolId: A.schoolId, admissionNumber: `OUT-${runId}`, firstName: "Out", lastName: "Sider", dateOfBirth: new Date("2013-01-01"), gender: "MALE" } }),
      );
      await expect(
        orders.createClassSale(
          ctx(A.schoolId, A.bursarId),
          { idempotencyKey: randomUUID(), classArmId: A.armId, packId, children: [{ studentId: outsider.id, sizes: [{ itemId: shirt.id, variantId: shirt.s8 }] }] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("takings and tenancy", () => {
    it("sums active orders by how they were billed", async () => {
      const report = await orders.takingsReport(ctx(A.schoolId, A.keeperId), {});
      const counter = report.rows.filter((r) => r.billing === "COUNTER");
      expect(counter.map((r) => r.counterMethod).sort()).toEqual(["BANK_TRANSFER", "CASH", "POS"]);
      expect(report.rows.find((r) => r.billing === "STORE_INVOICE")!.amount).toBe(600_000); // the cancelled one is out
      expect(report.totalAmount).toBe(report.rows.reduce((s, r) => s + r.amount, 0));
    });

    it("another school sees none of it", async () => {
      expect(await orders.listOrders(ctx(B.schoolId, B.ownerId), {})).toEqual([]);
      const [order] = await orders.listOrders(ctx(A.schoolId, A.ownerId), {});
      await expect(orders.getOrder(ctx(B.schoolId, B.ownerId), order!.id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        orders.createOrder(
          ctx(B.schoolId, B.ownerId),
          { idempotencyKey: randomUUID(), buyer: { kind: "WALK_IN" }, counter: { method: "CASH" }, lines: [{ variantId: book.v, quantity: 1, collectNow: false }] },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
