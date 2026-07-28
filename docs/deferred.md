# Deferred features

Things we caught ourselves wanting to build "while we're here" — captured here instead of acted on. Review this list at the weekly Sunday review. Items only move back into a module spec when a real customer (or a real technical need) asks for them.

Format:
- [ ] <feature> — <why deferred> — <what would unblock it>

---

## Captured so far

- [ ] Finance e2e (Playwright) coverage gap — the Finance restyle pass (Phase 1 of the design-system rollout, 2026-07-26: dashboard, invoices, debtors, expenses, payroll, settings/finance/discounts, settings/finance/fees) was verified via manual browser check and typecheck/lint only. No Playwright spec exercises the Finance module's golden paths (create invoice → record payment → collection rate updates; log expense → category totals; run payroll → payslip generation) the way `signup → onboard → first student → first payment` is covered for onboarding. This is money-movement UI, the highest-consequence surface in the app per CLAUDE.md's "Hard rules — Money" section, and a pure-CSS/markup restyle can still silently break a click target, a form submit, or a conditional render that a human eyeballing the page misses. Distinct from the restyle work itself (no functional changes were made) — tracked separately so it isn't lost once the visual diff is merged. Trigger: before Phase 5 (AI layer) work touches Finance data, or the first time a real payment-flow bug ships to production undetected — whichever comes first. Candidate first spec: the existing e2e harness's invitation-accept pattern, extended to log in as admin → create one invoice → record one payment → assert the dashboard's collection-rate figure updates.

- [ ] Production env loading via platform secrets — `@nestjs/config` reads from `.env` in dev, but production deploys need env vars from the platform (Fly.io secrets, Vercel env, etc.). Verify `ConfigModule` handles "no `.env` file present" in prod. Phase 3-ish, before first deploy.

- [ ] Phone uniqueness on `users` will need re-thinking in Phase 4 when guardians arrive. Multiple parents may share one phone number. Consider moving phone to a Guardian table or relaxing uniqueness. — currently `@unique` on `users.phone` — Phase 4 trigger.

- [ ] Admin dashboard aggregation queries (`DashboardService.getAdminDashboard`) have no dedicated index — whole-school "attendance today" (`AttendanceRecord` filtered by `date` alone) and the 8-week trend (`date >= ...` with no `schoolId`/`termId` prefix) both fall back to the existing `[schoolId, classArmId, date]` / `[schoolId, termId]` indexes, neither of which matches this access pattern. Fine at pilot scale (hundreds of students); flagged now per the dashboard rebuild's own risk callout rather than discovered later as a slow-page complaint. Trigger: a pilot school's dashboard load noticeably slows, or student count crosses a few thousand. Candidate fix: a `[schoolId, date]` composite index on `attendance_records`.

- [x] **School logo upload — "the one thing Phase 0 must ship" was silently downgraded, and nobody tracked it. FIXED 2026-07-26.**
  `docs/modules/phase-0.md` named this feature twice, unambiguously: Step 2 of
  onboarding is specced as "branding: **logo upload (to R2)**" (§ screens),
  and the deferred-features list for that phase says outright "File upload
  to R2 — **only logo upload in Phase 0**; everything else later" — i.e.
  logo upload wasn't just in-scope, it was named as the one upload feature
  that phase was explicitly meant to deliver, with every other upload
  capability deferred around it.
  What actually shipped instead: a plain `logoUrl: z.string().url()` text
  input the school owner had to fill in with a URL to an image already
  hosted somewhere else. The code's own comments (`step2-branding.dto.ts`,
  pre-fix) said "real R2 upload is Phase 2 — see docs/deferred.md" — **but
  no entry existed here recording that decision.** The substitution was
  never logged as a scope change anywhere: not in this file, not in
  phase-0.md's own "what's deferred" section, nowhere. Found only when a
  live design-review pass asked "why does nobody ever set a school logo?"
  and the investigation traced back to this gap.
  **Fixed**: `POST /schools/me/logo` (real multipart upload to the existing
  R2/filesystem storage layer, same discipline as `expense-receipt` and
  `payment-receipt`) + `GET /schools/me/logo-url` (freshly-signed display
  URL), wired into both the signup wizard's branding step AND a new
  `/settings/school` page (which phase-0.md *also* specced — "edit school
  details, owner/admin only" — and which likewise had never been built).
  `logoUrl` is no longer PATCH-able as a raw string anywhere (same
  treatment `Expense.receiptUrl` already gets).
  See CLAUDE.md's "Design system" / storage sections for the technical
  shape (extension-bearing `StorageObjectKey`, long-TTL signed display URL
  vs. receipts' short one).

- [ ] **Process pattern worth naming generally, not just this one instance**:
  a module spec explicitly naming ONE feature as "the thing this phase must
  ship" — not a nice-to-have, the one deliverable everything else in that
  phase's deferred list was deferred *around* — got silently swapped for a
  lesser placeholder during implementation, and that swap was never logged
  anywhere as a scope change. Nobody caught it until a live product-review
  session asked why the feature didn't seem to actually work, months later.
  The specific instance (school logo) is fixed above. **Not chasing down
  whether this happened anywhere else right now** — this entry exists so the
  pattern itself is on record: when a spec calls out ONE deliverable that
  explicitly, a silent downgrade of exactly that one thing is a higher-
  severity drift than an ordinary scope cut, and deserves an explicit
  deferred.md entry at the moment the substitution is made, not months
  later when someone notices the feature doesn't work. Trigger for revisit:
  any future phase-close retro, or if another "spec named this as the one
  must-ship thing" gap surfaces the same way this one did.

- [x] Recurring dev-server bootstrap hang on Windows. **ROOT-CAUSED AND FIXED**
  (Payroll CP4a follow-up, 2026-07-11). `node dist/main.js` intermittently
  hung right after `PartitionService`'s three "Partition ensured" debug logs
  and never reached `app.listen()` (no port bound, no error, no crash — just
  stuck). Observed across three separate sessions (Slice 15's manual gate,
  Payroll CP3's manual gate, Payroll CP4a's manual gate) — the first two
  resolved after a kill+retry and enough wall-clock patience, the third
  didn't after ~4 minutes / 3 attempts.
  Root cause: `PartitionService.onModuleInit()` awaited
  `ensurePartitionsForNextMonths(2)` (3 sequential `SELECT
  create_audit_log_partition(...)` calls) with **no timeout**. Under a slow
  or momentarily-saturated dev DB connection pool at startup — exactly the
  state right after a Docker Desktop relaunch, which several of these
  incidents followed — that await could hang indefinitely, and because
  `onModuleInit` runs inside `NestFactory.create()`, the whole bootstrap
  (including the eventual `app.listen()`) hung with it. The 3 "Partition
  ensured" logs appearing before the hang is exactly consistent with this:
  those are `ensurePartition`'s own debug logs firing as each of the 3
  calls succeeds in sequence — the hang was never IN those calls, it was
  Nest's own post-`onModuleInit` bookkeeping waiting on a connection the
  pool hadn't fully released yet.
  Fix: wrapped the `onModuleInit` call in `Promise.race` against a 5s
  timeout, catching both a rejection and a timeout and logging a
  `logger.warn` rather than propagating — non-fatal by design, since the
  monthly `@Cron` job (`createNextMonthPartitions`) is the durable path and
  `onModuleInit` is only a best-effort cold-start convenience. Two new
  tests in `partition.service.spec.ts` cover both the reject-path and the
  never-resolves-path (proving the race actually bounds the wait, not just
  that it doesn't throw).

  **CORRECTION (Payroll CP4b, 2026-07-12):** the PartitionService fix above
  is real and correct, but it was NOT the whole story. The live manual gate
  for CP4b hit the same "hangs after PartitionService's logs" symptom again
  even with the timeout fix in place — it wasn't hanging, it was just very
  slow: `FinanceService.onModuleInit()` unconditionally calls
  `transitionOverdueInvoices()` at boot, which sweeps every `ACTIVE` school
  with no bound. The dev DB had accumulated **54,106 schools** since
  2026-05-14 (54,095 matching the Vitest spec-fixture slug pattern
  `<module>-<suffix>-<runId>`, owner emails on `@example.test`) — two
  months of integration-test schools that each spec file's `afterAll()`
  is supposed to delete but clearly isn't fully doing, session over
  session. The sweep over that backlog took **3m16s** on the CP4b boot
  (log: `OVERDUE transition: 7 invoice(s) marked across 50524 school(s)`
  immediately followed by `Nest application successfully started`) — not
  infinite, just long enough that every prior attempt (including two of
  mine) gave up first and misattributed the wait entirely to
  PartitionService. Pruned the accumulated test schools (see the CP4b PR)
  as the immediate fix; `FinanceService.onModuleInit()` itself still has
  no timeout/bound and would slow-start again given enough accumulated
  data (dev or, less plausibly, a very large real school count in prod) —
  worth the same `Promise.race`-with-timeout treatment PartitionService
  got, as a follow-up.

  **Why the backlog kept accumulating, found while pruning it:**
  `User.school` (`schema.prisma:108`) has no `onDelete: Cascade` — Postgres
  confirms `users_school_id_fkey` is plain `RESTRICT` (`confdeltype = 'r'`),
  unlike the ~26 other School-owned relations that do cascade. Every spec
  file's `afterAll(() => basePrisma.school.delete({ where: { id } }).catch(()
  => undefined))` has therefore been silently failing on the FK violation
  for the project's entire history — the `.catch` swallows it, the test
  reports green, and the school row (plus its users) never actually goes
  away. That's the real mechanism behind the 54k backlog, not a one-off.
  Pruning it required an explicit dependency-ordered delete (null
  `class_arms.class_teacher_id` first — `NO ACTION` from User — then
  `users`, then `schools`) rather than a single cascading `DELETE FROM
  schools`. Left as-is for now (adding `onDelete: Cascade` to `User.school`
  touches a Phase-0 foundational model, out of scope for a payroll slice) —
  worth a dedicated migration + RLS-spec re-check before the backlog
  re-accumulates.

- [ ] Convert from `dotenv-cli` test wrapper to a shared test bootstrap that loads env the same way Nest does — keeps test and runtime env-loading aligned. — Phase 1 or before, low priority.

- [ ] Migrate from bearer-token sessions to full Better Auth integration (cookies, OAuth, magic links, 2FA). Captured in ADR-001. Trigger: before parent OTP flows ship in Phase 4, or when a school owner asks for SSO.

- [ ] Refactor audit log writes from direct (synchronous) to BullMQ queued, per the architecture doc. Signup is correctly an exception (atomic with school creation), but other modules should use the queue. — Phase 1 onward.

- [ ] BullMQ Redis polling cost — Fly Redis bills at $0.20/100K commands.
  BullMQ's default polling is aggressive; at scale this accumulates quickly.
  Before the first pilot school goes live, configure sensible intervals in
  the queue module: `stalledInterval: 30000` (check stalled jobs every 30s
  instead of the default 5s), and review `drainDelay` and `lockDuration`
  defaults. Trigger: before any school is actively using the platform in
  production. Consider switching to Fly Redis fixed-price plan (~$10/month)
  if command volume consistently exceeds ~500K/month.

- [ ] Document the SECURITY DEFINER `auth_check_signup_uniqueness` SQL function with a code comment explaining *why* elevated privileges are intentional. — pre-Phase 1 cleanup.

- [ ] Fix root-level `pnpm dev:api` (Turbo wrapper). Currently `pnpm dev` from `apps/api` works, but the Turbo-wrapped version exits with code 3221225781. Once Turbo dev pipeline is debugged, the root command is the preferred way to start. — when it starts being annoying.

- [ ] Folder rename: `Naija-class` → `school-kit`. Cosmetic; mismatches project name. Will create fresh Docker volumes when done. — anytime there's a natural pause.

- [x] Rate limiting on `POST /auth/login`. Per-IP first cut (10/min) plus per-email lockout (20/15min) via `RateLimitByEmailGuard`. **DONE Phase 3 Slice 2.**

- [ ] Expired-session sweeper. Daily cron: `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days'`. The AuthGuard already rejects expired sessions with `SESSION_EXPIRED`, so this is housekeeping (table growth) rather than correctness. — when `sessions` row count starts mattering for backup size.

- [x] Audit SECURITY DEFINER inventory. **DONE Phase 3 Slice 12 (2026-07-08).**
  Reviewed all 5 pre-existing functions (`auth_check_signup_uniqueness`,
  `auth_resolve_session`, `auth_lookup_user_for_login`,
  `auth_resolve_invitation_by_token_hash`, `create_audit_log_partition`) for
  consolidation; decision was to keep all 5 as-is (each has a narrow,
  non-overlapping return shape — see CLAUDE.md's audit note for the full
  reasoning) and instead land a mechanical conformance spec
  (`apps/api/src/__tests__/security-definer-inventory.spec.ts`) that enforces
  the ownership/search_path/grant discipline on every CI run, at any count —
  replacing the "refactor past 5" human-memory threshold. `encrypt_bvn` +
  `decrypt_bvn` (pgcrypto symmetric BVN encryption, key via Fly secret +
  `SET LOCAL app.bvn_key`) landed in the same PR, bringing the count to 7.
  See CLAUDE.md "SECURITY DEFINER functions — index" and
  `docs/modules/phase-3.md` §7 BVN encryption mechanism.

- [x] Rate-limit `GET /invitations/:token` and `POST /invitations/:token/accept`. 30/min and 20/min per-IP respectively via `@Throttle`. **DONE Phase 3 Slice 2.** Per-token-hash cap (prevent brute-forcing token space) still deferred — the 32-byte random token space makes this low-risk.

- [ ] Forced password reset for users with weak passwords (pre-Phase 3 accounts). Users who signed up under the Phase 0 policy (1+ letter + 1+ digit) will not meet the Phase 3 policy (uppercase + lowercase + digit + special char). A one-time flow that flags non-compliant accounts and prompts reset on next login would close the gap. — before pilot onboarding if a school has pre-existing users with weak passwords; otherwise low priority since only the owner account exists at Slice 2.

- [ ] Re-issue / revoke pending invitations. Today the admin UI lists pending invitations but only the freshly-created one shows a "Copy link" (because we don't store raw tokens). To copy an older link, the admin currently creates a fresh invite. Re-issue would rotate the token + bump expiresAt; revoke would delete the row (or mark a `revokedAt`). Trigger: first customer who needs to re-send a missed invitation.

- [x] **Wire Resend for real invitation email delivery — code shipped (Phase 4 Slice 6). FULLY RESOLVED 2026-07-24: real API key live, `schoolkit.ng` domain verified in Resend, real delivery confirmed in Arinzechukwu's actual inbox.** Originally written pre-Phase-4 for staff invitations (which then just logged the accept URL for manual copy-paste); superseded by Slice 6's `EmailService`/`GuardiansService.deliverInvitation`, which does send real guardian-invite emails — but only if `RESEND_API_KEY` is actually configured. It never was: `docs/runbooks/neon-prod-setup.md` §5's `flyctl secrets set` template omitted the line entirely (now fixed — see that runbook's own new gotcha note next to the template), so the key was simply absent from `school-kit-api`'s Fly secrets the whole time, not a placeholder/wrong value like the `CORS_ORIGIN`/`WEB_BASE_URL`/`NEXT_PUBLIC_API_URL` incidents from the two days before this one.
  Surfaced when Arinzechukwu invited a real guardian, completed the full accept/login flow successfully (proving the invitation mechanism itself works), but no email ever arrived. Root-caused via a direct Fly log match: `[GuardiansService] WARN Guardian invite email failed for ki***@gmail.com: InternalError: RESEND_API_KEY is not configured on this server`. `deliverInvitation`'s design is best-effort by intent (a send failure never blocks or rolls back the invitation — `acceptUrl` always returns regardless), which is exactly why this was invisible to normal use: no error surfaced anywhere a caller would see it, only a `WARN` in server logs nobody was watching. `NotificationPreference.emailEnabled` was confirmed **not** the cause — it defaults to `true` when unset, and the log line only fires when that gate already passed.
  **2026-07-24 — real key set (`flyctl secrets set RESEND_API_KEY=... --app school-kit-api`, confirmed deployed via `flyctl secrets list`), then tested for real, not just "secret present."** Booted the actual production NestJS app (`NestFactory.createApplicationContext(AppModule)` inside the live container — real DI, real env) and called the real `GuardiansService.invite()` for Arinzechukwu's own real test guardian (`kingvoclain@gmail.com`, a genuine record, not a QA artifact — his original July 20 invitation was already accepted, so this created a clean fresh invite with no "already pending" conflict). Result: the code now genuinely reaches Resend's API (no more "not configured" error) — but Resend rejected the send: `The schoolkit.ng domain is not verified. Please, add and verify your domain on https://resend.com/domains`. `EmailService` hardcodes `from: "no-reply@schoolkit.ng"`; Resend requires DNS-level domain verification (SPF/DKIM) before it will send from that domain. **No email was delivered to the guardian** — the invite still succeeded at the application level (best-effort design), producing a real accept link (`https://portal.schoolkit.ng/invitations/VApX3Moj-pxL2hosEW71PagNOB1TTEGwvGdzioWCmEs`) left in place since it's real guardian state, not test data to clean up.
  **Isolated the API-key path specifically, to rule out "maybe the key itself is still bad":** sent a one-off email via Resend's pre-verified fallback sender (`onboarding@resend.dev`) directly against the Resend SDK (bypassing `EmailService`, verification-only, no code changed). First attempt (to the guardian's address) was rejected by Resend itself — `You can only send testing emails to your own email address (vtechconsults@gmail.com)`, a hard platform restriction on the unverified-domain fallback sender, not a bug on our side. Retried against that account-owner address: **send succeeded**, real Resend email id `6927cebd-0d43-43a7-8291-aad9ca1d0761` returned. Could not independently confirm final inbox delivery via Resend's own `emails.get()` status API — that call returned `401 restricted_api_key: This API key is restricted to only send emails` (the key is deliberately send-only scoped, a reasonable security default, just one that limits how far this investigation could self-verify). This confirms the integration mechanism (API key → Resend acceptance) works end-to-end; it does not by itself confirm delivery into an inbox.
  **2026-07-24 — domain verified, final test run, delivery confirmed.** Arinzechukwu verified `schoolkit.ng` in Resend's dashboard (SPF/DKIM DNS records added). Re-ran the identical test: the July 24 pending invitation from the pre-verification attempt above was still outstanding (`acceptedAt: null`), so it was deleted first (`db.guardianInvitation.deleteMany({ where: { guardianId, acceptedAt: null } })` — 1 row, the stale invite from the failed attempt, not real accepted state) to allow a genuinely fresh `invite()` call rather than hitting `INVITATION_ALREADY_PENDING`. Called the real `GuardiansService.invite()` again, same production app context, same real guardian, `warn`/`error` log levels enabled (the same levels that had clearly surfaced the failure twice before). Result this time: **no `EmailService` error, no `Guardian invite email failed` warning at all** — only the pre-existing, unrelated `TermiiService` SMS warning (Termii itself is a separate, still-open gap, not part of this item). Clean `INVITE RESULT` with a fresh `acceptUrl`. Arinzechukwu confirmed the real email arrived in `kingvoclain@gmail.com`'s actual inbox. Closes the loop from the two documented failures above through to confirmed real-world delivery — not just "no error thrown."

