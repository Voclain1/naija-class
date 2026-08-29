import type { SetupStateDto } from "@school-kit/types";

import { apiFetch } from "@/lib/api-client";

// Backs both the dashboard checklist and the per-workflow prerequisite
// notices. Owner/admin only (the API 403s otherwise) — every caller is
// inside a component that already checks the role before rendering.
export function getSetupState(): Promise<SetupStateDto> {
  return apiFetch<SetupStateDto>("/schools/me/setup-state");
}
