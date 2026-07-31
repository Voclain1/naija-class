import type Redis from "ioredis";

// Redis-backed cache in front of auth_resolve_session — closes the #4
// production stall investigation (docs/deferred.md, 2026-07-31): every
// authenticated request was paying a live Postgres round-trip with no
// caching, a consistent 150-350ms tax measured on every single call. Neon's
// 5-minute autosuspend (school-kit-prod is on the Free tier — no dashboard
// control over that, confirmed 2026-07-31) compounds this further but is a
// separate, unfixable-today constraint; this cache only addresses the first,
// larger cause.
//
// 30s TTL: short enough that any revocation path this module doesn't know
// about self-heals within half a minute; long enough to absorb the several
// requests a single page load/navigation typically fires. TTL is a safety
// net, NOT the primary revocation mechanism — logout, password-reset "kill
// all sessions", and user deactivation all call invalidateSessionCache
// directly (see auth.service.ts and teacher-profiles.service.ts) so a
// revoked session stops working immediately, not up to 30s later.
export const SESSION_CACHE_TTL_SECONDS = 30;

function sessionCacheKey(tokenHash: string): string {
  return `session:${tokenHash}`;
}

// Mirrors ResolveSessionRow in auth.guard.ts exactly — kept as a plain
// interface here (not imported from the guard) to avoid a circular import;
// the two are structurally identical by contract, not by shared type.
export interface CachedSessionRow {
  session_id: string;
  user_id: string;
  school_id: string;
  expires_at: string; // ISO string over the wire; guard revives to Date
  user_is_active: boolean;
}

export async function getCachedSession(
  redis: Redis,
  tokenHash: string,
): Promise<CachedSessionRow | null> {
  const raw = await redis.get(sessionCacheKey(tokenHash));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSessionRow;
  } catch {
    // Corrupt entry (shouldn't happen — we control every writer) — treat as
    // a miss rather than throw; the DB fallback is always correct.
    return null;
  }
}

export async function setCachedSession(
  redis: Redis,
  tokenHash: string,
  row: CachedSessionRow,
): Promise<void> {
  await redis.set(
    sessionCacheKey(tokenHash),
    JSON.stringify(row),
    "EX",
    SESSION_CACHE_TTL_SECONDS,
  );
}

// Called from every real revocation path: logout (one tokenHash),
// password-reset's "kill all sessions" (every tokenHash for a user), and
// user deactivation (every tokenHash for a user whose sessions rows are
// NOT deleted — only isActive flips — so the cache is the only thing that
// would otherwise keep serving them as active). Empty array is a safe no-op.
export async function invalidateSessionCache(
  redis: Redis,
  tokenHashes: string[],
): Promise<void> {
  if (tokenHashes.length === 0) return;
  await redis.del(...tokenHashes.map(sessionCacheKey));
}