- [ ] Migrate web auth storage from `localStorage` bearer token to an httpOnly cookie. Today (`apps/web/src/lib/api-client.ts`) the token is in `localStorage`, which is readable by any script that runs on the page — fine for Phase 0 (no third-party scripts, no production users), but XSS becomes a session-takeover bug at launch. Cookie-based auth also unlocks proper Next.js middleware route protection (currently impossible because middleware cannot read `localStorage`), so we can replace the client-side `RequireAuth` flash with a server-side redirect. Trigger: before the marketing site adds analytics/third-party scripts, or before public beta — whichever comes first.

- [ ] Dev DB cleanup — ~100 test schools accumulated from signup testing. Before any demo or pilot, prune schools where slug doesn't match a known test pattern (slice5-academy, etc.). — pre-pilot.

- [ ] Debug Turbo on Windows — multiple commands (`pnpm dev:api`, `pnpm typecheck` via turbo) crash with Windows-specific DLL exit codes. Workaround: run per-workspace. Trigger: when this slows daily flow more than running per-workspace does. Could be a Turbo version pin, a Windows-WSL config issue, or a node-gyp native module thing.

- [ ] PostHog Node SDK in apps/api. Slice 8a wires PostHog from the browser only — all 6 Phase 0 events fire from user interactions in the web UI. Server-only events (cron jobs, queue workers, AI cost-budget breaches) need a Node SDK with batched flush + identify-by-userId. Trigger: first server-side event we want to track — likely Phase 5's AI token budget alerts, or earlier if a scheduled job from Phase 2 onwards needs telemetry.

- [ ] Sentry source-map upload during web builds. Slice 8a wires error capture without source maps, so stack traces in Sentry will reference minified bundle code. The `@sentry/nextjs` SDK ships a `withSentryConfig()` wrapper that handles upload via `@sentry/cli`; needs `SENTRY_AUTH_TOKEN` set in CI. Trigger: first real production deploy with end-user traffic (Phase 3 staging or earlier).

- [ ] Extract observability redactor to a shared package. We currently duplicate the email/phone/key regexes in `apps/api/src/observability/redact.ts` and `apps/web/src/lib/observability/redact.ts`. ~60 lines each, no rule-divergence yet. Trigger: when `apps/mobile` needs the same redactor (Phase 4 parent app), or when the regex set is updated and someone forgets to mirror the change.

- [ ] Lift Sentry init from manual config files to the `@sentry/nextjs` wizard's `withSentryConfig()` wrapper. Slice 8a uses manual init (sentry.client/server/edge.config.ts + instrumentation.ts) to keep the diff small and auditable in Phase 0. The wizard also wires source-map upload, release tagging, and tunnel routes (to bypass ad-blockers). Trigger: when we want source maps in prod (paired with the previous item) — same change covers both.

