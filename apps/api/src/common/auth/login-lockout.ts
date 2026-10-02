import { Inject, Injectable } from "@nestjs/common";
import { RateLimitError } from "@school-kit/types";
import type Redis from "ioredis";

import { REDIS_AUTH_CLIENT } from "./redis-auth.provider.js";

// Login lockout for the two FAMILY sign-ins — the student portal and the
// guardian portal (2026-10-02).
//
// The student design was approved at the Phase 6 / Slice 3 review and logged
// in docs/deferred.md ("Login lockout for the student portal — approved, NOT
// yet built"); the guardian gap is logged beside it as "the identical gap ...
// the same decision", so both take the same schedule here.
//
// Until now both had only rate limits. A rate limit slows a sustained
// low-rate attack against one account; it never stops it. The per-email guard
// on guardian login, for one, allows 20 attempts every 15 minutes, forever.
//
// THE SCHEDULE (approved; do not raise the hard lock — see below):
//
//   failures in window   effect on the NEXT attempt
//   1–5                  none
//   6–10                 refused for 5s, 15s, 30s, 60s, 120s
//   11+                  refused for 15 minutes, SLIDING: an attempt during
//                        the lock restarts it
//
//   The window is 30 minutes, measured from the most recent failure. Any
//   successful sign-in clears it, as do the recovery paths (see clear()).
//
// Two properties matter as much as the numbers:
//
// 1. KEYED ON WHAT WAS TYPED, never on a resolved account. A student's
//    identity is enumerable by construction — admission numbers are
//    sequential and school slugs are public — so if the counter only ran for
//    real accounts, "which admission numbers start getting locked" would be
//    the roster oracle the uniform INVALID_CREDENTIALS response exists to
//    prevent. check() runs BEFORE any lookup and recordFailure() runs for
//    unknown identities too, so a made-up admission number locks exactly
//    like a real one.
//
// 2. THE LOCK IS TEMPORARY, AND RECOVERY STAYS OPEN. A script can lock a
//    whole cohort with ~11 requests a head, which is why 15 minutes must not
//    be raised. The invitation-accept and password-reset paths are not
//    locked — they carry their own single-use token, so they are not a bypass
//    — and they CLEAR the lock, bounding the denial of service at "15
//    minutes, or less if a parent acts".

export const LOCKOUT_WINDOW_SECONDS = 30 * 60;
export const HARD_LOCK_SECONDS = 15 * 60;
const FREE_FAILURES = 5;
const ESCALATION_SECONDS = [5, 15, 30, 60, 120] as const;

/**
 * How long the NEXT attempt is refused after `failures` failures in the
 * window. 0 = not at all. Pure, so the schedule itself is specified by a test.
 */
export function lockSecondsAfter(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  const step = failures - FREE_FAILURES - 1;
  return step < ESCALATION_SECONDS.length ? ESCALATION_SECONDS[step]! : HARD_LOCK_SECONDS;
}

/** A hard lock is the 15-minute one, the only kind that slides. */
export function isHardLock(failures: number): boolean {
  return failures > FREE_FAILURES + ESCALATION_SECONDS.length;
}

/** Which sign-in a key belongs to. Separate namespaces, never shared. */
export type LockoutPrincipal = "student" | "guardian";

/**
 * The key for an identity AS TYPED. Normalised only enough that trivial
 * variants ("ADM/001 " vs "adm/001") cannot sidestep the count — never
 * resolved against the database (property 1 above).
 */
export function lockoutIdentity(principal: LockoutPrincipal, ...parts: string[]): string {
  return `${principal}:${parts.map((p) => p.trim().toLowerCase()).join(":")}`;
}

@Injectable()
export class LoginLockoutService {
  constructor(@Inject(REDIS_AUTH_CLIENT) private readonly redis: Redis) {}

  private failKey(identity: string) {
    return `login-lockout:fail:${identity}`;
  }

  private lockKey(identity: string) {
    return `login-lockout:lock:${identity}`;
  }

  /**
   * Refuse the attempt if this identity is locked. Call BEFORE any lookup or
   * password check, so a locked attempt costs nothing and reveals nothing.
   *
   * The refusal is a 429 with Retry-After (via details.retryAfterSeconds —
   * the HTTP filter turns it into the header). An attempt during a HARD lock
   * restarts it: the lock slides, so a script that keeps hammering stays
   * locked rather than getting a fresh batch every 15 minutes.
   */
  async check(identity: string): Promise<void> {
    const lockKey = this.lockKey(identity);
    const [kind, ttlMs] = await Promise.all([this.redis.get(lockKey), this.redis.pttl(lockKey)]);
    if (kind === null || ttlMs <= 0) return;

    let retryAfterSeconds = Math.ceil(ttlMs / 1000);
    if (kind === "hard") {
      await this.redis.set(lockKey, "hard", "EX", HARD_LOCK_SECONDS);
      retryAfterSeconds = HARD_LOCK_SECONDS;
    }
    throw new RateLimitError(
      "LOGIN_LOCKED",
      kind === "hard"
        ? "Too many sign-in attempts. Sign-in is paused for 15 minutes."
        : `Too many sign-in attempts. Try again in ${retryAfterSeconds} seconds.`,
      { retryAfterSeconds },
    );
  }

  /**
   * Count a failed attempt, and lock the NEXT one if the schedule says so.
   * Call for EVERY failure, including identities that do not exist.
   */
  async recordFailure(identity: string): Promise<void> {
    const failKey = this.failKey(identity);
    const failures = await this.redis.incr(failKey);
    // Measured from the most recent failure: a slow attacker does not get a
    // clean slate every 30 minutes just by pacing themselves.
    await this.redis.expire(failKey, LOCKOUT_WINDOW_SECONDS);

    const seconds = lockSecondsAfter(failures);
    if (seconds > 0) {
      await this.redis.set(this.lockKey(identity), isHardLock(failures) ? "hard" : "soft", "EX", seconds);
    }
  }

  /**
   * Forget this identity's failures and any lock. On a successful sign-in,
   * and on the recovery paths that prove the person is who they say
   * (accepting a fresh invitation, completing a password reset) — which is
   * what keeps a cohort-wide lock from outlasting a parent acting.
   */
  async clear(identity: string): Promise<void> {
    await this.redis.del(this.failKey(identity), this.lockKey(identity));
  }
}
