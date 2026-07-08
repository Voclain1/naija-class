import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  ExpenseCategoryDto,
  ExpenseDto,
  ExpenseReceiptUrlDto,
  ListExpensesQuery,
  UpdateExpenseCategoryInput,
  UpdateExpenseInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// ---- Expense categories ---------------------------------------------------

export function listExpenseCategories(
  options: { includeInactive?: boolean } = {},
): Promise<ExpenseCategoryDto[]> {
  const qs = options.includeInactive ? "?includeInactive=true" : "";
  return apiFetch<ExpenseCategoryDto[]>(`/expense-categories${qs}`, { method: "GET" });
}

export function createExpenseCategory(
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategoryDto> {
  return apiFetch<ExpenseCategoryDto>("/expense-categories", { method: "POST", body: input });
}

export function updateExpenseCategory(
  id: string,
  input: UpdateExpenseCategoryInput,
): Promise<ExpenseCategoryDto> {
  return apiFetch<ExpenseCategoryDto>(`/expense-categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteExpenseCategory(id: string): Promise<void> {
  return apiFetch<void>(`/expense-categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---- Expenses --------------------------------------------------------------

export function listExpenses(query: ListExpensesQuery = {}): Promise<ExpenseDto[]> {
  const params = new URLSearchParams();
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const qs = params.toString();
  return apiFetch<ExpenseDto[]>(`/expenses${qs ? `?${qs}` : ""}`, { method: "GET" });
}

export function createExpense(input: CreateExpenseInput): Promise<ExpenseDto> {
  return apiFetch<ExpenseDto>("/expenses", { method: "POST", body: input });
}

export function updateExpense(id: string, input: UpdateExpenseInput): Promise<ExpenseDto> {
  return apiFetch<ExpenseDto>(`/expenses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
  });
}

export function deleteExpense(id: string): Promise<void> {
  return apiFetch<void>(`/expenses/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// POST /expenses/:id/receipt — multipart/form-data. See api-client.ts's
// FormData handling: no Content-Type set here, the browser adds the
// multipart boundary itself.
export function uploadExpenseReceipt(id: string, file: File): Promise<ExpenseDto> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<ExpenseDto>(`/expenses/${encodeURIComponent(id)}/receipt`, {
    method: "POST",
    body: form,
  });
}

export function getExpenseReceiptUrl(id: string): Promise<ExpenseReceiptUrlDto> {
  return apiFetch<ExpenseReceiptUrlDto>(`/expenses/${encodeURIComponent(id)}/receipt`, {
    method: "GET",
  });
}