- [ ] Turbo remote cache in CI. Slice 8b runs the workflow on a fresh GH runner with no Turbo cache (local cache wouldn't survive between runs anyway). Remote cache (Vercel Remote Cache or self-hosted) would save the cumulative cost of re-running build/test on unchanged packages, but adds auth-token management + cache-poisoning surface. Trigger: when CI wall-clock exceeds ~6 min and the bottleneck is genuinely re-doing work that hasn't changed.

- [ ] Multi-job parallelism in CI. Slice 8b uses a single sequential job because each extra job re-pays the ~60s pnpm install cost. Splitting into parallel lint / typecheck / test jobs would save ~20s wall-clock today. Trigger: when the test suite grows past ~3 minutes and the parallelism win exceeds the install-redundancy cost (probably Phase 2+).

- [ ] Step 2 branding form: empty fields fail Zod validation. `logoUrl`/`primaryColor` use `.url()/.regex().optional()` — an empty string fails `.url()`/`.regex()` before `.optional()` rescues, so "leave blank and continue" doesn't work. Same pattern hits `inviteAdminSchema.firstName/lastName` and likely other `.min(1).optional()` fields. Fix is either `.preprocess(v => v === "" ? undefined : v, ...)` in the schema OR `setValueAs(v => v === "" ? undefined : v)` on each react-hook-form register call. Discovered during Slice 9 E2E test; workaround is filling valid placeholder values. — pre-customer launch.
  - PARTIALLY RESOLVED (`fix/empty-optional-forms`): the **student create/edit form** (`apps/web/src/components/students/student-form.tsx`) was the worst case — it used the strict `createStudentSchema` as the react-hook-form resolver, so every blank optional (`.min(1)…optional()` / `.email()` / `.url()`) failed and **silently blocked submit** with most fields rendering no error. Fixed with the form-class discipline: a local `studentFormSchema` matching FormValues (optionals allow `""` via `z.string().max()` + a `refine` for email/url format), root + per-field error blocks, `""`→undefined on submit, zero `as never`. The slice-5 guardian form (manual `useState` validation, maps `""`→undefined) and the slice-10 cp3 staff forms (`/staff/invite`, `/staff/[userId]/edit`, `/teacher/profile`) were audited and already follow the pattern. STILL OPEN: the Phase-0 **step-2 branding** form (`logoUrl`/`primaryColor`) — fix it the same way next time Phase-0 onboarding is touched.

- [ ] Coverage reporting in CI (Codecov or Coveralls). Phase 0 prioritises runtime correctness over coverage %. Trigger: when there's a real risk of untested code paths shipping — likely after Phase 3 when contributors join.

- [ ] Dependabot / Renovate + commitlint. Dependency-update bots and conventional-commit-message linting both have value but neither blocks Phase 0 shipping. Trigger: before first external contributor, or after first dependency-driven security incident.

- [ ] Wire real ESLint for apps/api. Slice 8b shipped real ESLint for `apps/web` (flat config, ESLint 9, shared base in `packages/config/eslint/`) but left `apps/api` on the echo-placeholder. Same pattern: add `packages/config/eslint/nest.js` extending the shared base with Node/Nest-specific rules (no-floating-promises, no-misused-promises, decorator-aware unused-vars), then point `apps/api/eslint.config.js` at it and flip the lint script to `eslint . --max-warnings=0`. Trigger: when api code starts having style drift, or before first external contributor.

- [ ] Move to eslint-config-next's native flat-config export when it ships. Slice 8b uses `@eslint/eslintrc`'s `FlatCompat` to consume eslint-config-next v15.5's legacy configs (the package doesn't yet ship a `flat/` export). When eslint-config-next adds native flat config (likely in a Next 15.x patch or Next 16), `packages/config/eslint/next.js` collapses to a direct spread and we drop `@eslint/eslintrc` from the dependency tree. Trigger: when next minor/major release notes mention native flat config support.

