import { z } from "zod";

import type { StoreStudentBilling } from "./store.dto.js";

// Store orders (2026-11-11, docs/modules/store-orders.md).
//
// One buyer, many lines, one total. A student's order is billed on the fees
// invoice or on a store invoice of its own (the school decides, and may let the
// seller choose); a member of staff or a walk-in buyer pays at the counter.
// Each line is handed over now or later. Prices always come from the server.

export const storeOrderBuyerValues = ["STUDENT", "STAFF", "WALK_IN"] as const;
export type StoreOrderBuyer = (typeof storeOrderBuyerValues)[number];

export const storeOrderBillingValues = ["FEES_INVOICE", "STORE_INVOICE", "COUNTER"] as const;
export type StoreOrderBilling = (typeof storeOrderBillingValues)[number];
export const STORE_ORDER_BILLING_LABELS: Record<StoreOrderBilling, string> = {
  FEES_INVOICE: "On the fees invoice",
  STORE_INVOICE: "Store invoice",
  COUNTER: "Paid at the counter",
};

export const storeCounterMethodValues = ["CASH", "POS", "BANK_TRANSFER"] as const;
export type StoreCounterMethod = (typeof storeCounterMethodValues)[number];
export const STORE_COUNTER_METHOD_LABELS: Record<StoreCounterMethod, string> = {
  CASH: "Cash",
  POS: "POS",
  BANK_TRANSFER: "Bank transfer",
};

export type StoreOrderStatus = "ACTIVE" | "CANCELLED";

/** Lines in one order, and children in one class sale. */
export const MAX_ORDER_LINES = 100;
export const MAX_CLASS_SALE_CHILDREN = 200;

/** "SO-000042" */
export function formatStoreOrderNumber(n: number): string {
  return `SO-${String(n).padStart(6, "0")}`;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const orderLineInput = z
  .object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(1000),
    /** Handed over at the counter now; otherwise it waits to be collected. */
    collectNow: z.boolean(),
  })
  .strict();

export const createStoreOrderSchema = z
  .object({
    /** One per checkout form, reused on a retry: a repeat returns the first order. */
    idempotencyKey: z.string().uuid(),
    buyer: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("STUDENT"), studentId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal("STAFF"), userId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal("WALK_IN"), name: optionalText(80) }).strict(),
    ]),
    /** Students only. Omitted: the school's default. */
    billing: z.enum(["FEES_INVOICE", "STORE_INVOICE"]).optional(),
    /** Staff and walk-in buyers only: how they paid at the counter. */
    counter: z
      .object({ method: z.enum(storeCounterMethodValues), reference: optionalText(80) })
      .strict()
      .optional(),
    packId: z.string().uuid().optional(),
    note: optionalText(200),
    lines: z.array(orderLineInput).min(1).max(MAX_ORDER_LINES),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.lines.map((l) => l.variantId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each item and size appears once; change its quantity instead." });
    }
    if (v.buyer.kind === "STUDENT" && v.counter) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A student's order is billed; record the payment on its invoice." });
    }
    if (v.buyer.kind !== "STUDENT" && v.billing) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only a student's order goes on an invoice." });
    }
    if (v.buyer.kind !== "STUDENT" && !v.counter) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Say how the buyer paid." });
    }
  });
export type CreateStoreOrderInput = z.infer<typeof createStoreOrderSchema>;

/** POST /store/orders/preview: prices and stock for a cart, nothing written. */
export const previewStoreOrderSchema = z
  .object({ lines: z.array(orderLineInput).min(1).max(MAX_ORDER_LINES) })
  .strict();
export type PreviewStoreOrderInput = z.infer<typeof previewStoreOrderSchema>;

export interface StoreOrderPreviewLineDto {
  variantId: string;
  name: string;
  unitPrice: number | null;
  amount: number | null;
  onHand: number;
  /** Why this line cannot be sold as it stands, in words; null when it can. */
  problem: string | null;
}

export interface StoreOrderPreviewDto {
  lines: StoreOrderPreviewLineDto[];
  /** Null while any line has a problem. */
  total: number | null;
}

export const collectStoreOrderSchema = z
  .object({
    lines: z
      .array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }).strict())
      .min(1)
      .max(MAX_ORDER_LINES),
  })
  .strict();
export type CollectStoreOrderInput = z.infer<typeof collectStoreOrderSchema>;

export const cancelStoreOrderSchema = z.object({ reason: z.string().trim().min(1).max(200) }).strict();
export type CancelStoreOrderInput = z.infer<typeof cancelStoreOrderSchema>;

export const listStoreOrdersQuerySchema = z
  .object({
    /** "true": only orders with something still to hand over. */
    toCollect: z.enum(["true", "false"]).optional(),
    q: z.string().trim().max(60).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    studentId: z.string().uuid().optional(),
    classSaleId: z.string().uuid().optional(),
  })
  .strict();
export type ListStoreOrdersQuery = z.infer<typeof listStoreOrdersQuerySchema>;

