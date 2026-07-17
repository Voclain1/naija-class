import { describe, expect, it } from "vitest";

import { basePrisma } from "@school-kit/db";

// Phase 3 / Slice 12 — mechanical conformance gate for SECURITY DEFINER
// functions, replacing the "if this list grows past 5, refactor" human-memory
// threshold (CLAUDE.md) with a standing check that holds at any count.
//
// SECURITY_DEFINER_FUNCTIONS is the single source of truth this spec checks
// against. CLAUDE.md's "SECURITY DEFINER functions — index" table must list
// exactly these functions — if a future migration adds a new `SECURITY
// DEFINER` function without updating both places, this spec fails loudly
// (assertion below compares the DB's actual prosecdef=true set against this
// list) instead of the drift going unnoticed.
//
// Every function in the inventory must, per the discipline documented in
// 20260516000000_add_auth_lookup_functions and CLAUDE.md:
//   1. be owned by the migration role (school_kit), never a runtime role;
//   2. pin `search_path = public, pg_temp`;
//   3. have EXECUTE revoked from PUBLIC and granted to app_user only.
const SECURITY_DEFINER_FUNCTIONS = [
  "auth_check_signup_uniqueness",
  "auth_resolve_session",
  "auth_lookup_user_for_login",
  "auth_resolve_invitation_by_token_hash",
  "create_audit_log_partition",
  "encrypt_bvn",
  "decrypt_bvn",
  // Phase 4 / Slice 2 — guardian portal auth (2026-07-16).
  "auth_resolve_guardian_session",
  "auth_lookup_guardians_for_login",
  "auth_resolve_guardian_invitation_by_token_hash",
] as const;

interface SecurityDefinerRow {
  name: string;
  owner: string;
  config: string[] | null;
}

interface PrivilegeRow {
  routine_name: string;
  grantee: string;
  privilege_type: string;
}

describe("SECURITY DEFINER inventory conformance (Phase 3 / Slice 12 refactor)", () => {
  it("the DB's actual prosecdef=true set matches SECURITY_DEFINER_FUNCTIONS exactly", async () => {
    const rows = await basePrisma.$queryRaw<Array<{ name: string }>>`
      SELECT p.proname AS name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef = true
    `;
    const actual = rows.map((r) => r.name).sort();
    const expected = [...SECURITY_DEFINER_FUNCTIONS].sort();
    expect(actual).toEqual(expected);
  });

  it.each(SECURITY_DEFINER_FUNCTIONS)(
    "%s is owned by school_kit with search_path pinned",
    async (name) => {
      const rows = await basePrisma.$queryRaw<SecurityDefinerRow[]>`
        SELECT
          p.proname AS name,
          pg_get_userbyid(p.proowner) AS owner,
          p.proconfig AS config
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ${name}
      `;
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.owner).toBe("school_kit");
      expect(row.config ?? []).toEqual(
        expect.arrayContaining([expect.stringMatching(/^search_path=public,\s*pg_temp$/)]),
      );
    },
  );

  it.each(SECURITY_DEFINER_FUNCTIONS)(
    "%s has EXECUTE revoked from PUBLIC and granted to app_user",
    async (name) => {
      const rows = await basePrisma.$queryRaw<PrivilegeRow[]>`
        SELECT routine_name, grantee, privilege_type
        FROM information_schema.routine_privileges
        WHERE routine_schema = 'public' AND routine_name = ${name}
      `;
      const grantees = rows.map((r) => r.grantee);
      expect(grantees).not.toContain("PUBLIC");
      expect(
        rows.some((r) => r.grantee === "app_user" && r.privilege_type === "EXECUTE"),
      ).toBe(true);
    },
  );

  // Supplementary check specific to the BVN encryption design (CLAUDE.md
  // "encrypt_bvn"/"decrypt_bvn" rows): the raw pgcrypto primitives themselves
  // must not be directly callable by app_user — only the two wrapper
  // functions above may invoke them (they run with school_kit's privileges
  // as SECURITY DEFINER). Without this, app_user could bypass the wrappers
  // entirely and call pgp_sym_decrypt with a guessed key directly.
  it.each(["pgp_sym_encrypt", "pgp_sym_decrypt"])(
    "%s (raw pgcrypto primitive) has EXECUTE revoked from PUBLIC and NOT granted to app_user",
    async (name) => {
      const rows = await basePrisma.$queryRaw<PrivilegeRow[]>`
        SELECT routine_name, grantee, privilege_type
        FROM information_schema.routine_privileges
        WHERE routine_name = ${name}
      `;
      const grantees = rows.map((r) => r.grantee);
      expect(grantees).not.toContain("PUBLIC");
      expect(grantees).not.toContain("app_user");
    },
  );
});
