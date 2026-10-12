import { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { createPrismaClient } from "./prisma-client.js";
// Single base client for the application. Tenant scoping is enforced by setting
// a transaction-local Postgres GUC (`app.current_school_id`) that every RLS
// policy reads. EVERY authenticated request MUST route through `withTenant`.
//
// Raw SQL outside this helper must also `SET LOCAL app.current_school_id = ...`
// before any read/write — otherwise RLS returns zero rows or, for INSERT/UPDATE
// without WITH CHECK, lets you write to the wrong tenant.
//
// The runtime connection is DATABASE_URL, the app_user role (never the
// migration role: RLS does not apply to it). The pool connects lazily, so a
// missing URL fails at the first query, as it did before Prisma 7.
const basePrisma = createPrismaClient(process.env.DATABASE_URL ?? "");

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
//           class-subjects incident this set was built for). Only that
//           never-started case is retried (2026-10-10, `isBodyTimeout`): a
//           body timeout re-runs the whole slow transaction, which usually
//           fails again and, under pool pressure, holds a second connection
//           for another full budget at the worst moment. The fix for a body
//           timeout is at the call site: fewer round-trips inside the
//           transaction, and/or an explicit `timeoutMs` override (see the
//           `options` param below) — see bulkUpsertScores in
//           assessment.service.ts for the worked example (2026-08-04
//           gradebook-save incident).
const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]);

// Prisma 7 (2026-10-12, docs/modules/prisma-7-upgrade.md D4) talks to Postgres
// through node-postgres, and a connection lost IN THE MIDDLE of a transaction
// no longer arrives as P1017: it is a P2010 carrying the driver's own cause in
// `meta.driverAdapterError.cause` — a socket-level `kind` (reset, unreachable,
// timed out), or `kind: "postgres"` with a Postgres code: class 08 (connection
// exception) or 57P01-57P03 (server shutting down / restarting / not yet
// accepting). pg's own "Connection terminated unexpectedly" is not mapped by
// the adapter at all, so it is matched by message. Nor is a failed connect to
// a host with SEVERAL addresses (IPv4 + IPv6, as on CI's `localhost`): Node
// tries each and throws a bare AggregateError carrying the socket code
// (ECONNREFUSED...), which Prisma passes through unwrapped. Caught by CI and
// reproduced locally with a two-address hostname. All of these mean the
// connection never opened or the server rolled the transaction back, which
// is what made P1001 / P1017 safe to retry.
// (A pooled connection killed while IDLE never reaches here: the pool drops it
// and the next transaction gets a fresh one, proven against a real server.)
const LOST_CONNECTION_KINDS = new Set(["DatabaseNotReachable", "ConnectionClosed", "SocketTimeout"]);
const SERVER_GOING_AWAY_CODES = new Set(["57P01", "57P02", "57P03"]);
const SOCKET_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
]);

function hasSocketErrorCode(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string" && SOCKET_ERROR_CODES.has(code)) return true;
  const inner = (e as { errors?: unknown }).errors;
  return Array.isArray(inner) && inner.some(hasSocketErrorCode);
}

interface DriverAdapterCause {
  kind?: string;
  code?: string;
}

function driverAdapterCause(e: Prisma.PrismaClientKnownRequestError): DriverAdapterCause | undefined {
  const meta = e.meta as { driverAdapterError?: { cause?: DriverAdapterCause } } | undefined;
  return meta?.driverAdapterError?.cause;
}

function isLostConnection(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const cause = driverAdapterCause(e);
    if (cause?.kind && LOST_CONNECTION_KINDS.has(cause.kind)) return true;
    if (cause?.kind === "postgres" && typeof cause.code === "string") {
      if (cause.code.startsWith("08") || SERVER_GOING_AWAY_CODES.has(cause.code)) return true;
    }
  }
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) && hasSocketErrorCode(e)) return true;
  return e instanceof Error && /connection terminated unexpectedly/i.test(e.message);
}

// One retry only — this is papering over a connection blip, not a resilience
// policy. If the retry also fails, something worse than a cold Neon compute
// is going on and it should surface as a real error.
const RETRY_DELAY_MS = 500;

export function isRetryableConnectionError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true;
  if (isLostConnection(e)) return true;
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(e.code) && !isBodyTimeout(e);
  }
  return false;
}

// P2028 covers both "the transaction never started" and "the transaction
// started and its body outlived its timeout". Prisma's message is the only
// thing that tells them apart: the never-started case says "Unable to start a
// transaction"; a body timeout says "Transaction already closed" (an expired
// transaction, at the next query or at commit) or "Transaction not found".
// Anything that is not the never-started wording counts as a body timeout, so
// an unfamiliar P2028 message is not retried.
function isBodyTimeout(e: Prisma.PrismaClientKnownRequestError): boolean {
  return e.code === "P2028" && !/unable to start a transaction/i.test(e.message);
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

  // Names this call site in the diagnostic emitted when a retryable error
  // fires. Optional, and worth setting on any long or hot path.
  label?: string;
}

/**
 * How long the failing attempt actually ran before it threw. This is the field
 * that separates the two failure modes P2028 covers, which are otherwise
 * indistinguishable in Sentry and need OPPOSITE fixes:
 *
 *   elapsed ~= 0            the transaction never STARTED — no connection was
 *                           free. Pool exhaustion. Fix: fewer concurrent
 *                           connection holders, or a bigger pool.
 *   elapsed ~= the budget   the transaction started and its BODY ran long.
 *                           Fix: fewer round trips, or a higher timeoutMs.
 *
 * Before this existed, the 2026-09-11 /dashboard investigation had to reason
 * from Sentry event COUNTS to guess which mechanism was firing.
 */
function describeAttemptFailure(e: unknown, elapsedMs: number, label?: string): string {
  const cause = e instanceof Prisma.PrismaClientKnownRequestError ? driverAdapterCause(e) : undefined;
  const code =
    e instanceof Prisma.PrismaClientKnownRequestError
      ? `${e.code}${cause?.code ? `/${cause.code}` : cause?.kind ? `/${cause.kind}` : ""}`
      : e instanceof Prisma.PrismaClientInitializationError
        ? "init"
        : "connection lost";
  const mode =
    elapsedMs < 100
      ? "never-started (pool acquisition)"
      : "body ran long (round-trip cost / latency)";
  return `withTenant${label ? ` [${label}]` : ""}: retrying after connection-level error (${code}) after ${elapsedMs}ms — ${mode}`;
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

  const startedAt = Date.now();
  try {
    return await attempt();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && isBodyTimeout(e)) {
      console.warn(
        `withTenant${options?.label ? ` [${options.label}]` : ""}: not retrying P2028 after ${Date.now() - startedAt}ms — body ran past its timeout`,
      );
      throw e;
    }
    if (!isRetryableConnectionError(e)) throw e;
    // packages/db has no injected Logger; this is the one chokepoint for
    // every tenant call, worth a visible signal when the retry path fires.
    console.warn(describeAttemptFailure(e, Date.now() - startedAt, options?.label));
    await sleep(RETRY_DELAY_MS);
    return attempt();
  }
}

export { basePrisma };
