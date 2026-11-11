import { randomUUID } from "node:crypto";

import { Injectable, Optional } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  formatStoreOrderNumber,
  lagosTodayIso,
  MAX_STUDENT_CHARGE_KOBO,
  NotFoundError,
  ValidationError,
  type CancelStoreOrderInput,
  type ClassSalePreviewDto,
  type ClassSaleResultDto,
  type CollectStoreOrderInput,
  type CreateClassSaleInput,
  type CreateStoreOrderInput,
  type ListStoreOrdersQuery,
  type PreviewClassSaleInput,
  type PreviewStoreOrderInput,
  type StoreOrderPreviewDto,
  type SavePackInput,
  type StoreCheckoutContextDto,
  type StoreCounterMethod,
  type StoreOrderDto,
  type StoreOrderLineDto,
  type StoreOrderSummaryDto,
  type StorePackDto,
  type StoreReportRangeQuery,
  type StoreStudentBilling,
  type StoreTakingsReportDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { StudentChargeService, type ChargeActor } from "../finance/student-charge.service.js";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service.js";
import { chargeTermFor } from "../library/library-fines.js";
import { audit, lagosDayStart, stockByVariant, variantName } from "./store.service.js";
import { assertAnyOf, holds, staffNames, type RequestContext } from "./store.shared.js";

// Store orders (2026-11-11, docs/modules/store-orders.md).
//
// A sale is an ORDER: one buyer, many lines, one total. How it is billed:
//   * a student, FEES_INVOICE: one STORE charge per line, riding on the fees
//     invoice like every other charge (the single sale of 2026-10-19);
//   * a student, STORE_INVOICE: the same charges, billed at once onto an
//     invoice of their own through InvoiceGenerationService — the family pays
//     it like any invoice (recorded at the counter through /payments/manual,
//     or online). The school sets the default and whether the seller may
//     choose (schools.store_billing_*);
//   * a member of staff or a walk-in buyer: paid at the counter (COUNTER),
//     recorded on the order. These are store takings, not fee payments: no
//     invoice, no payment row.
// Stock leaves only when a line is handed over, as a SELL movement tied to the
// line, so a pre-order (uniforms not yet delivered) can be taken and handed
// over when the stock arrives. Prices come from the item, never the client.
//
// Every order write runs under a per-school advisory lock, which numbers the
// order (SO-000042) and makes the idempotency check race-free: a checkout form
// sent twice makes one order.

const CHARGE_SOURCE = "store-order";

interface DraftLine {
  variantId: string;
  quantity: number;
  collectNow: boolean;
}

interface OrderDraft {
  buyer: "STUDENT" | "STAFF" | "WALK_IN";
  studentId: string | null;
  userId: string | null;
  buyerName: string | null;
  billing: "FEES_INVOICE" | "STORE_INVOICE" | "COUNTER";
  counterMethod: StoreCounterMethod | null;
  counterReference: string | null;
  term: { id: string; academicYearId: string } | null;
  classArmId: string | null;
  packId: string | null;
  classSaleId: string | null;
  note: string | null;
  idempotencyKey: string | null;
  lines: DraftLine[];
}

@Injectable()
export class StoreOrdersService {
  constructor(
    @Optional() private readonly charges: StudentChargeService = new StudentChargeService(),
    @Optional() private readonly invoices: InvoiceGenerationService = new InvoiceGenerationService(undefined, charges),
  ) {}

  // ------------------------------------------------------------- checkout

