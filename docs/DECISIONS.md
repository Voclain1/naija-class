# Architecture Decision Records

Cross-cutting design choices that go beyond a single module. One entry per
decision, kept short. Reverse-chronological: newest at the top.

---

## ADR-001 — Bearer-token sessions via argon2 for Phase 0; defer full Better Auth migration

**Date:** 2026-05-14
**Status:** Accepted
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
