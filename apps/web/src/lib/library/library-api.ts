import type {
  AddCopiesInput,
  CreateBookInput,
  IssueLoanInput,
  LibraryBookDto,
  LibraryBookSummaryDto,
  LibraryBorrowerDto,
  LibraryBorrowerKind,
  LibraryBorrowerLoansDto,
  LibraryContextDto,
  LibraryCopyLookupDto,
  LibraryLoanDto,
  LibraryLoanResultDto,
  LibrarySettingsDto,
  UpdateBookInput,
  UpdateCopyInput,
  UpdateLibrarySettingsInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 9 / CP6.1 — the library (docs/modules/phase-9.md §14).

const id = (value: string) => encodeURIComponent(value);
const query = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
};

export const getLibraryContext = () => apiFetch<LibraryContextDto>("/library/context", { method: "GET" });
export const updateLibrarySettings = (body: UpdateLibrarySettingsInput) =>
  apiFetch<LibrarySettingsDto>("/library/settings", { method: "PUT", body });

export const listBooks = (params: { q?: string; subjectId?: string } = {}) =>
  apiFetch<LibraryBookSummaryDto[]>(`/library/books${query(params)}`, { method: "GET" });
export const getBook = (bookId: string) => apiFetch<LibraryBookDto>(`/library/books/${id(bookId)}`, { method: "GET" });
export const createBook = (body: CreateBookInput) => apiFetch<LibraryBookDto>("/library/books", { method: "POST", body });
export const updateBook = (bookId: string, body: UpdateBookInput) =>
  apiFetch<LibraryBookDto>(`/library/books/${id(bookId)}`, { method: "PATCH", body });
export const deleteBook = (bookId: string) => apiFetch<void>(`/library/books/${id(bookId)}`, { method: "DELETE" });
export const addCopies = (bookId: string, body: AddCopiesInput) =>
  apiFetch<LibraryBookDto>(`/library/books/${id(bookId)}/copies`, { method: "POST", body });
export const updateCopy = (copyId: string, body: UpdateCopyInput) =>
  apiFetch<LibraryBookDto>(`/library/copies/${id(copyId)}`, { method: "PATCH", body });
export const lookupCopy = (accessionNumber: string) =>
  apiFetch<LibraryCopyLookupDto>(`/library/copies/lookup${query({ accessionNumber })}`, { method: "GET" });

export const findBorrowers = (kind: LibraryBorrowerKind, q: string) =>
  apiFetch<LibraryBorrowerDto[]>(`/library/borrowers${query({ kind, q })}`, { method: "GET" });
export const listLoans = (state: "OPEN" | "OVERDUE" | "RETURNED" | "LOST", q?: string) =>
  apiFetch<LibraryLoanDto[]>(`/library/loans${query({ state, q })}`, { method: "GET" });
export const issueLoan = (body: IssueLoanInput) => apiFetch<LibraryLoanDto>("/library/loans/issue", { method: "POST", body });
export const returnLoan = (accessionNumber: string, waiveReason?: string) =>
  apiFetch<LibraryLoanResultDto>("/library/loans/return", { method: "POST", body: { accessionNumber, ...(waiveReason ? { waiveReason } : {}) } });
// CP6.2 — a lost book, and the same book found again.
export const markLost = (loanId: string, waiveReason?: string) =>
  apiFetch<LibraryLoanResultDto>(`/library/loans/${id(loanId)}/lost`, { method: "POST", body: waiveReason ? { waiveReason } : {} });
export const markFound = (loanId: string) => apiFetch<LibraryLoanResultDto>(`/library/loans/${id(loanId)}/found`, { method: "POST" });
export const renewLoan = (loanId: string) => apiFetch<LibraryLoanDto>(`/library/loans/${id(loanId)}/renew`, { method: "POST" });

export const getStudentLoans = (studentId: string) =>
  apiFetch<LibraryBorrowerLoansDto>(`/library/students/${id(studentId)}/loans`, { method: "GET" });
export const getStaffLoans = (userId: string) =>
  apiFetch<LibraryBorrowerLoansDto>(`/library/staff/${id(userId)}/loans`, { method: "GET" });
