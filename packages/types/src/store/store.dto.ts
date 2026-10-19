import { z } from "zod";

// The Store (2026-10-19, docs/modules/id-cards-and-store.md §4).
//
// Items with optional sizes (variants); stock is kept per variant and is the
// sum of a ledger of movements, never an edited number. Money is kobo.

export const storeCategoryValues = [
  "UNIFORM",
  "TEXTBOOK",
  "STATIONERY",
  "LABORATORY",
  "SPORTS",
  "ICT",
  "CLEANING",
  "KITCHEN",
  "OTHER",
] as const;
export type StoreCategory = (typeof storeCategoryValues)[number];
export const STORE_CATEGORY_LABELS: Record<StoreCategory, string> = {
  UNIFORM: "Uniforms",
  TEXTBOOK: "Textbooks",
  STATIONERY: "Stationery",
  LABORATORY: "Laboratory",
  SPORTS: "Sports",
  ICT: "ICT",
  CLEANING: "Cleaning",
  KITCHEN: "Kitchen",
  OTHER: "Other",
};

export const storeMovementKindValues = ["RECEIVE", "ISSUE", "SELL", "RETURN", "WRITE_OFF", "ADJUST"] as const;
export type StoreMovementKind = (typeof storeMovementKindValues)[number];
export const STORE_MOVEMENT_LABELS: Record<StoreMovementKind, string> = {
  RECEIVE: "Received",
  ISSUE: "Issued",
  SELL: "Sold",
  RETURN: "Returned",
  WRITE_OFF: "Written off",
  ADJUST: "Stock-take adjustment",
};

/** ₦10,000,000 in kobo, the database's ceiling for one price. */
export const MAX_STORE_PRICE_KOBO = 1_000_000_000;
export const MAX_STORE_QUANTITY = 100_000;

const kobo = z.number().int().min(1).max(MAX_STORE_PRICE_KOBO);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();
const quantity = z.number().int().min(1).max(MAX_STORE_QUANTITY);

// ------------------------------------------------------------------ items

export const createStoreItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    code: optionalText(40),
    category: z.enum(storeCategoryValues),
    unit: z.string().trim().min(1).max(30).default("piece"),
    reorderLevel: z.number().int().min(0).max(MAX_STORE_QUANTITY).default(0),
    sellPrice: kobo.nullable().optional(),
    notes: optionalText(500),
    /** Sizes, e.g. ["Size 8", "Size 10"]; none for an item without sizes. */
    variants: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
  })
  .strict();
export type CreateStoreItemInput = z.infer<typeof createStoreItemSchema>;

export const updateStoreItemSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    code: optionalText(40),
    category: z.enum(storeCategoryValues).optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    reorderLevel: z.number().int().min(0).max(MAX_STORE_QUANTITY).optional(),
    sellPrice: kobo.nullable().optional(),
    notes: optionalText(500),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");
export type UpdateStoreItemInput = z.infer<typeof updateStoreItemSchema>;

export const addStoreVariantSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    sellPrice: kobo.nullable().optional(),
  })
  .strict();
export type AddStoreVariantInput = z.infer<typeof addStoreVariantSchema>;

export const updateStoreVariantSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    sellPrice: kobo.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");
export type UpdateStoreVariantInput = z.infer<typeof updateStoreVariantSchema>;

export const listStoreItemsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    category: z.enum(storeCategoryValues).optional(),
    /** "true": only items at or below their reorder level. */
    low: z.enum(["true", "false"]).optional(),
    includeInactive: z.enum(["true", "false"]).optional(),
  })
  .strict();
export type ListStoreItemsQuery = z.infer<typeof listStoreItemsQuerySchema>;

export interface StoreVariantDto {
  id: string;
  /** Null for an item without sizes. */
  label: string | null;
  sellPrice: number | null;
  /** The price a sale uses: the variant's, else the item's; null = not for sale. */
  effectivePrice: number | null;
  onHand: number;
  /** Weighted average of what was paid for it (kobo), null if never costed. */
  averageCost: number | null;
  isActive: boolean;
}

export interface StoreItemSummaryDto {
  id: string;
  name: string;
  code: string | null;
  category: StoreCategory;
  unit: string;
  reorderLevel: number;
  sellPrice: number | null;
  isActive: boolean;
  onHand: number;
  /** At or below the reorder level (only when a level is set). */
  low: boolean;
  /** onHand × average cost, kobo. */
  stockValue: number;
  sizes: number;
}

export interface StoreItemDto extends StoreItemSummaryDto {
  notes: string | null;
  variants: StoreVariantDto[];
  movements: StoreMovementDto[];
}

// -------------------------------------------------------------- movements

const target = {
  studentId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  department: z.string().trim().min(1).max(80).optional(),
};

export const recordStoreMovementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("RECEIVE"),
      variantId: z.string().uuid(),
      quantity,
      unitCost: z.number().int().min(0).max(MAX_STORE_PRICE_KOBO).nullable().optional(),
      supplier: optionalText(120),
      reference: optionalText(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("ISSUE"),
      variantId: z.string().uuid(),
      quantity,
      ...target,
      reason: optionalText(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SELL"),
      variantId: z.string().uuid(),
      quantity,
      studentId: z.string().uuid(),
      /** Defaults to the item's selling price. */
      unitPrice: kobo.optional(),
      reference: optionalText(80),
    })
    .strict(),
  z
    .object({
      kind: z.literal("RETURN"),
      variantId: z.string().uuid(),
      quantity,
      ...target,
      reason: optionalText(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("WRITE_OFF"),
      variantId: z.string().uuid(),
      quantity,
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
]).superRefine((v, ctx) => {
  if (v.kind === "ISSUE" && [v.studentId, v.userId, v.department].filter(Boolean).length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose who it is issued to: a student, a member of staff, or a department.",
    });
  }
  if (v.kind === "RETURN" && [v.studentId, v.userId, v.department].filter(Boolean).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose one person or department it came back from." });
  }
});
export type RecordStoreMovementInput = z.infer<typeof recordStoreMovementSchema>;

