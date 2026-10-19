import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  FIXED_ASSET_CONDITION_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  NotFoundError,
  ValidationError,
  type CreateFixedAssetInput,
  type DisposeFixedAssetInput,
  type FixedAssetDto,
  type FixedAssetEventKind,
  type FixedAssetListDto,
  type FixedAssetSummaryDto,
  type ListFixedAssetsQuery,
  type UpdateFixedAssetInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertAnyOf, isoDate, staffNames, type RequestContext } from "./store.shared.js";

// The fixed-assets register (2026-10-19, docs/modules/id-cards-and-store.md
// §4, owner's answer 4). asset.read sees it (storekeeper, bursar, admin);
// asset.manage keeps it (storekeeper, admin). Every move, assignment,
// condition and status change becomes a history line, so "where did the
// projector go?" has an answer.

type AssetRow = Prisma.FixedAssetGetPayload<object>;

function day(iso: string | null | undefined): Date | null | undefined {
  if (iso === undefined) return undefined;
  return iso === null ? null : new Date(`${iso}T00:00:00.000Z`);
}

function uniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

@Injectable()
export class AssetsService {
  async list(authCtx: AuthContext, query: ListFixedAssetsQuery): Promise<FixedAssetListDto> {
    await assertAnyOf(authCtx, "asset.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const q = query.q?.trim();
      const rows = await db.fixedAsset.findMany({
        where: {
          ...(query.category ? { category: query.category } : {}),
          ...(query.status ? { status: query.status } : { status: { not: "DISPOSED" } }),
          ...(q
            ? {
                OR: [
                  { tag: { contains: q, mode: "insensitive" } },
                  { name: { contains: q, mode: "insensitive" } },
                  { location: { contains: q, mode: "insensitive" } },
                  { serialNumber: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        orderBy: [{ category: "asc" }, { tag: "asc" }],
      });
      const names = await staffNames(db, rows.flatMap((r) => (r.assignedToUserId ? [r.assignedToUserId] : [])));
      const data = rows.map((r) => summary(r, names));
      return {
        data,
        totalCost: rows.filter((r) => r.status !== "DISPOSED").reduce((n, r) => n + (r.purchaseCost ?? 0), 0),
      };
    });
  }

  async get(authCtx: AuthContext, id: string): Promise<FixedAssetDto> {
    await assertAnyOf(authCtx, "asset.read");
    return withTenant(authCtx.schoolId, (db) => this.dto(db, id));
  }

  async create(authCtx: AuthContext, input: CreateFixedAssetInput, reqCtx: RequestContext): Promise<FixedAssetDto> {
    await assertAnyOf(authCtx, "asset.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertAssignee(db, input.assignedToUserId ?? null);
      let id: string;
      try {
        const row = await db.fixedAsset.create({
          data: {
            schoolId: authCtx.schoolId,
            tag: input.tag,
            name: input.name,
            category: input.category,
            location: input.location ?? null,
            assignedToUserId: input.assignedToUserId ?? null,
            assignedToText: input.assignedToUserId ? null : (input.assignedToText ?? null),
            condition: input.condition,
            status: input.status,
            serialNumber: input.serialNumber ?? null,
            supplier: input.supplier ?? null,
            purchaseDate: day(input.purchaseDate) ?? null,
            purchaseCost: input.purchaseCost ?? null,
            notes: input.notes ?? null,
            createdBy: authCtx.userId,
          },
          select: { id: true },
        });
        id = row.id;
      } catch (e) {
        if (uniqueViolation(e)) throw new ConflictError("TAG_TAKEN", "Another asset already has that tag number.");
        throw e;
      }
      await this.event(db, authCtx, id, "ADDED", null, input.location ?? null, null);
      await audit(db, authCtx, "asset.create", id, reqCtx, { tag: input.tag });
      return this.dto(db, id);
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateFixedAssetInput,
    reqCtx: RequestContext,
  ): Promise<FixedAssetDto> {
    await assertAnyOf(authCtx, "asset.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const before = await db.fixedAsset.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Asset not found.");
      if (before.status === "DISPOSED") {
        throw new ValidationError("ASSET_DISPOSED", "This asset has been disposed of and can no longer change.");
      }
      if (input.assignedToUserId !== undefined) await this.assertAssignee(db, input.assignedToUserId);
      const note = input.note ?? null;

      // Assigning to a person clears a department, and the other way round.
      const assignedToUserId =
        input.assignedToUserId !== undefined ? input.assignedToUserId : input.assignedToText ? null : undefined;
      const assignedToText =
        input.assignedToText !== undefined ? input.assignedToText : input.assignedToUserId ? null : undefined;

      let after: AssetRow;
      try {
        after = await db.fixedAsset.update({
          where: { id },
          data: {
            ...(input.tag !== undefined ? { tag: input.tag } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.location !== undefined ? { location: input.location } : {}),
            ...(assignedToUserId !== undefined ? { assignedToUserId } : {}),
            ...(assignedToText !== undefined ? { assignedToText } : {}),
            ...(input.condition !== undefined ? { condition: input.condition } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
            ...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
            ...(input.purchaseDate !== undefined ? { purchaseDate: day(input.purchaseDate) } : {}),
            ...(input.purchaseCost !== undefined ? { purchaseCost: input.purchaseCost } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          },
        });
      } catch (e) {
        if (uniqueViolation(e)) throw new ConflictError("TAG_TAKEN", "Another asset already has that tag number.");
        throw e;
      }

      const names = await staffNames(
        db,
        [before.assignedToUserId, after.assignedToUserId].filter((x): x is string => Boolean(x)),
      );
      const holder = (r: AssetRow) =>
        r.assignedToUserId ? (names.get(r.assignedToUserId) ?? "a member of staff") : r.assignedToText;

      let logged = false;
      if ((before.location ?? null) !== (after.location ?? null)) {
        await this.event(db, authCtx, id, "MOVED", before.location, after.location, note);
        logged = true;
      }
      if (holder(before) !== holder(after)) {
        await this.event(db, authCtx, id, "ASSIGNED", holder(before), holder(after), note);
        logged = true;
      }
      if (before.condition !== after.condition) {
        await this.event(
          db,
          authCtx,
          id,
          "CONDITION",
          FIXED_ASSET_CONDITION_LABELS[before.condition],
          FIXED_ASSET_CONDITION_LABELS[after.condition],
          note,
        );
        logged = true;
      }
      if (before.status !== after.status) {
        await this.event(
          db,
          authCtx,
          id,
          "STATUS",
          FIXED_ASSET_STATUS_LABELS[before.status],
          FIXED_ASSET_STATUS_LABELS[after.status],
          note,
        );
        logged = true;
      }
      const other = Object.keys(input).filter(
        (k) => !["location", "assignedToUserId", "assignedToText", "condition", "status", "note"].includes(k),
      );
      if (other.length > 0 || !logged) {
        await this.event(db, authCtx, id, "EDITED", null, null, note ?? `Changed: ${other.join(", ") || "details"}`);
      }
      await audit(db, authCtx, "asset.update", id, reqCtx, { fields: Object.keys(input) });
      return this.dto(db, id);
    });
  }

  async dispose(
    authCtx: AuthContext,
    id: string,
    input: DisposeFixedAssetInput,
    reqCtx: RequestContext,
  ): Promise<FixedAssetDto> {
    await assertAnyOf(authCtx, "asset.manage");
    return withTenant(authCtx.schoolId, async (db) => {
      const before = await db.fixedAsset.findUnique({ where: { id } });
      if (!before) throw new NotFoundError("Asset not found.");
      if (before.status === "DISPOSED") throw new ValidationError("ASSET_DISPOSED", "This asset is already disposed of.");
      await db.fixedAsset.update({
        where: { id },
        data: { status: "DISPOSED", disposedAt: day(input.disposedOn), disposalReason: input.reason },
      });
      await this.event(db, authCtx, id, "STATUS", FIXED_ASSET_STATUS_LABELS[before.status], "Disposed", input.reason);
      await audit(db, authCtx, "asset.dispose", id, reqCtx, { reason: input.reason });
      return this.dto(db, id);
    });
  }

  private async assertAssignee(db: PrismaClient, userId: string | null): Promise<void> {
    if (!userId) return;
    const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    if (!user?.isActive) throw new NotFoundError("Staff member not found.");
  }

  private async event(
    db: PrismaClient,
    authCtx: AuthContext,
    assetId: string,
    kind: FixedAssetEventKind,
    fromValue: string | null,
    toValue: string | null,
    note: string | null,
  ): Promise<void> {
    await db.fixedAssetEvent.create({
      data: { schoolId: authCtx.schoolId, assetId, kind, fromValue, toValue, note, createdBy: authCtx.userId },
    });
  }

  private async dto(db: PrismaClient, id: string): Promise<FixedAssetDto> {
    const row = await db.fixedAsset.findUnique({
      where: { id },
      include: { events: { orderBy: { createdAt: "desc" } } },
    });
    if (!row) throw new NotFoundError("Asset not found.");
    const names = await staffNames(db, [
      ...(row.assignedToUserId ? [row.assignedToUserId] : []),
      ...row.events.map((e) => e.createdBy),
    ]);
    return {
      ...summary(row, names),
      serialNumber: row.serialNumber,
      supplier: row.supplier,
      notes: row.notes,
      disposedAt: isoDate(row.disposedAt),
      disposalReason: row.disposalReason,
      events: row.events.map((e) => ({
        id: e.id,
        kind: e.kind,
        fromValue: e.fromValue,
        toValue: e.toValue,
        note: e.note,
        createdByName: names.get(e.createdBy) ?? "—",
        createdAt: e.createdAt,
      })),
    };
  }
}

function summary(r: AssetRow, names: Map<string, string>): FixedAssetSummaryDto {
  return {
    id: r.id,
    tag: r.tag,
    name: r.name,
    category: r.category,
    location: r.location,
    assignedTo: r.assignedToUserId ? (names.get(r.assignedToUserId) ?? null) : r.assignedToText,
    assignedToUserId: r.assignedToUserId,
    assignedToText: r.assignedToText,
    condition: r.condition,
    status: r.status,
    purchaseDate: isoDate(r.purchaseDate),
    purchaseCost: r.purchaseCost,
  };
}

async function audit(
  db: PrismaClient,
  authCtx: AuthContext,
  action: string,
  assetId: string,
  reqCtx: RequestContext,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action,
      entityType: "fixed_asset",
      entityId: assetId,
      ipAddress: reqCtx.ipAddress,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
