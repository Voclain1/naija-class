import { randomUUID } from "node:crypto";

import { Injectable, Optional } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  lagosTodayIso,
  MAX_STUDENT_CHARGE_KOBO,
  NotFoundError,
  ValidationError,
  type AddStoreVariantInput,
  type CreateStoreItemInput,
  type ListStoreItemsQuery,
  type ListStoreMovementsQuery,
  type RecordStoreMovementInput,
  type SaveStockTakeCountsInput,
  type StartStockTakeInput,
  type StoreItemDto,
  type StoreItemSummaryDto,
  type StoreMovementDto,
  type StoreMovementKind,
  type StorePeopleQuery,
  type StorePersonDto,
  type StoreReportRangeQuery,
  type StoreSalesReportDto,
  type StoreStockReportDto,
  type StoreStockTakeDto,
  type StoreStockTakeStatus,
  type StoreStockTakeSummaryDto,
  type StoreVariantDto,
  type UpdateStoreItemInput,
  type UpdateStoreVariantInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { StudentChargeService } from "../finance/student-charge.service.js";
import { chargeTermFor } from "../library/library-fines.js";
import { assertAnyOf, staffNames, type RequestContext } from "./store.shared.js";

// The Store (2026-10-19, docs/modules/id-cards-and-store.md §4).
//
// Stock is the sum of an append-only ledger (store_movements); nothing edits a
// number. Every outgoing movement locks the variant's row first, so two people
// at two desks cannot both hand out the last blazer. A sale bills the child
// through StudentChargeService (the one path that writes student_charges), in
// the same transaction as the movement, so a sale is never recorded without
// its bill or billed without its movement.
//
// Who may (owner's answer 5): store.read sees the store and its value;
// store.manage runs it (items, receiving, issuing, returns, write-offs, stock
// takes); store.sell bills a child; store.approve approves a stock take.

const CHARGE_SOURCE = "store";

interface Stock {
  onHand: number;
  averageCost: number | null;
}

/** Stock on hand and weighted average cost per variant, from the ledger. */
export async function stockByVariant(db: PrismaClient, variantIds?: string[]): Promise<Map<string, Stock>> {
  if (variantIds && variantIds.length === 0) return new Map();
  const filter = variantIds ? Prisma.sql`WHERE variant_id = ANY(${variantIds}::text[])` : Prisma.empty;
  const rows = await db.$queryRaw<
    { variant_id: string; on_hand: number; cost_total: bigint | null; cost_qty: bigint | null }[]
  >`
    SELECT variant_id,
           COALESCE(SUM(quantity), 0)::int AS on_hand,
           SUM(CASE WHEN kind = 'RECEIVE' AND unit_cost IS NOT NULL THEN quantity::bigint * unit_cost END) AS cost_total,
           SUM(CASE WHEN kind = 'RECEIVE' AND unit_cost IS NOT NULL THEN quantity END)::bigint AS cost_qty
      FROM store_movements
      ${filter}
     GROUP BY variant_id`;
  const out = new Map<string, Stock>();
  for (const r of rows) {
    const qty = r.cost_qty === null ? 0 : Number(r.cost_qty);
    out.set(r.variant_id, {
      onHand: Number(r.on_hand),
      averageCost: qty > 0 && r.cost_total !== null ? Math.round(Number(r.cost_total) / qty) : null,
    });
  }
  return out;
}

const NO_STOCK: Stock = { onHand: 0, averageCost: null };

/** Items at or below their reorder level, for the dashboard. */
export async function lowStockItemCount(db: PrismaClient): Promise<number> {
  const rows = await db.$queryRaw<{ n: number }[]>`
    SELECT COUNT(*)::int AS n FROM (
      SELECT i.id
        FROM store_items i
        LEFT JOIN store_movements m ON m.item_id = i.id
       WHERE i.is_active AND i.reorder_level > 0
       GROUP BY i.id, i.reorder_level
      HAVING COALESCE(SUM(m.quantity), 0) <= i.reorder_level
    ) low`;
  return rows[0]?.n ?? 0;
}

function variantName(item: { name: string }, label: string | null): string {
  return label ? `${item.name} (${label})` : item.name;
}

function uniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

@Injectable()
export class StoreService {
  constructor(@Optional() private readonly charges: StudentChargeService = new StudentChargeService()) {}

  // ------------------------------------------------------------------ items

