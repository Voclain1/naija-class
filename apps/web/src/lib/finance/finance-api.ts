import type {
  DebtorDto,
  SendRemindersInput,
  SendRemindersResult,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function listDebtors(termId: string): Promise<DebtorDto[]> {
  return apiFetch<DebtorDto[]>(`/finance/debtors?termId=${encodeURIComponent(termId)}`, {
    method: "GET",
  });
}

export function sendReminders(input: SendRemindersInput): Promise<SendRemindersResult> {
  return apiFetch<SendRemindersResult>("/finance/debtors/remind", {
    method: "POST",
    body: input,
  });
}