export interface StoreMovementDto {
  id: string;
  kind: StoreMovementKind;
  quantity: number;
  itemId: string;
  itemName: string;
  variantLabel: string | null;
  unitCost: number | null;
  unitPrice: number | null;
  /** "Ada Obi (SKA-0042)", a staff name, or the department. */
  party: string | null;
  supplier: string | null;
  reference: string | null;
  reason: string | null;
  /** The bill a sale raised. */
  billed: boolean;
  createdByName: string;
  createdAt: string | Date;
}

export const listStoreMovementsQuerySchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    kind: z.enum(storeMovementKindValues).optional(),
    itemId: z.string().uuid().optional(),
  })
  .strict();
export type ListStoreMovementsQuery = z.infer<typeof listStoreMovementsQuerySchema>;

// ------------------------------------------------------------ stock takes

export type StoreStockTakeStatus = "OPEN" | "SUBMITTED" | "APPROVED" | "CANCELLED";

export interface StoreStockTakeSummaryDto {
  id: string;
  status: StoreStockTakeStatus;
  note: string | null;
  lines: number;
  counted: number;
  createdByName: string;
  createdAt: string | Date;
  submittedAt: string | Date | null;
  decidedByName: string | null;
  decidedAt: string | Date | null;
}

export interface StoreStockTakeLineDto {
  id: string;
  itemName: string;
  variantLabel: string | null;
  category: StoreCategory;
  /** Live stock while open; the stock when submitted afterwards. */
  expected: number;
  counted: number | null;
  /** counted − expected, once counted. */
  difference: number | null;
}

export interface StoreStockTakeDto extends StoreStockTakeSummaryDto {
  submittedByName: string | null;
  lineItems: StoreStockTakeLineDto[];
}

export const startStockTakeSchema = z.object({ note: optionalText(200) }).strict();
export type StartStockTakeInput = z.infer<typeof startStockTakeSchema>;

export const saveStockTakeCountsSchema = z
  .object({
    counts: z
      .array(
        z.object({
          lineId: z.string().uuid(),
          counted: z.number().int().min(0).max(MAX_STORE_QUANTITY).nullable(),
        }),
      )
      .min(1)
      .max(5000),
  })
  .strict();
export type SaveStockTakeCountsInput = z.infer<typeof saveStockTakeCountsSchema>;

// ---------------------------------------------------------------- reports

export const storeReportRangeQuerySchema = z
  .object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .strict();
export type StoreReportRangeQuery = z.infer<typeof storeReportRangeQuerySchema>;

export interface StoreStockReportRowDto {
  itemId: string;
  itemName: string;
  code: string | null;
  category: StoreCategory;
  variantLabel: string | null;
  unit: string;
  onHand: number;
  reorderLevel: number;
  low: boolean;
  averageCost: number | null;
  value: number;
}

export interface StoreStockReportDto {
  rows: StoreStockReportRowDto[];
  totalValue: number;
}

export interface StoreSalesReportRowDto {
  itemId: string;
  itemName: string;
  variantLabel: string | null;
  quantity: number;
  amount: number;
}

export interface StoreSalesReportDto {
  from: string | null;
  to: string | null;
  rows: StoreSalesReportRowDto[];
  totalQuantity: number;
  totalAmount: number;
}

/** A person to issue or sell to: GET /store/people?kind=&q= */
export interface StorePersonDto {
  id: string;
  name: string;
  /** Admission number and class for a student; role for staff. */
  detail: string | null;
}
export const storePeopleQuerySchema = z
  .object({
    kind: z.enum(["STUDENT", "STAFF"]),
    q: z.string().trim().min(1).max(60),
  })
  .strict();
export type StorePeopleQuery = z.infer<typeof storePeopleQuerySchema>;

// ----------------------------------------------------- the parents' price list
//
// 2026-10-19: what the store sells and the price, for parents on the portal and
// the parent app. Read-only: no ordering (owner, 2026-10-19). Only items and
// sizes with a selling price; "available" rather than a count, because stock
// levels are the school's business.

/** GET/PUT /store/settings */
export interface StoreSettingsDto {
  pricesForParents: boolean;
}
export const updateStoreSettingsSchema = z.object({ pricesForParents: z.boolean() }).strict();
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

export interface PortalStorePriceDto {
  /** The size, or null for an item without sizes. */
  label: string | null;
  /** Kobo. */
  price: number;
  available: boolean;
}

export interface PortalStoreItemDto {
  id: string;
  name: string;
  category: StoreCategory;
  unit: string;
  sizes: PortalStorePriceDto[];
}

/** GET /portal/store/prices. `shown` false: the school has switched the list off. */
export interface PortalStorePriceListDto {
  shown: boolean;
  items: PortalStoreItemDto[];
}