  async listItems(authCtx: AuthContext, query: ListStoreItemsQuery): Promise<StoreItemSummaryDto[]> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const q = query.q?.trim();
      const items = await db.storeItem.findMany({
        where: {
          ...(query.includeInactive === "true" ? {} : { isActive: true }),
          ...(query.category ? { category: query.category } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { code: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: { variants: { select: { id: true, isActive: true } } },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
      const stock = await stockByVariant(db, items.flatMap((i) => i.variants.map((v) => v.id)));
      const rows = items.map((item) => summaryOf(item, item.variants, stock));
      return query.low === "true" ? rows.filter((r) => r.low) : rows;
    });
  }

  async getItem(authCtx: AuthContext, itemId: string): Promise<StoreItemDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, (db) => this.itemDto(db, itemId));
  }

  private async itemDto(db: PrismaClient, itemId: string): Promise<StoreItemDto> {
    const item = await db.storeItem.findUnique({
      where: { id: itemId },
      include: { variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    if (!item) throw new NotFoundError("Item not found.");
    const stock = await stockByVariant(db, item.variants.map((v) => v.id));
    const variants: StoreVariantDto[] = item.variants.map((v) => {
      const s = stock.get(v.id) ?? NO_STOCK;
      return {
        id: v.id,
        label: v.label,
        sellPrice: v.sellPrice,
        effectivePrice: v.sellPrice ?? item.sellPrice,
        onHand: s.onHand,
        averageCost: s.averageCost,
        isActive: v.isActive,
      };
    });
    const movements = await this.movementRows(db, { itemId }, 100);
    return { ...summaryOf(item, item.variants, stock), notes: item.notes, variants, movements };
  }

  async createItem(authCtx: AuthContext, input: CreateStoreItemInput, reqCtx: RequestContext): Promise<StoreItemDto> {
    await assertAnyOf(authCtx, "store.manage");
    const labels = dedupeLabels(input.variants);
    return withTenant(authCtx.schoolId, async (db) => {
      let itemId: string;
      try {
        const item = await db.storeItem.create({
          data: {
            schoolId: authCtx.schoolId,
            name: input.name,
            code: input.code ?? null,
            category: input.category,
            unit: input.unit,
            reorderLevel: input.reorderLevel,
            sellPrice: input.sellPrice ?? null,
            notes: input.notes ?? null,
            createdBy: authCtx.userId,
            variants: {
              // school_id comes from the item, through the composite relation.
              create: (labels.length ? labels : [null]).map((label, i) => ({ label, sortOrder: i })),
            },
          },
          select: { id: true },
        });
        itemId = item.id;
      } catch (e) {
        if (uniqueViolation(e)) throw new ConflictError("CODE_TAKEN", "Another item already has that code.");
        throw e;
      }
      await audit(db, authCtx, "store.item.create", "store_item", itemId, reqCtx, { name: input.name });
      return this.itemDto(db, itemId);
    });
  }

  async updateItem(
    authCtx: AuthContext,
    itemId: string,
    input: UpdateStoreItemInput,
    reqCtx: RequestContext,
  ): Promise<StoreItemDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const exists = await db.storeItem.findUnique({ where: { id: itemId }, select: { id: true } });
      if (!exists) throw new NotFoundError("Item not found.");
      try {
        await db.storeItem.update({
          where: { id: itemId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
            ...(input.sellPrice !== undefined ? { sellPrice: input.sellPrice } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (e) {
        if (uniqueViolation(e)) throw new ConflictError("CODE_TAKEN", "Another item already has that code.");
        throw e;
      }
      await audit(db, authCtx, "store.item.update", "store_item", itemId, reqCtx, { fields: Object.keys(input) });
      return this.itemDto(db, itemId);
    });
  }

  async addVariant(
    authCtx: AuthContext,
    itemId: string,
    input: AddStoreVariantInput,
    reqCtx: RequestContext,
  ): Promise<StoreItemDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const item = await db.storeItem.findUnique({
        where: { id: itemId },
        include: { variants: { select: { id: true, label: true, sortOrder: true } } },
      });
      if (!item) throw new NotFoundError("Item not found.");
      const unnamed = item.variants.find((v) => v.label === null);
      if (unnamed) {
        // An item without sizes gets its first size: the one unnamed variant
        // (and its stock) takes the label, so no stock is stranded.
        await db.storeItemVariant.update({
          where: { id: unnamed.id },
          data: { label: input.label, ...(input.sellPrice !== undefined ? { sellPrice: input.sellPrice } : {}) },
        });
      } else {
        try {
          await db.storeItemVariant.create({
            data: {
              schoolId: authCtx.schoolId,
              itemId,
              label: input.label,
              sellPrice: input.sellPrice ?? null,
              sortOrder: Math.max(0, ...item.variants.map((v) => v.sortOrder)) + 1,
            },
          });
        } catch (e) {
          if (uniqueViolation(e)) throw new ConflictError("SIZE_TAKEN", "This item already has that size.");
          throw e;
        }
      }
      await audit(db, authCtx, "store.variant.add", "store_item", itemId, reqCtx, { label: input.label });
      return this.itemDto(db, itemId);
    });
  }

  async updateVariant(
    authCtx: AuthContext,
    variantId: string,
    input: UpdateStoreVariantInput,
    reqCtx: RequestContext,
  ): Promise<StoreItemDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const v = await db.storeItemVariant.findUnique({ where: { id: variantId }, select: { itemId: true } });
      if (!v) throw new NotFoundError("Size not found.");
      try {
        await db.storeItemVariant.update({
          where: { id: variantId },
          data: {
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.sellPrice !== undefined ? { sellPrice: input.sellPrice } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
      } catch (e) {
        if (uniqueViolation(e)) throw new ConflictError("SIZE_TAKEN", "This item already has that size.");
        throw e;
      }
      await audit(db, authCtx, "store.variant.update", "store_item", v.itemId, reqCtx, {
        variantId,
        fields: Object.keys(input),
      });
      return this.itemDto(db, v.itemId);
    });
  }

  // -------------------------------------------------------------- movements

  async record(authCtx: AuthContext, input: RecordStoreMovementInput, reqCtx: RequestContext): Promise<StoreMovementDto> {
    if (input.kind === "SELL") await assertAnyOf(authCtx, "store.sell");
    else await assertAnyOf(authCtx, "store.manage");

    return withTenant(authCtx.schoolId, async (db) => {
      // Lock the variant: the stock check and the movement are one step.
      const locked = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM store_item_variants WHERE id = ${input.variantId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError("Item not found.");
      const variant = await db.storeItemVariant.findUniqueOrThrow({
        where: { id: input.variantId },
        include: { item: true },
      });
      if (!variant.item.isActive || !variant.isActive) {
        throw new ValidationError("ITEM_INACTIVE", "This item is no longer stocked. Turn it back on first.");
      }

      const outgoing = input.kind === "ISSUE" || input.kind === "SELL" || input.kind === "WRITE_OFF";
      const signed = outgoing ? -input.quantity : input.quantity;
      if (outgoing) {
        const onHand = (await stockByVariant(db, [variant.id])).get(variant.id)?.onHand ?? 0;
        if (onHand < input.quantity) {
          throw new ValidationError(
            "NOT_ENOUGH_STOCK",
            `Only ${onHand} ${variant.item.unit}${onHand === 1 ? "" : "s"} of ${variantName(variant.item, variant.label)} in the store.`,
          );
        }
      }

      const studentId = "studentId" in input ? (input.studentId ?? null) : null;
      const userId = "userId" in input ? (input.userId ?? null) : null;
      if (studentId) {
        const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } });
        if (!student) throw new NotFoundError("Student not found.");
      }
      if (userId) {
        const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) throw new NotFoundError("Staff member not found.");
      }

      const movementId = randomUUID();
      let unitPrice: number | null = null;
      let chargeId: string | null = null;
      if (input.kind === "SELL") {
        unitPrice = input.unitPrice ?? variant.sellPrice ?? variant.item.sellPrice;
        if (unitPrice === null) {
          throw new ValidationError("NO_PRICE", "Set a selling price for this item before selling it.");
        }
        const amount = unitPrice * input.quantity;
        if (amount > MAX_STUDENT_CHARGE_KOBO) {
          throw new ValidationError("AMOUNT_TOO_LARGE", "That sale is larger than one bill can carry. Sell fewer at a time.");
        }
        const terms = await db.term.findMany({ select: { id: true, startDate: true, endDate: true, isCurrent: true } });
        const termId = chargeTermFor(
          lagosTodayIso(),
          terms.map((t) => ({
            id: t.id,
            startDate: t.startDate.toISOString().slice(0, 10),
            endDate: t.endDate.toISOString().slice(0, 10),
            isCurrent: t.isCurrent,
          })),
        );
        if (!termId) throw new ValidationError("NO_TERM", "Set up the school's terms before selling, so the bill has a term.");
        const description = `${variantName(variant.item, variant.label)} × ${input.quantity}`.slice(0, 200);
        const charge = await this.charges.raise(
          db,
          { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress },
          { studentId: input.studentId, termId, kind: "STORE", description, amount, sourceModule: CHARGE_SOURCE, sourceId: movementId },
        );
        chargeId = charge.id;
      }

      await db.storeMovement.create({
        data: {
          id: movementId,
          schoolId: authCtx.schoolId,
          variantId: variant.id,
          itemId: variant.itemId,
          kind: input.kind,
          quantity: signed,
          unitCost: input.kind === "RECEIVE" ? (input.unitCost ?? null) : null,
          unitPrice,
          studentId,
          userId,
          department: "department" in input ? (input.department ?? null) : null,
          supplier: input.kind === "RECEIVE" ? (input.supplier ?? null) : null,
          reference: input.kind === "RECEIVE" || input.kind === "SELL" ? (input.reference ?? null) : null,
          reason: "reason" in input ? (input.reason ?? null) : null,
          studentChargeId: chargeId,
          createdBy: authCtx.userId,
        },
      });
      await audit(db, authCtx, `store.movement.${input.kind.toLowerCase()}`, "store_movement", movementId, reqCtx, {
        itemId: variant.itemId,
        variantId: variant.id,
        quantity: signed,
        ...(unitPrice !== null ? { unitPrice } : {}),
      });
      const [row] = await this.movementRows(db, { ids: [movementId] }, 1);
      return row!;
    });
  }

  async listMovements(authCtx: AuthContext, query: ListStoreMovementsQuery): Promise<StoreMovementDto[]> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, (db) =>
      this.movementRows(db, { itemId: query.itemId, kind: query.kind, from: query.from, to: query.to }, 2000),
    );
  }

  private async movementRows(
    db: PrismaClient,
    f: { itemId?: string; kind?: StoreMovementKind; from?: string; to?: string; ids?: string[] },
    take: number,
  ): Promise<StoreMovementDto[]> {
    const rows = await db.storeMovement.findMany({
      where: {
        ...(f.ids ? { id: { in: f.ids } } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.from || f.to
          ? {
              createdAt: {
                ...(f.from ? { gte: lagosDayStart(f.from) } : {}),
                ...(f.to ? { lt: lagosDayStart(f.to, 1) } : {}),
              },
            }
          : {}),
      },
      include: { item: { select: { name: true } }, variant: { select: { label: true } } },
      orderBy: { createdAt: "desc" },
      take,
    });
    const students = await db.student.findMany({
      where: { id: { in: rows.flatMap((r) => (r.studentId ? [r.studentId] : [])) } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    const studentById = new Map(students.map((s) => [s.id, `${s.firstName} ${s.lastName} (${s.admissionNumber})`]));
    const names = await staffNames(db, rows.flatMap((r) => [r.createdBy, ...(r.userId ? [r.userId] : [])]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      quantity: r.quantity,
      itemId: r.itemId,
      itemName: r.item.name,
      variantLabel: r.variant.label,
      unitCost: r.unitCost,
      unitPrice: r.unitPrice,
      party: r.studentId
        ? (studentById.get(r.studentId) ?? null)
        : r.userId
          ? (names.get(r.userId) ?? null)
          : r.department,
      supplier: r.supplier,
      reference: r.reference,
      reason: r.reason,
      billed: r.studentChargeId !== null,
      createdByName: names.get(r.createdBy) ?? "—",
      createdAt: r.createdAt,
    }));
  }

  /** Students or staff to issue or sell to, by name or number. */
  async people(authCtx: AuthContext, query: StorePeopleQuery): Promise<StorePersonDto[]> {
    await assertAnyOf(authCtx, "store.manage", "store.sell");
    const q = query.q.trim();
    return withTenant(authCtx.schoolId, async (db) => {
      if (query.kind === "STUDENT") {
        const students = await db.student.findMany({
          where: {
            status: "ACTIVE",
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { admissionNumber: { contains: q, mode: "insensitive" } },
            ],
          },
          select: { id: true, firstName: true, lastName: true, admissionNumber: true },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          take: 20,
        });
        const classes = await db.enrollment.findMany({
          where: { studentId: { in: students.map((s) => s.id) }, term: { isCurrent: true } },
          select: { studentId: true, classArm: { select: { name: true } } },
        });
        const classOf = new Map(classes.map((c) => [c.studentId, c.classArm.name]));
        return students.map((s) => ({
          id: s.id,
          name: `${s.firstName} ${s.lastName}`,
          detail: [s.admissionNumber, classOf.get(s.id)].filter(Boolean).join(" · "),
        }));
      }
      const users = await db.user.findMany({
        where: {
          isActive: true,
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, roles: { select: { role: { select: { name: true } } } } },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 20,
      });
      return users.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`,
        detail: u.roles.map((r) => r.role.name).join(", ") || null,
      }));
    });
  }

  // ------------------------------------------------------------ stock takes

  async listStockTakes(authCtx: AuthContext): Promise<StoreStockTakeSummaryDto[]> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const takes = await db.storeStockTake.findMany({
        include: { lines: { select: { counted: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const names = await staffNames(db, takes.flatMap((t) => [t.createdBy, ...(t.decidedBy ? [t.decidedBy] : [])]));
      return takes.map((t) => takeSummary(t, names));
    });
  }

  async getStockTake(authCtx: AuthContext, id: string): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, (db) => this.stockTakeDto(db, id));
  }

  private async stockTakeDto(db: PrismaClient, id: string): Promise<StoreStockTakeDto> {
    const take = await db.storeStockTake.findUnique({
      where: { id },
      include: {
        lines: {
          include: { variant: { select: { label: true, sortOrder: true, item: { select: { name: true, category: true } } } } },
        },
      },
    });
    if (!take) throw new NotFoundError("Stock take not found.");
    const live = take.status === "OPEN" ? await stockByVariant(db, take.lines.map((l) => l.variantId)) : null;
    const names = await staffNames(
      db,
      [take.createdBy, take.submittedBy, take.decidedBy].filter((x): x is string => Boolean(x)),
    );
    const lineItems = take.lines
      .map((l) => {
        const expected = live ? (live.get(l.variantId)?.onHand ?? 0) : (l.expected ?? 0);
        return {
          id: l.id,
          itemName: l.variant.item.name,
          variantLabel: l.variant.label,
          category: l.variant.item.category,
          expected,
          counted: l.counted,
          difference: l.counted === null ? null : l.counted - expected,
          sort: l.variant.sortOrder,
        };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.itemName.localeCompare(b.itemName) || a.sort - b.sort)
      .map(({ sort: _sort, ...rest }) => rest);
    return {
      ...takeSummary(take, names),
      submittedByName: take.submittedBy ? (names.get(take.submittedBy) ?? null) : null,
      lineItems,
    };
  }

  async startStockTake(authCtx: AuthContext, input: StartStockTakeInput, reqCtx: RequestContext): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const variants = await db.storeItemVariant.findMany({
        where: { isActive: true, item: { isActive: true } },
        select: { id: true },
      });
      if (variants.length === 0) throw new ValidationError("NOTHING_TO_COUNT", "Add items to the store before a stock take.");
      let id: string;
      try {
        const take = await db.storeStockTake.create({
          data: {
            schoolId: authCtx.schoolId,
            note: input.note ?? null,
            createdBy: authCtx.userId,
            lines: { createMany: { data: variants.map((v) => ({ variantId: v.id })) } },
          },
          select: { id: true },
        });
        id = take.id;
      } catch (e) {
        if (uniqueViolation(e)) {
          throw new ConflictError("STOCK_TAKE_OPEN", "A stock take is already in progress. Finish or cancel it first.");
        }
        throw e;
      }
      await audit(db, authCtx, "store.stocktake.start", "store_stock_take", id, reqCtx, { lines: variants.length });
      return this.stockTakeDto(db, id);
    });
  }

  async saveCounts(authCtx: AuthContext, id: string, input: SaveStockTakeCountsInput): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const take = await this.takeIn(db, id, ["OPEN"]);
      const lineIds = new Set((await db.storeStockTakeLine.findMany({ where: { stockTakeId: take.id }, select: { id: true } })).map((l) => l.id));
      for (const c of input.counts) {
        if (!lineIds.has(c.lineId)) throw new NotFoundError("A count is for a line not on this stock take.");
        await db.storeStockTakeLine.update({ where: { id: c.lineId }, data: { counted: c.counted } });
      }
      return this.stockTakeDto(db, id);
    });
  }

  /** Freezes the expected stock beside each count, for whoever approves it. */
  async submitStockTake(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      await this.takeIn(db, id, ["OPEN"]);
      const lines = await db.storeStockTakeLine.findMany({ where: { stockTakeId: id } });
      if (!lines.some((l) => l.counted !== null)) {
        throw new ValidationError("NOTHING_COUNTED", "Enter at least one count before submitting.");
      }
      const live = await stockByVariant(db, lines.map((l) => l.variantId));
      for (const l of lines) {
        await db.storeStockTakeLine.update({ where: { id: l.id }, data: { expected: live.get(l.variantId)?.onHand ?? 0 } });
      }
      await db.storeStockTake.update({
        where: { id },
        data: { status: "SUBMITTED", submittedBy: authCtx.userId, submittedAt: new Date() },
      });
      await audit(db, authCtx, "store.stocktake.submit", "store_stock_take", id, reqCtx, {
        counted: lines.filter((l) => l.counted !== null).length,
      });
      return this.stockTakeDto(db, id);
    });
  }

  /**
   * Turns each counted difference into an ADJUST movement. The difference is
   * counted − expected as frozen at submission, so anything issued or received
   * between submission and approval still counts.
   */
  async approveStockTake(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.approve");
    return withTenant(authCtx.schoolId, async (db) => {
      const take = await this.takeIn(db, id, ["SUBMITTED"]);
      const lines = await db.storeStockTakeLine.findMany({
        where: { stockTakeId: id, counted: { not: null } },
        include: { variant: { select: { itemId: true } } },
      });
      const day = take.submittedAt ? take.submittedAt.toISOString().slice(0, 10) : lagosTodayIso();
      let adjusted = 0;
      for (const l of lines) {
        const diff = (l.counted ?? 0) - (l.expected ?? 0);
        if (diff === 0) continue;
        await db.storeMovement.create({
          data: {
            schoolId: authCtx.schoolId,
            variantId: l.variantId,
            itemId: l.variant.itemId,
            kind: "ADJUST",
            quantity: diff,
            reason: `Stock take of ${day}`,
            stockTakeId: id,
            createdBy: authCtx.userId,
          },
        });
        adjusted++;
      }
      await db.storeStockTake.update({
        where: { id },
        data: { status: "APPROVED", decidedBy: authCtx.userId, decidedAt: new Date() },
      });
      await audit(db, authCtx, "store.stocktake.approve", "store_stock_take", id, reqCtx, { adjusted });
      return this.stockTakeDto(db, id);
    });
  }

  async cancelStockTake(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<StoreStockTakeDto> {
    await assertAnyOf(authCtx, "store.manage", "store.approve");
    return withTenant(authCtx.schoolId, async (db) => {
      await this.takeIn(db, id, ["OPEN", "SUBMITTED"]);
      await db.storeStockTake.update({
        where: { id },
        data: { status: "CANCELLED", decidedBy: authCtx.userId, decidedAt: new Date() },
      });
      await audit(db, authCtx, "store.stocktake.cancel", "store_stock_take", id, reqCtx, {});
      return this.stockTakeDto(db, id);
    });
  }

  private async takeIn(db: PrismaClient, id: string, allowed: StoreStockTakeStatus[]) {
    const take = await db.storeStockTake.findUnique({ where: { id } });
    if (!take) throw new NotFoundError("Stock take not found.");
    if (!allowed.includes(take.status)) {
      throw new ValidationError("STOCK_TAKE_STATE", `This stock take is ${take.status.toLowerCase()}.`);
    }
    return take;
  }

  // ---------------------------------------------------------------- reports

  async stockReport(authCtx: AuthContext): Promise<StoreStockReportDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const items = await db.storeItem.findMany({
        where: { isActive: true },
        include: { variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      });
      const stock = await stockByVariant(db, items.flatMap((i) => i.variants.map((v) => v.id)));
      const rows = items.flatMap((item) => {
        const itemOnHand = item.variants.reduce((n, v) => n + (stock.get(v.id)?.onHand ?? 0), 0);
        const itemLow = item.reorderLevel > 0 && itemOnHand <= item.reorderLevel;
        return item.variants.map((v) => {
          const s = stock.get(v.id) ?? NO_STOCK;
          return {
            itemId: item.id,
            itemName: item.name,
            code: item.code,
            category: item.category,
            variantLabel: v.label,
            unit: item.unit,
            onHand: s.onHand,
            reorderLevel: item.reorderLevel,
            low: itemLow,
            averageCost: s.averageCost,
            value: Math.max(0, s.onHand) * (s.averageCost ?? 0),
          };
        });
      });
      return { rows, totalValue: rows.reduce((n, r) => n + r.value, 0) };
    });
  }

  async salesReport(authCtx: AuthContext, query: StoreReportRangeQuery): Promise<StoreSalesReportDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const sales = await db.storeMovement.findMany({
        where: {
          kind: "SELL",
          ...(query.from || query.to
            ? {
                createdAt: {
                  ...(query.from ? { gte: lagosDayStart(query.from) } : {}),
                  ...(query.to ? { lt: lagosDayStart(query.to, 1) } : {}),
                },
              }
            : {}),
        },
        include: { item: { select: { name: true } }, variant: { select: { label: true } } },
      });
      const byVariant = new Map<string, { itemId: string; itemName: string; variantLabel: string | null; quantity: number; amount: number }>();
      for (const s of sales) {
        const row = byVariant.get(s.variantId) ?? {
          itemId: s.itemId,
          itemName: s.item.name,
          variantLabel: s.variant.label,
          quantity: 0,
          amount: 0,
        };
        row.quantity += -s.quantity;
        row.amount += -s.quantity * (s.unitPrice ?? 0);
        byVariant.set(s.variantId, row);
      }
      const rows = [...byVariant.values()].sort((a, b) => b.amount - a.amount || a.itemName.localeCompare(b.itemName));
      return {
        from: query.from ?? null,
        to: query.to ?? null,
        rows,
        totalQuantity: rows.reduce((n, r) => n + r.quantity, 0),
        totalAmount: rows.reduce((n, r) => n + r.amount, 0),
      };
    });
  }
}

// -------------------------------------------------------------------- helpers

function summaryOf(
  item: {
    id: string;
    name: string;
    code: string | null;
    category: StoreItemSummaryDto["category"];
    unit: string;
    reorderLevel: number;
    sellPrice: number | null;
    isActive: boolean;
  },
  variants: { id: string }[],
  stock: Map<string, Stock>,
): StoreItemSummaryDto {
  let onHand = 0;
  let stockValue = 0;
  for (const v of variants) {
    const s = stock.get(v.id) ?? NO_STOCK;
    onHand += s.onHand;
    stockValue += Math.max(0, s.onHand) * (s.averageCost ?? 0);
  }
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    category: item.category,
    unit: item.unit,
    reorderLevel: item.reorderLevel,
    sellPrice: item.sellPrice,
    isActive: item.isActive,
    onHand,
    low: item.reorderLevel > 0 && onHand <= item.reorderLevel,
    stockValue,
    sizes: variants.length,
  };
}

function takeSummary(
  t: {
    id: string;
    status: StoreStockTakeStatus;
    note: string | null;
    createdBy: string;
    createdAt: Date;
    submittedAt: Date | null;
    decidedBy: string | null;
    decidedAt: Date | null;
    lines: { counted: number | null }[];
  },
  names: Map<string, string>,
): StoreStockTakeSummaryDto {
  return {
    id: t.id,
    status: t.status,
    note: t.note,
    lines: t.lines.length,
    counted: t.lines.filter((l) => l.counted !== null).length,
    createdByName: names.get(t.createdBy) ?? "—",
    createdAt: t.createdAt,
    submittedAt: t.submittedAt,
    decidedByName: t.decidedBy ? (names.get(t.decidedBy) ?? null) : null,
    decidedAt: t.decidedAt,
  };
}

/** Case-insensitively distinct labels, first spelling kept. */
export function dedupeLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of labels) {
    const k = l.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(l.trim());
  }
  return out;
}

/** Midnight in Lagos (UTC+1) at the start of `iso`, plus `addDays`. */
export function lagosDayStart(iso: string, addDays = 0): Date {
  const d = new Date(`${iso}T00:00:00.000+01:00`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d;
}

async function audit(
  db: PrismaClient,
  authCtx: AuthContext,
  action: string,
  entityType: string,
  entityId: string,
  reqCtx: RequestContext,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action,
      entityType,
      entityId,
      ipAddress: reqCtx.ipAddress,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
