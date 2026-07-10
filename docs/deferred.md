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
  - PARTIALLY RESOLVED (`fix/empty-optional-forms`): the **student create/edit form** (`apps/web/src/components/students/student-form.tsx`) was the worst case — it used the strict `createStudentSchema` as the react-hook-form resolver, so every blank optional (`.min(1)…optional()` / `.email()` / `.url()`) failed and **silently blocked submit** with most fields rendering no error. Fixed with the form-class discipline: a local `studentFormSchema` matching FormValues (optionals allow `""` via `z.string().max()` + a `refine` for email/url format), root + per-field error blocks, `""`→undefined on submit, zero `as never`. The slice-5 guardian form (manual `useState` validation, maps `""`→undefined) and the slice-10 cp3 staff forms (`/staff/invite`, `/staff/[userId]/edit`, `/teacher/profile`) were audited and already follow the pattern. STILL OPEN: the Phase-0 **step-2 branding** form (`logoUrl`/`primaryColor`) — fix it the same way next time Phase-0 onboarding is touched.

- [ ] Coverage reporting in CI (Codecov or Coveralls). Phase 0 prioritises runtime correctness over coverage %. Trigger: when there's a real risk of untested code paths shipping — likely after Phase 3 when contributors join.

- [ ] Dependabot / Renovate + commitlint. Dependency-update bots and conventional-commit-message linting both have value but neither blocks Phase 0 shipping. Trigger: before first external contributor, or after first dependency-driven security incident.

- [ ] Wire real ESLint for apps/api. Slice 8b shipped real ESLint for `apps/web` (flat config, ESLint 9, shared base in `packages/config/eslint/`) but left `apps/api` on the echo-placeholder. Same pattern: add `packages/config/eslint/nest.js` extending the shared base with Node/Nest-specific rules (no-floating-promises, no-misused-promises, decorator-aware unused-vars), then point `apps/api/eslint.config.js` at it and flip the lint script to `eslint . --max-warnings=0`. Trigger: when api code starts having style drift, or before first external contributor.

- [ ] Move to eslint-config-next's native flat-config export when it ships. Slice 8b uses `@eslint/eslintrc`'s `FlatCompat` to consume eslint-config-next v15.5's legacy configs (the package doesn't yet ship a `flat/` export). When eslint-config-next adds native flat config (likely in a Next 15.x patch or Next 16), `packages/config/eslint/next.js` collapses to a direct spread and we drop `@eslint/eslintrc` from the dependency tree. Trigger: when next minor/major release notes mention native flat config support.

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

## Phase 5 — AI table naming reconciliation (BLOCKER for the call-logger)
- [ ] `AIInteractionLog` vs `AIGeneration` naming drift. Slice 12 shipped
  `ai_interaction_logs`, but ARCHITECTURE.md §5/§7 and CLAUDE.md's AI hard
  rule ("every `claudeClient.messages.create` must log to the
  `ai_generations` table") name the LLM-call log `AIGeneration` /
  `ai_generations`. ARCHITECTURE.md §5 also lists `CurriculumChunk` +
  `TutorSession` as the other two AI tables — neither is `MasteryRecord`,
  which §5 doesn't list at all. Phase 5 MUST, BEFORE building the call-
  logger, either (a) rename/absorb `AIInteractionLog` → `AIGeneration`, or
  (b) define a clear boundary between an interaction log and a generation
  log — otherwise we end up with two overlapping tables doing the same job.
  Decide alongside the `AIInteractionLog.payload` / `MasteryRecord.status`
  taxonomy (the inline-vs-R2 payload storage tradeoff is part of this).
  Trigger: first Phase 5 slice that writes an LLM call. Flagged in the
  slice-12 schema + migration headers.

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

- [ ] Paystack webhook URL — must be configured in the Paystack dashboard
  (Settings → API Keys & Webhooks → Webhook URL) pointing to
  `https://school-kit-api.fly.dev/api/v1/payments/paystack/webhook` before
  live payments can be processed. Operational step, not a build item. Without
  it, `charge.success` events are never delivered and the verify endpoint
  (`GET /payments/paystack/verify/:reference`) is the only self-heal path.
  Trigger: before any school goes live on Paystack.
