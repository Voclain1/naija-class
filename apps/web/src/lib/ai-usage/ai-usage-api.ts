// Typed wrapper around /ai-usage. Shape comes from @school-kit/types so the
// client can't drift from the API.

import type { AiUsageDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getAiUsage(months = 3): Promise<AiUsageDto> {
  return apiFetch<AiUsageDto>(`/ai-usage?months=${months}`, { method: "GET" });
}
