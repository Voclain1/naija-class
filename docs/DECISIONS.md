# Architecture Decision Records

Cross-cutting design choices that go beyond a single module. One entry per
decision, kept short. Reverse-chronological: newest at the top.

---

## ADR-002 — Hand-roll TOTP 2FA + Next.js cookie proxy; defer Better Auth to Phase 4+

**Date:** 2026-06-26
**Status:** Accepted
**Scope:** Phase 3 Slice 2 auth hardening — 2FA, httpOnly cookie, rate limiting, Better Auth deferral

### Context

ADR-001 deferred Better Auth to "before Phase 1 ships a real user feature" and listed three revisit triggers. All three have now fired:

1. ✓ A second authentication method: TOTP 2FA.
2. ✓ Email verification: imminent (Phase 4 parent OTP flows).
3. ✓ Before a real user feature ships: Phase 3 is the last infra slice before Phase 4.

The consequence written in ADR-001 ("When we add 2FA, we will migrate to Better Auth properly") is now in scope. After evaluating Better Auth's 2FA plugin: it requires a full session-adapter migration (cookies, OAuth, DB schema changes). Completing the migration in Phase 3 would be a 2–3 week scope expansion that blocks Phase 4.

### Decision

1. **TOTP 2FA**: hand-rolled via `otplib` (`import { authenticator } from 'otplib'`). TOTP secret stored in `users.totp_secret` (plain text in Phase 3; Phase 4 KMS encrypts it at rest). 2FA challenge token: Redis key `2fa:challenge:<token>` → `{userId, schoolId}`, 5-min TTL, single-use (deleted on read). Uses the auth Redis client (`REDIS_AUTH_CLIENT`), not BullMQ's connection.
2. **httpOnly cookie**: Next.js proxy routes (`/api/auth/*`) set `Set-Cookie: sk_token=<raw_token>; HttpOnly; Secure; SameSite=Strict` on the Vercel domain. The NestJS API `AuthGuard` is unchanged (reads `Authorization: Bearer`). The web app stops reading from `localStorage`. Mobile continues with `Authorization: Bearer`.
3. **Rate limiting**: `@nestjs/throttler` for IP-based limits (global 200/min, per-endpoint overrides). Custom `RateLimitByEmailGuard` using Redis `INCR/EXPIRE` for per-email limits (20 attempts/15 min on `POST /auth/login`). Separate `REDIS_AUTH_CLIENT` (not BullMQ's connection).
4. **Password policy**: raised from "1+ letter + 1+ digit" to "uppercase + lowercase + digit + special char" (min 8 chars, max 128). Login schema intentionally stays lenient (no complexity check) to prevent 400 vs 401 probing.
5. **Better Auth**: deferred to Phase 4+. Phase 4 must migrate before parent OTP flows ship.

### Consequences

- **+** Phase 3 stays on schedule. 2FA ships before Phase 4 finance slice.
- **+** Cookie migration unblocks Next.js middleware auth (server components, SSR redirects).
- **−** Phase 4 carries the Better Auth migration cost. Scope is known and bounded (session adapter + cookie plumbing + OAuth surface if needed).
- **−** TOTP secret is initially stored unencrypted. Phase 4 KMS integration encrypts it.

### Revisit when

- Phase 4 parent OTP flows begin — migrate to Better Auth at that point.

### See also

- ADR-001 (superseded)
- `docs/modules/phase-3.md` §11 (auth hardening slice)
- `docs/deferred.md` — Better Auth migration deferred item

---

## ADR-001 — Bearer-token sessions via argon2 for Phase 0; defer full Better Auth migration

**Date:** 2026-05-14
**Status:** Superseded by ADR-002 (2026-06-26)
**Scope:** Phase 0 auth (signup, login, session creation)

### Context

`CLAUDE.md` says "never roll your own crypto. Use Better Auth primitives." The
Phase 0 spec also lists "Install Better Auth in api, configure" as a Week-2
task. But the API surface we ship in Prompt 3 is a single endpoint
(`POST /auth/signup-owner`) whose response shape is `{ user, school, token }` —
a bearer token returned in the response body — and a Prisma schema (`User`,
`Session`) that is already shaped to host auth state ourselves. There is no
OAuth, no magic links, no 2FA, no email verification, no cookie/middleware
plumbing in Phase 0 Prompt 3. Wiring Better Auth's full adapter +
middleware + cookie flow for one endpoint is disproportionate.

### Decision

For Phase 0 Prompt 3 (and the immediately-following Prompt 4
`POST /auth/login`):

1. **Password hashing**: use the `argon2` npm package directly (argon2id,
   default parameters). This is a well-audited primitive — not "rolling our
   own crypto." Better Auth itself ultimately delegates to a library of the
   same class.
2. **Session storage**: write `Session` rows ourselves. Token is a
   256-bit value from `crypto.randomBytes(32)`, base64url-encoded. Only the
   SHA-256 hash of the raw token is stored in `sessions.token_hash`; the
   client gets the raw token once, in the signup/login response body.
3. **No Better Auth dependency** in `apps/api` yet. The package is not
   imported, not installed.

### Consequences

- **+** Prompt 3 stays narrowly scoped to "signup endpoint" instead of
  ballooning into "signup + Better Auth integration."
- **+** Response shape matches the spec exactly (`{ user, school, token }`).
- **+** `Session` schema is exactly what we already have — no field-mapping
  layer.
- **−** When we add OAuth, magic links, 2FA, or email verification, we will
  migrate to Better Auth properly. That migration is a deliberate, separate
  prompt before Phase 1 ships and before any real user signs up. Until then
  the bearer-token surface is internal.
- **−** Cookies vs Authorization header: we use `Authorization: Bearer
  <token>`. Web app stores it server-side (HTTP-only cookie set by Next.js)
  or in `HttpOnly` cookie set by API, TBD when we wire the web client. The
  raw token is never written to localStorage.

### Revisit when

- We add a second authentication method (OAuth, magic link, 2FA).
- We add email verification or password reset (these touch the same auth
  surface and the duplication cost goes up).
- Before Phase 1 ships a real user feature.

### See also

- `packages/types/src/auth/signup-owner.dto.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `CLAUDE.md` → Hard rules → Auth
