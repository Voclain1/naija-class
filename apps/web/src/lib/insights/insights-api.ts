// Typed wrapper around /insights. Shapes come from @school-kit/types so the
// client can't drift from the API.

import type { AskInsightInput, AskInsightResultDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function askInsight(input: AskInsightInput): Promise<AskInsightResultDto> {
  return apiFetch<AskInsightResultDto>("/insights/ask", { method: "POST", body: input });
}
