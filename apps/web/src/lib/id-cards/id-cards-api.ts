import type {
  IdCardHolderKindDto,
  IdCardHolderListDto,
  IssueIdCardsResultDto,
  PrintIdCardsDto,
} from "@school-kit/types";

import { apiFetch } from "@/lib/api-client";

// ID cards (docs/modules/id-cards-and-store.md §3).

export function listIdCards(kind: IdCardHolderKindDto, classArmId?: string) {
  const params = new URLSearchParams({ kind });
  if (classArmId) params.set("classArmId", classArmId);
  return apiFetch<IdCardHolderListDto>(`/id-cards?${params.toString()}`, { method: "GET" });
}
export const issueIdCards = (kind: IdCardHolderKindDto, holderIds: string[]) =>
  apiFetch<IssueIdCardsResultDto>("/id-cards/issue", { method: "POST", body: { kind, holderIds } });
export const cancelIdCard = (cardId: string, reason: string) =>
  apiFetch<{ ok: true }>(`/id-cards/${encodeURIComponent(cardId)}/cancel`, { method: "POST", body: { reason } });
export const reissueIdCard = (cardId: string, reason: string) =>
  apiFetch<{ id: string }>(`/id-cards/${encodeURIComponent(cardId)}/reissue`, { method: "POST", body: { reason } });
export const printIdCards = (cardIds: string[]) =>
  apiFetch<PrintIdCardsDto>("/id-cards/print", { method: "POST", body: { cardIds } });

// The cards chosen for printing travel to the print page in the session, not
// the address: 500 ids would not fit in a URL.
const PRINT_KEY = "sk-id-cards-to-print";
export function rememberCardsToPrint(cardIds: string[]) {
  try {
    window.sessionStorage.setItem(PRINT_KEY, JSON.stringify(cardIds));
  } catch {
    // Blocked storage: the print page says there is nothing chosen.
  }
}
export function cardsToPrint(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(PRINT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
