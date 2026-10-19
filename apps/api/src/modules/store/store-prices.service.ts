import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type { PortalStorePriceListDto, StoreSettingsDto, UpdateStoreSettingsInput } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { stockByVariant } from "./store.service.js";
import { assertAnyOf, type RequestContext } from "./store.shared.js";

// The store's price list for parents (2026-10-19, id-cards-and-store.md §4b):
// what the school sells and for how much, read-only. A parent sees an item
// only when it is stocked and has a selling price; each size says "available"
// or not, never how many. The school switches the list off on the Store page.

@Injectable()
export class StorePricesService {
  /** GET /store/settings: anyone who can see the store. */
  async settings(authCtx: AuthContext): Promise<StoreSettingsDto> {
    await assertAnyOf(authCtx, "store.read");
    return withTenant(authCtx.schoolId, async (db) => {
      const school = await db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: { storePricesForParents: true } });
      return { pricesForParents: school.storePricesForParents };
    });
  }

  /** PUT /store/settings: what parents are shown is the school's call, so owner and admin. */
  async updateSettings(authCtx: AuthContext, input: UpdateStoreSettingsInput, reqCtx: RequestContext): Promise<StoreSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await db.school.update({ where: { id: authCtx.schoolId }, data: { storePricesForParents: input.pricesForParents } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "store.settings.update",
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { pricesForParents: input.pricesForParents },
        },
      });
      return { pricesForParents: input.pricesForParents };
    });
  }

  /** GET /portal/store/prices */
  async forParent(g: GuardianAuthContext): Promise<PortalStorePriceListDto> {
    return withTenant(g.schoolId, async (db) => {
      const school = await db.school.findUniqueOrThrow({ where: { id: g.schoolId }, select: { storePricesForParents: true } });
      if (!school.storePricesForParents) return { shown: false, items: [] };
      const items = await db.storeItem.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          category: true,
          unit: true,
          sellPrice: true,
          variants: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, label: true, sellPrice: true } },
        },
        take: 500,
      });
      const stock = await stockByVariant(db, items.flatMap((i) => i.variants.map((v) => v.id)));
      return {
        shown: true,
        items: items
          .map((i) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            unit: i.unit,
            sizes: i.variants
              .map((v) => ({ label: v.label, price: v.sellPrice ?? i.sellPrice, available: (stock.get(v.id)?.onHand ?? 0) > 0 }))
              .filter((v): v is { label: string | null; price: number; available: boolean } => v.price !== null),
          }))
          .filter((i) => i.sizes.length > 0),
      };
    });
  }
}
