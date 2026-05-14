import { PrismaClient } from "./generated/client";

// Single base client for the application. Tenant scoping is enforced by setting
// a transaction-local Postgres GUC (`app.current_school_id`) that every RLS
// policy reads. EVERY authenticated request MUST route through `withTenant`.
//
// Raw SQL outside this helper must also `SET LOCAL app.current_school_id = ...`
// before any read/write — otherwise RLS returns zero rows or, for INSERT/UPDATE
// without WITH CHECK, lets you write to the wrong tenant.
const basePrisma = new PrismaClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  schoolId: string,
  fn: (tx: PrismaClient) => Promise<T>,
): Promise<T> {
  // Defence in depth — the auth layer is the real source of truth for which
  // schoolId may be used, but we refuse anything that isn't a UUID rather than
  // pass it straight to Postgres.
  if (!UUID_RE.test(schoolId)) {
    throw new Error("withTenant: schoolId must be a UUID");
  }

  return basePrisma.$transaction(async (tx) => {
    // `set_config(name, value, is_local=true)` is the parameter-safe form of
    // `SET LOCAL`. is_local=true scopes it to the current transaction, which
    // means PgBouncer in transaction-pooling mode can recycle the connection
    // afterwards without leaking the setting to another tenant.
    await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
    return fn(tx as unknown as PrismaClient);
  });
}

export { basePrisma };
