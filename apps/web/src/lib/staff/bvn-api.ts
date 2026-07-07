import type {
  BvnRevealDto,
  BvnStatusDto,
  CaptureBvnInput,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Phase 3 / Slice 12 — BVN capture/reveal client. Mirrors the API's split
// between self-service (/users/me/bvn*, no permission needed) and
// admin/owner-gated access to another staff member's BVN
// (/users/:id/bvn*, staff-bvn.* permissions).

// ---- Self-service ---------------------------------------------------------

export function getMyBvnStatus(): Promise<BvnStatusDto> {
  return apiFetch<BvnStatusDto>("/users/me/bvn", { method: "GET" });
}

export function captureMyBvn(input: CaptureBvnInput): Promise<void> {
  return apiFetch<void>("/users/me/bvn", { method: "PATCH", body: input });
}

export function revealMyBvn(): Promise<BvnRevealDto> {
  return apiFetch<BvnRevealDto>("/users/me/bvn/reveal", { method: "GET" });
}

// ---- Admin/owner acting on another staff member ---------------------------

export function getStaffBvnStatus(userId: string): Promise<BvnStatusDto> {
  return apiFetch<BvnStatusDto>(`/users/${encodeURIComponent(userId)}/bvn`, {
    method: "GET",
  });
}

export function captureStaffBvn(
  userId: string,
  input: CaptureBvnInput,
): Promise<void> {
  return apiFetch<void>(`/users/${encodeURIComponent(userId)}/bvn`, {
    method: "PATCH",
    body: input,
  });
}

export function revealStaffBvn(userId: string): Promise<BvnRevealDto> {
  return apiFetch<BvnRevealDto>(
    `/users/${encodeURIComponent(userId)}/bvn/reveal`,
    { method: "GET" },
  );
}