  async checkoutContext(authCtx: AuthContext): Promise<StoreCheckoutContextDto> {
    const perms = await assertAnyOf(authCtx, "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const s = await this.billingSettings(db, authCtx.schoolId);
      return { ...s, mayRecordPayment: holds(perms, "payment.record") };
    });
  }

  async createOrder(authCtx: AuthContext, input: CreateStoreOrderInput, reqCtx: RequestContext): Promise<StoreOrderDto> {
    await assertAnyOf(authCtx, "store.sell");
    const result = await withTenant(authCtx.schoolId, async (db) => {
      await lockSchoolOrders(db, authCtx.schoolId);
      const prior = await db.storeOrder.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (prior) return { id: prior.id, replayed: true };

      const draft: OrderDraft = {
        buyer: input.buyer.kind,
        studentId: null,
        userId: null,
        buyerName: null,
        billing: "COUNTER",
        counterMethod: null,
        counterReference: null,
        term: null,
        classArmId: null,
        packId: input.packId ?? null,
        classSaleId: null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        lines: input.lines,
      };
      if (input.buyer.kind === "STUDENT") {
        const student = await db.student.findUnique({ where: { id: input.buyer.studentId }, select: { status: true } });
        if (!student) throw new NotFoundError("Student not found.");
        if (student.status !== "ACTIVE") throw new ConflictError("STUDENT_LEFT", "This student is no longer at the school.");
        draft.studentId = input.buyer.studentId;
        draft.billing = await this.chooseBilling(db, authCtx.schoolId, input.billing);
        draft.term = await currentChargeTerm(db);
        draft.classArmId = await armFor(db, input.buyer.studentId, draft.term.id);
      } else {
        if (input.buyer.kind === "STAFF") {
          const user = await db.user.findUnique({ where: { id: input.buyer.userId }, select: { isActive: true } });
          if (!user || !user.isActive) throw new NotFoundError("Staff member not found.");
          draft.userId = input.buyer.userId;
        } else {
          draft.buyerName = input.buyer.name ?? null;
        }
        draft.counterMethod = input.counter!.method;
        draft.counterReference = input.counter!.reference ?? null;
      }
      if (draft.packId) await this.assertPack(db, draft.packId);
      const id = await this.writeOrder(db, authCtx, reqCtx, draft);
      return { id, replayed: false };
    });
    const dto = await withTenant(authCtx.schoolId, (db) => this.orderDto(db, result.id));
    return { ...dto, replayed: result.replayed };
  }

  /** Prices and stock for a cart, so the till shows the server's total. Writes nothing. */
  async previewOrder(authCtx: AuthContext, input: PreviewStoreOrderInput): Promise<StoreOrderPreviewDto> {
    await assertAnyOf(authCtx, "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const ids = input.lines.map((l) => l.variantId);
      const variants = await db.storeItemVariant.findMany({ where: { id: { in: ids } }, include: { item: true } });
      const byId = new Map(variants.map((v) => [v.id, v]));
      const stock = await stockByVariant(db, ids);
      const lines = input.lines.map((l) => {
        const v = byId.get(l.variantId);
        if (!v) return { variantId: l.variantId, name: "Unknown item", unitPrice: null, amount: null, onHand: 0, problem: "Item not found." };
        const name = variantName(v.item, v.label);
        const onHand = stock.get(v.id)?.onHand ?? 0;
        const unitPrice = v.sellPrice ?? v.item.sellPrice;
        const amount = unitPrice === null ? null : unitPrice * l.quantity;
        let problem: string | null = null;
        if (!v.item.isActive || !v.isActive) problem = "No longer stocked.";
        else if (unitPrice === null) problem = "Has no selling price yet.";
        else if (amount! > MAX_STUDENT_CHARGE_KOBO) problem = "Too many for one bill.";
        else if (l.collectNow && onHand < l.quantity) problem = `Only ${onHand} in the store. Untick "Hand over now" to hand it over later.`;
        return { variantId: v.id, name, unitPrice, amount, onHand, problem };
      });
      const ok = lines.every((l) => l.problem === null);
      const total = ok ? lines.reduce((sum, l) => sum + l.amount!, 0) : null;
      return { lines, total: total !== null && total > MAX_STUDENT_CHARGE_KOBO ? null : total };
    });
  }

  // -------------------------------------------------------------- orders

  async listOrders(authCtx: AuthContext, query: ListStoreOrdersQuery): Promise<StoreOrderSummaryDto[]> {
    await assertAnyOf(authCtx, "store.read", "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const q = query.q?.trim();
      const numberQ = q ? Number(q.replace(/^so-?/i, "")) : NaN;
      let buyerStudentIds: string[] | undefined;
      let buyerUserIds: string[] | undefined;
      if (q && !Number.isInteger(numberQ)) {
        const like = { contains: q, mode: "insensitive" as const };
        buyerStudentIds = (
          await db.student.findMany({
            where: { OR: [{ firstName: like }, { lastName: like }, { admissionNumber: like }] },
            select: { id: true },
            take: 200,
          })
        ).map((s) => s.id);
        buyerUserIds = (
          await db.user.findMany({ where: { OR: [{ firstName: like }, { lastName: like }] }, select: { id: true }, take: 200 })
        ).map((u) => u.id);
      }
      const where: Prisma.StoreOrderWhereInput = {
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(query.classSaleId ? { classSaleId: query.classSaleId } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: lagosDayStart(query.from) } : {}),
                ...(query.to ? { lt: lagosDayStart(query.to, 1) } : {}),
              },
            }
          : {}),
        ...(q
          ? Number.isInteger(numberQ)
            ? { number: numberQ }
            : {
                OR: [
                  { studentId: { in: buyerStudentIds! } },
                  { userId: { in: buyerUserIds! } },
                  { buyerName: { contains: q, mode: "insensitive" } },
                ],
              }
          : {}),
      };
      if (query.toCollect === "true") {
        const open = await db.$queryRaw<{ order_id: string }[]>`
          SELECT DISTINCT l.order_id FROM store_order_lines l
            JOIN store_orders o ON o.id = l.order_id
           WHERE o.status = 'ACTIVE' AND l.collected < l.quantity`;
        where.id = { in: open.map((r) => r.order_id) };
        where.status = "ACTIVE";
      }
      const rows = await db.storeOrder.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: "desc" },
        take: 300,
      });
      return this.summaries(db, rows);
    });
  }

  async getOrder(authCtx: AuthContext, id: string): Promise<StoreOrderDto> {
    await assertAnyOf(authCtx, "store.read", "store.sell");
    return withTenant(authCtx.schoolId, (db) => this.orderDto(db, id));
  }

  /** Hands over some or all of what is still owed on an order. */
  async collect(authCtx: AuthContext, id: string, input: CollectStoreOrderInput, reqCtx: RequestContext): Promise<StoreOrderDto> {
    await assertAnyOf(authCtx, "store.manage", "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const order = await lockOrder(db, id);
      if (order.status !== "ACTIVE") throw new ConflictError("ORDER_CANCELLED", "This order was cancelled.");
      const lines = await db.storeOrderLine.findMany({
        where: { orderId: id },
        include: { item: { select: { name: true, unit: true } }, variant: { select: { label: true } } },
      });
      const byId = new Map(lines.map((l) => [l.id, l]));
      const wanted = new Map<string, number>();
      for (const w of input.lines) {
        if (!byId.has(w.lineId)) throw new NotFoundError("That item is not on this order.");
        wanted.set(w.lineId, (wanted.get(w.lineId) ?? 0) + w.quantity);
      }
      await lockVariants(db, [...wanted.keys()].map((lineId) => byId.get(lineId)!.variantId));
      const stock = await stockByVariant(db, [...new Set(lines.map((l) => l.variantId))]);
      const takenNow = new Map<string, number>();
      for (const [lineId, q] of wanted) {
        const line = byId.get(lineId)!;
        const left = line.quantity - line.collected;
        if (q > left) {
          throw new ValidationError("NOTHING_TO_COLLECT", `Only ${left} of ${variantName(line.item, line.variant.label)} is still to hand over.`);
        }
        const onHand = (stock.get(line.variantId)?.onHand ?? 0) - (takenNow.get(line.variantId) ?? 0);
        if (onHand < q) {
          throw new ValidationError("NOT_ENOUGH_STOCK", `Only ${onHand} of ${variantName(line.item, line.variant.label)} in the store.`);
        }
        takenNow.set(line.variantId, (takenNow.get(line.variantId) ?? 0) + q);
      }
      for (const [lineId, q] of wanted) {
        await this.handOver(db, authCtx, reqCtx, order, byId.get(lineId)!, q);
      }
      await audit(db, authCtx, "store.order.collect", "store_order", id, reqCtx, {
        lines: [...wanted].map(([lineId, quantity]) => ({ lineId, quantity })),
      });
      return this.orderDto(db, id);
    });
  }

  /**
   * Cancels an order nothing of which has been handed over. A fees-invoice
   * order's charges are voided while still OPEN; once on an invoice, the
   * bursar cancels that invoice first. A store invoice with no payment is
   * cancelled here, in the same transaction. Counter money is the seller's to
   * give back; the order records why.
   */
  async cancel(authCtx: AuthContext, id: string, input: CancelStoreOrderInput, reqCtx: RequestContext): Promise<StoreOrderDto> {
    await assertAnyOf(authCtx, "store.sell");
    const actor = actorOf(authCtx, reqCtx);
    let cancelledInvoice: string | null = null;
    const dto = await withTenant(authCtx.schoolId, async (db) => {
      const order = await lockOrder(db, id);
      if (order.status !== "ACTIVE") throw new ConflictError("ORDER_CANCELLED", "This order is already cancelled.");
      const lines = await db.storeOrderLine.findMany({ where: { orderId: id } });
      if (lines.some((l) => l.collected > 0)) {
        throw new ConflictError(
          "ORDER_HANDED_OVER",
          "Some of this order was handed over. Take those items back as a return on the item's page, and sort out any money under Bursary.",
        );
      }
      if (order.billing === "STORE_INVOICE" && order.invoiceId) {
        const invoice = await db.invoice.findUnique({ where: { id: order.invoiceId }, select: { status: true } });
        if (invoice && invoice.status !== "CANCELLED") {
          if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID" || invoice.status === "REFUNDED") {
            throw new ConflictError(
              "ORDER_PAID",
              "The store invoice for this order has a payment. Reverse the payment under Bursary first.",
            );
          }
          await this.invoices.cancelInTransaction(db, actor, order.invoiceId);
          cancelledInvoice = order.invoiceId;
        }
      }
      for (const line of lines) {
        if (!line.chargeId) continue;
        const outcome = await this.charges.voidBySource(db, actor, {
          sourceModule: CHARGE_SOURCE,
          sourceId: line.id,
          reason: `Store order ${formatStoreOrderNumber(order.number)} cancelled: ${input.reason}`.slice(0, 200),
        });
        if (outcome === "billed") {
          throw new ConflictError(
            "ORDER_INVOICED",
            "This order is already on the child's fees invoice. The bursar cancels that invoice under Bursary first, or keeps the order.",
          );
        }
      }
      await db.storeOrder.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: authCtx.userId, cancelReason: input.reason },
      });
      await audit(db, authCtx, "store.order.cancel", "store_order", id, reqCtx, {
        number: order.number,
        billing: order.billing,
        total: order.total,
        ...(cancelledInvoice ? { invoiceId: cancelledInvoice } : {}),
      });
      return this.orderDto(db, id);
    });
    if (cancelledInvoice) await this.invoices.archivePendingLinks(authCtx.schoolId, cancelledInvoice);
    return dto;
  }

  // --------------------------------------------------------------- packs

  async listPacks(authCtx: AuthContext, includeInactive: boolean): Promise<StorePackDto[]> {
    await assertAnyOf(authCtx, "store.read", "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const packs = await db.storePack.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true },
      });
      return this.packDtos(db, packs.map((p) => p.id));
    });
  }

  async getPack(authCtx: AuthContext, id: string): Promise<StorePackDto> {
    await assertAnyOf(authCtx, "store.read", "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const [pack] = await this.packDtos(db, [id]);
      if (!pack) throw new NotFoundError("Pack not found.");
      return pack;
    });
  }

  async savePack(authCtx: AuthContext, id: string | null, input: SavePackInput, reqCtx: RequestContext): Promise<StorePackDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const items = await db.storeItem.findMany({ where: { id: { in: input.items.map((i) => i.itemId) } }, select: { id: true } });
      if (items.length !== input.items.length) throw new NotFoundError("An item in the pack was not found.");
      let packId = id;
      try {
        if (packId) {
          const found = await db.storePack.findUnique({ where: { id: packId }, select: { id: true } });
          if (!found) throw new NotFoundError("Pack not found.");
          await db.storePack.update({
            where: { id: packId },
            data: { name: input.name, note: input.note ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
          });
          await db.storePackItem.deleteMany({ where: { packId } });
        } else {
          const created = await db.storePack.create({
            data: {
              schoolId: authCtx.schoolId,
              name: input.name,
              note: input.note ?? null,
              isActive: input.isActive ?? true,
              createdBy: authCtx.userId,
            },
          });
          packId = created.id;
        }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw new ConflictError("PACK_NAME_TAKEN", "There is already a pack with that name.");
        }
        throw e;
      }
      await db.storePackItem.createMany({
        data: input.items.map((i) => ({ schoolId: authCtx.schoolId, packId: packId!, itemId: i.itemId, quantity: i.quantity })),
      });
      await audit(db, authCtx, id ? "store.pack.update" : "store.pack.create", "store_pack", packId!, reqCtx, {
        items: input.items.length,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      });
      const [pack] = await this.packDtos(db, [packId!]);
      return pack!;
    });
  }

  // ---------------------------------------------------------- class sale

  async previewClassSale(authCtx: AuthContext, input: PreviewClassSaleInput): Promise<ClassSalePreviewDto> {
    await assertAnyOf(authCtx, "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { name: true } });
      if (!arm) throw new NotFoundError("Class not found.");
      const [pack] = await this.packDtos(db, [input.packId]);
      if (!pack) throw new NotFoundError("Pack not found.");
      const term = await currentChargeTerm(db);
      const roster = await classRoster(db, input.classArmId, term.id);
      const bought = await db.storeOrder.findMany({
        where: { packId: input.packId, status: "ACTIVE", studentId: { in: roster.map((r) => r.id) } },
        select: { studentId: true },
      });
      const boughtIds = new Set(bought.map((b) => b.studentId));
      return {
        classArmName: arm.name,
        pack,
        children: roster.map((s) => ({
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          admissionNumber: s.admissionNumber,
          alreadyBought: boughtIds.has(s.id),
        })),
      };
    });
  }

  /**
   * One order per child for a pack, all in one transaction, everything waiting
   * to be handed over. Billed like any student order; never paid at the counter.
   */
  async createClassSale(authCtx: AuthContext, input: CreateClassSaleInput, reqCtx: RequestContext): Promise<ClassSaleResultDto> {
    await assertAnyOf(authCtx, "store.sell");
    return withTenant(authCtx.schoolId, async (db) => {
      await lockSchoolOrders(db, authCtx.schoolId);
      const prior = await db.storeOrder.findMany({
        where: { classSaleId: input.idempotencyKey },
        select: { total: true },
      });
      if (prior.length > 0) {
        return {
          classSaleId: input.idempotencyKey,
          orders: prior.length,
          total: prior.reduce((s, o) => s + o.total, 0),
          replayed: true,
        };
      }
      const pack = await db.storePack.findUnique({
        where: { id: input.packId },
        include: { items: { include: { item: { include: { variants: { where: { isActive: true } } } } } } },
      });
      if (!pack || !pack.isActive) throw new NotFoundError("Pack not found.");
      const billing = await this.chooseBilling(db, authCtx.schoolId, input.billing);
      const term = await currentChargeTerm(db);
      const roster = new Set((await classRoster(db, input.classArmId, term.id)).map((r) => r.id));

      let total = 0;
      for (const child of input.children) {
        if (!roster.has(child.studentId)) {
          throw new ValidationError("NOT_IN_CLASS", "A chosen child is not in this class this term.");
        }
        const chosen = new Map(child.sizes.map((s) => [s.itemId, s.variantId]));
        const lines: DraftLine[] = pack.items.map((pi) => {
          const variants = pi.item.variants;
          let variantId = chosen.get(pi.itemId);
          if (!variantId) {
            if (variants.length !== 1) {
              throw new ValidationError("SIZE_NEEDED", `Choose a size of ${pi.item.name} for every child.`);
            }
            variantId = variants[0]!.id;
          } else if (!variants.some((v) => v.id === variantId)) {
            throw new ValidationError("SIZE_NOT_FOUND", `That size of ${pi.item.name} is not stocked.`);
          }
          return { variantId, quantity: pi.quantity, collectNow: false };
        });
        const orderId = await this.writeOrder(db, authCtx, reqCtx, {
          buyer: "STUDENT",
          studentId: child.studentId,
          userId: null,
          buyerName: null,
          billing,
          counterMethod: null,
          counterReference: null,
          term,
          classArmId: input.classArmId,
          packId: pack.id,
          classSaleId: input.idempotencyKey,
          note: null,
          idempotencyKey: null,
          lines,
        });
        const o = await db.storeOrder.findUniqueOrThrow({ where: { id: orderId }, select: { total: true } });
        total += o.total;
      }
      await audit(db, authCtx, "store.class-sale.create", "store_pack", pack.id, reqCtx, {
        classSaleId: input.idempotencyKey,
        classArmId: input.classArmId,
        orders: input.children.length,
        billing,
        total,
      });
      return { classSaleId: input.idempotencyKey, orders: input.children.length, total, replayed: false };
    });
  }

  // -------------------------------------------------------------- report

  async takingsReport(authCtx: AuthContext, query: StoreReportRangeQuery): Promise<StoreTakingsReportDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const orders = await db.storeOrder.findMany({
        where: {
          status: "ACTIVE",
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: lagosDayStart(query.from) } : {}),
                  ...(query.to ? { lt: lagosDayStart(query.to, 1) } : {}),
                },
              }
            : {}),
        },
        select: { billing: true, counterMethod: true, total: true, invoiceId: true },
      });
      const rows = new Map<string, StoreTakingsReportDto["rows"][number]>();
      for (const o of orders) {
        const method = (o.counterMethod as StoreCounterMethod | null) ?? null;
        const key = `${o.billing}:${method ?? ""}`;
        const row = rows.get(key) ?? { billing: o.billing, counterMethod: method, orders: 0, amount: 0 };
        row.orders += 1;
        row.amount += o.total;
        rows.set(key, row);
      }
      const invoiceIds = orders.flatMap((o) => (o.invoiceId ? [o.invoiceId] : []));
      const paid = invoiceIds.length
        ? await db.invoice.aggregate({ where: { id: { in: invoiceIds } }, _sum: { totalPaid: true } })
        : { _sum: { totalPaid: 0 } };
      const order = ["FEES_INVOICE", "STORE_INVOICE", "COUNTER"];
      const list = [...rows.values()].sort(
        (a, b) => order.indexOf(a.billing) - order.indexOf(b.billing) || (a.counterMethod ?? "").localeCompare(b.counterMethod ?? ""),
      );
      return {
        from: query.from ?? null,
        to: query.to ?? null,
        rows: list,
        totalOrders: orders.length,
        totalAmount: orders.reduce((s, o) => s + o.total, 0),
        storeInvoicesPaid: paid._sum.totalPaid ?? 0,
      };
    });
  }

  // ------------------------------------------------------------- private

  private async billingSettings(db: PrismaClient, schoolId: string) {
    const school = await db.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { storeBillingDefault: true, storeBillingSellerChoice: true },
    });
    return {
      billingDefault: school.storeBillingDefault as StoreStudentBilling,
      sellerMayChooseBilling: school.storeBillingSellerChoice,
    };
  }

  private async chooseBilling(
    db: PrismaClient,
    schoolId: string,
    asked: StoreStudentBilling | undefined,
  ): Promise<StoreStudentBilling> {
    const s = await this.billingSettings(db, schoolId);
    if (!asked || asked === s.billingDefault) return s.billingDefault;
    if (!s.sellerMayChooseBilling) {
      throw new ForbiddenError("Your school bills store orders one way only. An owner or admin can change this in Store settings.");
    }
    return asked;
  }

  private async assertPack(db: PrismaClient, packId: string) {
    const pack = await db.storePack.findUnique({ where: { id: packId }, select: { id: true } });
    if (!pack) throw new NotFoundError("Pack not found.");
  }

  /** Writes one order with its lines, bills and hand-overs. Caller holds the school's order lock. */
  private async writeOrder(db: PrismaClient, authCtx: AuthContext, reqCtx: RequestContext, d: OrderDraft): Promise<string> {
    const actor = actorOf(authCtx, reqCtx);
    const variantIds = d.lines.map((l) => l.variantId);
    await lockVariants(db, variantIds);
    const variants = await db.storeItemVariant.findMany({ where: { id: { in: variantIds } }, include: { item: true } });
    const byId = new Map(variants.map((v) => [v.id, v]));
    const stock = await stockByVariant(db, variantIds);

    const priced = d.lines.map((l) => {
      const v = byId.get(l.variantId);
      if (!v) throw new NotFoundError("Item not found.");
      const name = variantName(v.item, v.label);
      if (!v.item.isActive || !v.isActive) {
        throw new ValidationError("ITEM_INACTIVE", `${name} is no longer stocked.`);
      }
      const unitPrice = v.sellPrice ?? v.item.sellPrice;
      if (unitPrice === null) throw new ValidationError("NO_PRICE", `Set a selling price for ${name} before selling it.`);
      const amount = unitPrice * l.quantity;
      if (amount > MAX_STUDENT_CHARGE_KOBO) {
        throw new ValidationError("AMOUNT_TOO_LARGE", `That much ${name} is more than one bill can carry. Sell fewer at a time.`);
      }
      if (l.collectNow && (stock.get(l.variantId)?.onHand ?? 0) < l.quantity) {
        const onHand = stock.get(l.variantId)?.onHand ?? 0;
        throw new ValidationError(
          "NOT_ENOUGH_STOCK",
          `Only ${onHand} of ${name} in the store. Untick "Hand over now" to take the order and hand it over later.`,
        );
      }
      return { ...l, lineId: randomUUID(), itemId: v.itemId, name, unit: v.item.unit, unitPrice, amount };
    });
    const total = priced.reduce((s, l) => s + l.amount, 0);
    if (total > MAX_STUDENT_CHARGE_KOBO) {
      throw new ValidationError("AMOUNT_TOO_LARGE", "This order is larger than one bill can carry. Split it into two.");
    }

    const orderId = randomUUID();
    const [{ next }] = await db.$queryRaw<{ next: number }[]>`
      SELECT COALESCE(MAX(number), 0)::int + 1 AS next FROM store_orders`;
    const number = Number(next);

    // Student orders: one STORE charge per line, then (store invoice) billed at once.
    const chargeIds = new Map<string, string>();
    let invoiceId: string | null = null;
    if (d.buyer === "STUDENT") {
      const charges: Array<{ id: string; kind: "STORE"; description: string; amount: number }> = [];
      for (const l of priced) {
        const charge = await this.charges.raise(db, actor, {
          studentId: d.studentId!,
          termId: d.term!.id,
          kind: "STORE",
          description: `${l.name} × ${l.quantity} (${formatStoreOrderNumber(number)})`.slice(0, 200),
          amount: l.amount,
          sourceModule: CHARGE_SOURCE,
          sourceId: l.lineId,
        });
        chargeIds.set(l.lineId, charge.id);
        charges.push({ id: charge.id, kind: "STORE" as const, description: charge.description, amount: l.amount });
      }
      if (d.billing === "STORE_INVOICE") {
        const invoice = await this.invoices.issueChargesInvoiceInTransaction(db, actor, {
          studentId: d.studentId!,
          termId: d.term!.id,
          academicYearId: d.term!.academicYearId,
          classArmId: d.classArmId,
          charges,
          dueDate: null,
          source: "store",
        });
        invoiceId = invoice.id;
      }
    }

    await db.storeOrder.create({
      data: {
        id: orderId,
        schoolId: authCtx.schoolId,
        number,
        buyer: d.buyer,
        studentId: d.studentId,
        userId: d.userId,
        buyerName: d.buyerName,
        billing: d.billing,
        total,
        termId: d.term?.id ?? null,
        invoiceId,
        counterMethod: d.counterMethod,
        counterReference: d.counterReference,
        packId: d.packId,
        classSaleId: d.classSaleId,
        note: d.note,
        idempotencyKey: d.idempotencyKey,
        createdBy: authCtx.userId,
      },
    });
    await db.storeOrderLine.createMany({
      data: priced.map((l) => ({
        id: l.lineId,
        schoolId: authCtx.schoolId,
        orderId,
        itemId: l.itemId,
        variantId: l.variantId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.amount,
        chargeId: chargeIds.get(l.lineId) ?? null,
      })),
    });
    const order = { id: orderId, studentId: d.studentId, userId: d.userId, counterReference: d.counterReference };
    for (const l of priced) {
      if (!l.collectNow) continue;
      await this.handOver(
        db,
        authCtx,
        reqCtx,
        order,
        { id: l.lineId, itemId: l.itemId, variantId: l.variantId, unitPrice: l.unitPrice, quantity: l.quantity, collected: 0 },
        l.quantity,
      );
    }
    await audit(db, authCtx, "store.order.create", "store_order", orderId, reqCtx, {
      number,
      buyer: d.buyer,
      billing: d.billing,
      total,
      lines: priced.length,
      handedOver: priced.filter((l) => l.collectNow).length,
      ...(invoiceId ? { invoiceId } : {}),
      ...(d.counterMethod ? { counterMethod: d.counterMethod } : {}),
      ...(d.classSaleId ? { classSaleId: d.classSaleId } : {}),
    });
    return orderId;
  }

  /** A SELL movement for `quantity` of the line, and the line's count. Caller has locked the variant and checked stock. */
  private async handOver(
    db: PrismaClient,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    order: { id: string; studentId: string | null; userId: string | null; counterReference?: string | null },
    line: { id: string; itemId: string; variantId: string; unitPrice: number; quantity: number; collected: number },
    quantity: number,
  ) {
    const { count } = await db.storeOrderLine.updateMany({
      where: { id: line.id, collected: { lte: line.quantity - quantity } },
      data: { collected: { increment: quantity } },
    });
    if (count !== 1) throw new ConflictError("NOTHING_TO_COLLECT", "Someone else handed this over a moment ago. Refresh and try again.");
    const movementId = randomUUID();
    await db.storeMovement.create({
      data: {
        id: movementId,
        schoolId: authCtx.schoolId,
        variantId: line.variantId,
        itemId: line.itemId,
        kind: "SELL",
        quantity: -quantity,
        unitPrice: line.unitPrice,
        studentId: order.studentId,
        userId: order.userId,
        orderLineId: line.id,
        createdBy: authCtx.userId,
      },
    });
    await audit(db, authCtx, "store.movement.sell", "store_movement", movementId, reqCtx, {
      itemId: line.itemId,
      variantId: line.variantId,
      quantity: -quantity,
      unitPrice: line.unitPrice,
      orderId: order.id,
    });
  }

  private async summaries(db: PrismaClient, rows: OrderRow[]): Promise<StoreOrderSummaryDto[]> {
    const studentIds = rows.flatMap((r) => (r.studentId ? [r.studentId] : []));
    const students = studentIds.length
      ? await db.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, firstName: true, lastName: true, admissionNumber: true },
        })
      : [];
    const classes = studentIds.length
      ? await db.enrollment.findMany({
          where: { studentId: { in: studentIds }, term: { isCurrent: true } },
          select: { studentId: true, classArm: { select: { name: true } } },
        })
      : [];
    const classOf = new Map(classes.map((c) => [c.studentId, c.classArm.name]));
    const studentById = new Map(students.map((s) => [s.id, s]));
    const names = await staffNames(db, rows.flatMap((r) => [r.createdBy, ...(r.userId ? [r.userId] : [])]));
    const invoiceIds = rows.flatMap((r) => (r.invoiceId ? [r.invoiceId] : []));
    const invoices = invoiceIds.length
      ? await db.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, totalDue: true, totalPaid: true, status: true },
        })
      : [];
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    return rows.map((r) => {
      const student = r.studentId ? studentById.get(r.studentId) : undefined;
      const buyerName =
        r.buyer === "STUDENT"
          ? student
            ? `${student.firstName} ${student.lastName}`.trim()
            : "Student"
          : r.buyer === "STAFF"
            ? (names.get(r.userId!) ?? "Member of staff")
            : (r.buyerName ?? "Walk-in buyer");
      const invoice = r.invoiceId ? invoiceById.get(r.invoiceId) : undefined;
      return {
        id: r.id,
        number: formatStoreOrderNumber(r.number),
        buyer: r.buyer,
        buyerName,
        buyerDetail: student ? [student.admissionNumber, classOf.get(student.id)].filter(Boolean).join(" · ") || null : null,
        studentId: r.studentId,
        billing: r.billing,
        status: r.status,
        total: r.total,
        itemCount: r.lines.reduce((s, l) => s + l.quantity, 0),
        toCollect: r.status === "ACTIVE" ? r.lines.reduce((s, l) => s + (l.quantity - l.collected), 0) : 0,
        packName: r.pack?.name ?? null,
        invoice: invoice
          ? { id: invoice.id, totalDue: invoice.totalDue, totalPaid: invoice.totalPaid, status: invoice.status }
          : null,
        createdByName: names.get(r.createdBy) ?? "—",
        createdAt: r.createdAt,
      };
    });
  }

  private async orderDto(db: PrismaClient, id: string): Promise<StoreOrderDto> {
    const row = await db.storeOrder.findUnique({ where: { id }, include: orderInclude });
    if (!row) throw new NotFoundError("Order not found.");
    const [summary] = await this.summaries(db, [row]);
    const lineRows = await db.storeOrderLine.findMany({
      where: { orderId: id },
      include: { item: { select: { name: true, unit: true } }, variant: { select: { label: true } } },
      orderBy: { createdAt: "asc" },
    });
    const stock = await stockByVariant(db, lineRows.map((l) => l.variantId));
    const lines: StoreOrderLineDto[] = lineRows.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      itemName: l.item.name,
      variantLabel: l.variant.label,
      unit: l.item.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      amount: l.amount,
      collected: l.collected,
      toCollect: row.status === "ACTIVE" ? l.quantity - l.collected : 0,
      onHand: stock.get(l.variantId)?.onHand ?? 0,
    }));
    const chargeIds = lineRows.flatMap((l) => (l.chargeId ? [l.chargeId] : []));
    const billedCharges =
      row.billing === "FEES_INVOICE" && chargeIds.length
        ? await db.studentCharge.count({ where: { id: { in: chargeIds }, status: "BILLED" } })
        : 0;
    const names = row.cancelledBy ? await staffNames(db, [row.cancelledBy]) : new Map<string, string>();
    return {
      ...summary!,
      counterMethod: (row.counterMethod as StoreCounterMethod | null) ?? null,
      counterReference: row.counterReference,
      note: row.note,
      classSaleId: row.classSaleId,
      lines,
      cancelledByName: row.cancelledBy ? (names.get(row.cancelledBy) ?? null) : null,
      cancelledAt: row.cancelledAt,
      cancelReason: row.cancelReason,
      billedCharges,
    };
  }

  private async packDtos(db: PrismaClient, ids: string[]): Promise<StorePackDto[]> {
    if (ids.length === 0) return [];
    const packs = await db.storePack.findMany({
      where: { id: { in: ids } },
      include: {
        items: {
          include: {
            item: {
              select: {
                id: true,
                name: true,
                unit: true,
                isActive: true,
                sellPrice: true,
                variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    const stock = await stockByVariant(db, packs.flatMap((p) => p.items.flatMap((i) => i.item.variants.map((v) => v.id))));
    return packs.map((p) => {
      const items = p.items
        .map((pi) => ({
          itemId: pi.itemId,
          itemName: pi.item.name,
          unit: pi.item.unit,
          quantity: pi.quantity,
          itemActive: pi.item.isActive,
          sizes: pi.item.variants.map((v) => ({
            variantId: v.id,
            label: v.label,
            price: v.sellPrice ?? pi.item.sellPrice,
            onHand: stock.get(v.id)?.onHand ?? 0,
            isActive: v.isActive,
          })),
        }))
        .sort((a, b) => a.itemName.localeCompare(b.itemName));
      let fixedTotal: number | null = 0;
      for (const i of items) {
        const live = i.sizes.filter((s) => s.isActive);
        const prices = new Set(live.map((s) => s.price));
        if (live.length === 0 || prices.size !== 1 || live[0]!.price === null) {
          fixedTotal = null;
          break;
        }
        fixedTotal += live[0]!.price * i.quantity;
      }
      return { id: p.id, name: p.name, note: p.note, isActive: p.isActive, items, fixedTotal };
    });
  }
}

// ------------------------------------------------------------------ helpers

const orderInclude = {
  lines: { select: { quantity: true, collected: true } },
  pack: { select: { name: true } },
} satisfies Prisma.StoreOrderInclude;
type OrderRow = Prisma.StoreOrderGetPayload<{ include: typeof orderInclude }>;

function actorOf(authCtx: AuthContext, reqCtx: RequestContext): ChargeActor {
  return { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress };
}

/** Serialises order writes for one school: numbering and idempotency. */
async function lockSchoolOrders(db: PrismaClient, schoolId: string) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-order:${schoolId}`}))`;
}

async function lockVariants(db: PrismaClient, variantIds: string[]) {
  const ids = [...new Set(variantIds)].sort();
  if (ids.length === 0) return;
  await db.$queryRaw`SELECT id FROM store_item_variants WHERE id = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
}

async function lockOrder(db: PrismaClient, id: string) {
  const locked = await db.$queryRaw<{ id: string }[]>`SELECT id FROM store_orders WHERE id = ${id} FOR UPDATE`;
  if (locked.length === 0) throw new NotFoundError("Order not found.");
  return db.storeOrder.findUniqueOrThrow({ where: { id } });
}

/** The term a store charge is billed for today (the library's rule). */
async function currentChargeTerm(db: PrismaClient): Promise<{ id: string; academicYearId: string }> {
  const terms = await db.term.findMany({
    select: { id: true, academicYearId: true, startDate: true, endDate: true, isCurrent: true },
  });
  const termId = chargeTermFor(
    lagosTodayIso(),
    terms.map((t) => ({
      id: t.id,
      startDate: t.startDate.toISOString().slice(0, 10),
      endDate: t.endDate.toISOString().slice(0, 10),
      isCurrent: t.isCurrent,
    })),
  );
  if (!termId) throw new ValidationError("NO_TERM", "Set up the school's terms before selling to students, so the bill has a term.");
  return { id: termId, academicYearId: terms.find((t) => t.id === termId)!.academicYearId };
}

async function armFor(db: PrismaClient, studentId: string, termId: string): Promise<string | null> {
  const e = await db.enrollment.findFirst({ where: { studentId, termId }, select: { classArmId: true } });
  return e?.classArmId ?? null;
}

async function classRoster(db: PrismaClient, classArmId: string, termId: string) {
  const rows = await db.enrollment.findMany({
    where: { classArmId, termId, status: "ENROLLED", student: { status: "ACTIVE" } },
    select: { student: { select: { id: true, firstName: true, lastName: true, admissionNumber: true } } },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
  return rows.map((r) => r.student);
}
