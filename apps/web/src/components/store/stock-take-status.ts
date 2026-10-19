import type { StoreStockTakeStatus } from "@school-kit/types";

export const STOCK_TAKE_STATUS: Record<StoreStockTakeStatus, { label: string; variant: "warning" | "success" | "muted" | "default" }> = {
  OPEN: { label: "Counting", variant: "warning" },
  SUBMITTED: { label: "Waiting for approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
};
