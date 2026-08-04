import { Prisma, PrismaClient } from "../generated/client/index.js";
// Single base client for the application. Tenant scoping is enforced by setting
// a transaction-local Postgres GUC (`app.current_school_id`) that every RLS
// policy reads. EVERY authenticated request MUST route through `withTenant`.
//
// Raw SQL outside this helper must also `SET LOCAL app.current_school_id = ...`
// before any read/write — otherwise RLS returns zero rows or, for INSERT/UPDATE
// without WITH CHECK, lets you write to the wrong tenant.
const basePrisma = new PrismaClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Connection-level Prisma error codes only — a dead/never-established
// connection to Postgres, not a query or business-logic failure. Deliberately
// narrow: P2002 (unique violation) and friends must never be retried, they'll
// just fail identically again. Root cause this exists for: Neon's Free-tier
// autosuspend can kill a pooled connection between requests, or make a fresh
// one take several seconds to wake — see docs/deferred.md's Neon autosuspend
// entry. Every `withTenant` call opens a real `$transaction`, so this is the
// one chokepoint that protects every tenant-scoped read/write in the app.
//   P1001 — can't reach the database server at all
//   P1002 — reached the server, but the connection timed out
//   P1008 — operation timed out
//   P1017 — server closed the connection (the exact error Sentry reported
//           on GET /academic-years)
//   P2024 — timed out fetching a new connection from the pool
//   P2028 — transaction API error. Originally documented here as "only fires
//           for the connection-level case" — DISPROVEN 2026-08-04: a real
//           production transaction (bulkUpsertScores) that started fine and
//           then ran past its own 5000ms interactive-transaction body budget
//           throws this exact code too ("Transaction already closed"/
//           "Transaction not found"), same as the connection-establishment
//           case ("unable to start a transaction in the given time", the
//           class-subjects incident this set was built for). Retrying a
//           body-timeout just re-runs the same slow transaction and reliably
//           fails again — the retry here is a no-op for that failure mode,
//           not actively harmful. The real fix for a body-timeout is at the
//           call site: fewer round-trips inside the transaction, and/or an
//           explicit `timeoutMs` override (see the `options` param below) —
//           see bulkUpsertScores in assessment.service.ts for the worked
//           example (2026-08-04 gradebook-save incident).
const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]);

// One retry only — this is papering over a connection blip, not a resilience
// policy. If the retry also fails, something worse than a cold Neon compute
// is going on and it should surface as a real error.
const RETRY_DELAY_MS = 500;

function isRetryableConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(e.code);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WithTenantOptions {
  // Overrides Prisma's 5000ms interactive-transaction default. Use ONLY when
  // a specific call site's transaction body legitimately needs more time
  // (documented at that call site, e.g. bulkUpsertScores) — never as a
  // blanket default, which would just let every transaction hold its Neon
  // connection open longer under normal load.
  timeoutMs?: number;
}

export async function withTenant<T>(
  schoolId: string,
  fn: (tx: PrismaClient) => Promise<T>,
  options?: WithTenantOptions,
): Promise<T> {
  // Defence in depth — the auth layer is the real source of truth for which
  // schoolId may be used, but we refuse anything that isn't a UUID rather than
  // pass it straight to Postgres.
  if (!UUID_RE.test(schoolId)) {
    throw new Error("withTenant: schoolId must be a UUID");
  }

  const txOptions = options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined;

  const attempt = () =>
    basePrisma.$transaction(async (tx) => {
      // `set_config(name, value, is_local=true)` is the parameter-safe form of
      // `SET LOCAL`. is_local=true scopes it to the current transaction, which
      // means PgBouncer in transaction-pooling mode can recycle the connection
      // afterwards without leaking the setting to another tenant.
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      return fn(tx as unknown as PrismaClient);
    }, txOptions);

  try {
    return await attempt();
  } catch (e) {
    if (!isRetryableConnectionError(e)) throw e;
    // packages/db has no injected Logger; this is the one chokepoint for
    // every tenant call, worth a visible signal when the retry path fires.
    console.warn(
      `withTenant: retrying after connection-level error (${
        e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "init"
      })`,
    );
    await sleep(RETRY_DELAY_MS);
    return attempt();
  }
}

export { basePrisma };