- [ ] `apps/web/src/lib/api-client.ts`'s `apiFetch` only wraps non-2xx HTTP responses in the typed `ApiError` — a raw `fetch()` rejection (network failure, CORS failure, connection reset) propagates as an unwrapped `TypeError`/`AbortError` instead, which falls through to whatever generic catch-all a caller has (e.g. `guardians-tab.tsx`'s `"Could not create guardian."` fallback for `!(err instanceof ApiError)`), with no distinction from a real server-side error. Found 2026-07-19 while root-causing a guardian-creation bug report from Arinzechukwu — initially misattributed to a ~22s Fly cold start (`apps/api/fly.toml`'s `min_machines_running` fix, same date fixed that too, real but unrelated bug), but the actual trigger for THIS report was a CORS misconfiguration (see the dedicated entry below) that made every browser-side API call from the real production domain fail with a raw, unwrapped fetch rejection — exactly the gap this item describes. Both underlying causes are now fixed, but this gap itself remains: ANY future network-level failure (not just these two) will keep producing the same non-diagnostic message to users and support, and — as this incident showed — makes root-causing slower, since "generic client error" gives no signal on whether the request even reached the server. A proper fix would catch the raw fetch rejection in `apiFetch` and wrap it in a distinguishable error type (e.g. `ApiNetworkError`) so callers/error boundaries can show "couldn't reach the server, check your connection" instead of the generic catch-all. — Trigger: next time a network-level (as opposed to application-level) failure causes user-facing confusion, or as a proactive hardening pass once Phase 4 closes.

- [x] **`CORS_ORIGIN`/`WEB_BASE_URL` Fly secrets pointed at the wrong domain in production since initial provisioning. FIXED 2026-07-19.** `docs/runbooks/neon-prod-setup.md` §5's `flyctl secrets set` template has always used a `<vercel-web-url>` placeholder for both `CORS_ORIGIN` and `WEB_BASE_URL` — whoever first ran it (around Slice 1's close, `docs/runbooks/neon-prod-setup.md` last touched 2026-07-08, but the placeholder line itself dates to the 2026-06-18 infra commit) substituted the raw `https://school-kit-web.vercel.app/` Vercel URL (with a trailing slash — `cors`'s origin match is exact-string, so the slash alone would have broken it even against the right domain). Nobody updated it when `app.schoolkit.ng` was later attached as `school-kit-web`'s real custom domain — that attachment isn't documented anywhere in this repo either (unlike `portal.schoolkit.ng`'s, which got a full write-up in `docs/modules/phase-4.md` §7 Slice 1 CP2 — worth doing the same for `app.schoolkit.ng` next time either domain's config is touched).
  Real-world impact: every browser-side request from `apps/web`'s real production origin (`https://app.schoolkit.ng`) triggered a CORS preflight failure — confirmed directly via `curl -X OPTIONS` with `Origin: https://app.schoolkit.ng`, which came back with no `access-control-allow-origin` header at all. This is browser-only (curl/server-to-server calls never enforce CORS), which is exactly why a direct API reproduction of Arinzechukwu's report succeeded cleanly while the real admin UI failed — and it affected the invitation-accept page too (`apps/web/src/app/invitations/[token]/page.tsx` is a client component, so its API calls are equally CORS-subject), not just guardian creation.
  **Exposure window and re-send check:** roughly 2026-06-18/26 (original provisioning) through 2026-07-19 (this fix). Two mitigating facts, both verified directly rather than assumed: (1) the wrong `WEB_BASE_URL` domain (`school-kit-web.vercel.app`) still resolves to the same live deployment (`curl` confirmed `200`, no dead link — Vercel serves both the custom domain and the raw `.vercel.app` URL for the same project by default), so invitation emails sent during the window were not *dead* links; (2) a read-only production query (all schools, `invitation.acceptedAt IS NULL AND createdAt >= 2026-06-18`) found **zero pending invitations** — so even though the accept flow would have hit the same CORS failure for anyone who tried, nobody appears to have actually tried during the exposure window. **No known invitations need manual re-sending as of 2026-07-19** — re-check this conclusion if evidence turns up of a real invitation attempt from this period that isn't captured by this query (e.g. a school support ticket).

- [x] **`school-kit-web`'s `NEXT_PUBLIC_API_URL` Vercel env var held a placeholder value in production, breaking every browser-facing auth flow. FIXED 2026-07-20.** Found the same day as the `CORS_ORIGIN`/`WEB_BASE_URL` entry above, via the same reporter (Arinzechukwu, this time hitting "can't create a new school" on `app.schoolkit.ng` rather than guardian creation) — a separate bug, not a continuation of the CORS one: `apps/web/src/app/api/auth/[...auth]/route.ts` (which proxies login/signup-owner/logout/2fa/challenge server-side, so it's never subject to browser CORS at all) was building its API base URL from `NEXT_PUBLIC_API_URL`, which `vercel env pull` showed as an empty string but the actual deployed bundle's runtime error (`vercel logs --expand`) revealed as literally `api.placeholder.example.com` — a value baked in at Next.js build time (`NEXT_PUBLIC_*` vars are compiled into the bundle, not read live) that had never been corrected to the real API URL. Confirmed by direct reproduction: `POST https://app.schoolkit.ng/api/auth/signup-owner` returned `500` with `[TypeError: fetch failed] { [cause]: [Error: getaddrinfo ENOTFOUND api.placeholder.example.com] }` in Vercel's function logs, before the fix; `201 Created` with a real session cookie after.
  Fixed via `vercel env rm`/`vercel env add NEXT_PUBLIC_API_URL` (production + preview) set to `https://school-kit-api.fly.dev/api/v1`, then a forced fresh production build (`vercel --prod`) since the bad value was compiled into the already-live bundle and updating the dashboard value alone would not have taken effect until the next deploy anyway.
  **Exposure window and real-impact check:** the env var key itself is "created 38 days ago" per Vercel (no value-change history available via the CLI, so that's an upper bound, not a confirmed continuous-bad-value duration). Checked for real impact by querying every school in production: **every single school row is a `Smoke Test School` entry** created by `scripts/smoke-test.sh`'s own direct-to-Fly-API calls (which bypass this broken proxy entirely, explaining why smoke tests kept passing the whole time) — there is not one genuine, non-test school signup in the database. Combined with this project being pre-pilot (no onboarded customers), this confirms **no real customer was ever affected** — the only impact was blocking Arinzechukwu's own manual QA, which is exactly what surfaced it. See the smoke-test-school-accumulation item below, found via this same query.

- [ ] **Production `school-kit-api` DB accumulates an uncleaned `Smoke Test School` row on every single deploy.** Found 2026-07-20 while checking the `NEXT_PUBLIC_API_URL` incident above for real-user impact: `scripts/smoke-test.sh`'s `POST /auth/signup-owner` call (op 3 of the deploy smoke test, direct against the Fly API) creates a genuine `School`+owner `User` row on every successful `deploy-staging.yml` run and never deletes it — every production deploy leaves one more behind. At the time of that check, the 15 most recent schools in the entire production database were *all* smoke-test artifacts (`smoke-<epoch>` slugs), none cleaned up. Same failure category as the pre-existing "Dev DB cleanup — ~100 test schools" item above, except this one is in **production**, not dev. Fix options: (a) have the smoke test delete its own school at the end of the run (requires a delete path — see that item's own note that no `DELETE /schools/:id` API exists today), or (b) a scheduled cleanup job filtering on the `smoke-` slug prefix. — Trigger: before a real pilot school's data needs to coexist cleanly with these in any admin-facing school list, or whenever someone next touches `scripts/smoke-test.sh`.

- [x] **`STORAGE_DRIVER=r2` was never set in production — `school-kit-api` and `school-kit-render-worker` were running the dev-only filesystem storage driver the entire time. Found 2026-07-21, FIXED and verified end-to-end 2026-07-23.** Found while spot-checking other third-party secrets after the `RESEND_API_KEY` incident above turned up the same "documented/coded but never verified live" pattern a third time in two days. `docs/runbooks/neon-prod-setup.md` §5 already templated the four `R2_*` credential lines (unlike the Resend gap, those weren't missing from the template) — but `STORAGE_DRIVER` itself, the switch that actually selects the R2 driver, was nowhere in the template on either app. `storage.module.ts`'s own fallback (`config.get<string>("STORAGE_DRIVER") ?? "filesystem"`) meant both apps silently ran the filesystem driver in production this whole time, and confirmed via `flyctl secrets list` that the `R2_*` credentials were never actually set either — so this was two compounding gaps (no real credentials AND no switch to use them), not just one.
  Two independent problems, both real: (1) **write target** — the filesystem driver writes to the Fly machine's own ephemeral container disk, no volume mounted (checked `fly.toml` — no `[[mounts]]` block), so every file written is lost on the next deploy or restart. (2) **serve path** — the filesystem driver's `signUrl()` points at `DevStorageController`, which is deliberately dev-only (`isProd ? [] : [DevStorageController]`, same module) — confirmed directly with `GET /api/v1/dev-storage/...` against the live API returning `404`, independent of whether any file survived. Even a file that happened to still exist had no route to be fetched through.
  **Investigated for real damage before doing anything else, per explicit instruction — found none.** Queried every `Payment.receiptUrl` and `ReportCard.artifactUrl` in production: all `null`, zero rows either way. Consistent with the `NEXT_PUBLIC_API_URL` incident's own finding that every school in the database is a `scripts/smoke-test.sh` artifact (whose 5 ops never touch payments or report cards) — nothing has ever exercised the real write path, so there was nothing to recover and nobody to notify. Purely a forward-looking fix, confirmed before anything was applied.
  **A second wrong-documented-value gap surfaced along the way**: the runbook's suggested `R2_BUCKET="school-kit-staging"` (also present in the original Slice 1b provisioning journal) turned out not to exist under the real account. Confirmed by calling R2's S3-compatible API directly with the real credentials before using them for anything else — `ListBuckets` itself came back `403` (the token is scoped to a single bucket, not account-wide — a permissions rejection, not a signature failure, so this didn't mean the credentials were bad), then `HeadBucket`/`ListObjectsV2` against candidate names found the real bucket: **`school-kit-prod`**. Fixed in the runbook template (see its own guard note) before the actual `flyctl secrets set` calls ran, so the wrong value was never live even briefly.
  **Fixed and verified real end-to-end, not just secret presence**: `flyctl secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=school-kit-prod STORAGE_DRIVER=r2` run on both `school-kit-api` and `school-kit-render-worker`, confirmed deployed via `flyctl secrets list`. Then a genuine write+fetch cycle through real, unmodified production code: signed up a test school, created a student and a real `ISSUED` invoice, called the real `POST /payments/manual` endpoint — `201`, with a populated `receiptUrl` (`schools/<id>/receipts/<paymentId>.html`, the canonical R2 object key), proving `storage.put()` succeeded synchronously as part of the request. Called the real `GET /payments/:id/receipt` endpoint — `200`, returned a genuine presigned URL at `school-kit-prod.<accountId>.r2.cloudflarestorage.com` (bucket name matches the corrected value). Fetched that URL directly — `200 OK`, `Server: cloudflare`, real receipt HTML content (`Receipt RCP-...`) matching the payment just created. All test data (DB rows and the R2 object itself) cleaned up afterward and confirmed gone (`NotFound` on a follow-up `HeadObjectCommand`).

- [ ] **Re-validate the report-card PDF memory gate IN A FLY.IO CONTAINER + author `apps/api/Dockerfile` with Chromium provisioning.** Slice-5 cp2's 40-card memory gate was measured in **dev on Windows** only (numbers in the 2026-06-04 journal entry). The fly.io Linux container fit is unproven. Before the first deploy that enables PDF render: (1) write `apps/api/Dockerfile` provisioning Chromium + system libs + a font (checklist in `docs/modules/phase-2.md` § "Deployment — Chromium provisioning"); (2) re-run the gate in-container against the target machine size (512MB / 1GB) — GREEN if peak RSS < 70% of budget. If it FAILS in-container, fall back to the external render service (the existing phase-2.md deferred item). **Trigger: pre-deploy / Phase 3 infra, or the first time PDF render is wanted in a deployed env.**

## Phase 1 — AI foundation tables (DONE — slice 12, 2026-06-01)
- [x] Mastery-tracking table: thin/additive-friendly, school_id + RLS,
  RLS test extended. Minimal columns (student, school, topic_ref,
  status, updated_at). Detailed shape OWNED BY PHASE 5. Foundation-only,
  sits empty until then. MUST be pulled into docs/modules/phase-1.md
  when spec is written — failure mode is forgetting it and hitting a
  live-data migration at Phase 5. _(Shipped as `MasteryRecord` /
  `mastery_records`, slice 12. FORCE RLS + isolation spec; zero rows.)_
- [x] AI-interaction-log table: same discipline. Minimal columns
  (student, school, session_ref, payload jsonb, created_at). Shape
  owned by Phase 5. _(Shipped as `AIInteractionLog` /
  `ai_interaction_logs`, slice 12.)_

## Phase 5 — AI table naming reconciliation (RESOLVED 2026-07-26)
- [x] `AIInteractionLog` vs `AIGeneration` naming drift. Slice 12 shipped
  `ai_interaction_logs`, while ARCHITECTURE.md §5/§7 and CLAUDE.md's AI hard
  rule ("every `claudeClient.messages.create` must log to the
  `ai_generations` table") name the LLM-call log `AIGeneration` /
  `ai_generations`. Investigated pre-Phase-5 (no code anywhere reads or
  writes `AIInteractionLog` today — only the RLS policy and the Slice 12
  isolation spec touch it — so there was no live-data risk either way).
  **Decision: keep both, as genuinely different tables — not a rename, not
  a merge.** The two schemas already point at different jobs: `payload`
  (loose JSON) + nullable `studentId` + `sessionRef` grouping on
  `AIInteractionLog` is shaped for session/interaction **content**
  (conversation/feature transcript, replay, audit); the hard rule's
  required fields for `ai_generations` (model, prompt name+version, token
  counts, latency, cost, success/error) are shaped for a flat, typed,
  cheaply-aggregable per-call **cost/compliance ledger** that the
  budget-enforcement query needs. Renaming `AIInteractionLog` →
  `AIGeneration` would not have closed the gap — none of the hard rule's
  required columns exist on `AIInteractionLog`, so it would still need
  every one of them bolted on afterward. One tutor session (one
  `AIInteractionLog` group) is expected to span multiple underlying calls,
  each logged separately to `ai_generations`. Boundary now documented in
  CLAUDE.md's AI hard-rules section. `ARCHITECTURE.md §5`'s naming of
  `CurriculumChunk` + `TutorSession` (neither shipped, neither is
  `MasteryRecord`) is unaffected by this decision — those remain
  unbuilt/unnamed-in-schema until their own Phase 5 slices.

  **Not yet done — Phase 5's own plan-first still owns finalizing this**
  (schema drafted here, migration deliberately NOT applied by this PR):
  ```prisma
  model AIGeneration {
    id               String   @id @default(uuid())
    schoolId         String   @map("school_id")
    interactionLogId String?  @map("interaction_log_id") // nullable: not every call is session-scoped
    model            String
    promptName       String   @map("prompt_name")
    promptVersion    String   @map("prompt_version")
    inputTokens      Int      @map("input_tokens")
    outputTokens     Int      @map("output_tokens")
    latencyMs        Int      @map("latency_ms")
    costEstimate     Int      @map("cost_estimate") // money: kobo, per CLAUDE.md's Money hard rule — see open question below
    success          Boolean
    errorMessage     String?  @map("error_message") // redacted; no secrets/PII, per CLAUDE.md
    createdAt        DateTime @default(now()) @map("created_at")

    interactionLog AIInteractionLog? @relation(fields: [interactionLogId], references: [id], onDelete: SetNull)

    @@index([schoolId])
    @@index([schoolId, createdAt])
    @@map("ai_generations")
  }
  ```
  Open questions for that plan-first: (1) **cost-estimate currency/unit** —
  Anthropic bills in USD; CLAUDE.md's Money rule says kobo/`Int` in DB, which
  means either converting USD→kobo at write time (needs an FX-rate source
  and a rounding policy) or accepting `costEstimate` is the one deliberate
  exception to the kobo rule (needs its own explicit carve-out, not a silent
  one). (2) whether `promptVersion` should be a free string or reference a
  versioned prompt registry in `packages/ai/prompts/`. (3) retention/
  partitioning policy once volume is non-trivial (the `audit_logs`
  partitioning precedent from Phase 3 Slice 3 may be the template).
  Trigger: first Phase 5 slice that writes an LLM call.

## Roadmap / strategy — REVISIT with live market research (not decided)
- [ ] CBT / online exams (JAMB/WAEC/UTME prep) — competitors lead with
  this. Decide in/defer based on pilot-school demand + current market.
- [ ] Predictive AI (at-risk-student early warning from attendance+grade
  trend, enrollment forecasting, auto billing reminders) — high-value,
  data already collected. Verify market framing before Phase 5.
- [ ] Agentic vs generative AI positioning — market may have shifted
  toward adaptive/agentic by Phase 5. Run live search before committing
  AI roadmap. Do NOT build multi-agent orchestration as solo founder.
- [ ] Timetable, transport, library, hostel — Phase 7. Named so
  "do you have X?" has a clear deferred answer, not a blank.
- [ ] WAEC/NECO localization is the moat (Khanmigo/Squirrel AI aren't
  localized) — keep leaning on it. Verify competitor claims when planning.

  - [ ] mapUniqueViolation helper — multi-constraint meta.target fix.
  Original concern: a model with 2+ unique-per-school constraints would
  break the single-constraint discriminator. Slice 5 turned out to be a
  non-trigger: Guardian carries ZERO unique constraints (phone is
  intentionally shareable across guardians, per schema.prisma + the
  list-guardians scoped tests), and StudentGuardian has exactly one
  unique constraint — `(studentId, guardianId)` — so a local helper
  `mapStudentGuardianLinkUniqueViolation` returning
  `GUARDIAN_ALREADY_LINKED` was enough and stays in-place. The
  P2002 `err.meta.target` inspection fix stays deferred until a slice
  actually adds a model with 2+ uniques (no candidate currently
  identified inside Phase 1 — TeacherProfile has one, ImportJob has
  none, Enrollment has one). Trigger: first such model. The
  SECURITY-DEFINER pre-check alternative remains worse on every axis
  (cost: pushes SD count past 5, hardens an attack surface that doesn't
  need hardening) so the meta.target path is the locked decision.

- [ ] pg_trgm-backed student search. Slice 4 cp2 ships search as
  `ILIKE %term%` across (admissionNumber, lastName, firstName) — fine
  for a 250-student pilot, sequential-scan-shaped past that. Drop in
  the `pg_trgm` extension (already on the box for pgvector neighbours
  in Phase 5), add a GIN trigram index on the searchable columns, and
  swap the Prisma `contains` to a raw `$queryRaw` similarity match.
  Trigger: roster latency on `/students?search=…` exceeds ~300ms in
  any pilot, OR first school crosses ~2 000 students.

- [ ] Consolidate pre-tenant DB access into a single `common/pre-tenant/`
  module. Slice 6 cp1 grew the `basePrisma` allowlist (the ESLint rule
  that flags tenant-bypassing imports) to 8 paths — auth lookups, the
  validate worker, the import-job updater, etc. Each one is justified
  individually (no schoolId in scope yet, or a tenantWorker that sets
  one before any DB call) but the breadth dulls the rule. Plan: move
  every legitimate caller behind a single barrel that exports a
  narrower `preTenantPrisma` handle, shrink the allowlist back to 1.
  Trigger: when the count tops 10, or when slice 13 sweeps permissions
  and we touch most of these files anyway.

- [ ] Prisma 5.22 → 7.x major upgrade. Slice 6 cp1 pinned Prisma at
  5.22 because the validate worker / pgvector pieces all green. Major
  upgrades are a dedicated maintenance pass, not a feature rider —
  schema-engine binary path changes and the rust-free pre-Prisma-6
  client need to be retested against our RLS spec and tenant client.
  Trigger: end-of-phase maintenance window, or when a security
  advisory lands on 5.x.

- [ ] CSV bad-rows CSV de-duplicates parse+required errors per field.
  Slice 6 cp3 surfaces both the "could not parse 'X' as DD/MM/YYYY"
  message AND the schema's "date of birth required" when a row's DOB
  is malformed — both are correct individually, but for the admin
  fixing rows in Excel the second one is noise. Engine should drop
  the required-error when a pre-parse error already covered the same
  field. Polish, not correctness. Trigger: first admin feedback that
  the bad-rows CSV is hard to scan.

- [ ] Expose CSV headers + sample rows on `GET /imports/:jobId` so the
  mapping wizard resumes after a tab close / refresh / direct-URL paste.
  Slice 6 cp4 bridges step 1 → step 2 via sessionStorage keyed by jobId
  (see apps/web/src/lib/imports/session.ts) — typical wizard completion
  is <5 minutes so the gap rarely bites, but a refresh in step 2 today
  bounces the admin back to upload. Fix: add `headers: string[]` and
  `sampleRows: Record<string,string>[]` to `ImportJobDto` for PENDING
  jobs only (the slice 7 commit path doesn't need them). Cheaper than
  reading the persisted source CSV on every poll. Trigger: first admin
  who hits the "session expired" toast, or when the wizard gains a step
  4 (done screen) that admins might bookmark.

- [ ] Guardian-import dedup key — spec at phase-1.md:949 says exact-match on
  `phone + lastName`. Slice 8 cp1 implements `phone + firstName + lastName`
  instead because slice 5's schema comment at schema.prisma:438-442
  explicitly anticipates "a mother and father commonly share a household
  phone" — and they'd share lastName too. Spec key collapses Mr. + Mrs.
  Okonkwo at the same number into ONE Guardian (wrong data). The fix
  costs nothing (same query plan) and is the right product behaviour.
  Captured here so a future reader of phase-1.md:949 doesn't try to
  "fix" the implementation back to the spec. Trigger: only if a pilot
  reports the opposite problem (two Guardian rows for what they think
  is one person).

- [ ] Guardian-import merge policy when dedup-key matches but Guardian-
  level fields disagree — first-row wins, silently. Schema has
  `relationship` as a per-Guardian column (schema.prisma:462), not on
  StudentGuardian. When two CSV rows share the slice-8 dedup key
  (phone+firstName+lastName) but disagree on relationship (or email,
  occupation, etc.), the commit-side find-or-create returns the existing
  Guardian and silently ignores the second row's Guardian-level data.
  Same merge-conflict policy as distributed-systems sync. Tested
  explicitly in commit-guardians.handler.spec.ts case 2. Trigger: only
  if a pilot complains they can't tell why row N's relationship was
  "ignored" — the obvious upgrade is to surface a per-row warning tier
  in the error report (validate / commit / warning), which would also
  cost a small UI tweak on the preview screen.

- [ ] `/guardians` roster page (canonical entry point for the guardian
  bulk-import wizard). Slice 5 shipped guardian forms inline on the
  student-detail page; the standalone roster page hasn't landed yet.
  Slice 8 cp2 routes the wizard's "View roster" CTA to `/students` as
  a stopgap because that's where admins can drill down to a student
  and see the new guardians on the Guardians tab. Trigger: when slice
  11+ ships `/guardians` and `/guardians/[id]`, swap the CTA target.

- [ ] Bulk "invite all imported guardians with an email" CTA on the CSV
  import done page (`/guardians/import/[jobId]/done`). Scoped into the
  guardian-invite plan-first as an approved follow-up to the per-guardian
  invite action, then dropped mid-implementation: `ImportJob`
  (`schema.prisma:660`) tracks only aggregate counts
  (`committedRows`/`validRows`/etc.), not which Guardian rows a job actually
  created or matched — there's no `importJobId` FK or join table, and a
  `createdAt`-window heuristic would be unsound (dedup-matched guardians
  from earlier imports aren't freshly created, so they wouldn't show a
  recent `createdAt` even though this job touched them). Building the CTA
  as originally scoped needs real per-row tracking (nullable `importJobId`
  on `Guardian`, or a join table) — a schema change, not the UI-only work
  the rest of this pass was. Decision: skip it here; the `/guardians`
  roster page (slice 11, see the item above) will need bulk-select
  machinery anyway and can invite whatever's selected without needing
  per-job tracking at all. Trigger: slice 11, or sooner if a pilot school
  does frequent large guardian CSV imports and manually inviting one-by-one
  becomes a real pain point.

- [ ] Shared `usePermissions` hook for `apps/web`. The 2-line
  `hasPermission(permissions, perm)` helper (checks `permissions.includes("*")
  || permissions.includes(perm)`) is duplicated per-file rather than shared:
  `finance/payroll/page.tsx`, `staff/bvn-section.tsx`,
  `components/students/guardians-tab.tsx` (guardian-invite button, gating
  `guardian.invite` to owner/admin — hide, not disable, for everyone else),
  and now `settings/notifications/page.tsx` (same hide-not-disable gate on
  `notification-preferences.read`/`update`). No divergence yet, just
  copy-paste. **Trigger condition has now fired (4th site, 2026-07-18)** —
  next touch of any of these four files is a reasonable point to actually
  extract the hook, rather than adding a 5th copy.

- [ ] Cross-cutting unsaved-changes guard for the class-subject matrix.
  Slice 3 cp3 ships a two-layer guard: `beforeunload` (catches close /
  refresh / URL-bar navigation) plus a `MatrixDirtyContext` that the
  AcademicSubNav consumes (catches sibling tab clicks within
  `/settings/academic/*`). What's NOT guarded: the global sidebar, the
  user menu, the logo/home link, and any link outside the academic
  sub-nav. A user who clicks "Dashboard" in the sidebar with unsaved
  matrix changes loses them silently. Phase-1-acceptable because the
  matrix is a rarely-edited setup screen (term-start workflow), but
  needs lifting to a global Next.js navigation interceptor before the
  matrix sees daily traffic OR before any other screen needs the same
  guard (e.g. CSV import mid-flow). Trigger: first user-reported "I
  lost my changes" OR second screen that needs a dirty guard. Likely
  approach: a router-level event listener (Next.js 15 App Router
  doesn't expose `router.beforePopstate`-style hooks cleanly, so this
  may need a wrapping `<Link>` component or a `useNavigationGuard()`
  hook reading from a shared dirty registry).

  - [ ] Add graduatedAt column to Enrollment if Phase 2 transcript module
  needs an explicit graduation moment; currently derived from updatedAt
  (slice 9 cp1).
- [ ] Stronger atomicity test for the slice 4 → slice 9 cascade via
  Prisma $extends({ query: ... }) middleware (spy-based approach blocked
  by Prisma tx-client proxy; correlation test is sufficient for now)
  (slice 9 cp1).

  - [ ] /enrollments/bulk wizard's "Admitted after previous term" group
  pages through listStudents client-side and filters by admittedAt
  locally. Fine for ~250-student schools; at 5,000+ becomes 25 serial
  requests on mount. Add server-side admittedAt[gt] filter to GET
  /students when scale demands. (slice 9 cp2)

  - [ ] Audit the `as never` casts on zodResolver across the 5 academic
  dialog forms (academic-year, term, class-level, class-arm, subject).
  Class-arm was uniquely broken (URL-path param + nullable-number-from-
  blank-input combo) — the API body schema rejected the FormValues
  silently with no UI feedback, because `.strict()` errors have empty
  `path: []` and react-hook-form has nowhere to bind them. The fix
  (slice 9 cp2) introduces a local `classArmFormSchema` that mirrors
  FormValues, but the `as never` cast itself is a type-safety smell
  that could mask future regressions in the other four dialogs the
  same way. Replace `zodResolver(schema) as never` with properly-
  typed resolvers across all five dialogs. (Discovered slice 9 cp2.)

- [ ] Teacher CSV import is INVITE-ONLY (email + firstName + lastName);
  importing the profile fields (staffNumber, specialty) is deferred.
  phase-1.md:950 originally specified the teacher CSV carries staffNumber
  + specialty, but the Invitation row can't hold them (phase-1.md:478,
  "No new columns are added to invitations") — which is why slice 8
  deferred teacher import to slice 10 in the first place. Slice 10 cp2
  ships the invite-only CSV (Q2 lifecycle: profiles are created by the
  admin after acceptance), which fully satisfies acceptance criterion #7
  ("the CSV import flow works for teachers, creating Invitations"). To
  import profile fields too, the typed staffNumber/specialty would need a
  STAGING mechanism that survives invite→accept: e.g. a pending
  TeacherProfile (userId nullable + invitedEmail) materialised on accept,
  or a small TeacherInvitationDraft table keyed by (schoolId, email)
  consumed by the accept hook. Both are real schema work. Trigger: a pilot
  that wants bulk staff-data load (not just bulk invites) — or when Resend
  email delivery lands and the bulk-invite flow gets real reach. (slice 10
  cp2.)

- [ ] Bulk teacher-invite accept-URL delivery. commit-teachers.row.ts mints
  one Invitation per row and LOGS the accept URL (`[INVITATION] <url>`),
  exactly like the single-invite UsersService.invite flow — because Resend
  email delivery is deferred (Phase 4). For a 15-teacher bulk import the
  operator must currently scrape 15 URLs from the worker logs; and since
  we only store the token HASH, there's no "copy link" affordance for them
  afterwards (same root cause as the existing "Re-issue / revoke pending
  invitations" item). Trigger: Phase 4 communications (Resend) — the bulk
  path should send each teacher their own accept email. (slice 10 cp2.)

  - [x] RLS isolation spec gap: slice 9 enrollments table never had its
  RLS block added to apps/api/src/__tests__/rls.spec.ts. Discovered
  during slice 10 cp1 (which DID add teacher_profiles). Required for
  slice 13 acceptance #10 ("all Phase 1 tables in isolation spec").
  DONE (slice 13): enrollments describe block added (5 assertions, same
  pattern as teacher_assignments). All 15 Phase 1 tables now covered;
  rls.spec.ts at 63 tests.

- [ ] Single teacher invite via the UI needs a `roleKey` on `POST
  /users/invite`. Slice 10 cp3's `/staff/invite` form was ADMIN-ONLY:
  `inviteAdminSchema` had no `roleKey` field and `UsersService.invite`
  hardcoded `roleKey: "admin"` (Phase 0).
  **PARTIALLY RESOLVED (Phase 3 slice 15 cp2):** `inviteAdminSchema` now
  carries `roleKey: z.enum(["admin", "bursar"]).default("admin")`,
  `UsersService.invite` re-validates it server-side, and `/staff/invite` has
  a Role dropdown — but the enum is deliberately **admin | bursar only**.
  Teacher is still excluded: TeacherProfile fields (staffNumber, specialty)
  aren't on the invite-accept path (see the "Teacher CSV import" deferred
  item above), so a single teacher invite still can't carry them, and
  teachers are invited in bulk via `/staff/import` (the CSV path mints
  `roleKey="teacher"` invitations through `commit-teachers.row.ts`). Extending
  the enum to include `"teacher"` needs that staging mechanism first, not
  just a dropdown option. Trigger: an admin who needs to invite one teacher
  without building a one-row CSV. (slice 10 cp3; partially resolved slice 15
  cp2.)
  - ALSO BLOCKS a clean E2E path: slice 11 cp4's `inviteAndAcceptTeacher`
    fixture (`e2e/fixtures/teacher.ts` + `db.ts`) seeds the `roleKey='teacher'`
    Invitation row directly via `withTenant` precisely because no API mints
    one. When this lands, swap `seedTeacherInvitation` for the new endpoint —
    the fixture's accept+login half is already production-faithful. (slice 11
    cp4.)

- [ ] Staff roster has no server-side pagination. `/staff` (slice 10 cp3)
  loads the FULL set from `GET /users` + `GET /users/invitations` (neither is
  cursor-paginated) and pulls one page (limit 200) of `GET /teacher-profiles`
  purely to compute has-profile state. Fine for a pilot school's handful of
  staff; if a school ever crosses ~200 teachers the has-profile lookup
  silently stops past page 1 (the page surfaces an amber note when the
  teacher-profiles cursor is non-empty, so it's visible, not silent — but the
  fix is real). Add cursor params to `GET /users` (or fold has-profile into
  the user list server-side) when staff counts grow. Trigger: first school
  past ~200 staff, or staff-roster latency complaints. (slice 10 cp3.)

  - [ ] Auth-to-cookies migration to enable server components.
  Currently every page is "use client" because apiFetch reads the
  Bearer token from localStorage (server components can't access it).
  Migrating to httpOnly cookie auth (or hybrid session lookup) would
  enable Server Components for SEO, smaller client bundle, server-
  side notFound() / redirect() flows. Cross-cutting refactor — likely
  Phase 4 or Phase 7. Discovered slice 11 cp3.

- [x] Student create/edit form rejects BLANK optional fields. The form
  (`apps/web/src/components/students/student-form.tsx`) validated raw form
  values with `zodResolver(createStudentSchema)`, whose optional fields are
  `.min(1)…optional()` / `.email()` / `.url()` — so an empty string `""` (the
  default for an untouched input) failed validation. Most of those fields
  rendered NO error message, so clicking "Create student" with only the
  required fields filled silently did nothing. Broke acceptance #5's UI path
  (a service-level create with omitted optionals works fine — that's why
  slice-4 specs pass). Discovered by slice 13's
  `e2e/tests/admin-roster-happy-path.spec.ts`.
  RESOLVED on its own branch/PR `fix/empty-optional-forms` (merged before
  slice 13): local `studentFormSchema` matching FormValues with optionals
  allowing `""`, root + per-field errors, `""`→undefined on submit, zero
  `as never`. Sibling forms (slice-5 guardian, slice-10 cp3 staff) audited
  and already compliant. See the `#58` entry above for the full record.
  (Discovered slice 13; fixed in fix/empty-optional-forms.)
- [ ] Grading-scheme "reset scores" / unfreeze path — once any AssessmentScore
  exists for a school, the GradingService freeze guard (Phase 2 / Slice 2 cp3)
  blocks all component create/update/delete/replace, because changing a weight
  or the component set would silently corrupt every already-materialized
  Assessment total (phase-2.md "score aggregation cascading wrong if
  GradingComponent.weight changes mid-term"). The invariant is deliberately
  conservative (ANY score, school-wide — not "active term only") to categorically
  prevent the retroactive-recompute footgun. The unfreeze is therefore an
  explicit, audited admin action — e.g. `POST /grading-scheme/reset` (owner-only)
  that deletes the school's AssessmentScores + their Assessment summaries inside
  one audited tx, returning the scheme to an editable state. The freeze error
  message points at this path ("an admin must reset scores first (audited)").
  NOT built in slice 2 — trigger is the first pilot that genuinely needs to
  re-weight a scheme after marks were entered (rare; most schools lock the
  scheme before the term starts). When built, it must be a single audited
  mutation, not a silent cascade.
- [ ] Per-date enrollment history (daily attendance). Enrollment carries one
  row per (student, term) with a single `classArmId` field. A mid-term arm
  transfer overwrites the previous arm. The daily-attendance register
  (Phase 2 / Slice 7) therefore reflects the student's CURRENT arm; historical
  "who was in this arm on this date" is not queryable. Existing
  `attendance_records` rows survive a transfer (they carry their own
  `class_arm_id`), and the term summary still surfaces a transferred/withdrawn
  student (it is queried by `term_id`, not current enrollment) — so no history
  is lost, only the "register as it stood on a past date for a since-moved
  student" reconstruction. Trigger: the first school that needs to audit
  past-date attendance for transferred students. When built, the fix is an
  enrollment-history/movement table (one row per arm placement with an
  effective-date range), not a column on Enrollment.

- [ ] Receipt branding — HTML receipts (Phase 3 / Slice 7) contain no school
  name, logo, student name, or term; they carry only the payment amount,
  receipt number, method, and date. Add these fields to the receipt template
  as a fast-follow once pilot feedback confirms the minimal receipt is
  acceptable. Trigger: first pilot school that requests a branded receipt.

- [ ] PDF receipts via Puppeteer — `storageService.put` saves receipts as
  `text/html` (Phase 3 / Slice 7, D4 in `docs/modules/phase-3.md §16`).
  Swap to `text/pdf` by running the template through `RenderService` with no
  API contract change (`GET /payments/:id/receipt` returns a signed URL
  regardless of MIME type). Trigger: first bursar who finds the browser-print
  path inadequate. Zero schema change needed.

- [ ] Full payroll — salary structure + deductions → net, Paystack staff
  transfers, payslip PDF, structured qualifications. Phase 3 / Slice 12 was
  scoped down at build time (2026-07-08) to BVN capture/reveal only
  (`encrypt_bvn`/`decrypt_bvn` pgcrypto functions) — the rest of "basic
  payroll" per phase-3.md §6.10 was never built and this is the first place
  it's tracked as deferred (flagged during slice 15 close-out; previously an
  undocumented gap between the slice table's original scope and what
  actually shipped). Trigger: first pilot school that needs the platform to
  run payroll rather than just store BVNs.

- [x] `audit-coverage.spec.ts` extended for `finance.*` mutations. **DONE**
  (Phase 3 cleanup pass, 2026-07-10). Flagged unmet at slice 15 close-out;
  a "Phase 3 Finance audit coverage" describe block was added mirroring the
  Phase 1/2 blocks' pattern — one or two mutations per resource, not
  exhaustive edge cases (those live in the per-service specs). Covers
  `fee-category.{create,delete}`, `fee-item.{create,delete}`,
  `discount-rule.{create,deactivate}`, `invoice.issue`, `payment.record`,
  `refund.create`, `expense.{create,delete}`, and
  `staff-bvn.{update,reveal}`.

- [ ] Re-confirm the render-memory in-container gate (phase-3.md acceptance
  criterion #14) — the existing deferred.md item above ("Re-validate the
  report-card PDF memory gate IN A FLY.IO CONTAINER...") covers the actual
  work; this entry just cross-references it so slice 15's close-out pass
  doesn't silently imply criterion #14 is met when the container
  re-validation hasn't happened yet.

- [x] `DevStorageController` hardcoded `Content-Type: application/pdf` and
  `Content-Disposition: attachment` for every file it serves, regardless of
  what was actually stored — `FilesystemStorageDriver.put()` discards the
  contentType/contentDisposition it's given (dev-only, no metadata
  sidecar), so this dev-only signed-URL endpoint had no way to know better.
  Silently correct for report-card PDFs (the original use case); silently
  **wrong** for payment-receipt/expense-receipt HTML — a browser hitting a
  receipt's signed URL got a forced "download" of a mislabeled PDF instead
  of the HTML rendering inline. Nobody caught it because prior manual gates
  checked byte-fidelity of the stored file, not the Content-Type header the
  signed URL actually served. **DONE** (Payroll CP3, 2026-07-10): both
  headers are now derived from the path extension (`.html` → `text/html` +
  inline, `.pdf` → `application/pdf` + attachment, unchanged) — discovered
  because the payslip's "HTML renders in browser" manual-gate step failed
  against the old hardcoded value.
  **STILL OPEN**: `expense-receipt` is deliberately extensionless (Content-Type
  meant to travel as object metadata per storage.types.ts) — with no sidecar
  to read it from, it now falls through to `application/octet-stream`
  (triggers an honest download) rather than the previous always-wrong `pdf`
  label. A real fix needs the filesystem driver to persist a metadata
  sidecar file, or for dev-storage to accept an R2-like HEAD-first content
  type lookup. Trigger: first dev workflow that needs an expense receipt to
  render inline (photos/PDFs already download fine either way — this only
  bites a browser trying to preview rather than save).

- [ ] `schema.prisma` has drifted from applied migration history on three
  unrelated index/constraint names — discovered 2026-07-16 while generating
  the Phase 4 slice 2 (guardian auth) migration via `prisma migrate diff
  --from-url $DIRECT_URL --to-schema-datamodel prisma/schema.prisma --script`
  against local dev (which `prisma migrate status` confirmed was fully
  up-to-date on all 46 prior migrations — so this is real schema.prisma vs.
  migration-history divergence, not a missing-migration gap). The diff
  included, alongside the intended guardian changes: `ALTER TABLE
  "audit_logs" RENAME CONSTRAINT "audit_logs_new_pkey" TO "audit_logs_pkey"`,
  a new `audit_logs_school_id_created_at_idx` index, a renamed
  `fee_items_school_id_class_level_id_term_id_academic_year_id_idx` (from
  some shorter prior name), and a `payments_school_id_paystack_reference_key`
  unique index — none of which touch `guardians`/`guardian_sessions`/
  `guardian_invitations`, so they were excluded from that migration rather
  than folded in blind. Needs its own investigation: either schema.prisma
  was hand-edited without a matching migration at some point (a real gap to
  close with a follow-up migration), or Prisma's auto-generated index-naming
  is non-deterministic in a way that makes `migrate diff` an unreliable
  source for isolating a single model's changes going forward (a tooling
  footgun worth knowing about even if no actual DB fix is needed). Trigger:
  before the next migration that touches `audit_logs`, `payments`, or
  `fee_items`, since a naive `migrate diff` for that change would pull in
  this same unrelated noise again.

- [ ] Paystack webhook URL — must be configured in the Paystack dashboard
  (Settings → API Keys & Webhooks → Webhook URL) pointing to
  `https://school-kit-api.fly.dev/api/v1/payments/paystack/webhook` before
  live payments can be processed. Operational step, not a build item. Without
  it, `charge.success` events are never delivered and the verify endpoint
  (`GET /payments/paystack/verify/:reference`) is the only self-heal path.
  Trigger: before any school goes live on Paystack.

- [ ] Double-PENDING-row overpayment risk in `PaymentsService.initPaystack`
  (Phase 3 Slice 8) and its guardian-facing counterpart,
  `PortalPaymentsService.initiate` (Phase 4 Slice 5). Found while building
  Slice 5, pre-existing in Phase 3 — not introduced by this slice. Neither
  `initPaystack` call site checks for an already-outstanding PENDING
  Paystack payment on the same invoice before creating a new one; the
  overpayment guard only runs at *init* time (comparing the requested
  amount against `totalDue - totalPaid` as it stood then), never at
  *webhook-apply* time. Two PENDING rows can exist simultaneously, each
  with its own valid Paystack reference — if both are actually completed
  (e.g. two browser tabs, or a staff member and a guardian both initiating
  a payment for the same invoice around the same time), `applyPaystackSuccess`
  processes each webhook independently and `totalPaid` recomputes as the
  sum of both, a real overpayment applied to the invoice with no guard
  catching it. Slice 5 added a narrow, guardian-endpoint-only mitigation
  (`PortalPaymentsService.initiate` rejects a second attempt while a
  PENDING Paystack payment for the same invoice was created within the
  last 30 minutes — see `IN_FLIGHT_WINDOW_MS`), which closes the
  double-click/multi-tab case for a single guardian but does NOT close the
  cross-actor case (a guardian and a staff member, or two different
  guardians on a multi-guardian student, both initiating around the same
  time) or fix the underlying webhook-apply-time gap. A real fix means
  either the same in-flight check inside the staff `initPaystack` path too
  (closes same-actor races only) or re-validating `remaining >= amount`
  inside `applyPaystackSuccess` itself and capping/rejecting an
  overpayment-causing webhook application (closes the general case, but
  touches the most heavily-tested Phase 3 money code). Trigger: a pilot
  school reports an actual overpayment, or before this becomes higher-
  volume than pilot scale.

- [x] **Audit the whole app for orphaned pages — backend + UI built and
  working, but no discoverable nav link to reach them. DONE 2026-07-26.**
  Found four in total, all fixed same-day-to-next-day, all found one at a
  time via manual testing hitting a dead end before the systematic pass:
  the guardian-invite button (`GuardiansTab`, 2026-07-24), the `/finance/*`
  sub-pages (invoices/debtors/expenses/payroll — only `/finance/dashboard`
  was linked from the sidebar, fixed via PR #110's `FinanceSubNav`,
  2026-07-24), `/settings/finance/fees` + `/settings/finance/discounts`
  (Fee catalog + discount rules — fully built per `docs/modules/phase-3.md`
  slices 4/5 but absent from the `/settings` hub's `LINKS` array; this is
  what blocked Arinzechukwu's Gate 2 invoice test, since he had no way to
  configure a non-zero fee item — PR #113, 2026-07-24), and `/enrollments`
  (Phase 1 / Slice 9 cp2 — current-term roster grouped by class arm, with
  bulk-enroll at `/enrollments/bulk` — zero inbound references anywhere in
  `apps/web/src`, not even a button on `/students` or `/dashboard`; PR
  #117, 2026-07-26).
  **The systematic pass itself (2026-07-26):** enumerated every `page.tsx`
  under `apps/web/src/app/` (69 routes) and `apps/portal/src/app/` (5
  routes) via `Glob`, then cross-referenced every one against every
  `href`/`router.push`/`router.replace` target anywhere in `apps/web/src`
  and `apps/portal/src` — persistent nav components (both sidebars, the
  settings hub, three sub-navs) *and* in-page buttons on other pages, not
  just nav. Dynamic detail pages (`/students/[id]`, `/staff/[userId]`,
  import-wizard `[jobId]` steps, etc.) were excluded — those are reached via
  a specific record's link, not a persistent nav item, and that's correct
  by design. `/enrollments` was the only genuine orphan the systematic pass
  turned up beyond the three already fixed; `apps/portal` had none at all
  (only 5 routes, a simple linear graph, too small/new to have accumulated
  this drift). A few routes that looked orphaned on first pass turned out
  fine on inspection — `/debug/sentry` self-documents as intentionally
  unlinked (`notFound()` in production, explicit comment), `/finance/
  payments/callback` is a Paystack redirect landing page never meant for
  nav, `/teacher/attendance/summary` and `/teacher/attendance/subject/
  summary` are in-page sub-views linked from their parent pages rather than
  hubs needing their own nav entry.
  **Confirmed: no further instances remain in `apps/web` or `apps/portal`**
  as of this pass. New drift is always possible as new modules ship —
  re-run the same methodology (enumerate routes, cross-reference every nav
  component + in-page link, exclude dynamic detail pages) if another
  "feature exists but nobody can find it" report comes in, rather than
  assuming this list is permanently exhaustive.

- [ ] Gate 3's live confirmatory test — a real `FinanceService.sendReminders()`
  call against a real outstanding invoice, proving `TermiiService.sendSms()`
  is never invoked when a school's `NotificationPreference.smsEnabled` is
  `false` — is deferred, not done. Attempted 2026-07-25 against production;
  aborted before the one production write it would have needed (see below),
  pending Arinzechukwu's sign-off, which he declined for tonight.
  What's confirmed instead (code-level, not a live call): `FinanceService
  .sendReminders` (`apps/api/src/modules/finance/finance.service.ts` ~line
  253-255) computes `smsAttemptable = channels.sms && this.termii
  .isConfigured` and only enters the `this.termii.sendSms(...)` branch when
  `smsAttemptable && guardianPhone` — `channels.sms` false short-circuits
  before any Termii call is reachable, by construction, not by a runtime
  check that could itself be buggy. Also confirmed live in production
  (read-only): both real "Virgo Fidelis Montessori School" rows
  (`6beff17c...`, `07865652...`) have no `NotificationPreference` row at
  all, meaning `NotificationPreferencesService.getEnabledChannels`'s
  `DEFAULTS` apply — `smsEnabled: false` — to both, matching this gate's
  required precondition already, with zero write needed to confirm that
  part.
  Why a live call didn't happen: production currently has no student with
  BOTH an outstanding invoice (`ISSUED`/`PARTIALLY_PAID`/`OVERDUE`) AND a
  primary guardian with a phone number. The one near-miss — Chinedu Eze at
  `6beff17c...`, who has a primary guardian with phone+email — has a
  `CANCELLED` invoice for the school's only term, and `InvoiceGeneration
  Service.generateForArm` refuses to regenerate for a student-term pair
  that already has *any* invoice row regardless of status (no "delete
  invoice" endpoint exists — only cancel). Closing that gap for real would
  have meant a direct DB delete of the dead `CANCELLED` row outside any
  product flow — explicitly declined rather than done unilaterally.
  Unblocks either way: (a) real invoice data naturally comes to exist in
  production (Arinzechukwu generates one through the actual product flow
  now that the Gate 2 fee-catalog-nav fix landed), making a clean student+
  invoice+guardian candidate available without any DB surgery, or (b)
  Termii's sender-ID registration approval completes (separately blocked on
  Arinzechukwu's business documents), at which point the real end-to-end
  send-and-confirm test this gate ultimately wants becomes possible anyway
  and supersedes this narrower gate-check. Either makes this item moot, not
  merely satisfied.

- [x] **CI's `e2e (Playwright)` job has been hitting its 20-minute hard timeout and getting CANCELLED on every single push to `main` for ~4 weeks — root-caused 2026-07-24, FIXED 2026-07-25.** This was a real, reproducible bug, not "flaky e2e" — but NOT in the logout→re-login flow the entry below originally hypothesized. See the **CORRECTION** block below for the confirmed root cause and fix; the original bisection evidence is left in place because it's still accurate, only the hypothesis paragraph was wrong.
  **The evidence, not a theory:** pulled the last 100 CI runs on `main` via `gh run list`. The job passed reliably for months; the last green run was 2026-06-26T22:32:32Z (run `28268970807`); every run since — 40 in a row, one per merge — has ended `cancelled` at the 20-minute ceiling. The very first cancelled run (`28300695234`, 2026-06-27T20:20:37Z) fired immediately after **PR #70 "Phase 3/slice 2 cp1"** merged — the 2FA/TOTP feature, which rewrote `apps/web/src/components/auth/login-form.tsx` (117 lines changed) into its current two-step credentials→TOTP form and introduced the cookie-based session proxy (`apps/web/src/app/api/auth/[...auth]/route.ts`) and `apps/web/src/middleware.ts`. No CI config changed in that window — this is an app-code regression, not an infra/runner change.
  **Exact hang point**, from `e2e/tests/phase-0-happy-path.spec.ts:201-222` (and `slice-11-teacher-scope.spec.ts` fails identically, at the same shared step — both use the same log-out-then-log-back-in helper):
  ```
  await adminPage.getByRole("menuitem", { name: /log out/i }).click();
  await adminPage.waitForURL(/\/login$/);                                              // ← succeeds — CI log shows `GET /login 200`
  await expect(adminPage.getByText("Sign in", { exact: true }).first()).toBeVisible();  // ← hangs here, burns the full 180s per-test budget
  ```
  It is specifically the **logout → re-login** cycle that hangs, not login by itself — confirmed by direct counter-evidence: a fresh (never-logged-in) login, driven by a real headless-Chromium Playwright script against the actual running app during the finance-nav verification pass the same day, completed in well under a second with no hang at all. Every failing e2e test logs out an already-authenticated session first, then tries to log back in on the same page — that specific sequence is what's broken.
  **Leading hypothesis, not yet confirmed:** a race in `AuthProvider.logout()` (`apps/web/src/lib/auth/auth-provider.tsx`) between `clearStoredToken()` + `router.replace("/login")` on the client and the `sk_session` HttpOnly cookie actually clearing server-side via the proxy route's `logoutRequest()` call. If the client-side redirect fires before the cookie is confirmed cleared, `/login` (or `middleware.ts`'s cookie check) could bounce the page in a way that never leaves Playwright a stable "Sign in" element to find — this has NOT been reproduced locally yet, only inferred from the log evidence above. First step of the real fix: reproduce a manual logout→re-login cycle locally (not via the CI-only symptom) and watch what the cookie/redirect sequence actually does.
  **Why every recent PR (#105–#110 confirmed, likely further back) merged anyway:** `e2e (Playwright)` is a required branch-protection check, so a cancelled run leaves the PR `mergeStateStatus: BLOCKED`; the repo owner has been using `gh pr merge --admin` (or the GitHub UI's admin-override merge) to land every PR since 2026-06-27 regardless. That override itself isn't the problem — `lint + typecheck + test + build` (the job that actually runs the real test suite) has been passing clean every time, so nothing has shipped untested. The problem is purely that this has been silently costing ~20–25 minutes of wasted CI wall-clock on every single merge for a month, framed internally as routine "e2e is flaky, bypass it" rather than a specific, now-understood, fixable regression.
  **Deliberately not fixed in this pass** — surfaced during the finance-nav (#110) and password-reset (#111) PRs' own CI runs, root-caused same-day, explicitly deferred to its own dedicated session per instruction rather than being rushed in alongside unrelated work. Trigger: next available focused session — start from the reproduction step above, not from re-deriving the bisection (already done here).

  **CORRECTION (2026-07-25) — the logout/re-login race hypothesis above was wrong. Real root cause found via actual local reproduction (as the follow-up session was explicitly instructed to do) plus two independent CI job logs, not by re-guessing from the same evidence.**
  Two local repro attempts targeting the hypothesized mechanism — a plain logout→re-login cycle, and the same cycle with `/login` never pre-compiled (matching the admin's real never-visited-`/login`-before-logout path) — both passed cleanly, in well under a second each. `AuthProvider.logout()`, `LoginForm`'s login, and the cookie-clearing/setting proxy route are all correct; there is no race there.
  Pulled two independent CI job logs (`30171549170`, `30170177904`) and diffed the request sequence line-by-line instead of eyeballing a single line. Both show the **identical** deterministic pattern on every attempt (original + 2 retries, both failing spec files):
  ```
  GET /invitations/:token 200   ← admin/teacher loads the accept-invitation page
  GET /login 200                ← NOT the logout step — happens before it's ever reached
  [... exactly 180.000s later ...]
  ✘ test (3.0m)
  ```
  No `POST .../accept` and no `GET /dashboard` ever appears between those two lines, in either run — the original entry's "CI log shows `GET /login 200`" observation was real, but it was misattributed to the explicit logout click instead of this earlier, unrelated `/login` visit.
  **Actual root cause:** `apps/web/src/lib/invitations/invitations-api.ts`'s `acceptInvitation()` called NestJS directly via `apiFetch` (bearer-token, in-memory only) instead of going through a Next.js proxy route the way `login`/`signup`/`logout`/`2fa-challenge` all correctly do. Accepting an invitation mints a real session (`{ user, school, token }`, same shape as login) but never sets the `sk_session` HttpOnly cookie. `AcceptInvitationForm` then does `window.location.href = "/dashboard"` — a hard navigation, which wipes the just-set in-memory token and has no cookie to fall back on — so `middleware.ts`'s cookie check deterministically redirects the fresh `/dashboard` request to `/login`. `phase-0-happy-path.spec.ts:196`'s `await adminPage.waitForURL(/\/dashboard$/)` (and `e2e/fixtures/teacher.ts`'s identical `inviteAndAcceptTeacher()` line, explaining `slice-11-teacher-scope.spec.ts`'s identical failure) has no per-call timeout in this Playwright config — unlike `expect().toBeVisible()`, which is capped at 15s — so it silently burns the full 180s test timeout. Deterministic, not racy: fails the same way on literally every run, matching the "every push since PR #70" bisection exactly.
  A stale code comment in `AcceptInvitationForm` ("hard navigation... re-reads the token from localStorage") described the pre-PR-#70 mechanism and was never updated when PR #70 replaced localStorage-bearer-token auth with the cookie/proxy pattern — classic missed-call-site-in-a-migration bug.
  **Related bug found and fixed in the same pass:** `e2e/fixtures/session.ts`'s `loginAsAdmin`/`loginAsTeacher` injected a bearer token into `localStorage["sk_auth_token"]` — a key `apps/web/src/lib/api-client.ts` now actively deletes on every page load (one-time post-migration cleanup). Every "authenticated" fixture context was silently rendering as a guest and bouncing to `/login`. Same root theme as the main bug (a call site PR #70's migration missed), different location — explains the faster (~16-17s, not 3-minute) failures seen for `admin-roster-happy-path.spec.ts` and `csv-import-students.spec.ts` in the same CI runs.
  **Fix:** extracted the cookie-setting logic from the auth proxy into `apps/web/src/lib/server/session-cookie.ts`; added a matching proxy route at `/api/invitations/[token]/accept`; pointed `acceptInvitation()` at it via a shared `proxyFetch` (moved from `auth-api.ts` into `api-client.ts` so `invitations-api.ts` can reuse it). Fixed `session.ts` to inject the `sk_session` cookie via `context.addCookies()`; `teacher.ts` now reads it back via `context.cookies()` (httpOnly cookies aren't readable via `page.evaluate`/`document.cookie` by design). Follow-up review (same PR) caught that the new route was returning the raw token in the response body alongside the cookie — `apps/portal`'s equivalent proxy already strips this with an explicit comment noting `apps/web` doesn't; adopted the same stripping here since `AcceptInvitationForm` never reads the token past receiving it (see the separate deferred item below for `login`/`signup`/`2fa-challenge`, which still return it and were deliberately left untouched in this PR).
  **Verified, not assumed:** `phase-0-happy-path.spec.ts` and `slice-11-teacher-scope.spec.ts` pass 5/5 repeats each locally; the `session.ts`-dependent specs pass 3/3 repeats each; full local `pnpm test:e2e` suite green (5/5 tests, one full run). No 2FA code touched by this fix — `login`/`signup`/`logout`/`2fa-challenge` were already correct and remain untouched.

- [ ] `apps/web`'s `/api/auth/[...auth]/route.ts` (`login`, `signup-owner`, `2fa/challenge`) still returns the raw session token in the JSON response body alongside setting the `sk_session` HttpOnly cookie — found during the invitation-accept fix above, deliberately NOT touched there (kept that PR narrowly scoped). `apps/portal/src/app/api/portal/[...portal]/route.ts` already strips this (its own comment explicitly flags the asymmetry: "unlike apps/web's equivalent route"), because the portal's `AuthProvider` never keeps an in-memory token at all. `apps/web`'s `AuthProvider` (`login`/`loginWithChallenge`/`signup` in `apps/web/src/lib/auth/auth-provider.tsx`) genuinely uses `response.token` today — `setStoredToken(response.token)` feeds the in-memory `activeToken` that the immediately-following `meRequest()` call needs (no hard navigation in between on these three paths, unlike invitation-accept, so the token doesn't get wiped before use). Closing this gap for real means restructuring so the cookie is the only thing that crosses the wire — e.g. having `AuthProvider` call `GET /api/auth/session` right after login/signup/2fa-challenge to re-derive the token from the cookie server-side (mirroring how cold-boot hydration already works) instead of relying on the response body — not a same-shape drop-in fix like the invitation-accept case, which is why it's deferred rather than folded in. Trigger: a dedicated security-hardening pass, or before this app handles data sensitive enough that an XSS's blast radius matters more than it does today.

- [ ] **HIGH PRIORITY — `teacher` role is missing `grading-scheme.read`; no real teacher account can currently load the gradebook grid in production.** Found during the Phase 4 design-system restyle's mandatory live-verification pass (2026-07-28) — `GradebookGridPage` (`apps/web/src/app/(teacher)/teacher/gradebook/[armId]/[subjectId]/page.tsx:17,52`) unconditionally calls `getGradingScheme()`, which hits `GET /grading-scheme`, guarded by `@Permissions("grading-scheme.read")` (`apps/api/src/modules/grading/grading.controller.ts:57`). `PHASE_2_TEACHER_PERMISSIONS` (`packages/types/src/permissions.ts:419-432`) has no `grading-*` entry at all — every teacher hits a 403 the moment they open any subject's gradebook.
  **Not a recent regression — a longstanding gap dating to the Phase 2 slice 9 RBAC rollup itself** (commit `53be149`, PR #55, 2026-06-10): `PHASE_2_TEACHER_PERMISSIONS` was authored at that commit and never included `grading-scheme.read`, `grading-component.read`, or `grade-boundary.read`. This week's restyle touched only markup/classes in `gradebook-grid.tsx` and the page wrapper — it did not introduce the bug, only surfaced it by being the first pass to actually drive the gradebook end-to-end as a real teacher.
  Confirmed by direct code read, not guessed: the controller's `@Permissions` decorator, the teacher permission array, and the frontend's unconditional call were all inspected directly (see `[[project_phase4_restyle]]`).
  Temporarily patched in the **dev DB only** (teacher role row's `permissions` array, via a throwaway script, not committed to any migration/seed/code) to unblock the live-verification pass — Arinzechukwu approved this specifically for that purpose. Confirmed clean: no diff to `packages/types/src/permissions.ts`, no new/modified migration, no seed-data change in the working tree — the dev-DB patch has no footprint in what would be committed or merged, and is harmless to leave in the local dev DB as-is.
  Trigger: fix before the next real teacher account touches the gradebook — likely a one-line addition of `grading-scheme.read` (read-only; teachers should not get `.update`) to `PHASE_2_TEACHER_PERMISSIONS`, plus the equivalent data migration pattern the slice-9 rollup used to backfill existing role rows.

- [ ] **Teacher portal mobile nav shows admin's nav items, not the teacher's own.** Found during the same Phase 4 restyle live-verification pass (2026-07-28). `TeacherLayout` (`apps/web/src/app/(teacher)/layout.tsx`) reuses `AdminTopbar` (`apps/web/src/components/admin/topbar.tsx`), which renders `<MobileNav>`; `MobileNav`/`NavList` hardcode `NAV_ITEMS`/`LATER_PHASE_ITEMS` from `components/admin/nav-items.ts` (admin-specific) rather than accepting the caller's own item list. A teacher on a narrow viewport sees Students/Staff/Finance/Settings in the hamburger drawer instead of their own Dashboard/Classes/Gradebook/Attendance/Profile.
  **A real regression, not a pre-existing gap — introduced by PR #120** (`feat(web): admin dashboard rebuild — design system, real KPIs, mobile nav`, commit `3cab59b`, 2026-07-26). `TeacherLayout` has used `AdminTopbar` since PR #29 (slice 11 cp3, well before this), but `AdminTopbar` had no mobile nav at all before #120 — its own commit message says so explicitly ("the sidebar previously had no equivalent below the md breakpoint at all"). #120 added `<MobileNav>` to `AdminTopbar` for the admin dashboard rebuild without adding a props path for `TeacherLayout`'s distinct nav list, so every consumer of `AdminTopbar` — including the teacher portal, a pre-existing consumer it didn't intend to change — silently inherited admin's hamburger menu two days before this gap was noticed.
  Fixing it means making `NavList`/`MobileNav` accept an items prop (and `TeacherLayout` pass its own list) — a functional change, correctly left out of the markup-only restyle PR that surfaced it.
  Trigger: next session touching `components/admin/mobile-nav.tsx`, `nav-list.tsx`, or the teacher portal layout — or before the mobile teacher-portal experience is demoed/shipped to a real school.
