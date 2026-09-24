
## Status

**Built (2026-09-23), server + web + app.**

- `POST /auth/web-handoff` (authenticated, throttled) mints a single-use
  token, hashed at rest, 60-second life, bound to the minting session.
- `POST /auth/web-handoff/exchange` (public, throttled) burns it atomically —
  `UPDATE … WHERE used_at IS NULL AND expires_at > now()`, so "once" is a
  property of the UPDATE rather than a check followed by a hope — then
  re-checks the minting session and the user's `is_active`, and issues a NEW
  session. Every refusal returns the same code and message: a precise answer
  would tell a stranger which guess was closer.
- `auth_resolve_web_handoff_token` is the pre-tenant resolver (the browser
  arrives with a token and no school). It joins CLAUDE.md's inventory, taking
  the count to 23 — **the cadence trigger** — so the "+3" review was carried
  out and recorded there.
- `apps/web/src/app/handoff/route.ts` exchanges server-side and sets the
  HttpOnly cookie exactly as login does, so the session token never reaches
  the browser's JavaScript. `next` is re-validated there as well as in the
  API schema: that route is what actually performs the redirect, and a guard
  on the far side of a network hop is one someone can forget to keep.
- The app mints before opening, and **falls back to the plain link** on any
  failure, so a handoff is never worse than what it replaced.
