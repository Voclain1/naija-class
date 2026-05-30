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

- [ ] Turbo remote cache in CI. Slice 8b runs the workflow on a fresh GH runner with no Turbo cache (local cache wouldn't survive between runs anyway). Remote cache (Vercel Remote Cache or self-hosted) would save the cumulative cost of re-running build/test on unchanged packages, but adds auth-token management + cache-poisoning surface. Trigger: when CI wall-clock exceeds ~6 min and the bottleneck is genuinely re-doing work that hasn't changed.

- [ ] Multi-job parallelism in CI. Slice 8b uses a single sequential job because each extra job re-pays the ~60s pnpm install cost. Splitting into parallel lint / typecheck / test jobs would save ~20s wall-clock today. Trigger: when the test suite grows past ~3 minutes and the parallelism win exceeds the install-redundancy cost (probably Phase 2+).

- [ ] Step 2 branding form: empty fields fail Zod validation. `logoUrl`/`primaryColor` use `.url()/.regex().optional()` — an empty string fails `.url()`/`.regex()` before `.optional()` rescues, so "leave blank and continue" doesn't work. Same pattern hits `inviteAdminSchema.firstName/lastName` and likely other `.min(1).optional()` fields. Fix is either `.preprocess(v => v === "" ? undefined : v, ...)` in the schema OR `setValueAs(v => v === "" ? undefined : v)` on each react-hook-form register call. Discovered during Slice 9 E2E test; workaround is filling valid placeholder values. — pre-customer launch.

- [ ] Coverage reporting in CI (Codecov or Coveralls). Phase 0 prioritises runtime correctness over coverage %. Trigger: when there's a real risk of untested code paths shipping — likely after Phase 3 when contributors join.

- [ ] Dependabot / Renovate + commitlint. Dependency-update bots and conventional-commit-message linting both have value but neither blocks Phase 0 shipping. Trigger: before first external contributor, or after first dependency-driven security incident.

- [ ] Wire real ESLint for apps/api. Slice 8b shipped real ESLint for `apps/web` (flat config, ESLint 9, shared base in `packages/config/eslint/`) but left `apps/api` on the echo-placeholder. Same pattern: add `packages/config/eslint/nest.js` extending the shared base with Node/Nest-specific rules (no-floating-promises, no-misused-promises, decorator-aware unused-vars), then point `apps/api/eslint.config.js` at it and flip the lint script to `eslint . --max-warnings=0`. Trigger: when api code starts having style drift, or before first external contributor.

- [ ] Move to eslint-config-next's native flat-config export when it ships. Slice 8b uses `@eslint/eslintrc`'s `FlatCompat` to consume eslint-config-next v15.5's legacy configs (the package doesn't yet ship a `flat/` export). When eslint-config-next adds native flat config (likely in a Next 15.x patch or Next 16), `packages/config/eslint/next.js` collapses to a direct spread and we drop `@eslint/eslintrc` from the dependency tree. Trigger: when next minor/major release notes mention native flat config support.

## Phase 1 — AI foundation tables (DECIDED, build in Phase 1)
- [ ] Mastery-tracking table: thin/additive-friendly, school_id + RLS,
  RLS test extended. Minimal columns (student, school, topic_ref,
  status, updated_at). Detailed shape OWNED BY PHASE 5. Foundation-only,
  sits empty until then. MUST be pulled into docs/modules/phase-1.md
  when spec is written — failure mode is forgetting it and hitting a
  live-data migration at Phase 5.
- [ ] AI-interaction-log table: same discipline. Minimal columns
  (student, school, session_ref, payload jsonb, created_at). Shape
  owned by Phase 5.

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

  - [ ] RLS isolation spec gap: slice 9 enrollments table never had its
  RLS block added to apps/api/src/__tests__/rls.spec.ts. Discovered
  during slice 10 cp1 (which DID add teacher_profiles). Required for
  slice 13 acceptance #10 ("all Phase 1 tables in isolation spec").