export interface StoreOrderLineDto {
  id: string;
  itemId: string;
  itemName: string;
  variantLabel: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  collected: number;
  /** quantity − collected */
  toCollect: number;
  /** On hand now, so the seller can see whether it can be handed over. */
  onHand: number;
}

/** The store invoice's state, read from the invoice itself. */
export interface StoreOrderInvoiceDto {
  id: string;
  totalDue: number;
  totalPaid: number;
  status: string;
}

export interface StoreOrderSummaryDto {
  id: string;
  number: string;
  buyer: StoreOrderBuyer;
  /** "Ada Obi", a staff name, a walk-in's name or "Walk-in buyer". */
  buyerName: string;
  /** Admission number and class for a student; null otherwise. */
  buyerDetail: string | null;
  studentId: string | null;
  billing: StoreOrderBilling;
  status: StoreOrderStatus;
  total: number;
  itemCount: number;
  toCollect: number;
  packName: string | null;
  invoice: StoreOrderInvoiceDto | null;
  createdByName: string;
  createdAt: string | Date;
}

export interface StoreOrderDto extends StoreOrderSummaryDto {
  counterMethod: StoreCounterMethod | null;
  counterReference: string | null;
  note: string | null;
  classSaleId: string | null;
  lines: StoreOrderLineDto[];
  cancelledByName: string | null;
  cancelledAt: string | Date | null;
  cancelReason: string | null;
  /** Fees-invoice orders: lines already on an invoice (cannot be cancelled here). */
  billedCharges: number;
  /** POST /store/orders: true when the key had been used and nothing new was made. */
  replayed?: boolean;
}

/** GET /store/checkout: what a seller needs before a sale. */
export interface StoreCheckoutContextDto {
  billingDefault: StoreStudentBilling;
  sellerMayChooseBilling: boolean;
  /** Whether this seller may record a payment on an invoice (pay now). */
  mayRecordPayment: boolean;
}

// ------------------------------------------------------------------ packs

export const savePackSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    note: optionalText(200),
    isActive: z.boolean().optional(),
    items: z
      .array(z.object({ itemId: z.string().uuid(), quantity: z.number().int().min(1).max(1000) }).strict())
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.items.map((i) => i.itemId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each item appears once in a pack; change its quantity instead." });
    }
  });
export type SavePackInput = z.infer<typeof savePackSchema>;

export interface StorePackSizeDto {
  variantId: string;
  label: string | null;
  price: number | null;
  onHand: number;
  isActive: boolean;
}

export interface StorePackItemDto {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  itemActive: boolean;
  /** The item's sizes; one unnamed size for an item without sizes. */
  sizes: StorePackSizeDto[];
}

export interface StorePackDto {
  id: string;
  name: string;
  note: string | null;
  isActive: boolean;
  items: StorePackItemDto[];
  /** Σ quantity × price when every item has one size with a price; else null (depends on sizes). */
  fixedTotal: number | null;
}

// ------------------------------------------------------------- class sale

export const previewClassSaleSchema = z
  .object({ classArmId: z.string().uuid(), packId: z.string().uuid() })
  .strict();
export type PreviewClassSaleInput = z.infer<typeof previewClassSaleSchema>;

export interface ClassSaleChildDto {
  studentId: string;
  name: string;
  admissionNumber: string | null;
  /** Already has an active order for this pack. */
  alreadyBought: boolean;
}

export interface ClassSalePreviewDto {
  classArmName: string;
  pack: StorePackDto;
  children: ClassSaleChildDto[];
}

export const createClassSaleSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    classArmId: z.string().uuid(),
    packId: z.string().uuid(),
    billing: z.enum(["FEES_INVOICE", "STORE_INVOICE"]).optional(),
    children: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            /** The size chosen for each pack item that has sizes. */
            sizes: z.array(z.object({ itemId: z.string().uuid(), variantId: z.string().uuid() }).strict()).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_CLASS_SALE_CHILDREN),
  })
  .strict()
  .superRefine((v, ctx) => {
    const ids = v.children.map((c) => c.studentId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A child appears twice." });
    }
  });
export type CreateClassSaleInput = z.infer<typeof createClassSaleSchema>;

export interface ClassSaleResultDto {
  classSaleId: string;
  orders: number;
  total: number;
  /** True when the key had been used and nothing new was made. */
  replayed: boolean;
}

// --------------------------------------------------------------- takings

export interface StoreTakingsRowDto {
  billing: StoreOrderBilling;
  counterMethod: StoreCounterMethod | null;
  orders: number;
  amount: number;
}

/** GET /store/reports/takings: active orders between two dates, by how they were billed. */
export interface StoreTakingsReportDto {
  from: string | null;
  to: string | null;
  rows: StoreTakingsRowDto[];
  totalOrders: number;
  totalAmount: number;
  /** Paid so far on the store invoices counted above. */
  storeInvoicesPaid: number;
}
