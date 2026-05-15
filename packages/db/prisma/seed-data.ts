// Static seed data. Kept separate from seed.ts so it can be imported from
// tests (e.g. to assert the 'owner' role row exists) without running the seed
// routine as a side effect.

import { PHASE_0_PERMISSIONS } from "@school-kit/types";

export interface SystemRoleSeed {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

// System roles are global (school_id = NULL, is_system = true) and referenced
// by `key`. Per docs/modules/phase-0.md → RBAC → Seeded roles.
//
// `owner` is the wildcard role attached to the user who signs up the school.
// `admin` carries every Phase 0 permission. The spec calls out "except
// school.delete", which doesn't exist yet as a permission — preserved here as
// a TODO comment so the intent isn't lost when school.delete lands.
export const SYSTEM_ROLE_SEEDS: SystemRoleSeed[] = [
  {
    key: "owner",
    name: "Owner",
    description: "School owner — full access to everything in the tenant.",
    permissions: ["*"],
  },
  {
    key: "admin",
    name: "Administrator",
    description:
      "School administrator — every Phase 0 permission except school deletion (TODO when school.delete lands).",
    permissions: [...PHASE_0_PERMISSIONS],
  },
];
