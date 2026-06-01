import { SetMetadata } from "@nestjs/common";

import type { Permission } from "@school-kit/types";

// Marks the permission(s) a handler requires. Read by PermissionsGuard.
//
// Slice 13: every endpoint on a guarded Phase 1 controller carries this — the
// guard FAILS CLOSED if a handler it protects has no @Permissions metadata, so
// forgetting it on a new endpoint surfaces as a 403 (and is caught by the
// controller-introspection test) rather than a silently open route.
//
// A handler may list more than one key; the guard requires ALL of them.
export const PERMISSIONS_METADATA_KEY = "permissions";

export const Permissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_METADATA_KEY, permissions);
