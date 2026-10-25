import type { MyAccountDeletionRequestDto } from "@school-kit/types";

import type { Principal } from "../auth/principal";
import { apiFetch } from "./client";

// Account deletion requests (docs/modules/account-deletion-requests.md): the
// app stores require a way to ask from inside the app. It tells the school,
// which holds the records and decides.

const PATHS: Record<Principal, string> = {
  staff: "/users/me/deletion-request",
  guardian: "/portal/me/deletion-request",
  student: "/student-portal/me/deletion-request",
};

export const myAccountDeletionRequest = (principal: Principal) =>
  apiFetch<MyAccountDeletionRequestDto>(PATHS[principal], { method: "GET" });

export const requestAccountDeletion = (principal: Principal) =>
  apiFetch<MyAccountDeletionRequestDto>(PATHS[principal], { method: "POST" });
