import type { StoreItemSummaryDto } from "@school-kit/types";

import { apiFetch } from "./client";

// The school store's items and what is on hand (docs/modules/id-cards-and-store.md
// §4). store.read: owner, admin, the Storekeeper and the bursar.

export function staffStoreItems(low: boolean): Promise<StoreItemSummaryDto[]> {
  return apiFetch<StoreItemSummaryDto[]>(`/store/items${low ? "?low=true" : ""}`);
}
