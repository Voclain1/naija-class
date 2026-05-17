# Deferred features

Things we caught ourselves wanting to build "while we're here" — captured here instead of acted on. Review this list at the weekly Sunday review. Items only move back into a module spec when a real customer (or a real technical need) asks for them.

Format:
- [ ] <feature> — <why deferred> — <what would unblock it>

---

## Captured so far

- [ ] Production env loading via platform secrets — `@nestjs/config` reads from `.env` in dev, but production deploys need env vars from the platform (Fly.io secrets, Vercel env, etc.). Verify `ConfigModule` handles "no `.env` file present" in prod. Phase 3-ish, before first deploy.

- [ ] Phone uniqueness on `users` will need re-thinking in Phase 4 when guardians arrive. Multiple parents may share one phone number. Consider moving phone to a Guardian table or relaxing uniqueness. — currently `@unique` on `users.phone` — Phase 4 trigger.

- [ ] Convert from `dotenv-cli` test wrapper to a shared test bootstrap that loads env the same way Nest does — keeps test and runtime env-loading aligned. — Phase 1 or before, low priority.

- [ ] Migrate from bearer-token sessions to full Better Auth integration (cookies, OAuth, magic links, 2FA). Captured in ADR-001. Trigger: before parent OTP flows ship in Phase 4, or when a school owner asks for SSO.

- [ ] Refactor audit log writes from direct (synchronous) to BullMQ queued, per the architecture doc. Signup is correctly an exception (atomic with school creation), but other modules should use the queue. — Phase 1 onward.

- [ ] Document the SECURITY DEFINER `auth_check_signup_uniqueness` SQL function with a code comment explaining *why* elevated privileges are intentional. — pre-Phase 1 cleanup.

- [ ] Fix root-level `pnpm dev:api` (Turbo wrapper). Currently `pnpm dev` from `apps/api` works, but the Turbo-wrapped version exits with code 3221225781. Once Turbo dev pipeline is debugged, the root command is the preferred way to start. — when it starts being annoying.

- [ ] Folder rename: `Naija-class` → `school-kit`. Cosmetic; mismatches project name. Will create fresh Docker volumes when done. — anytime there's a natural pause.

- [ ] Rate limiting on `POST /auth/login`. Per-IP first cut (e.g., 10/min) plus per-email lockout after N consecutive failures. Captured during Phase 0 Prompt 4 plan. — before public signup goes live, or before launch.

- [ ] Expired-session sweeper. Daily cron: `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days'`. The AuthGuard already rejects expired sessions with `SESSION_EXPIRED`, so this is housekeeping (table growth) rather than correctness. — when `sessions` row count starts mattering for backup size.

- [ ] Audit SECURITY DEFINER inventory before Phase 3. We now have 4 functions (`auth_check_signup_uniqueness`, `auth_resolve_session`, `auth_lookup_user_for_login`, `auth_resolve_invitation_by_token_hash`). If the count climbs past 5, refactor to either a consolidated `auth_resolve(...)` function or move them into a separate `auth_service` schema owned by a dedicated role — keeps the attack surface auditable. **Adding the next function triggers this refactor.**

- [ ] Rate-limit `GET /invitations/:token` and `POST /invitations/:token/accept`. Same trigger as the login rate-limit item — before public signup goes live. Per-IP cap is the minimum; per-token-hash cap on accept would also prevent brute-forcing acceptedAt-flipping races.

- [ ] Re-issue / revoke pending invitations. Today the admin UI lists pending invitations but only the freshly-created one shows a "Copy link" (because we don't store raw tokens). To copy an older link, the admin currently creates a fresh invite. Re-issue would rotate the token + bump expiresAt; revoke would delete the row (or mark a `revokedAt`). Trigger: first customer who needs to re-send a missed invitation.

- [ ] Wire Resend for real invitation email delivery. Slice 7 logs the accept URL to the API console and shows it in the admin UI for manual copy-paste; the `RESEND_API_KEY` slot exists in `.env.example` already. Trigger: Phase 4 communications module, or earlier if a pilot school needs it.

- [ ] Migrate web auth storage from `localStorage` bearer token to an httpOnly cookie. Today (`apps/web/src/lib/api-client.ts`) the token is in `localStorage`, which is readable by any script that runs on the page — fine for Phase 0 (no third-party scripts, no production users), but XSS becomes a session-takeover bug at launch. Cookie-based auth also unlocks proper Next.js middleware route protection (currently impossible because middleware cannot read `localStorage`), so we can replace the client-side `RequireAuth` flash with a server-side redirect. Trigger: before the marketing site adds analytics/third-party scripts, or before public beta — whichever comes first.

- [ ] Dev DB cleanup — ~100 test schools accumulated from signup testing. Before any demo or pilot, prune schools where slug doesn't match a known test pattern (slice5-academy, etc.). — pre-pilot.

- [ ] Debug Turbo on Windows — multiple commands (`pnpm dev:api`, `pnpm typecheck` via turbo) crash with Windows-specific DLL exit codes. Workaround: run per-workspace. Trigger: when this slows daily flow more than running per-workspace does. Could be a Turbo version pin, a Windows-WSL config issue, or a node-gyp native module thing.

- [ ] PostHog Node SDK in apps/api. Slice 8a wires PostHog from the browser only — all 6 Phase 0 events fire from user interactions in the web UI. Server-only events (cron jobs, queue workers, AI cost-budget breaches) need a Node SDK with batched flush + identify-by-userId. Trigger: first server-side event we want to track — likely Phase 5's AI token budget alerts, or earlier if a scheduled job from Phase 2 onwards needs telemetry.

- [ ] Sentry source-map upload during web builds. Slice 8a wires error capture without source maps, so stack traces in Sentry will reference minified bundle code. The `@sentry/nextjs` SDK ships a `withSentryConfig()` wrapper that handles upload via `@sentry/cli`; needs `SENTRY_AUTH_TOKEN` set in CI. Trigger: first real production deploy with end-user traffic (Phase 3 staging or earlier).

- [ ] Extract observability redactor to a shared package. We currently duplicate the email/phone/key regexes in `apps/api/src/observability/redact.ts` and `apps/web/src/lib/observability/redact.ts`. ~60 lines each, no rule-divergence yet. Trigger: when `apps/mobile` needs the same redactor (Phase 4 parent app), or when the regex set is updated and someone forgets to mirror the change.

- [ ] Lift Sentry init from manual config files to the `@sentry/nextjs` wizard's `withSentryConfig()` wrapper. Slice 8a uses manual init (sentry.client/server/edge.config.ts + instrumentation.ts) to keep the diff small and auditable in Phase 0. The wizard also wires source-map upload, release tagging, and tunnel routes (to bypass ad-blockers). Trigger: when we want source maps in prod (paired with the previous item) — same change covers both.