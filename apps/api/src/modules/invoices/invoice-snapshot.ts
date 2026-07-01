import type { InvoiceLineItemDto } from "@school-kit/types";

// ---------------------------------------------------------------------------
// Internal types shared between the snapshot builder and the service
// ---------------------------------------------------------------------------

export interface FeeItemForSnapshot {
  id: string;
  name: string;
  amount: number; // kobo
  categoryId: string;
  categoryName: string;
}

export interface DiscountRuleForSnapshot {
  id: string;
  name: string;
  feeItemId: string | null;
  feeCategoryId: string | null;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT" | "FULL_WAIVER";
  value: number | null; // basis points | kobo | null for FULL_WAIVER
}

export interface SnapshotResult {
  items: InvoiceLineItemDto[];
  totalAmount: number;   // kobo
  totalDiscount: number; // kobo
  totalDue: number;      // kobo
}

// ---------------------------------------------------------------------------
// computeRuleDiscount
// ---------------------------------------------------------------------------

/**
 * Returns the raw discount amount (kobo) a single rule contributes to a fee
 * item. Computed against the ORIGINAL item amount — the caller sums all rule
 * contributions and caps the total at item.amount.
 *
 * This means: each rule's discountAmount is computed against the original item
 * amount, not a running remainder — discount application order is display-only.
 */
export function computeRuleDiscount(amount: number, rule: DiscountRuleForSnapshot): number {
  switch (rule.discountType) {
    case "PERCENTAGE":
      // Integer arithmetic (floor), no floating point. 1000 bp = 10%.
      return Math.floor((amount * (rule.value ?? 0)) / 10000);
    case "FIXED_AMOUNT":
      return rule.value ?? 0;
    case "FULL_WAIVER":
      return amount;
  }
}

// ---------------------------------------------------------------------------
// buildSnapshot
// ---------------------------------------------------------------------------

/**
 * Builds the frozen invoice snapshot from a list of matched fee items and a
 * student's active discount rules. Pure function — no DB access.
 */
export function buildSnapshot(
  feeItems: FeeItemForSnapshot[],
  discountRules: DiscountRuleForSnapshot[],
): SnapshotResult {
  let totalAmount = 0;
  let totalDiscount = 0;

  const items: InvoiceLineItemDto[] = feeItems.map((item) => {
    // Each rule's discountAmount is computed against the original item amount,
    // not a running remainder — discount application order is display-only.
    const matchingRules = discountRules.filter(
      (r) => r.feeItemId === item.id || r.feeCategoryId === item.categoryId,
    );

    const discountsApplied = matchingRules.map((rule) => ({
      ruleId: rule.id,
      ruleName: rule.name,
      discountAmount: computeRuleDiscount(item.amount, rule),
    }));

    const rawDiscount = discountsApplied.reduce((sum, d) => sum + d.discountAmount, 0);
    const cappedDiscount = Math.min(rawDiscount, item.amount);

    totalAmount += item.amount;
    totalDiscount += cappedDiscount;

    return {
      feeItemId: item.id,
      categoryName: item.categoryName,
      feeName: item.name,
      amount: item.amount,
      discountsApplied,
      netAmount: item.amount - cappedDiscount,
    };
  });

  return {
    items,
    totalAmount,
    totalDiscount,
    totalDue: totalAmount - totalDiscount,
  };
}
