import { z } from "zod";

// The fixed-assets register (2026-10-19, docs/modules/id-cards-and-store.md
// §4, owner's answer 4): computers, projectors, furniture, laboratory
// equipment and the like. Every move, assignment, condition and status change
// is kept as history. Money is kobo.

export const fixedAssetCategoryValues = [
  "ICT",
  "FURNITURE",
  "LABORATORY",
  "SPORTS",
  "AUDIO_VISUAL",
  "VEHICLE",
  "KITCHEN",
  "BUILDING",
  "OTHER",
] as const;
export type FixedAssetCategory = (typeof fixedAssetCategoryValues)[number];
export const FIXED_ASSET_CATEGORY_LABELS: Record<FixedAssetCategory, string> = {
  ICT: "Computers & ICT",
  FURNITURE: "Furniture",
  LABORATORY: "Laboratory",
  SPORTS: "Sports",
  AUDIO_VISUAL: "Audio-visual",
  VEHICLE: "Vehicles",
  KITCHEN: "Kitchen",
  BUILDING: "Building & fittings",
  OTHER: "Other",
};

export const fixedAssetConditionValues = ["NEW", "GOOD", "FAIR", "POOR", "BROKEN"] as const;
export type FixedAssetCondition = (typeof fixedAssetConditionValues)[number];
export const FIXED_ASSET_CONDITION_LABELS: Record<FixedAssetCondition, string> = {
  NEW: "New",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  BROKEN: "Broken",
};

export const fixedAssetStatusValues = ["IN_USE", "IN_STORE", "UNDER_REPAIR", "DISPOSED"] as const;
export type FixedAssetStatus = (typeof fixedAssetStatusValues)[number];
export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  IN_USE: "In use",
  IN_STORE: "In store",
  UNDER_REPAIR: "Under repair",
  DISPOSED: "Disposed",
};

export type FixedAssetEventKind = "ADDED" | "MOVED" | "ASSIGNED" | "CONDITION" | "STATUS" | "EDITED";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const assetFields = {
  tag: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  category: z.enum(fixedAssetCategoryValues),
  location: optionalText(120),
  assignedToUserId: z.string().uuid().nullable().optional(),
  assignedToText: optionalText(120),
  condition: z.enum(fixedAssetConditionValues),
  status: z.enum(["IN_USE", "IN_STORE", "UNDER_REPAIR"] as const),
  serialNumber: optionalText(80),
  supplier: optionalText(120),
  purchaseDate: z.string().date().nullable().optional(),
  purchaseCost: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  notes: optionalText(500),
};

export const createFixedAssetSchema = z
  .object({
    ...assetFields,
    condition: assetFields.condition.default("GOOD"),
    status: assetFields.status.default("IN_USE"),
  })
  .strict();
export type CreateFixedAssetInput = z.infer<typeof createFixedAssetSchema>;

export const updateFixedAssetSchema = z
  .object({
    tag: assetFields.tag.optional(),
    name: assetFields.name.optional(),
    category: assetFields.category.optional(),
    location: assetFields.location,
    assignedToUserId: assetFields.assignedToUserId,
    assignedToText: assetFields.assignedToText,
    condition: assetFields.condition.optional(),
    status: assetFields.status.optional(),
    serialNumber: assetFields.serialNumber,
    supplier: assetFields.supplier,
    purchaseDate: assetFields.purchaseDate,
    purchaseCost: assetFields.purchaseCost,
    notes: assetFields.notes,
    /** Why it moved or changed, kept on the history line. */
    note: optionalText(200),
  })
  .strict()
  .refine((v) => Object.keys(v).filter((k) => k !== "note").length > 0, "Nothing to change.");
export type UpdateFixedAssetInput = z.infer<typeof updateFixedAssetSchema>;

export const disposeFixedAssetSchema = z
  .object({
    disposedOn: z.string().date(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type DisposeFixedAssetInput = z.infer<typeof disposeFixedAssetSchema>;

export const listFixedAssetsQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    category: z.enum(fixedAssetCategoryValues).optional(),
    status: z.enum(fixedAssetStatusValues).optional(),
  })
  .strict();
export type ListFixedAssetsQuery = z.infer<typeof listFixedAssetsQuerySchema>;

export interface FixedAssetSummaryDto {
  id: string;
  tag: string;
  name: string;
  category: FixedAssetCategory;
  location: string | null;
  /** The person's name, or the department or class. */
  assignedTo: string | null;
  assignedToUserId: string | null;
  assignedToText: string | null;
  condition: FixedAssetCondition;
  status: FixedAssetStatus;
  purchaseDate: string | null;
  purchaseCost: number | null;
}

export interface FixedAssetEventDto {
  id: string;
  kind: FixedAssetEventKind;
  fromValue: string | null;
  toValue: string | null;
  note: string | null;
  createdByName: string;
  createdAt: string | Date;
}

export interface FixedAssetDto extends FixedAssetSummaryDto {
  serialNumber: string | null;
  supplier: string | null;
  notes: string | null;
  disposedAt: string | null;
  disposalReason: string | null;
  events: FixedAssetEventDto[];
}

export interface FixedAssetListDto {
  data: FixedAssetSummaryDto[];
  /** Sum of purchase cost of everything not disposed, kobo. */
  totalCost: number;
}
