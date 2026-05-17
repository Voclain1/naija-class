import type { SchoolMeDto } from "../onboarding/school.dto.js";
import type { SignupOwnerUserDto } from "./signup-owner.dto.js";

// One role grant as exposed by GET /auth/me. `permissions` may be the
// wildcard `["*"]` for the owner role, or a string[] of permission keys
// (see packages/types/src/permissions.ts).
export interface AuthMeRoleDto {
  key: string;
  name: string;
  permissions: string[];
}

// Response of GET /auth/me. `permissions` is the flattened, deduped union
// across all role grants. If any role has `*`, the array is exactly
// `["*"]` — clients should treat it as "all permissions" and short-circuit
// their own permission checks rather than enumerate.
//
// `school` is the wider SchoolMeDto (not the narrower SignupOwnerSchoolDto)
// because the onboarding wizard needs the full set of editable fields to
// pre-fill its forms without an extra round-trip on every page mount.
export interface MeResponse {
  user: SignupOwnerUserDto;
  school: SchoolMeDto;
  roles: AuthMeRoleDto[];
  permissions: string[];
}
