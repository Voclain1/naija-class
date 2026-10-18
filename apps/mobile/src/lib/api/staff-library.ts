import type {
  IssueLoanInput,
  LibraryBorrowerDto,
  LibraryBorrowerKind,
  LibraryCopyLookupDto,
  LibraryLoanDto,
  LibraryLoanResultDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Phase 9 / CP6.2 — the lending desk and the loans list on the staff app
// (docs/modules/phase-9.md §14). library.read to look; library.lend to lend,
// take back, renew or mark a book lost: owner, admin and the Librarian.

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export function staffLibraryLoans(state: "OPEN" | "OVERDUE" | "LOST"): Promise<LibraryLoanDto[]> {
  return apiFetch<LibraryLoanDto[]>(`/library/loans?${q({ state })}`);
}

export function staffLibraryCopy(accessionNumber: string): Promise<LibraryCopyLookupDto> {
  return apiFetch<LibraryCopyLookupDto>(`/library/copies/lookup?${q({ accessionNumber })}`);
}

export function staffLibraryBorrowers(kind: LibraryBorrowerKind, search: string): Promise<LibraryBorrowerDto[]> {
  return apiFetch<LibraryBorrowerDto[]>(`/library/borrowers?${q({ kind, q: search })}`);
}

export function staffLibraryIssue(body: IssueLoanInput): Promise<LibraryLoanDto> {
  return apiFetch<LibraryLoanDto>("/library/loans/issue", { method: "POST", body });
}

export function staffLibraryReturn(accessionNumber: string, waiveReason?: string): Promise<LibraryLoanResultDto> {
  return apiFetch<LibraryLoanResultDto>("/library/loans/return", {
    method: "POST",
    body: { accessionNumber, ...(waiveReason ? { waiveReason } : {}) },
  });
}

export function staffLibraryRenew(loanId: string): Promise<LibraryLoanDto> {
  return apiFetch<LibraryLoanDto>(`/library/loans/${encodeURIComponent(loanId)}/renew`, { method: "POST" });
}

export function staffLibraryLost(loanId: string, waiveReason?: string): Promise<LibraryLoanResultDto> {
  return apiFetch<LibraryLoanResultDto>(`/library/loans/${encodeURIComponent(loanId)}/lost`, {
    method: "POST",
    body: waiveReason ? { waiveReason } : {},
  });
}

// CP11.2 (docs/modules/phase-9.md §20): the same lost book found again.
export function staffLibraryFound(loanId: string): Promise<LibraryLoanResultDto> {
  return apiFetch<LibraryLoanResultDto>(`/library/loans/${encodeURIComponent(loanId)}/found`, { method: "POST", body: {} });
}
