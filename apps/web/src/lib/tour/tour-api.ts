import type { SignupOwnerUserDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

// POST /users/me/complete-tour — called on both Finish and Skip; there is no
// separate "skipped" state (see User.tourCompletedAt's schema comment).
export function completeTourRequest(): Promise<SignupOwnerUserDto> {
  return apiFetch<SignupOwnerUserDto>("/users/me/complete-tour", { method: "POST" });
}
