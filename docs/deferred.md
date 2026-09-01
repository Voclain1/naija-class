# Deferred features

Things we caught ourselves wanting to build "while we're here" — captured here instead of acted on. Review this list at the weekly Sunday review. Items only move back into a module spec when a real customer (or a real technical need) asks for them.

Format:
- [ ] <feature> — <why deferred> — <what would unblock it>

---

## Captured so far

- [x] **RESOLVED 2026-08-21 (PR #201, merged f674e4a, deployed and verified).**
  Every newly provisioned school lands with NO academic year and NO
  current term, through BOTH onboarding paths — and nothing tells the owner.**
  Found 2026-08-19 while building a test school for the slice 5 push
  verification: `GET /academic-years` on a freshly signed-up school returned
  `[]`.

  **Verified against the code, not inferred from one school:**
  - `packages/db/src/seeds/school-defaults.ts` — its own header lists what it
    seeds: "14 class levels, one default arm each, a core subject catalogue,
    and the grading scheme + components + grade boundaries." No academic year,
    no term. Both callers (`AuthService.signupOwner` and platform-admin
    provisioning) share this one function, so both paths are affected.
  - The onboarding wizard is five steps — Basics, Branding, Invites, NDPR,
    Success (`apps/web/src/components/onboarding/step*.tsx`). None creates an
    academic year or term.
  - A UI to create one DOES exist, at Settings → Academic → Years. So this is
    not "impossible", it is "nothing points there".

  **Why it matters:** a term is a required foreign key for enrollment,
  invoice generation and attendance. Until an owner finds that settings page
  unprompted, they cannot enroll a student, cannot issue an invoice, and
  cannot mark a register — i.e. the three things a school actually bought the
  product to do. Building the test school hit exactly this: student created
  fine, then enrollment failed for want of a `termId`.

  **This is the same shape as the incident `school-defaults.ts` was written to
  fix**, and its own header describes that one: four schools provisioned
  2026-08-08 with zero class levels, where "an owner could log in and do
  nothing", one of whose owners gave up and re-registered, leaving two rows
  for one school. That fix covered class structure, subjects and grading —
  the academic-year half was never part of it, so the same "logs in, can do
  nothing" outcome survives in a narrower form.

  **Not fixed here deliberately, and not a slice 5 concern** — slice 5 only
  surfaced it. Two candidate fixes, and the choice is a product call rather
  than a technical one:
  (a) seed a default year+term in `applySchoolDefaults`. Cheap, but the dates
      would be guesses, and a wrong term silently attached to real enrollments
      is worse than no term;
  (b) add an academic-year step to the onboarding wizard, where the owner
      supplies real dates. More work, correct data, and it fits the existing
      five-step flow.
  Recommend (b). (a) is tempting precisely because it is easy, which is how a
  guessed date ends up on a real school's records.

  **RESOLUTION (2026-08-21).** Option (b), essentially — but the decision was
  re-made from scratch against the code rather than taken from this note, and
  the argument that settled it is stronger than "guessed dates are untidy":
  term dates are LOAD-BEARING. `resolveTermForDate()` resolves attendance
  purely by date range and ignores `isCurrent`, `FinanceService` attributes
  expenses by that range because `Expense` has no `termId`, and the range
  prints on the report-card PDF given to parents. A school signing up in
  February would have been seeded a calendar for a term that ended two months
  earlier and then been unable to mark attendance at all. Full argument in
  `docs/modules/academic-calendar-bootstrap.md` §2, which applies the
  `subjects.ts` precedent (seed only what is universally TRUE).

  Shipped: onboarding step 5 now carries the calendar — riding on the
  EXISTING step 5, which was an empty object, so no renumbering, no route
  move and no migration for schools mid-onboarding, all of which the
  plan-first had costed as the main expense. Calendar creation and activation
  share one transaction. Already-active schools get an in-app prompt backed
  by `POST /schools/me/academic-calendar` — deliberately a prompt, NOT a
  backfill, because the earlier `backfill-school-defaults.ts` was safe only
  in that the 14 class levels are universally correct, whereas term dates are
  school-specific judgement.

  Production census before the fix (`pnpm db:census-academic-calendar`, the
  read-only script added by this work): **36 of 42 real schools (86%) stuck** —
  25 PRISTINE, 11 NO_CURRENT, 0 NO_YEAR_WITH_DATA. Note the census counts DB
  state, not whether a school has a PATH to recovery: it will keep counting
  those 36 until each owner actually fills the banner in, which is the
  prompt-not-backfill decision working, not a failed rollout.

  **Deploy + verification record.** Merged `f674e4a` 2026-08-21 21:15 UTC;
  `deploy-staging` succeeded; `Applying migration
  20260821000000_admin_dashboard_read_permission` → "All migrations have been
  successfully applied" against the production Neon database; Fly release
  deployed and its 6-op smoke test green including a real signup;
  `GET /api/v1/schools/me/academic-calendar/status` on the deployed API
  returns **401**, not 404 — the route exists and its AuthGuard is live.
  Direct DB read confirmed by Arinzechukwu (2026-08-21), which the migration's
  own success report is NOT a substitute for: `admin | true`, `bursar | false`,
  `owner | false`, `teacher | false` — owner correctly false because it holds
  the `*` wildcard rather than an individual grant.

- [ ] **RECOMMENDED FOR PRIORITISATION (2026-08-21) — no longer just a
  tidy-up.** When this was logged it was one refactor behind one bug. It is
  now the common root of **three of the four** recurring role bugs, and the
  fourth is its mirror image:

  | # | Bug | Gate that disagreed |
  |---|---|---|
  | 1 | Bursar admin-shell lockout | ROLE list in the web shell |
  | 2 | Bursar missing scoping permissions | PERMISSION list |
  | 3 | Bursar grant inert for 19 days | ROLE list in the SERVICE, below the fixed one |
  | 4 | Admin `dashboard.read` never granted | PERMISSION enforced, never granted |

  1–3 are the same defect: a permission system and a role system that do not
  consult each other, so a grant can be correct and still do nothing. 4 is the
  inverse — enforcement with no grant — and was invisible for a different
  reason worth remembering: it was MASKED BY ANOTHER BUG (#198 meant the
  dashboard never called its API, so the 403 never fired). Fixing #198 exposed
  it, which is the second time in this sequence that one fix uncovered the
  next. That pattern is the argument for doing the structural work rather than
  waiting for bug five to introduce itself.

  Cost is unchanged and still real (~20 call sites of a shared auth helper);
  what has changed is the evidence for the benefit. **Flagged as a
  recommendation for Arinzechukwu to weigh against everything else in flight,
  explicitly NOT a decision taken here.**

- [ ] **Permission-gate the academic READ paths and drop the redundant
  service-layer role check** — the properly-scoped version of the hotfix
  shipped 2026-08-21 (see the recurring-pattern entry directly below).

  The hotfix added `"bursar"` to `assertUserActiveAndHasOneOf(authCtx,
  ["owner", "admin"])` in the seven academic READ paths
  (`academic-years.service.ts` list/findById, `terms.service.ts`
  listForYear/findById, `class-arms.service.ts` listForLevel/list/findById).
  That unblocks the role, but it treats the symptom: those endpoints are
  ALREADY correctly gated by `@Permissions("academic-year.read")` etc. on
  their controllers, and the service-layer check is a second, parallel
  authorization system that keys off ROLE KEYS and cannot see permissions at
  all. Every future role will hit the same wall, and the failure mode is
  silent — the permission grant simply does nothing.

  **The real fix**: where a controller already gates on the right permission,
  the service-layer role check on READ paths is redundant and should be
  removed (keeping the `isActive` re-check, which is a genuine
  defense-in-depth requirement from CLAUDE.md's auth rules and is the other
  half of what that helper does). **Deliberately NOT done as part of the
  hotfix**: `assertUserActiveAndHasOneOf` has ~20 call sites across
  assessment, students, users, schools, ai-usage and more, and splitting the
  active-check from the role-check touches every one. That is a plan-first
  with its own RBAC test pass, not a line to change under time pressure while
  a production role is broken.

  Note the helper's own header comment already describes itself as a gate for
  "every handler that performs a tenant-scoped **mutation**" — the read paths
  were arguably never its intended scope, which is worth using as the starting
  point for that plan-first.

- [ ] **RECURRING PATTERN — this is the THIRD time the `bursar` role has
  shipped broken in the same shape: a grant that looks correct in
  `permissions.ts` but is contradicted by a second gate somewhere else, caught
  only in a browser, never by CI.** Recorded as a pattern deliberately, not
  just as today's instance; the individual bugs are all fixed, the shape is
  what keeps recurring.

  1. **2026-08-02 — admin-shell lockout.** `bursar` shipped in Phase 3 /
     Slice 15 with real finance permissions, but `(admin)/layout.tsx`'s
     `RequireAuth roles={["owner", "admin"]}` was never updated, so a bursar
     hitting any `(admin)` route was redirected to `/teacher/dashboard` with
     no way back in. Gate: a ROLE list in the web shell.
  2. **2026-08-02 (same day, second gate) — missing scoping permissions.**
     Bursar held every `finance.*` permission but not `academic-year.read` /
     `term.read` / `class-arm.read`, so every finance page's year/term
     selector 403'd. Gate: the PERMISSION list.
  3. **2026-08-21 — the fix for (2) was inert for 19 days.** The permissions
     were added and the endpoints stayed 403, because the three academic
     services ALSO call `assertUserActiveAndHasOneOf(authCtx, ["owner",
     "admin"])`, which checks ROLE KEYS and never consults permissions. Gate:
     a role list in the SERVICE layer, below the one that was fixed.

  **Why CI never caught (3), which is the part worth internalising:**
  `bursar-scope.spec.ts` had a regression test named "bursar CAN read academic
  years, terms, and class arms" that passed green the entire time. It asserted
  `guard.canActivate(...)` — the PermissionsGuard only — and stopped exactly
  one layer above where the rejection actually happened. The test was not
  wrong about what it checked; it was wrong about what it implied. A test that
  proves a request gets PAST one gate says nothing about whether the request
  succeeds, whenever more than one gate exists.

  **Mitigation shipped with the hotfix**: a sibling test that calls the
  SERVICES directly, verified to fail against the pre-fix code before being
  committed. **Still open**: nothing systematically detects "a permission is
  granted in `permissions.ts` but a role check elsewhere contradicts it."
  Options worth weighing in the plan-first above — (a) an inventory spec that
  cross-references `assertUserActiveAndHasOneOf` role lists against the
  `@Permissions` metadata on the same handler and fails on disagreement;
  (b) an e2e RBAC walk that exercises each role's real landing page over HTTP,
  which is what a human did to find all three of these.

- [ ] **Two of the four session resolvers have no revocation signal at all**
  (found by the SECURITY DEFINER cadence review, 2026-08-16). `auth_resolve_
  student_session` returns `student_status` + `portal_enabled` and
  `auth_resolve_session` returns `user_is_active`, so both staff and students
  can be cut off mid-session. `auth_resolve_guardian_session` returns
  neither — `Guardian` has no `is_active` column, and clearing
  `password_hash` blocks future logins without touching a live session, so a
  guardian who should lose access keeps it for up to 30 days.
  `platform_admin_resolve_session` is the same, for the single most
  privileged principal in the system.
  Slice 3 sharpened this rather than causing it: the child now has the
  strongest revocation story and the two principals with the most access have
  the weakest. Fix is small in both cases — add an `is_active`-equivalent to
  `Guardian` and return it; return `user_is_active` from the platform-admin
  resolver — but each is a schema/behaviour change with its own blast radius,
  so neither was smuggled into an unrelated slice. Trigger: before any real
  guardian offboarding is needed, or the next time either resolver is touched.

- [ ] **The Paystack leg of guardian mobile checkout has never been round-tripped**
  (logged 2026-08-15, Phase 6 / Slice 2). **Gates "slice 2 is fully complete" —
  explicitly NOT a blocker for slice 3**, which builds the auth/session
  foundation and touches none of this. Live verification against a running API
  proved everything up to the Paystack call: route, `GuardianAuthGuard`, bearer
  auth, path params, and typed error mapping all work, and the refusal
  (`409 PAYSTACK_NOT_ENABLED`) carries parent-safe copy with no key material —
  asserted, not assumed. What is unproven is the call itself: the dev school has
  no Paystack subaccount, so no `authorization_url` was ever requested and
  `runCheckout`'s open-browser-then-poll cycle has never run against a real
  hosted checkout. Closing it needs a Paystack **test-mode** subaccount attached
  to the dev school — an outward-facing action against the real Paystack account,
  which is why it was not done unprompted. Trigger: before slice 2 is called
  done, or the first time anyone touches `portal-payments`.

- [ ] **Paystack checkout does not return the user to the mobile app** (logged
  2026-08-15, Phase 6 / Slice 2). `PortalPaymentsService.initiate` hardcodes
  the Paystack callback to `${PORTAL_BASE_URL}/payments/callback` — a web URL.
  `apps/mobile` opens the hosted checkout in an in-app browser, so after
  paying the guardian lands on the portal's web callback page *inside that
  browser* and has to close it manually, rather than being deep-linked back
  into the app. Accepted deliberately for slice 2, whose whole premise is
  that guardian mobile ships against the existing `/portal` API with **zero
  server changes** — fixing this needs either a client-supplied callback URL
  (a new input on a money endpoint, which wants its own threat model) or a
  scheme-aware callback that branches on caller.
  **This is cosmetic, not a correctness bug**: `runCheckout` never treats the
  redirect as proof of payment. It polls `GET /portal/payments/:reference`
  after the browser closes, because the authoritative signal is the Paystack
  webhook — the same reason the portal's own callback page polls. A parent
  who force-quits mid-checkout still gets the right answer on next open.
  Trigger: first real guardian complaint about the flow, or whenever a slice
  is already touching `portal-payments`.

- [x] ~~Per-school AI enablement has no UI and no endpoint~~ — **built before this script ran, which was the point.** `PATCH /platform-admin/schools/:schoolId/ai` plus a toggle on the super-admin school row shipped 2026-08-14 (PR #173): same guard, throttle and audit-row shape as `PATCH …/early-access`, with `ai_enabled` added to `platform_admin_list_schools()` so the toggle isn't a blind write. Kept here rather than deleted because the sequencing is the lesson: `packages/db/scripts/disable-ai-per-school.ts` closes the per-school gate on every existing school, and closing a gate with no sanctioned way to reopen it would have forced the first pilot enablement to be a hand-written `UPDATE` with no audit row. Build the re-open path first.

- [ ] `School.aiEnabled` still `@default(true)` for newly created schools — the backfill above is a point-in-time fix on the existing population. Every school created after it (signup or `POST /platform-admin/schools`) arrives with AI on, so the population drifts back open one school at a time and the backfill has to be re-run. Deliberately NOT changed by that script: the default-true is a considered decision documented in `schema.prisma` beside `parentSummaryEnabled`'s deliberately-opposite default-false, and reversing it is a product call, not a backfill's business. The argument for flipping it got stronger once the item above shipped: enabling a school is now a one-click, audited platform-admin action, so defaulting new schools to `false` costs an operator one click on a school they were already looking at — rather than the hand-written SQL it would have cost before.

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

- [x] **FIXED 2026-08-09 (recurrence prevented; backlog drain is a one-time manual step, see below).** `deploy-staging.yml` now runs a `Prune smoke-test schools` step after the smoke test — `if: always()` (a failed smoke run can still have completed op 3, which is exactly the case that leaks a row) and `continue-on-error` (cleanup must never turn a healthy deploy into a failed one, or re-trigger the rollback path). It prunes every matching smoke school, not just the current run's, so the backlog drains itself once the step first runs. **The prune predicate was tightened in the same change and this is the load-bearing detail:** it was `slug LIKE 'smoke-%'`, which was fine as a manual dev-only chore but a live data-loss path once automated against production — `RESERVED_SLUGS` is an exact-match set of 39 names with no prefix matching, so a genuine school registering `smoke-academy` would have passed validation and then been silently destroyed, students/invoices/payments and all. It now requires BOTH a slug matching `^smoke-[0-9]+$` AND an owner user whose email ends in the RFC-2606-reserved `@smoke-test.invalid` domain. A read-only companion (`scripts/list-smoke-schools.sql`, `pnpm db:list-smoke`) previews exactly what would be deleted, including a "near-miss audit" listing any school the OLD predicate would have destroyed — run it before the prune, always. Backlog at time of fix: ~66 schools minimum, derived from 66 successful `deploy-staging.yml` runs since 2026-06-26 (plausibly 70-80 counting runs that failed after op 3); not directly counted, as production DB access was unavailable in that session. Original item follows. —
- [ ] **Production `school-kit-api` DB accumulates an uncleaned `Smoke Test School` row on every single deploy.** Found 2026-07-20 while checking the `NEXT_PUBLIC_API_URL` incident above for real-user impact: `scripts/smoke-test.sh`'s `POST /auth/signup-owner` call (op 3 of the deploy smoke test, direct against the Fly API) creates a genuine `School`+owner `User` row on every successful `deploy-staging.yml` run and never deletes it — every production deploy leaves one more behind. At the time of that check, the 15 most recent schools in the entire production database were *all* smoke-test artifacts (`smoke-<epoch>` slugs), none cleaned up. Same failure category as the pre-existing "Dev DB cleanup — ~100 test schools" item above, except this one is in **production**, not dev. Fix options: (a) have the smoke test delete its own school at the end of the run (requires a delete path — see that item's own note that no `DELETE /schools/:id` API exists today), or (b) a scheduled cleanup job filtering on the `smoke-` slug prefix. — Trigger: before a real pilot school's data needs to coexist cleanly with these in any admin-facing school list, or whenever someone next touches `scripts/smoke-test.sh`.

- [ ] **No platform-admin endpoint for `School.aiMonthlyTokenBudget` — setting a school's AI spend cap currently requires a raw production DB write.** Surfaced 2026-08-16 while enabling the first AI pilot school: the platform-admin surface has `PATCH /platform-admin/schools/:schoolId/ai` (the on/off kill switch) and `PATCH …/early-access`, but nothing for the budget column, so capping Virgo Fidelis at 750,000 tokens/month had to be done as a direct `basePrisma.school.update` inside the running container, with a hand-written `platform_admin.schools.set-ai-budget` audit row to avoid an unaudited production change. That is the wrong shape for a field that is (a) spend configuration, (b) expected to be tuned per school as pilots widen, and (c) the only thing standing between a runaway loop and the platform's Anthropic bill.
  **Why it's small:** it is structurally identical to the AI toggle that already exists — `schools` is the one table with no RLS policy, so it is a single-column `basePrisma.school.update` plus an audit row, no SECURITY DEFINER function and no GUC needed (same reasoning recorded for the `ai` and `early-access` endpoints in CLAUDE.md's inventory notes). The natural shape is `PATCH /platform-admin/schools/:schoolId/ai-budget` taking `{ aiMonthlyTokenBudget: number | null }`, with `null` meaning "fall back to `DEFAULT_MONTHLY_TOKEN_BUDGET`". Worth surfacing the current value in `platform_admin_list_schools()` at the same time — it is already the one list an operator reads before acting, and `ai_enabled` was added there for exactly that reason; note the function's omissions column currently names `ai_monthly_token_budget` as deliberately excluded ("spend configuration"), so that decision has to be revisited explicitly rather than silently reversed.
  **Related sizing note worth keeping:** `DEFAULT_USER_DAILY_CALL_CAP` (200 calls/user/day) does not meaningfully bound the monthly budget. At the lesson-plan prompt's ~4,460-token reservation, two staff can reserve ~1.8M tokens in a single day — more than the 2M default budget. The per-user cap is a runaway-loop guard, not a spend guard, exactly as its own comment says; the monthly budget is the only real spend bound, which is why configuring it needs to be easy. — Trigger: the second school to get an explicit budget, or the first time AI enablement widens past one school.

- [ ] **Two `School` rows named "Virgo Fidelis Montessori School" in production — one real, one near-empty duplicate.** Confirmed 2026-08-16 by direct read-only query against the production DB while verifying the AI enablement gates. The real tenant is `6beff17c-c65a-47db-9f00-61936e0ac467` (slug `virgo-fidelis-school`, created 2026-07-24): 12 students, 2 staff, 7 enrollments, and the school Arinzechukwu is piloting AI on (`ai_enabled = true`, set 2026-08-16T13:37:51Z). The duplicate is `07865652-54c1-4005-9d01-c97eda8a10c7` (slug `virgo`, created 2026-07-20): 1 student, 1 staff, 1 enrollment, `ai_enabled = false`. A `GROUP BY lower(name) HAVING count(*) > 1` across all 32 production schools returns **this pair and nothing else** — it is the only duplicate-name collision in the database, so this entry is the standing list rather than an addition to one. Both rows were already noted incidentally in the Gate 3 SMS item further down this file (as "both real … rows", in the course of confirming neither has a `NotificationPreference` row); that note establishes they exist but does not track cleaning them up — this entry does.
  **Why it matters beyond tidiness:** the two are indistinguishable by name in every admin-facing school list, including the platform-admin roster (`platform_admin_list_schools()` returns `name`, not `slug`), which is exactly the surface an operator uses to pick a school when toggling AI, granting early access, or fulfilling a Paystack setup request. The AI toggle landed on the right row this time — verified against student counts, not against the name — but that was luck plus a check, not a property of the UI. Any future per-school operation carries the same coin-flip.
  **Not fixed here, and not safe to fix casually:** the duplicate is not empty (1 student, 1 staff, 1 enrollment), so this is a merge-or-delete decision about real records, not a prune. `User.school` is still `RESTRICT`, not `Cascade` (see the payroll-slice item above), so any delete needs the same dependency-ordered teardown that backlog prune required, and there is no `DELETE /schools/:id` API. Needs Arinzechukwu's call on whether the `virgo` row's single student is a genuine record to migrate or a test artifact to discard. — Trigger: before the AI pilot widens past this one school, or the next time any platform-admin write targets a school picked from a name-only list.

- [x] **`STORAGE_DRIVER=r2` was never set in production — `school-kit-api` and `school-kit-render-worker` were running the dev-only filesystem storage driver the entire time. Found 2026-07-21, FIXED and verified end-to-end 2026-07-23.** Found while spot-checking other third-party secrets after the `RESEND_API_KEY` incident above turned up the same "documented/coded but never verified live" pattern a third time in two days. `docs/runbooks/neon-prod-setup.md` §5 already templated the four `R2_*` credential lines (unlike the Resend gap, those weren't missing from the template) — but `STORAGE_DRIVER` itself, the switch that actually selects the R2 driver, was nowhere in the template on either app. `storage.module.ts`'s own fallback (`config.get<string>("STORAGE_DRIVER") ?? "filesystem"`) meant both apps silently ran the filesystem driver in production this whole time, and confirmed via `flyctl secrets list` that the `R2_*` credentials were never actually set either — so this was two compounding gaps (no real credentials AND no switch to use them), not just one.
  Two independent problems, both real: (1) **write target** — the filesystem driver writes to the Fly machine's own ephemeral container disk, no volume mounted (checked `fly.toml` — no `[[mounts]]` block), so every file written is lost on the next deploy or restart. (2) **serve path** — the filesystem driver's `signUrl()` points at `DevStorageController`, which is deliberately dev-only (`isProd ? [] : [DevStorageController]`, same module) — confirmed directly with `GET /api/v1/dev-storage/...` against the live API returning `404`, independent of whether any file survived. Even a file that happened to still exist had no route to be fetched through.
  **Investigated for real damage before doing anything else, per explicit instruction — found none.** Queried every `Payment.receiptUrl` and `ReportCard.artifactUrl` in production: all `null`, zero rows either way. Consistent with the `NEXT_PUBLIC_API_URL` incident's own finding that every school in the database is a `scripts/smoke-test.sh` artifact (whose 5 ops never touch payments or report cards) — nothing has ever exercised the real write path, so there was nothing to recover and nobody to notify. Purely a forward-looking fix, confirmed before anything was applied.
  **A second wrong-documented-value gap surfaced along the way**: the runbook's suggested `R2_BUCKET="school-kit-staging"` (also present in the original Slice 1b provisioning journal) turned out not to exist under the real account. Confirmed by calling R2's S3-compatible API directly with the real credentials before using them for anything else — `ListBuckets` itself came back `403` (the token is scoped to a single bucket, not account-wide — a permissions rejection, not a signature failure, so this didn't mean the credentials were bad), then `HeadBucket`/`ListObjectsV2` against candidate names found the real bucket: **`school-kit-prod`**. Fixed in the runbook template (see its own guard note) before the actual `flyctl secrets set` calls ran, so the wrong value was never live even briefly.
  **Fixed and verified real end-to-end, not just secret presence**: `flyctl secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=school-kit-prod STORAGE_DRIVER=r2` run on both `school-kit-api` and `school-kit-render-worker`, confirmed deployed via `flyctl secrets list`. Then a genuine write+fetch cycle through real, unmodified production code: signed up a test school, created a student and a real `ISSUED` invoice, called the real `POST /payments/manual` endpoint — `201`, with a populated `receiptUrl` (`schools/<id>/receipts/<paymentId>.html`, the canonical R2 object key), proving `storage.put()` succeeded synchronously as part of the request. Called the real `GET /payments/:id/receipt` endpoint — `200`, returned a genuine presigned URL at `school-kit-prod.<accountId>.r2.cloudflarestorage.com` (bucket name matches the corrected value). Fetched that URL directly — `200 OK`, `Server: cloudflare`, real receipt HTML content (`Receipt RCP-...`) matching the payment just created. All test data (DB rows and the R2 object itself) cleaned up afterward and confirmed gone (`NotFound` on a follow-up `HeadObjectCommand`).

- [ ] **Smart Student Import has no content evals and its prompt has never
  seen a real register (2026-08-20).** The feature shipped complete —
  vision plumbing, budget accounting, human-review gate, provenance flag, 50
  tests, 22 new eval checks — but every one of those checks is STRUCTURAL.
  Whether the model correctly reads "Chukwuemeka" off a photocopied,
  handwritten page is a content question none of them can answer, and
  `student-list-extraction` is at v1 having never run against a real Nigerian
  school register.

  This is the same gap phase-5.md §9 already carries for slices 2-5, but
  sharper: handwriting varies far more than a score table does, and the
  output lands in a child's permanent record rather than in a comment a
  parent reads once. The precedent is recent and specific —
  `report-card-subject-comment` needed a v2 the same day a real key was first
  configured, for two defects 154 structural checks could not see.

  **What closing this needs:** ~10 photographed pages from a real school with
  hand-verified ground truth, a per-field exact-match accuracy pass, and
  almost certainly a prompt v2. The fixture set is a new KIND of eval asset —
  nothing in `packages/ai/evals/cases` is comparable — so building it is real
  work, not a config change.

  **Trigger:** before this feature is enabled for ANY school. Same rule
  phase-5.md §9 sets for slice 5 — do not switch a school on until someone
  has read real output. Blocked on Arinzechukwu confirming a pilot school.

  **Related, and cheap to get wrong:** extraction is SYNCHRONOUS by design
  (D3 — no persisted image means no queued job). The 30-60s estimate for a
  full page is an ESTIMATE; it has never been measured against the real API.
  If real timings blow past what a Fly request will tolerate, the decision to
  revisit is D3 itself, and that needs sign-off — not a quiet switch to
  buffering the image somewhere.

- [ ] **Re-validate the report-card PDF memory gate IN A FLY.IO CONTAINER + author `apps/api/Dockerfile` with Chromium provisioning.** Slice-5 cp2's 40-card memory gate was measured in **dev on Windows** only (numbers in the 2026-06-04 journal entry). The fly.io Linux container fit is unproven. Before the first deploy that enables PDF render: (1) write `apps/api/Dockerfile` provisioning Chromium + system libs + a font (checklist in `docs/modules/phase-2.md` § "Deployment — Chromium provisioning"); (2) re-run the gate in-container against the target machine size (512MB / 1GB) — GREEN if peak RSS < 70% of budget. If it FAILS in-container, fall back to the external render service (the existing phase-2.md deferred item). **Trigger: pre-deploy / Phase 3 infra, or the first time PDF render is wanted in a deployed env.**

- [x] **HIGH PRIORITY, ROOT CAUSE CONFIRMED (2026-07-31) — frequent long loading stalls on login/navigation in production. Two stacking causes; Cause 1 FIXED 2026-07-31 (Redis session cache), Cause 2 DELIBERATELY NOT FIXED (Neon Free tier — no dashboard control, confirmed same day).**
  Investigated fresh rather than assuming this was the known dev-only stale-`.next`-cache issue (CLAUDE.md's documented gotcha) — correctly ruled out immediately, since production runs a built app with no dev cache to go stale.
  **Cause 1 — zero session caching, confirmed via direct request timing against the live production API.** `AuthGuard` (`apps/api/src/common/auth/auth.guard.ts`) called `auth_resolve_session` via a live `$queryRaw` on every single authenticated request, with no Redis lookaside — Redis was already provisioned (`redis-auth.module.ts`) but scoped only to rate-limiting/2FA challenge tokens, never session data. Measured directly: `GET /health` (no DB) averaged 630–850ms baseline; `GET /health/db` (one query) added a consistent 150–350ms on top of that baseline on **every** call, not occasionally; a real `POST /auth/login` (bad creds, still exercises the full lookup + argon2 comparison path) ran 1.0–1.6s. A flat per-request tax that compounds across ordinary navigation, independent of any cold-start.
  **Cause 2 — Neon compute autosuspend, confirmed via the Neon dashboard (Project → Branch → Settings → Compute): "Scale to zero" is ON, 5-minute inactivity threshold, compute size 0.25 CU (~1GB RAM). Confirmed 2026-07-31: `school-kit-prod` is on Neon's Free tier, which does not allow disabling or customizing this setting at all — Neon's own docs confirm Free tier autosuspend is fixed and non-configurable; even the Launch plan only allows a full on/off toggle, not a custom threshold, and Arinzechukwu cannot upgrade before onboarding.** Decision: **leave Cause 2 as-is, revisit the plan-upgrade decision after launch once there's real revenue to justify the ~$19–41/month always-on cost** (see the pricing math this file's earlier version of this entry — now folded into this note — worked out from Neon's published $0.106/CU-hour Launch and $0.222/CU-hour Scale rates). Fixing Cause 1 alone still meaningfully reduces stall frequency/severity even with Cause 2 unaddressed, since Cause 1 was a tax on **every** request, not just the first-after-idle one.
  **Fly.io cold starts were ruled out as a cause even before this fix** — verified directly via `flyctl status`/`flyctl machine list`: one machine continuously `started` with 1/1 health checks passing; `min_machines_running = 1` (2026-07-19 fix) confirmed genuinely live, not just committed.
  **Cause 1 fix, implemented and verified 2026-07-31:**
  - `apps/api/src/common/auth/session-cache.ts` (new) — `session:{tokenHash}` key in the existing `REDIS_AUTH_CLIENT` (no new Redis connection), 30s TTL, `getCachedSession`/`setCachedSession`/`invalidateSessionCache`.
  - `AuthGuard.canActivate` checks the cache first; on a miss falls back to the identical `auth_resolve_session` DB path and populates the cache before returning. Only positive results are cached — an invalid/unknown token always re-checks the DB.
  - **Explicit invalidation on every real revocation path** (30s TTL is a safety net, not the primary mechanism): `AuthService.logout()` (one session), `AuthService.resetPassword()`'s "kill all sessions" (every session for the user), and — found while implementing, not originally asked for but included per explicit approval (option b) — `TeacherProfilesService.delete()`'s user-deactivation path (`isActive: false` without deleting the session rows; the cache is the only thing that would otherwise keep serving a deactivated user as active).
  - **Revocation correctness proven with a real Redis + real Postgres integration spec** (`apps/api/src/modules/auth/session-cache-revocation.spec.ts`, deliberately NOT using the mocked Redis every other controller-integration spec uses): warms the cache, confirms the entry exists in Redis directly, triggers each revocation path, confirms the cache entry is gone, and confirms an immediate retry with the same token gets rejected (`INVALID_SESSION` / `USER_INACTIVE`) rather than a stale-valid 200. All 4 tests pass. Fixing this required updating the Redis mock in 5 other controller-integration spec files (`users`, `invitations`, `schools`, `auth.controller`, `auth.session`) plus `auth.password-reset.spec.ts` (needed a real Redis client — it genuinely exercises kill-all-sessions) and `portal-payments.controller.spec.ts` (needed *a* Redis provider at all, even though its routes don't go through the staff `AuthGuard`, because Nest's DI still has to construct `AuthGuard` as a global `APP_GUARD`). Full suite: 1337 passed, 2 pre-existing skipped, 0 failed.
  - **Latency measurement — honest limitation, not swept under the rug.** Attempted the same before/after methodology as the original investigation, against the local dev server: results were flat (~11–20ms for every call, cache hit or miss) because local dev has no Neon-equivalent cross-continent network hop — Docker Postgres on the same machine is already too fast for the DB-round-trip cost to be the dominant factor, so local numbers can't reproduce the production signal. **Did not fabricate a misleading local number.** What's verified instead: the caching *mechanism* itself is correct and complete (the 4 revocation-correctness tests above are real evidence, not "should work"), and the structural argument holds regardless of environment — a cache hit is one Redis GET against `REDIS_AUTH_CLIENT` (Fly Redis, same region as the API), while a cache miss is one Postgres query across the documented Fly(Johannesburg)→Neon(Frankfurt) cross-continent hop that Cause 1's original 150–350ms measurement was against. The real before/after production number is a fast-follow once this is deployed — same `GET /health/db`-style probe the original investigation used, now against a warm cache.
  Trigger for Cause 2: real revenue to justify a Neon plan upgrade, or a pilot school reporting the residual first-after-idle stall as a real problem before then.
  **Shipped and deployed 2026-07-31**: PR #130, merged after a genuine (non-timeout) e2e pass (12m49s), `deploy-staging` succeeded, `school-kit-api` confirmed running the new release (v76, both machines) via `flyctl releases`/`flyctl status`.
  **Real production before/after latency — the fast-follow promised above, now measured.** Against the live API, same GET-based methodology as the original investigation: created one minimal test school (`Latency Probe Test School`, same accepted pattern as `deploy-staging.yml`'s own smoke-test signup — no `DELETE /schools/:id` endpoint exists to clean it up, matching the already-tracked smoke-test-accumulation item above), got a real bearer token, hit `GET /auth/me` 8 times with the same token, twice (two independent passes, both consistent): **first call (cache miss) ~3.0–3.1s; every subsequent call within the 30s TTL (cache hit) ~1.9–2.1s — a reproducible ~1.0–1.1s improvement, every single time, across both passes.** `GET /health/db` (unauthenticated, unaffected by this fix, measured in the same session for context) sat at ~0.9–1.0s steady-state — confirming Neon is currently running measurably slower than during the original investigation (consistent with Cause 2's autosuspend still being live and unaddressed; `/health/db`'s own first-call-of-session spike hit 3.03s during this same test run, matching the original 2.33s cold-start signature). `GET /auth/me`'s cached-call floor (~2s) stays well above `/health`'s plain ~650-850ms baseline because that handler does its own additional DB work (fetching user/school/roles/permissions) that this fix doesn't touch — only the session-resolution step inside `AuthGuard` is cached. The ~1.0-1.1s delta is specifically what this fix removed, isolated from that other cost.
  **2026-08-03 — retry logic added for Cause 2's worst case; Launch upgrade decision still deferred.** Four production Sentry issues (`GET /academic-years` — "server has closed the connection", 51 events, Escalating; `class-levels/:levelId/class-subjects` — "unable to start a transaction in the given time", 11 events across two issues) traced directly to Cause 2 above, not new code — every `withTenant()` call opens a real Prisma `$transaction`, and Neon's autosuspend was either killing an already-pooled connection or delaying a fresh one by several seconds. `withTenant()` (`packages/db/src/tenant-client.ts`) now retries once, after a 500ms delay, but only for connection-level Prisma error codes (`P1001`/`P1002`/`P1008`/`P1017`/`P2024`/`P2028`) — never business-logic errors like `P2002`, which would just fail identically again. This converts a hard 500 into a delayed-but-successful response; it does **not** eliminate the underlying multi-second latency, since that's Neon's real compute-wake time, not something a retry can skip. Verified: full API suite green (1370 passed, 2 pre-existing skipped, 0 failed), local happy-path smoke-tested end-to-end through the new code path. Honest limitation, same as Cause 1's fix above: the actual retry-firing path (a real connection death) can't be reproduced locally — no Neon-equivalent cold-start exists in local Docker Postgres.
  **Corrected finding on the Scale-tier claim above**: re-checked directly against Neon's own docs (not just the dashboard snapshot the original 2026-07-31 investigation used) — Launch's 5-minute autosuspend is confirmed fixed/non-configurable exactly as this entry originally found, but Neon's **Scale** tier (one level up, $0.222/CU-hour vs. Launch's $0.106/CU-hour, both purely usage-based with no monthly minimum) does allow a configurable autosuspend delay from 1 minute up to always-on/7 days. **Not worth pursuing without real usage data**: Scale's custom-threshold cost only beats flat Launch-always-on if actual billed compute stays under ~11.5 hours/day (the breakeven point given Scale's 2x-higher per-hour rate) — unverifiable pre-launch with no real traffic yet. A scheduled keep-warm ping on Free tier was also considered and rejected: it doesn't avoid the cost, it just burns the same finite 100 compute-hour/month Free allowance faster, competing directly with real usage for the same budget.
  **Decision: still leave Cause 2 as-is.** The original "revisit after real revenue" trigger is unchanged — Arinzechukwu explicitly declined the Launch upgrade on 2026-08-03, given the retry logic above now covers the worst-case failure mode (hard error) even though it doesn't fix the latency. Do not re-investigate the Scale-tier option from scratch next time this is revisited; the finding above is current as of 2026-08-03.
  — reported as a bug, root-caused to a discoverability gap, not a defect. Investigated and fixed 2026-07-31.** Drove the actual Add Term and Edit Term flows in a real browser (logged in as dev-owner, created a fresh academic year, opened its terms page): both `POST /academic-years/:id/terms` and `PATCH /terms/:id` returned clean 2xx responses, dialogs closed, toasts fired, table updated — no `.strict()`-resolver silent-rejection bug like the one that broke the class-arm dialog (the flagged-but-unaudited `docs/deferred.md` concern about all 5 academic dialogs' `zodResolver(schema) as never` casts). Term's `FormValues` has no nullable-number-from-blank-string field like class-arm's `capacity`, so it doesn't hit that failure mode.
  **Real cause, found once Arinzechukwu described what he actually saw:** `AcademicYearsTable` (`apps/web/src/components/settings/academic/academic-years-table.tsx`) put the year label itself behind a bare `<Link>` with only `hover:underline` — the *only* way to reach the terms page (and therefore the Add/Edit Term dialogs) was clicking plain text with zero visual affordance that it was interactive. Every other row-to-detail-page navigation in the app (Students roster, Staff roster) uses an explicit outlined button with an icon and "View" label in the Actions column — this table was the one place that broke that convention. An admin who never discovered the label was clickable would never reach the term dialogs at all, which reads exactly like "the button doesn't work."
  **Fixed**: replaced the bare label link with a plain text cell, and added an explicit "View terms" button (`Eye` icon, outline variant, same `h-7`/`size="sm"` shape as Students/Staff's "View" buttons) in the Actions column, consistent with the rest of the app. Considered converting to an inline-expand row instead (showing terms without any navigation) — rejected: there is no expand/collapse pattern anywhere else in this codebase, and the Terms page carries its own header, back-link, and Add/Edit/Delete term actions that would need duplicating inline; the explicit-button fix matches an existing, already-consistent pattern instead of introducing a new one for a single table.
  Verified via a real Playwright-driven browser session against the dev server (screenshot confirms the button renders correctly with Edit/Delete alongside it, and clicking it navigates to the terms sub-page) — not just a code read.

- [x] **Bulk student add via spreadsheet-like grid — shipped 2026-07-31.**
  `/students/new/bulk` — bio-only fields (no photo, no class arm, no
  guardian, matching the precedent set by both the single-add form and the
  CSV import path, neither of which bundle those either), 3 starting rows,
  sequential looped `POST /students` calls (no new bulk endpoint, no
  BullMQ), per-row inline errors. Verified end-to-end against the dev
  server with real data: a forced duplicate-admission-number conflict
  showed inline without losing the other already-created rows, a retry
  after fixing the conflicting row correctly skipped re-creating the
  already-successful ones, all three students appeared correctly in the
  roster and one was spot-checked on its detail page. See
  `apps/web/src/components/students/bulk-student-form.tsx`.

  **Narrowed and sped up 2026-08-18** (same file). The grid shipped with 13
  data columns — every optional bio field the single-add form had — which
  made "add several students quickly" the slowest intake path in the app.
  It now captures only what a school actually needs at intake: admission
  number, first/middle/last name, DOB, gender, and an optional email. Phone,
  address, blood group, religion, state of origin, nationality, photo,
  medical notes and free notes are gone from this screen; they belong to the
  student and guardian to supply from their own portal (Phase 6 / Slice 3),
  and `nationality` in particular is now simply not sent — the column's
  `@default("Nigerian")` already stores what the always-prefilled cell did.
  Four keyboard affordances were added at the same time: paste a block from
  Excel/Sheets into any cell (it spreads across columns and down rows,
  normalising `dd/mm/yyyy` dates and `M`/`F` genders), Enter to move down a
  column, auto-appending a spare row as you type in the last one, and blank
  rows ignored on submit — which is what makes the auto-append safe, and is
  also why this form validates by hand rather than through `zodResolver`
  (the resolver has no way to say "skip this row"). The single-add form kept
  every field but now opens with only the intake set visible; the rest sit
  behind a **More details (optional)** disclosure that stays mounted (so no
  typed value is ever dropped) and auto-opens on edit whenever any of those
  fields already holds a value, or on a failed submit whose error is inside
  it. The roster's own toolbar was rearranged in the same pass: five
  equal-weight buttons wrapping onto two ragged rows became Export + Print
  on the left and one primary split button — **Add student**, with the grid
  and CSV import under its caret — on the right.

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

## Phase 5 — `ai:eval` has no content-quality coverage (logged 2026-08-11)
- [ ] `pnpm ai:eval` became a real gate in Slice 2 (it was
  `echo 'eval placeholder'` — exit 0, asserting nothing — from Phase 0 until
  then). It now runs 42 checks and fails the build on exit code. But every
  one of those checks is **structural**, and the distinction matters more
  than the number does:
    * **PII safety (7)** and **prompt quality (13)** inspect *inputs* — the
      rendered prompt string, and the system-prompt text we authored.
    * **Registry + schema integrity (22)** inspects schema definitions and
      registry metadata. It never sees a prompt, let alone a response.
    * **`live-generation`** is the only suite that would inspect model
      output — and **it has never executed once**, because no
      `ANTHROPIC_API_KEY` has ever been configured (placeholder locally,
      absent from Fly as of 2026-08-11).

  So the suite proves the plumbing, the schema, and that no student PII can
  reach the model through a renderer. It proves **nothing** about whether
  generated content is on-topic, age-appropriate for the stated class level,
  or pedagogically coherent. A model producing fluent, well-structured
  nonsense passes all 42 checks.

  Even once a key lands, `live-generation` is deliberately shape-and-floor
  rather than judgement: not a refusal, not truncated, parses as JSON, each
  section over 80 chars, and a regex for Nigerian localisation markers. That
  catches a section coming back as a one-line stub, or the grounding
  instruction being ignored wholesale. It cannot grade quality.

  Closing this needs one of: golden reference outputs plus an LLM-judge
  scoring rubric conformance, or a human review pass over a fixed fixture
  set at each prompt-version bump. Both are real eval-design work with their
  own decisions (who writes the references, what the rubric measures, what
  score gates a merge) and neither belongs bolted onto a feature slice.

  **Trigger (restated 2026-08-14 — the original one has already half-fired).**
  It read "when `ANTHROPIC_API_KEY` is first configured and `live-generation`
  actually runs". The key IS now configured on `school-kit-api` and has been
  verified with a live generation — but `live-generation` still has not run,
  because `AI_ENABLED=false` holds every path short of the model. The two
  halves came apart, so the trigger is now the second half alone: **when
  `live-generation` actually executes**, which in practice means when
  `AI_ENABLED` is flipped and the first pilot school generates real output.

  **Status: DEFERRED, standing, no urgency — confirmed 2026-08-14.** This
  explicitly does **not** block Phase 7 (renumbered from Phase 6 on
  2026-08-15 — the AI work this refers to is RAG + tutor, now Phase 7). It
  does not block Phase 6's mobile/student-portal work either, which ships no
  AI output at all. It is not a countdown and nothing is
  waiting on it; it is recorded here so that the day someone reads a batch of
  real output and asks "how would we know if this got worse?", the two
  options above are already written down rather than rediscovered.

  What DOES still gate a school going live is unchanged and much narrower:
  do not switch a school on until someone has read a batch of its real
  output (phase-5.md §9). That is a human step, not an eval, and it is
  satisfied by the one-at-a-time rollout rather than by this item.

## Roadmap / strategy — REVISIT with live market research (not decided)
- [ ] CBT / online exams (JAMB/WAEC/UTME prep) — competitors lead with
  this. Decide in/defer based on pilot-school demand + current market.
  **A full capability assessment (what exists, what's missing, the
  two-question clarification to put to any lead who asks, and time
  estimates) was written 2026-08-09 — see "CBT / online exams — capability
  assessment" at the end of this file. This line stays as the
  market-research placeholder; that section is the engineering reality.**
- [ ] Predictive AI (at-risk-student early warning from attendance+grade
  trend, enrollment forecasting, auto billing reminders) — high-value,
  data already collected. Verify market framing before Phase 5.
- [ ] Agentic vs generative AI positioning — market may have shifted
  toward adaptive/agentic by Phase 5. Run live search before committing
  AI roadmap. Do NOT build multi-agent orchestration as solo founder.
- [ ] Timetable, transport, library, hostel — Phase 9 (auxiliary
  modules; renumbered from Phase 7 on 2026-08-15). Named so
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
  || permissions.includes(perm)`) is duplicated per-file rather than shared.

  **Recount 2026-09-01: there are TEN copies, not four.** This entry claimed
  four from 2026-07-18 until an actual `grep -rn "function hasPermission"`
  was run while gating the invoice-cancel affordance. The full list:
  `finance/dashboard/page.tsx`, `finance/payroll/page.tsx`,
  `insights/page.tsx`, `settings/ai-usage/page.tsx`,
  `settings/notifications/page.tsx`, `settings/parent-summaries/page.tsx`,
  `components/admin/sidebar.tsx`, `components/staff/bvn-section.tsx`,
  `components/students/guardians-tab.tsx`, and `lib/finance/invoice-cancel.ts`.
  Still no behavioural divergence — all ten are the same two lines — but the
  entry's own trigger condition had fired five sites earlier than it said, and
  nobody noticed because the count was never re-derived.

  `lib/finance/invoice-cancel.ts`'s copy (added 2026-09-01) is the odd one
  out and the natural seed for the extraction: it is the only one that is
  **exported and unit-tested**, and the only one living in a pure module
  rather than inside a component. The other nine are unreachable by
  `apps/web`'s node-environment Vitest runner. When this is finally extracted,
  move that one rather than writing an eleventh.

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

- [x] **Single teacher invite via the UI needs a `roleKey` on `POST
  /users/invite`. FULLY RESOLVED 2026-07-31.** Slice 10 cp3's `/staff/invite`
  form was ADMIN-ONLY: `inviteAdminSchema` had no `roleKey` field and
  `UsersService.invite` hardcoded `roleKey: "admin"` (Phase 0).
  **PARTIALLY RESOLVED (Phase 3 slice 15 cp2):** `inviteAdminSchema` gained
  `roleKey: z.enum(["admin", "bursar"]).default("admin")` and a Role dropdown
  on `/staff/invite` — but the enum was deliberately **admin | bursar only**,
  on the stated assumption that extending it to `"teacher"` needed a staging
  mechanism first (a way to carry `staffNumber`/`specialty` across invite→
  accept, since `Invitation` has no columns for them).
  **That assumption turned out to be wrong when actually investigated.**
  Re-read `InvitationsService.accept()` (`apps/api/src/modules/invitations/
  invitations.service.ts`) directly: it resolves `roleKey` against ANY seeded
  system role by key and grants it — it never creates or touches
  `TeacherProfile` for any role, admin/bursar included. The bulk CSV import
  path (`commit-teachers.row.ts`) already proved this out for teachers
  specifically: it mints a plain `roleKey="teacher"` invitation with **no**
  TeacherProfile, and the admin creates that profile afterward via the
  existing `/staff/[userId]/edit` page (which gates profile-creation on the
  user already holding the `teacher` role, not on how they were created).
  So a single teacher invite needed zero new plumbing — just the same
  allow-list extension slice 15 already did for bursar.
  **Fixed:** `inviteAdminSchema`'s enum is now `["admin", "bursar",
  "teacher"]`; `UsersService.invite`'s defence-in-depth re-check updated to
  match; `/staff/invite`'s Role dropdown has a "Teacher" option (with a
  contextual note pointing at CSV import for bulk onboarding instead); the
  staff roster's CTA relabeled "Invite staff" (was "Invite admin") since it
  no longer implies admin-only. New tests added mirroring the existing
  bursar coverage: `users.service.spec.ts` ("roleKey: 'teacher' — creates a
  teacher invitation") and `users.controller.spec.ts` (`POST /users/invite`
  201 with `roleKey: "teacher"`). TeacherProfile capture remains a deliberate
  post-accept step, identical for both onboarding paths — not a gap.
  - Also unblocks slice 11 cp4's `inviteAndAcceptTeacher` fixture
    (`e2e/fixtures/teacher.ts` + `db.ts`), which seeded the `roleKey='teacher'`
    `Invitation` row directly via `withTenant` because no API minted one —
    swapping `seedTeacherInvitation` for the real endpoint is a fast-follow,
    not done in this pass (the fixture's accept+login half was already
    production-faithful either way, so this is a cleanliness win, not a
    correctness fix).

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
  Phase 4 or Phase 9 (auxiliary; renumbered from Phase 7 on
  2026-08-15). Discovered slice 11 cp3.

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
  Termii's sender-ID registration approval completes (**blocked on CAC
  registration — see "SMS is unshippable until CAC registration completes"
  at the end of this file for the full writeup; that is the authoritative
  entry, this parenthetical is just a pointer**), at which point the real
  end-to-end
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

- [x] **HIGH PRIORITY — `teacher` role is missing `grading-scheme.read`; no real teacher account can currently load the gradebook grid in production. FIXED 2026-07-28 (PR #126).** Found during the Phase 4 design-system restyle's mandatory live-verification pass (2026-07-28) — `GradebookGridPage` (`apps/web/src/app/(teacher)/teacher/gradebook/[armId]/[subjectId]/page.tsx:17,52`) unconditionally calls `getGradingScheme()`, which hits `GET /grading-scheme`, guarded by `@Permissions("grading-scheme.read")` (`apps/api/src/modules/grading/grading.controller.ts:57`). `PHASE_2_TEACHER_PERMISSIONS` (`packages/types/src/permissions.ts:419-432`) had no `grading-*` entry at all — every teacher hit a 403 the moment they opened any subject's gradebook.
  **Not a recent regression — a longstanding gap dating to the Phase 2 slice 9 RBAC rollup itself** (commit `53be149`, PR #55, 2026-06-10): `PHASE_2_TEACHER_PERMISSIONS` was authored at that commit and never included `grading-scheme.read`, `grading-component.read`, or `grade-boundary.read`. The Phase 4 restyle touched only markup/classes in `gradebook-grid.tsx` and the page wrapper — it did not introduce the bug, only surfaced it by being the first pass to actually drive the gradebook end-to-end as a real teacher.
  Confirmed by direct code read, not guessed: the controller's `@Permissions` decorator, the teacher permission array, and the frontend's unconditional call were all inspected directly (see `[[project_phase4_restyle]]`).
  Temporarily patched in the **dev DB only** (teacher role row's `permissions` array, via a throwaway script, not committed to any migration/seed/code) to unblock the live-verification pass — Arinzechukwu approved this specifically for that purpose. Confirmed clean at the time: no diff to `packages/types/src/permissions.ts`, no new/modified migration, no seed-data change in the working tree.
  **Fixed for real (PR #126, 2026-07-28)**: added `"grading-scheme.read"` to `PHASE_2_TEACHER_PERMISSIONS` (read-only — teachers do NOT get `.update`), shipped `20260728000000_teacher_grading_scheme_read_permission` backfilling the existing `teacher` system-role row (same idempotent full-literal-UPDATE pattern as the slice-9 rollup migration). `permissions-coverage.spec.ts`'s "teacher grants exactly the documented Phase 2 subset" assertion now covers this grant as deliberate and tested. Audited every other teacher-facing frontend call site (`apps/web/src/app/(teacher)/**`, `components/teacher/**`) against the teacher permission set at the same time — no other gap found; `grading-scheme.read` was the only one. Verified live against the real running dev API (not just tests): `GET /grading-scheme` → `200` for `dev-teacher` (previously 403), `PATCH /grading-scheme` still correctly `403` (read-only boundary holds), and the gradebook grid renders real student rows/scores in a live Playwright-driven browser session.

- [x] **Teacher portal mobile nav shows admin's nav items, not the teacher's own. FIXED 2026-07-28 (PR #127).** Found during the same Phase 4 restyle live-verification pass (2026-07-28). `TeacherLayout` (`apps/web/src/app/(teacher)/layout.tsx`) reused `AdminTopbar` (`apps/web/src/components/admin/topbar.tsx`), which renders `<MobileNav>`; `MobileNav`/`NavList` hardcoded `NAV_ITEMS`/`LATER_PHASE_ITEMS` from `components/admin/nav-items.ts` (admin-specific) rather than accepting the caller's own item list. A teacher on a narrow viewport saw Students/Staff/Finance/Settings in the hamburger drawer instead of their own Dashboard/Classes/Gradebook/Attendance/Profile.
  **A real regression, not a pre-existing gap — introduced by PR #120** (`feat(web): admin dashboard rebuild — design system, real KPIs, mobile nav`, commit `3cab59b`, 2026-07-26). `TeacherLayout` has used `AdminTopbar` since PR #29 (slice 11 cp3, well before this), but `AdminTopbar` had no mobile nav at all before #120 — its own commit message says so explicitly ("the sidebar previously had no equivalent below the md breakpoint at all"). #120 added `<MobileNav>` to `AdminTopbar` for the admin dashboard rebuild without adding a props path for `TeacherLayout`'s distinct nav list, so every consumer of `AdminTopbar` — including the teacher portal, a pre-existing consumer it didn't intend to change — silently inherited admin's hamburger menu two days before this gap was noticed.
  **Fixed (PR #127, 2026-07-28)**: `NavList`/`MobileNav`/`AdminTopbar` now accept optional `items`/`laterPhaseItems` props, defaulting to the admin list so the `(admin)` layout's `<AdminTopbar />` call site is unchanged. Extracted `TeacherSidebar`'s item computation (including the async `subjectAttendanceEnabled` fetch) into a shared `useTeacherNavItems()` hook, and added `TeacherTopbar` (`components/teacher/topbar.tsx`) — a thin client wrapper supplying the teacher's own items to `AdminTopbar` — for `TeacherLayout` to render instead of `AdminTopbar` directly. Verified live in a real browser (Playwright, 375px viewport, real cookie-based sessions): the admin mobile drawer still shows every admin item plus "Later phases" unchanged; the teacher mobile drawer now shows exactly Dashboard/Classes/Gradebook/Attendance/Profile with no admin items and no "Later phases" section.

## Future feature ideas — captured 2026-07-31, long-range roadmap (not scoped)

Arinzechukwu's longer-range feature wishlist, captured pre-launch (Saturday
2026-08-01 deadline) as a pure backlog dump — **none of these have been
scoped, investigated, or estimated.** This is intentionally just a list so
the ideas aren't lost; do not start building any of them off this entry
alone. Cross-references to `docs/ARCHITECTURE.md` are given where a phase
already sketches the feature, so a future plan-first has a starting point,
not a commitment to that phase's exact shape or timing.

- [ ] Lesson notes and lesson plans — ARCHITECTURE.md §6.5 (Academic
  management, Phase 2 per §9) already names both explicitly ("Weekly lesson
  plans with learning objectives," "Lesson notes (delivered content)"), plus
  an AI hook in §7 ("generate lesson plan from a topic").
  **Partly built as of Phase 5 / Slice 2 (2026-08-12)** — §7's AI hook
  shipped: `POST /lesson-plans` generates the five sections from a free-text
  topic, plus `/teacher/lesson-plans` for generate/edit/quiz/print. What
  remains of this entry is the rest of §6.5, none of which Slice 2 touched:
  **lesson notes (delivered content)** as a distinct entity, and the
  **weekly/scheme-of-work** framing — a Slice 2 plan is a standalone
  one-off keyed to a free-text topic, with no week, no sequence, and no
  curriculum taxonomy behind it (D13). Whether those become a Phase 2
  academic feature or an extension of `lesson_plans` is still unscoped, so
  this stays on the wishlist rather than being ticked.

- [ ] Student profiles (badges, achievements, milestones) — not named
  anywhere in ARCHITECTURE.md. Closest existing concepts are the plain
  `Student` profile (§5, §6.3) and the merit/demerit point system under
  Behaviour (§6.15, Phase 9 per §9 — renumbered from Phase 7 on 2026-08-15) — but gamification (badges/milestones)
  is a distinct product idea from either, not a documented feature. Needs
  its own decision on scope before it maps to a phase.

- [ ] Timetable generator — ARCHITECTURE.md §6.5 lists a "Visual timetable
  builder with conflict detection" under Academic management, but this
  file's own "Roadmap / strategy" section (above) separately lists
  "Timetable, transport, library, hostel — Phase 9." The two docs disagree
  on which phase owns it — flagging the discrepancy here rather than
  resolving it; whoever scopes this should reconcile §6.5 vs. the Phase 9
  roadmap note first.

- [ ] Clinic/health records — ARCHITECTURE.md §6.14 (Health records) is
  fully specified conceptually (medical profile, sickbay log, medication/
  vaccination tracking, auto-alert on sickbay visit) and named under Phase
  7 ("auxiliary modules — rolling, ship as schools ask") in §9. Nothing
  built yet.

- [ ] Inventory management — not named anywhere in ARCHITECTURE.md. Net-new
  idea, no existing phase or module maps to it.

- [ ] AI-assisted result compilation — ARCHITECTURE.md §6.7 (Assessment and
  grading) and §7's "Report card comment generator" AI hook cover adjacent
  ground (report-card comments, at-risk flagging), but "compiling results"
  specifically (aggregating scores into a finished report card via AI) isn't
  spelled out as its own capability. Phase 5 (AI layer) is the natural home
  per §9. Reminder per CLAUDE.md's AI hard rules: any such feature needs a
  teacher-approval gate before finalizing — never auto-final on grades.

- [ ] Homework and assignments — ARCHITECTURE.md §6.8 (Assignments and
  homework) is fully specified (creation, submission incl. file/photo
  upload, auto-grading for MCQ, AI-assisted essay grading with teacher
  approval, plagiarism flag). §9's original "Phase 6 — assignments and
  student portal" was split on 2026-08-15: the student-portal half is now
  Phase 6 (which builds the student principal assignments depend on), and
  assignments themselves are **Phase 8**. Nothing built yet.

- [ ] Exam management, including AI-generated exam questions — overlaps two
  existing docs: ARCHITECTURE.md §6.7 (Assessment and grading, Phase 2) for
  the exam-recording side, and §7's "Quiz mode: generates MCQ + short-answer
  questions with mark scheme" (Phase 5 AI layer) for the generation side.
  Also adjacent to (but distinct from) this file's own still-undecided
  "CBT / online exams (JAMB/WAEC/UTME prep)" roadmap item under "Roadmap /
  strategy — REVISIT with live market research" (above) — that item is
  about full online exam-taking/proctoring, this ask is narrower (AI-
  generated question banks for a school's own exams). Worth reconciling
  scope with that item when this is picked up, not building in parallel.

- [ ] Digital ID cards — not named anywhere in ARCHITECTURE.md. Net-new
  idea; would likely need a print-layout/PDF-render capability similar to
  report cards' (`RenderService`) but no existing module claims it.

- [ ] Result checker (likely a public/parent-facing lookup, no login) —
  adjacent to but distinct from ARCHITECTURE.md §6.18 Parent portal's
  "Child dashboard" (which is authenticated). A public lookup-by-reference-
  number flow (WAEC-checker-style) isn't specified anywhere and raises its
  own auth/tenancy questions (how does an unauthenticated lookup stay
  scoped to the right school, what proves the requester is entitled to see
  that result) — flag for a real plan-first, not a quick add, given
  CLAUDE.md's multi-tenancy and PII hard rules.

- [ ] AI study assistant — ARCHITECTURE.md §7's "Student tutor" is the
  matching spec (curriculum-grounded via RAG/pgvector, conversation history
  in `TutorSession`, daily message cap, "exam practice" mode). `TutorSession`
  is already named in the Phase 1 data model (§5) as AI-owned/Phase-5-shaped
  per the `AIInteractionLog`/`AIGeneration` precedent elsewhere in this file
  — Phase 5 (AI layer) per §9. Nothing built yet.

- [ ] Internal messaging — **do not duplicate; this is already tracked.**
  Same feature as Phase 4 Slice 7 (in-app messaging), confirmed deferred at
  Slice 8's plan-first (`docs/modules/phase-4.md` §2, "Slice 7 deferred,
  confirmed at Slice 8's plan-first (2026-07-19)") and carried in this
  file's own Roadmap section implicitly via ARCHITECTURE.md §6.9
  (Communication). See that phase-4.md note for why it was deliberately
  deferred (framed as "last and lowest-priority," zero prior art). This
  entry exists only as a pointer so the wishlist capture doesn't fork a
  second, disconnected tracking spot for the same ask.

- [ ] WhatsApp integration — **do not duplicate; this is already tracked.**
  Same item as the still-open WhatsApp deferral: `docs/modules/phase-4.md`
  §4 item 3 and §8 D1 ("Channel scope: email + SMS only, no WhatsApp, no
  push... WhatsApp Business API approval is an external, non-controllable
  dependency"), and ARCHITECTURE.md's own open question #5 ("WhatsApp vs
  SMS primacy"). Revisit trigger already documented there: once/if WhatsApp
  Business API approval lands. This entry is a pointer, not a new item.

- [ ] Event calendar — ARCHITECTURE.md §6.16 (Events and calendar) is
  specified (term calendar with holidays/breaks, events, parent RSVP, push
  reminders) and falls under Phase 9 ("auxiliary modules — rolling"; renumbered from
  Phase 7 on 2026-08-15) per
  §9. Nothing built yet.

- [ ] **Possible navigation race on `/dashboard`: clicking a sidebar link
  very shortly after landing on the dashboard can silently cancel that
  navigation and revert to `/dashboard?termId=...` instead.** Found
  2026-07-31 while testing the new `NavigationProgress` global loading
  indicator (`components/navigation-progress.tsx`) — reproduced
  independently of that new component, so it's a pre-existing behavior, not
  something introduced by it: a bare `<Link>` click to `/students` fired
  immediately after `waitForURL(/\/dashboard/)` landed back on
  `/dashboard?termId=...` instead, with zero interception or throttling
  involved. Root cause (not fully confirmed, inferred from the dashboard's
  own code): `apps/web/src/app/(admin)/dashboard/page.tsx`'s comment at line
  88 says "The term selector lives in the topbar and writes `?termId=` once
  it resolves the school's current term" — an async effect that calls
  `router.replace()` shortly after the dashboard mounts. If a user clicks
  away before that resolves, the two navigation intents can race, and the
  replace appears to win, reverting the in-flight navigation. Waiting
  ~1.5s after landing on the dashboard before clicking away reliably avoided
  it in testing — suggesting this is a narrow window (most real users don't
  click within a second of a fresh page load) rather than a constant
  problem, but it's real and worth a proper fix rather than staying
  anecdotal. Trigger: a user report of "I clicked X and it took me back to
  the dashboard instead," or a dedicated session on dashboard navigation
  correctness. Candidate fix: the term-selector's `router.replace()` should
  probably be a no-op (or at least not clobber an already-in-flight
  navigation) if the pathname has already changed away from `/dashboard` by
  the time it resolves.

## AI & advanced feature wishlist — captured 2026-07-31, tiered (not scoped)

Arinzechukwu's longer-range AI/advanced-feature wishlist, separate from the
"Future feature ideas" list above — captured the same day, same rule
applies: **none of these are scoped, investigated, or committed to a phase.**
Grouped into the three tiers he assessed them at, not by build order.

### Strong candidates — natural fit with existing AI-architecture plans

- [ ] AI Principal Dashboard — plain-English questions over school data.
  Adjacent to ARCHITECTURE.md §7's "Insights for admins" ("Which classes
  are underperforming this term?", "Which students are at risk of
  failing?") but broader in scope (open-ended Q&A vs. two fixed pre-
  computed queries) — Phase 5 territory, needs its own plan-first for the
  query-generation/guardrails approach before it maps onto that section.

- [ ] Voice-to-report-card comments — adjacent to §7's "Report card comment
  generator" (currently spec'd as score/attendance/behaviour → text). Adds
  a voice-input capture step ahead of that same generation pipeline;
  doesn't change the generator itself, just how the teacher's raw input
  arrives. Same teacher-approval-gate hard rule applies regardless.

- [ ] Predictive fee collection analysis — direct match for §7's "Insights
  for admins" AI hook: "predict which families are likely to default based
  on payment history" (§6.10 Finance's own AI-hooks line). Already named,
  not yet built.

- [ ] School reputation dashboard / benchmarking against similar schools —
  not named anywhere in ARCHITECTURE.md. Cross-school benchmarking implies
  aggregating data ACROSS tenants for comparison, which is a real tension
  with this project's core multi-tenancy/RLS model (CLAUDE.md: "never
  expose any ID from one school to a user from another") — needs a
  specific anonymization/aggregation design before scoping, not a
  straightforward per-school query.

- [ ] Parent satisfaction surveys with AI analysis — adjacent to §6.18
  Parent portal and §7's sentiment-adjacent AI hooks, but surveys
  themselves aren't named anywhere yet. New data model (survey + response)
  needed regardless of the AI-analysis layer on top.

- [ ] Smart timetable optimization — extends the **already-logged**
  "Timetable generator" item in the "Future feature ideas" section above
  (this same file) — see that entry for the existing §6.5-vs-Phase-7
  discrepancy between ARCHITECTURE.md and this file's own roadmap section,
  which needs resolving before either the base generator or this AI-
  optimization layer on top of it gets scoped. Not a duplicate entry —
  cross-referenced.

- [ ] Offline-first architecture — flagged by Arinzechukwu as **core
  infrastructure for the Nigerian context specifically, not a nice-to-have
  feature.** ARCHITECTURE.md §11 open question #4 ("Offline strategy depth
  — full offline-first sync (CRDTs, complex) vs basic offline cache for
  reads only") already names this as an unresolved architectural question,
  not a feature request — this wishlist entry reinforces that it should be
  weighted as such when §11 is finally resolved, not deprioritized as a
  bolt-on. No phase currently owns it.

- [ ] Multi-language support — **do not duplicate; already named in
  ARCHITECTURE.md's Phase 5 scope.** §6.9 Communication's AI hooks ("translate
  teacher messages into Yoruba, Igbo, Hausa, or Nigerian Pidgin") and §7's
  Parent progress summary ("Translation to Yoruba, Igbo, Hausa, or Nigerian
  Pidgin on request") both already specify this under Phase 5. This entry
  is a pointer, not a new item.

### Worth including, with real caveats

- [ ] Voice attendance — **verify it's actually faster/better than manual
  marking before assuming value.** ARCHITECTURE.md §6.6 already specs
  "mobile-first marking (teacher taps through class register)" as the
  baseline UX; voice would need to beat that on real classroom speed/
  accuracy (background noise, accents, a moving line of students), not
  just sound futuristic. Prototype-and-measure before scoping as a real
  feature.

- [ ] AI phone assistant for parents — **flag as expensive: telephony
  infrastructure + ongoing per-call cost, not a one-time build.** Needs its
  own cost-modeled scoping (call volume estimate × per-minute rate, plus
  whichever telephony/voice-AI vendor) before it's bundled casually
  alongside the other AI hooks in §7, none of which carry a comparable
  ongoing per-interaction infrastructure cost.

- [ ] Face recognition attendance — **flag explicitly: this is biometric
  data collection on children.** Needs a real NDPR consent/safety review
  before any scoping work, not just a feature-build discussion — CLAUDE.md's
  existing hard rules on student PII (never send full name/DOB/contact info
  to the LLM, redact PII in logs) are calibrated for text/contact data, not
  biometric capture, and don't automatically cover this case. Do not treat
  as a normal attendance-method option until that review happens.

- [ ] Live classroom observation records — **needs real definition before
  it's a scoped feature.** Unanswered as of this capture: what's actually
  recorded (video? audio? structured notes?), by whom (peer teacher?
  admin? automated?), stored where and for how long, and who can access it
  later. Not adjacent to any existing ARCHITECTURE.md section — closest is
  §6.4 Staff management's "performance tracking (peer reviews, aggregated
  parent feedback)," which is explicitly NOT the same thing (no recording
  implied there). Do not scope further without answering the above.

- [ ] AI discipline monitoring — **flagged as vague; concerns children —
  do not scope further without clarity on what "monitoring" actually
  means.** §6.15 Behaviour and discipline already specs a concrete,
  narrow feature (merit/demerit points, incident logging, a warning→
  suspension→expulsion workflow) with no AI or monitoring component. This
  wishlist item as stated could mean anything from "AI-summarize existing
  incident logs" (low-risk, adjacent to §6.15) to "proactively surveil
  student behavior" (a fundamentally different, much higher-risk category
  needing its own ethics/consent/NDPR treatment, similar in kind to the
  face-recognition item above). Get a concrete definition from Arinzechukwu
  before this is anything more than a name on a list.

### Business/structural — not really AI features, track separately from the AI roadmap

- [ ] Franchise school management — not named anywhere in ARCHITECTURE.md.
  Business-model feature (managing a chain/franchise of schools under one
  operator), not an AI capability — belongs on a separate business-roadmap
  track from the Phase 5 AI-layer list above, whenever that track exists.

- [ ] Alumni networking platform — not named anywhere in ARCHITECTURE.md.
  Same category as franchise management: a real product idea, but
  structurally a different kind of feature (community/social, not
  academic/AI) — track separately, not folded into the AI roadmap.

- [ ] Multi-campus management — **do not duplicate; already tracked.**
  CLAUDE.md's "Groups API shape — the single-school-now/multi-campus-later
  pattern" section documents the existing `Branch` model (full CRUD, RLS,
  permissions since Phase 0) and the `{ groupId, label, ... }[]` dashboard
  shape already built to re-key onto `Branch.id` with zero frontend
  contract change once multi-campus ships. This entry is a pointer, not a
  new item.

---

## Pre-Phase-5 readiness sweep — captured 2026-08-09

Findings from the pre-Phase-5 cleanup/readiness investigation. The actioned
part of that sweep (packages/ai ESM fix, production env-var gaps, smoke-school
cleanup, doc corrections, the early-access flag, this file's new sections) is
not repeated here; what follows is the part deliberately logged rather than
built, plus the open decisions the actioned work is buying time on.

### Pricing / tier enforcement — flag shipped, every decision still open

`School.earlyAccessGrantedAt` (nullable timestamp, migration
`20260809000000_add_school_early_access_granted_at`) shipped 2026-08-09,
settable from the super-admin school list via
`PATCH /platform-admin/schools/:id/early-access`. **It is a marker and
nothing more — no code anywhere reads it to make a decision.**

Why it exists: before it, the platform had *no* mechanism distinguishing an
early-access school from a later signup. Confirmed by grep — zero product
code for `subscription|billing|pricing|tier|plan`; `SchoolStatus` is
`ONBOARDING|ACTIVE|SUSPENDED|ARCHIVED` (lifecycle, not commercial); the only
available discriminator was `created_at`. That is inadequate on three counts:
it forces grandfathering to be purely temporal (cannot honour "I promised this
school free access on a call" for a school signing up next month); it cannot
separate a genuine pilot from a smoke-test artifact or a provisioning test;
and it cannot distinguish "early and still active" from "early and churned".
Adding the column costs ~30 minutes now and becomes a per-row judgement call
later, after schools have onboarded — hence doing it before more schools
arrive rather than after.

Note the tension this is a placeholder for: the Paystack integration takes a
**0% platform cut** (100% of every transaction routes to the school's own
subaccount — see `School.paystackSubaccountCode`'s schema comment), so
SchoolKit's revenue is subscription-only. The revenue model the business
depends on has no schema representation beyond this one flag.

Still undecided, all of it:

- [ ] Tier shape — per-student vs flat, and how many tiers. Named in
  CLAUDE.md's own "Things this file does not cover yet" list since Phase 0.
- [ ] What early-access actually *grants* — free forever, free for N months,
  a discount, or a feature ceiling. The flag deliberately does not encode
  this; it only records who qualifies.
- [ ] Enforcement points — what a school past its tier limit actually
  experiences (soft warning, blocked writes, read-only, nothing). Touches
  every module, so it needs its own plan-first, not a rider on a feature PR.
- [ ] Whether `earlyAccessGrantedAt` should be backfilled for the schools
  that exist when tiers ship, or left to manual marking. The migration
  deliberately does NOT backfill — see its header for why.
- [ ] Re-stamping behaviour: setting `true` on an already-marked school
  overwrites the original timestamp rather than preserving it. Deliberate
  (hiding operator mistakes is worse, and the audit log records every
  transition) but worth revisiting if the original date ever becomes
  contractually meaningful.

Trigger: whenever paid tiers move from idea to decision. Do NOT build
enforcement off the flag alone without settling the four items above.

### Platform super-admin — expansion scope

Promoted into this file 2026-08-09. Until then this scope existed **only in
Claude Code's session memory** — `docs/deferred.md` had zero hits for
`super-admin`, `platform admin`, or `impersonat`, so the repo itself carried
no record of it at all.

What exists today (do not re-scope these): the read-only cross-tenant surface
(PR #142, 2026-08-02 — schools + staff roster, names/signup dates/status/
basic counts only) and school provisioning (PR #149, 2026-08-07 —
`POST /platform-admin/schools`), plus the early-access toggle above. Gating
is `User.isPlatformAdmin`, granted only by direct DB `UPDATE`, re-read live
from the DB by `PlatformAdminGuard` on every request.

Future workstreams, none scoped or estimated:

- [ ] **School lifecycle management** — suspend, reactivate, archive, and
  hard-delete a school from the super-admin surface. Note there is still no
  `DELETE /schools/:id` anywhere in the API (the gap that made smoke-school
  cleanup a SQL script rather than an API call). `SchoolStatus` already has
  `SUSPENDED`/`ARCHIVED` values that nothing currently transitions to.
- [ ] **Billing management** — depends entirely on the pricing decisions
  above; there is nothing to manage until tiers exist.
- [ ] **User management** — today `listUsers` is read-only and deliberately
  omits `is_platform_admin` so the surface cannot enumerate who else holds
  access. Two known gaps already flagged in migration headers: no
  platform-admin *deactivation* flow, and no resend/revoke for a pending
  owner invitation (an explicit scope cut in PR #149).
- [ ] **Platform analytics** — cross-tenant aggregates (signups over time,
  activation funnel, feature adoption). Note the tension already documented
  for the "school reputation dashboard / benchmarking" wishlist item:
  anything aggregating across tenants needs a deliberate anonymization
  design, not just a query.
- [ ] **Impersonation ("act as this school")** — **a decision, not a
  feature.** Currently exists nowhere: not built, not decided, not written
  down until this entry. It lets a platform admin read (and potentially
  write) a specific school's real data including student PII, which puts it
  squarely against CLAUDE.md's multi-tenancy hard rules and carries real NDPR
  weight. `platform-admin-dashboard.tsx`'s own header comment already warns
  that no "act as this school" affordance should be added without growing the
  underlying SECURITY DEFINER functions, "which is the actual enforcement
  point, not this UI". Minimum before any build: decide whether it is
  read-only or read-write, whether the impersonated school is notified, what
  the audit trail looks like, and whether consent is required.

### CBT / online exams — capability assessment (2026-08-09)

Written up in response to a direct question from a lead. Expands the one-line
"CBT / online exams (JAMB/WAEC/UTME prep)" entry under "Roadmap / strategy"
above, which stays as the market-research placeholder. **No build, no
commitment — this is the honest assessment so the next person does not have to
re-derive it.**

**Ask the lead which CBT they mean before quoting anything.** The two are
conflated everywhere and differ by an order of magnitude:

- **(a) Exam-prep CBT** (JAMB/WAEC/UTME practice) — what competitors lead
  with. **Content-acquisition-bound, not engineering-bound**: the hard problem
  is who authors or licenses 10,000+ past questions with mark schemes, and
  under what rights (see CLAUDE.md's open "Curriculum content licensing"
  item). The engineering is a subset of (b).
- **(b) The school's own exams, delivered online** — the school authors its
  own questions, students sit them in the lab, results flow into the existing
  gradebook. Straight engineering.

Most Nigerian private-school leads asking "do you have CBT?" mean (a).

**What exists and genuinely helps** — the *results* half is strong and
shipped: `GradingScheme`/`GradingComponent` (per-school CA/exam weights
summing to exactly 100), `GradeBoundary` (WAEC nine-point scale, seeded),
`AssessmentScore` (raw marks, score within [0, component.weight]),
`Assessment` (materialized per-student/subject/term rollup plus positions),
the gradebook grid, the sign-off → form-review → approve → release workflow,
and BullMQ/R2 PDF rendering.

**Be precise about what that is: a system for recording and processing marks
that already exist.** It has no concept of a question and no concept of a
student *doing* anything. The model named `Assessment` is a term rollup, not
a test — that name will mislead anyone skimming the schema.

The gap:

1. **Student identity and auth — the largest blocker, and it is not an exam
   feature.** No `Student.passwordHash`, no `StudentSession`, no student auth
   SD function, no student-facing app (`apps/mobile` is a two-file Expo
   stub). Guardians got a full portal in Phase 4; students got nothing.
   Building it is essentially a re-run of Phase 4 / Slice 2, plus a wrinkle
   that slice did not have: these are minors, so credential issuance, reset
   and recovery cannot assume a private email inbox.
2. Student-facing exam surface, built for shared lab machines and low-end
   tablets rather than the admin shell.
3. Question bank — `Question`, `QuestionOption`, subject/level/topic/
   difficulty tagging, media, and **versioning (a question that has been
   answered can never be mutated in place)**. The authoring UI is the real
   adoption risk, not the schema: no teacher will type 500 questions into a
   web form, so bulk import and/or AI generation is what makes it usable —
   and AI generation is Phase 5 with a mandatory teacher-approval gate.
4. Exam definition — sections, fixed-set vs randomized-pool selection,
   per-question marks, duration, availability window, shuffle, attempts.
5. Delivery runtime — `ExamAttempt`/`ExamResponse`, a **server-authoritative**
   timer (never the client clock), per-answer autosave, and correct resume
   after a tab close, browser crash or power cut. Looks trivial in a demo;
   this is where real implementations bleed.
6. Auto-grading — trivial for MCQ/true-false, real work for short-answer;
   essay is Phase 5 plus the approval gate.
7. Grade integration — the one place existing infra pays off, and mostly
   easy. One catch: `AssessmentScore.score` is capped at `component.weight`
   (already-weighted units), so an exam marked out of 100 needs explicit
   scaling plus a teacher-approval step before it lands.
8. **Anti-cheating — set expectations honestly.** Achievable in-browser:
   per-student randomized question/option order, one question at a time,
   tab-blur logging, copy/paste suppression, server-side timing, device/IP
   logging. All **deterrent, not prevention**. Real proctoring (lockdown
   browser, webcam, screen recording) is a different product and, for
   children, lands in the same biometric/NDPR territory already flagged for
   the face-recognition attendance wishlist item — a consent/safety review,
   not just a build.
9. **Infrastructure — the most under-appreciated item.** Every request the
   platform serves today is low-concurrency admin/teacher CRUD. A live exam
   is 40-200 students hitting the API simultaneously for 45 minutes with
   continuous autosave writes. Current measured production reality (see the
   Neon latency entries above): autosuspend still live, ~2s authenticated
   request latency, one real Postgres transaction per request via
   `withTenant()`, a single Fly machine, and a retry-once band-aid added
   2026-08-03 because connections were dying under *ordinary* load. **An exam
   session would be the first genuine load event this platform has ever seen,
   and the honest expectation is that it fails.** CBT therefore drags in a
   connection-pooling / Neon-plan / scaling workstream that must be scoped
   separately — plus Nigerian power and connectivity reality, which reopens
   ARCHITECTURE.md §11 open question #4 (offline strategy depth).

Estimate, calibrated against this repo's own history (Phase 4 was ~6 slices,
Phase 2 ~8):

| Scope | Estimate |
|---|---|
| Demo only (one subject, MCQ, fake student login, no persistence guarantees) | ~1 week |
| Minimum credible CBT (MCQ + true/false, teacher-authored bank, timed exam, auto-score, results into gradebook, basic deterrents, no proctoring, no offline) | **6-9 slices, roughly 4-8 weeks** |
| Infra hardening plus a real load test before any school runs a live exam | **+1-2 weeks, not optional** |
| Exam-prep content product, option (a) | engineering is a subset of the above; **content licensing is the actual project**, unestimated |

Positioning for a lead: the full loop from marks → WAEC-scale grading →
positions → signed-off report cards → PDFs is built and working, and that is
the differentiator today. Online exam delivery is roadmap, not started. If
CBT is a hard requirement for a given school, it is a 1-2 month build, not a
next-sprint item.

Related existing entries, do not fork new ones: "Exam management, including
AI-generated exam questions" and "Result checker" under "Future feature
ideas"; "CBT / online exams (JAMB/WAEC/UTME prep)" under "Roadmap /
strategy". The sidebar already shows **Assessments & Exams** and **Result
Checker** as greyed-out "Coming soon" items, so a lead who has seen a demo has
seen those.

### Bulk student add — ranked follow-ups

The highest-leverage fix (**a class-arm column on the student CSV import,
creating the `Enrollment` alongside the `Student` in the same per-row
transaction**) is approved and tracked separately — it is NOT in this list.
What follows is everything deliberately not built.

Context on what is actually slow, so this is not re-investigated:

- `/students/new/bulk` submits a **sequential loop of individual
  `POST /students` calls**, one HTTP round-trip per student, awaited one at a
  time. Sequential is deliberate (`bulk-student-form.tsx`, lines 44-50) — it
  makes within-batch duplicate admission numbers reject correctly for free.
  At production's ~1-2s per authenticated request, 100 students is 2-4
  minutes of a browser tab that must stay open.
- All grid state is in React memory. A refresh, crash or accidental
  navigation loses every not-yet-created row.
- CSV import is the architecturally sound path (BullMQ worker, bad-rows CSV,
  10k-row / 5 MB caps that are nowhere near binding). Its commit loop runs one
  `withTenant()` transaction per row sequentially — the ~10ms/row estimate in
  `commit.handler.ts` was measured against local Docker Postgres and is
  realistically 50-200ms against Neon, but it is a background job, so this is
  the least broken path.

Ranked, highest value-per-effort first:

- [ ] **Paste-from-Excel into the bulk grid.** A paste handler splitting on
  tabs/newlines to populate rows. Cheap, and removes both the "click Add row
  97 times" problem (the grid starts at 3 rows) and most of the typing.
  Someone adding 100 students already has them in a spreadsheet.
- [ ] **Bounded-parallel submission in the grid.** `mapWithConcurrency`
  already exists (`apps/web/src/lib/concurrency.ts`, written after the
  2026-08-04 Matrix-page incident) and is already used by
  `/enrollments/bulk`. Concurrency 4-6 is a roughly 4-6x wall-clock win.
  **Caveat: it forfeits the free within-batch duplicate handling the
  sequential loop buys**, so it needs a client-side cross-row duplicate check
  first. Not a one-line change.
- [ ] **A real `POST /students/bulk` endpoint** — one request, one
  transaction, `createMany`. Biggest raw win (100 round-trips down to 1),
  most work: new DTO, new service path, and per-row error reporting so
  partial failures stay actionable.
- [ ] **Draft persistence for the grid** (sessionStorage, keyed the way
  `lib/imports/session.ts` already does it). Does not make anything faster;
  removes the catastrophic-loss failure mode.

Trigger: the first school onboarding with 100+ students, or the first admin
complaint about the grid.

### Known debt, acknowledged not actioned (2026-08-09)

- [ ] **SECURITY DEFINER table-shape review is overdue by 8 functions.** The
  "+3" cadence trigger set at the Phase 3 / Slice 12 audit came due at 8; the
  count is now **16**, and CLAUDE.md's own inventory notes it as due-not-done
  at 12, 15 and 16. Nothing is broken — `security-definer-inventory.spec.ts`
  is a mechanical conformance gate that still passes on every CI run — but the
  *human* shape review keeps sliding. `auth_lookup_guardians_for_login` is the
  specific outlier waiting on it: the only multi-row function in the table, an
  explicitly interim strategy pending a real fix (e.g. a school selector in
  portal login). Note the 2026-08-09 early-access work changed
  `platform_admin_list_schools()`'s return shape again but added no new
  function, so the count stays at 16. Trigger: schedule it as its own session;
  it will not happen as a rider on a feature PR, which is precisely why it has
  slipped four times.
- [ ] **`docs/journal/` stops at 2026-07-24.** Unjournaled since: the platform
  super-admin surface (2026-08-02), school provisioning (2026-08-07), the
  onboarding-nudge email (2026-08-08), the admin dashboard restyle, and this
  sweep. Given how much of this project's real decision history lives in the
  journal rather than in commit messages, this is a growing hole in exactly
  the record needed to pick Phase 5 up cold.
- [ ] **`packages/ui` still points `main`/`types`/`exports` at `src/`** — the
  same shape as the `packages/ai` violation fixed 2026-08-09, deliberately
  left alone. It is consumed only by the two Next apps, which list it in
  `transpilePackages` and bundle it from source, so it never reaches Node's
  own resolver and the ESM rule's rationale does not apply. Revisit only if
  something outside Next (the API, a script, a worker) ever imports it.
- [ ] **`RESERVED_SLUGS` is exact-match only, with no prefix reservation.**
  Surfaced 2026-08-09 while automating smoke-school cleanup: a real school
  could register `smoke-academy` and, under the old `LIKE 'smoke-%'` prune
  predicate, have been silently deleted with all its data. Closed for that
  specific case by tightening the prune predicate (slug matching
  `^smoke-[0-9]+$` AND an owner email at the RFC-2606-reserved
  `@smoke-test.invalid` domain), not by changing slug validation. The general
  gap remains: no prefix is reserved, so any future "system-owned slug
  pattern" carries the same hazard. Trigger: before introducing any other
  reserved slug *pattern*.

### SMS is unshippable until CAC registration completes — external blocker

**This is a genuine external dependency with no engineering workaround. Do
not re-investigate it as a config or code problem.** Logged 2026-08-09 after
the pre-Phase-5 sweep flagged the missing production env vars and Arinzechukwu
identified the actual cause.

**The blocker:** Termii requires a registered business to approve a sender ID
(the alphanumeric "from" name on a transactional SMS). That approval is
gated on **CAC registration**, which is not yet complete. Until it is, there
is no approved sender ID, so there is no usable Termii account, so
`TERMII_API_KEY` / `TERMII_SENDER_ID` / `TERMII_BASE_URL` cannot be set to
real values. Nothing in this repo can move that forward.

**Current production state (confirmed 2026-08-09 via `flyctl secrets list -a
school-kit-api`):** none of the three `TERMII_*` vars is set. The app is
unaffected — see the impact analysis below.

**Impact: none, by construction.** Verified at every call site rather than
assumed:
- `TermiiService`'s constructor logs a warning when the key is absent and
  sets `apiKey = ""`. **It does not throw**, so the API boots normally.
- `NotificationPreference.smsEnabled` defaults to **`false`** (schema
  default AND `NotificationPreferencesService`'s own `DEFAULTS` constant, so
  a school with no preference row is also `false`). Every SMS path is gated
  on it.
- `FinanceService.sendReminders` computes
  `smsAttemptable = channels.sms && this.termii.isConfigured` and skips with
  a log line — it never even attempts a send.
- `GuardiansService.deliverInvitation` gates on `smsEnabled`, and its
  `sendSms` call is inside a `try/catch` that logs a warning. A failure
  never propagates: the invitation is already committed and the **email
  still sends**.

So: with SMS off (the default for every school), nothing is reachable. If a
school turns it on before CAC clears, sends fail silently into the logs —
which is why the onboarding guide was corrected in the same commit to say
text messages aren't live yet, rather than inviting admins to enable a
toggle that does nothing.

**What unblocks this**, in order: CAC registration completes → Termii sender
ID submitted and approved → confirm the account's real `TERMII_BASE_URL`
(it is **per-account**, dashboard-assigned, NOT the documented
`https://api.ng.termii.com` default — see CLAUDE.md's env var section and
`docs/modules/phase-4.md` §8 D6) → `flyctl secrets set` all three →
end-to-end send test → revert the guide's "not live yet" wording.

**Related, do not duplicate:** the Gate-3 live-confirmatory-test item above
already references this blocker in passing ("Termii's sender-ID registration
approval completes (separately blocked on Arinzechukwu's business
documents)") — that parenthetical is the same dependency, named vaguely and
buried inside an unrelated item, which is why this entry exists. That gate
becomes moot rather than merely satisfied once SMS is live.

---

## Phase 6 / Slice 3 — student portal follow-ups (opened 2026-08-16, PR #181)

Both of these were raised, argued and decided during the slice-3 review;
neither blocked the merge. They are recorded here rather than in the PR
body so they survive the merge being squashed.

### Login lockout for the student portal — approved, NOT yet built

`POST /student-portal/login` currently ships behind the ordinary per-IP
throttle (5/min) and nothing else. Approved shape, per-`(school_id,
admission_number)` in Redis:

| Failures in window | Response |
|---|---|
| 1–5 | Normal, no delay |
| 6–10 | `429` with `Retry-After`, escalating 5s → 15s → 30s → 60s → 120s |
| 11+ | Hard lock, **15 minutes**, sliding on further attempts |

Window 30 minutes; counter cleared on any successful login; key
`student-login-fail:{schoolId}:{admissionNumber}`.

**Two constraints that matter as much as the numbers, and are easy to get
wrong:**

1. **The counter must increment for admission numbers that do NOT exist.**
   If it only counts against real students, the throttle becomes the
   enumeration oracle that the uniform `INVALID_CREDENTIALS` response and
   the dummy-argon2-verify path exist to prevent — an attacker learns a
   valid admission number by observing which ones begin rate-limiting. Key
   on the supplied string, never on a resolved student row.
2. **The lock must NOT extend to invitation-accept.** Admission numbers are
   sequential and school slugs are public, so a script can lock a whole
   cohort. Leaving the accept path open means a locked-out child's
   guardian can issue a fresh single-use invite and restore access
   immediately, bounding the denial of service at "15 minutes, or less if
   the parent acts". The accept path carries its own single-use token, so
   this is not a bypass.

The residual DoS is real and accepted: ~11 requests per student is enough
to degrade a cohort's logins for 15 minutes. This is why the lock is
sliding-but-temporary and why 15 minutes should not be raised.

### `WITHDRAWN` / `GRADUATED` students lose access to their own records — **DECIDED and FIXED 2026-08-16**

**Outcome: keep vs obtain are now two different questions with two different
answers.** `WITHDRAWN` and `GRADUATED` students keep signing in to an account
they already have, and may NOT accept a fresh invitation to create a first
one. `SUSPENDED` and `INACTIVE` remain excluded from both. The single
`PORTAL_ALLOWED_STATUS` literal is gone, replaced by
`PORTAL_SESSION_STATUSES` and `PORTAL_ACTIVATION_STATUSES` in
`apps/api/src/common/auth/student-portal-status.ts`, which carries the
reasoning.

Rationale: a first credential is guardian-mediated supervision of a live
school relationship, and once that relationship has ended there is no
supervision left to mediate — so obtaining has a weaker justification than
continuing. Proven by `student-portal.status-walk.spec.ts` (18 cases over
real HTTP), including a control that an `ACTIVE` student CAN still accept
(without it, every "cannot accept" case would pass if accept were simply
broken) and a case pinning that a refused accept does not burn the
invitation, so a student reinstated later does not find their link silently
dead. Mutation-checked: reverting the widening fails 8 of the 18.

The original entry follows, unedited, because it records why this was
shipped one way and changed a day later.

---

`PORTAL_ALLOWED_STATUS` is the single value `"ACTIVE"`, in three places:
`StudentAuthGuard`, `StudentPortalService.login`, and the invitation-accept
gate. Every non-`ACTIVE` status therefore loses portal access —
`SUSPENDED`, `INACTIVE`, `WITHDRAWN` and `GRADUATED` alike.

The slice-3 review debated `SUSPENDED` at length and settled on "suspended
students lose access", which is what ships. **`WITHDRAWN` and `GRADUATED`
were never separately considered** — they fall out of the same blanket
gate. The practical consequence: a student loses their results and history
the day the school marks them graduated, which is precisely when a
school-leaver is most likely to want them.

Shipped as-is deliberately: `ACTIVE`-only is the more restrictive setting,
so it cannot leak anything, and widening it later is purely additive. But
it is an inherited default, not a decision, and should become one.

If widened, `PORTAL_ALLOWED_STATUS` becomes a set and all three call sites
read from it — note that the invitation-accept gate is the one place where
widening has a real security question attached (should a graduated student
be able to *newly activate* an account, or only keep an existing one?).

---

## Rollout rails make the operator fish the school ID out of DevTools — captured 2026-08-25

**Small, self-contained, not urgent.** Logged because this is now the THIRD
one-school-at-a-time rollout rail sharing the same friction, which is the point
at which it stops being a quirk of one script.

Every rail takes an operator-reviewed school id as its argument:

- AI enablement (`PATCH /platform-admin/schools/:schoolId/ai`)
- Early access (`PATCH /platform-admin/schools/:schoolId/early-access`)
- Staff mobile (`PATCH /platform-admin/schools/:schoolId/staff-mobile`, plus
  the dry-run/confirm CLI `apps/api/scripts/set-staff-mobile.ts`)

But the platform-admin dashboard never renders a school id as text.
`platform-admin-dashboard.tsx` uses `schoolId` as a React key and inside
request paths only, so the operator's actual retrieval route today is: open
DevTools, read the `/api/platform-admin/schools` response, or click "View
users" and read the id out of the resulting `/api/platform-admin/users?schoolId=…`
request URL.

Discovered concretely during CP2 Gate 5 prep (2026-08-25): the dry-run could
not be run without asking the maintainer to go and fetch the id by hand.

**Why this is worth fixing rather than tolerating.** The operator-reviewed id is
not incidental to these rails — it IS the safety check. `set-staff-mobile.ts`
refuses `--apply` unless `--confirm-school-id` matches exactly, and refuses more
than one `--school-id` so there is no bulk mode. A retrieval path that runs
through DevTools invites the one behaviour that check exists to prevent:
typing a plausible-looking id from memory. Making the real id one click away is
a safety improvement, not a convenience.

**Suggested shape:** a "copy id" affordance on each dashboard row (icon button,
copies to clipboard, brief confirmation). Deliberately NOT a plain visible id
column — the row is already dense, and the id is needed occasionally rather than
read at a glance.

**RESOLVED 2026-08-26.** Shipped in `platform-admin-dashboard.tsx`: each school
row's name cell now carries a second line — a copy-icon button whose label IS
the full school id, in monospace, which copies the id to the clipboard and
swaps the icon to a tick for two seconds. Fallback on a refused clipboard write
is `window.prompt` with the id pre-filled, the same pattern
`components/settings/invitations-table.tsx` already uses; that fallback matters
more here than it does there, because the entire point of the affordance is
that obtaining an id never sends the operator back to DevTools.

**One deliberate divergence from the shape suggested above:** the id IS
rendered visibly, not hidden behind a bare icon. The note's reasoning was row
density, and that concern was real but is answered by placement — the id sits
as a secondary line under the school name rather than as a ninth column, and
`whitespace-nowrap` keeps it on one line (verified in a real browser; without
it the 36-char id wrapped). The stronger argument is the one this entry makes
itself: the operator-reviewed id IS the safety check that `--confirm-school-id`
enforces. A copy-only icon would let an operator paste an id they never
actually looked at, which is a *different* way of failing the same check that
typing one from memory fails. Seeing the id and copying it are both required
for the check to mean anything.

Verified in a real browser (Chromium via Playwright, against the local API and
Postgres, logged in through the real `/super-admin/login` form as a genuine
platform admin): the id renders as text in the row, clicking the button places
that exact id on the clipboard (read back via `navigator.clipboard.readText()`),
and the copied-state feedback appears and reverts. That check was run as a
throwaway spec and deliberately not committed — see the note in
`docs/journal/2026-08-26.md`.

---

## `staffMobileEnabled` is a blind write — missing from the platform-admin read surface (captured 2026-08-25)

`PATCH /platform-admin/schools/:schoolId/staff-mobile` (shipped in CP1, PR #211)
sets `School.staffMobileEnabled`, but **nothing on the platform-admin read
surface returns it**: `platform_admin_list_schools()` does not select the
column, and `PlatformAdminSchoolDto` has no such field. The operator can
therefore turn staff mobile on for a school and has no way to read back that it
is on — the write's own response echo is the only signal, which is exactly what
independent verification is not.

**This is the same gap the AI toggle deliberately closed**, and the reasoning
transfers unchanged. CLAUDE.md's inventory row for `platform_admin_list_schools`
records that `ai_enabled` was added to the return shape on 2026-08-14 precisely
"so `PATCH /platform-admin/schools/:schoolId/ai` isn't a blind write", and
argues it belongs there because it is platform status about the tenancy set by
the operator, not the school's own configuration. `staffMobileEnabled` is the
same category by the same test: operator-set, platform-side, not school
configuration and not spend configuration.

Found concretely during CP2 Gate 5 (2026-08-25): after the enablement PATCH for
Virgo returned `{ staffMobileEnabled: true }`, there was no read path to confirm
it. Gate 5 proceeded on a stronger substitute — a successful staff mobile login
proves the flag, because the flag is re-read from the row at both password
acceptance and challenge completion and a false value returns
`403 STAFF_MOBILE_DISABLED`. That substitute works for enablement; it does NOT
give the operator a roster view, and it does not work at all for confirming a
DISABLE.

**FIXED 2026-08-25, same day**, once the disable-direction consequence was
understood: an enable had an accidental proof, a disable had none, and a kill
switch verifiable only in the granting direction is the wrong way round.

Shipped: migration `20260825120000_platform_admin_staff_mobile_visibility`
(DROP + CREATE, same function name, adding `staff_mobile_enabled`),
`PlatformAdminSchoolDto.staffMobileEnabled`, the service mapping, and a
READ-ONLY column on the dashboard row. Read-only deliberately, unlike the AI
toggle beside it: enablement runs through the one-school rollout rail with a
dry run and an exactly-matching `--confirm-school-id`, and a one-click row
toggle would quietly undo that friction — the gap was visibility, not
convenience.

Verified against a live database: SECURITY DEFINER count still 20, owner
`school_kit`, `prosecdef` true, `search_path` pinned, EXECUTE to `app_user`
with PUBLIC absent, new column present in `pg_get_function_result`. The
allow-list shape test in `platform-admin-access.spec.ts` was extended (it is a
deliberate allow-list so this surface can never widen silently), and a new
regression asserts the LIST reflects the write in BOTH directions —
false → true → false. Platform-admin suite 33/33, SD inventory + RBAC gates
45/45.

---

## No audit trail is inspectable through the product — SQL is the only way to read one (captured 2026-08-25)

**Platform-wide, not specific to any module.** Every mutating path in this
system writes to `audit_logs` — it is a hard rule in CLAUDE.md for money, it is
enforced for platform-admin actions, and `audit-coverage.spec.ts` gates it. But
**nothing anywhere reads those rows back.** Searched 2026-08-25 across
`apps/api/src/modules` (no controller, no service, no `auditLog.findMany`
outside test files) and `apps/web/src/app` (no route, no page). There is no
`GET /audit-logs` endpoint, no admin screen, no export.

From the application's point of view the audit trail is **write-only**. The
only way to read an audit row is a direct SQL query against production.

**Why this is worth its own entry rather than a footnote.** The audit trail is
relied on as an answer to questions that are, in practice, asked by people who
cannot run SQL:

- "Who changed this student's grade, and when?"
- "Who recorded this payment?" — the money rule exists precisely so this is
  answerable, including for admin overrides.
- "Did that operator action actually take effect?" — this is how the gap was
  found: verifying CP2's Gate 5 device mark required reading one audit row, and
  the only available instruction was "open the Neon SQL editor"
  (`docs/runbooks/cp2-gate5-verification.md`).
- NDPR / dispute situations, where "we have an audit log" is materially weaker
  if nobody but a developer with production database access can produce it.

**Not obviously a bug.** Keeping the trail out of the product is a defensible
posture: audit rows carry `ip_address`, actor ids and `metadata` that can name
students, and a careless read surface is a new PII exposure on a table that
currently has none. The point of this entry is that the current state looks
like a deliberate decision and may not be one — it has never been written down
anywhere as a choice.

**If it is ever built, the real questions are:**

1. Who may read it? Owner only, or owner + admin? A staff member reading who
   changed what about their own colleagues is its own problem.
2. Scoped how? `audit_logs` is under RLS and monthly-partitioned, so a naive
   date-range query across partitions needs care.
3. Redacted how? `ip_address` and `metadata` are the sensitive parts; the
   actor, action, entity and timestamp are the useful parts, and those are
   mostly separable.
4. Platform-admin rows have `school_id = null` and must never appear in a
   school's own view.

Not started. No decision taken. Logged so the absence reads as known rather
than accidental.

---

## Verifying that a mobile action really happened takes a browser console and a SQL editor (captured 2026-08-25)

**Directly connected to the audit-log read-gap entry above** — that entry is the
root cause; this is the shape the pain actually took in practice. Logged
separately because the fix is not necessarily the same fix.

CP2's Gate 5 asked a simple question: *did the register a teacher marked on a
phone actually land?* Answering it required all of the following, none of which
a school could do:

1. Log into the web app as an owner/admin, open DevTools, and paste a
   ~40-line script that fetches the arm list, `/auth/me`, and the register, then
   compares `markedBy` against the arm's `classTeacherId`.
2. Open the Neon production SQL editor and run two hand-written queries — one
   joining `attendance_records` to `students`, one against `audit_logs`.
3. Know in advance that "one audit row per submit, not one per student" is the
   expected shape, or the result is uninterpretable.

The scripts are written down (`docs/runbooks/cp2-gate5-verification.md`) so this
is repeatable, but "repeatable by the person who holds the production database
credential" is a narrow definition of repeatable.

**Why this is worth its own entry.** Three distinct gaps stack here, and only
the first is the audit-log one:

- **The audit row is unreadable outside SQL** — see the entry above.
- **Provenance is not surfaced anywhere in the product.** `AttendanceRecord`
  stores `markedBy` and `markedAt`, and the API returns both on every register
  row, but no screen renders "who marked this". The web register editor shows a
  "last marked at HH:MM" stamp and drops the *who* entirely. A head teacher
  asking "did Mrs Okafor mark JSS3 today, or did someone do it for her?" has no
  answer inside the app — the data is right there in the response and simply is
  not displayed.
- **There is no per-user activity view.** "What did this staff member do today"
  is answerable only by SQL, which matters more now that staff act from phones
  where the school cannot see over anyone's shoulder.

**Deliberately not proposing a build.** The obvious move — render `markedBy` as
a name on the register — is a one-line-ish change and probably right, but it is
also the sort of thing that should be decided alongside the audit-read question
rather than bolted on ahead of it, since both are answering "who did this".
Whoever picks up the audit-log entry should pick this up in the same pass.

Concrete data point from the run that surfaced it: one arm, 12 students, one
save from the phone, one audit row — and two credentialed tools to see it.

Not started. No decision taken.

## Finance / bursar invoice UX — follow-ups after PR #220 (captured 2026-08-27)

PR #220 hardened the core bursar invoice journey (`/finance/invoices`) against
six confirmed UX-discovery findings — F-01 cancellation confirmation, F-04
human student identity, F-05 empty-vs-error, F-12 raw error objects, F-29
selector clarity, F-32 client navigation. These are the things that PR found
and deliberately did NOT expand into. None is started; none has a decision.

### F-34 — bulk invoice generation has no scope/amount confirmation gate

**The one on this list that is about money, and the reason the list exists.**

"Generate invoices" bills every enrolled student in a class arm on a single
click. There is a Preview, and PR #220 made it name students and show a
realistic total — but preview is **advisory and optional**, and nothing
requires the bursar to have looked at it before generating. The button does
not restate what is about to happen in terms of a count and a naira total, and
there is no confirmation step between intent and a whole arm being billed.

Note the asymmetry PR #220 has now created, which is the sharpest argument for
picking this up: **cancelling ONE invoice now requires an explicit
confirmation naming the student and the amount, while creating THIRTY does
not.** That is exactly backwards by blast radius. It was left that way
deliberately — the slice's brief said not to change generation workflow
silently, and making preview mandatory is a product decision about how a
bursar's day works, not a bug fix. But it should not stay backwards for long.

Worth deciding together, not piecemeal:
- Does generation get a confirmation dialog (count + total + arm + term), a
  mandatory preview step, or neither?
- Is "already invoiced students are skipped" enough of a safety net in
  practice? It makes a double-generate harmless, which is a real mitigation —
  but it does nothing about generating for the WRONG arm or the WRONG term,
  which is the failure that actually costs a school money and trust.
- What is the undo story? There isn't one: cancelling N invoices means N
  individually-confirmed cancellations. If generation stays one-click, bulk
  cancel probably has to exist, and bulk cancel is its own hazard.

**Needs a focused product/UX assessment soon.** Not started.

### The Generate and List tabs share one picker

Academic year / term / class are a single piece of state used by both tabs. A
bursar who switches to "Invoice list" and changes the class to look something
up has also changed what the Generate tab would bill, with no indication that
happened. Pre-existing, not introduced by #220.

Interacts directly with F-34 above: a one-click generate is more dangerous
when the selection can be changed from a screen the user thinks is read-only.
If F-34 gets a confirmation gate that restates the arm and term, that also
largely defuses this — which is a reason to decide them together rather than
separately.

### Other finance surfaces still turn a failed fetch into an empty array

PR #220 fixed this on `/finance/invoices` (loading / genuine-zero /
filtered-zero / fetch-failed / reference-data-failed are now distinct states
with retry, resolved by a total function in
`apps/web/src/lib/finance/invoice-list-state.ts`). The same `.catch(() =>
setX([]))` pattern still stands on:

- `finance/discounts` — three sites (`.catch(() => {})`, `setTerms([])`,
  `setRules([])`)
- `finance/fees` — four sites (`.catch(() => undefined)`, `setAllArms([])`,
  `[] as TermDto[]`, `setArms([])`)
- `finance/dashboard` and `finance/debtors` — the TERM-list fetch
  (`.catch(() => setTerms([]))`); their primary data fetches were fixed in #220

Scoped out of #220 on purpose: the brief forbade a repo-wide error refactor,
and the machinery to fix them now exists and is tested. This is mechanical
work, not a design question — `resolveInvoiceListView` and
`financeErrorMessage` are the pattern to copy.

### Cancellation affordance is not permission-aware

`canCancelInvoice` filters on invoice STATUS only. A user without
`invoice.cancel` is still offered the action and discovers the truth via a 403
— which now at least renders as reviewed human copy rather than silence, but
is still the wrong place to learn it. The server remains the authority and
that is correct; this is purely about not offering an action that cannot
succeed.

### "Unknown student" identity handling

`studentDisplayName` deliberately never falls back to a raw or truncated
student id — that was the point of F-04. When a student row cannot be resolved
it renders "Unknown student", or "Unnamed student (ADM-…)" when an admission
number survives. That is the right refusal, but nothing surfaces WHY, and
there is no path from that row to finding out. Rare (it needs a hard-deleted
student), so this is a polish item, not a correctness one.

### Broader finance error-state consistency

Beyond the empty-array item above: `apps/web/src/lib/finance/error-copy.ts`
now exists as the single place that decides what a school employee is told
when a finance request fails, and it is unit-tested against the specific leaks
F-12 found (`ApiError:`, `TypeError:`, `ECONNREFUSED`, bare error codes). It is
currently used by exactly three screens. The remaining finance surfaces each
still phrase failure their own way. Adopting it everywhere is worth doing as
one deliberate pass rather than opportunistically — the value is in the
consistency, not in any single screen.

Not started. No decision taken on any item above.

## Physical Android runtime smoke — mobile session-end UX (deferred post-merge, 2026-08-29)

PR #230 merged under an explicit PM waiver of native Android runtime evidence
as a merge blocker. The Android development APK was built and automated CI,
typecheck, lint, and mobile tests were green, but no agent performed a physical
device session test. Do not represent this as Android runtime verification.

Physical Android runtime smoke for mobile session-end UX remains outstanding:
guardian/student/staff terminating 401, deliberate logout, network failure,
principal isolation, and one-time notice lifecycle. Use disposable local
identities and the development profile's local API target; no production school
data should be mutated.

### Mobile password recovery — physical Android smoke outstanding

Guardian email recovery and guardian-mediated student recovery have real-
Postgres lifecycle evidence, not device evidence. At the first available
Android session, use disposable identities to verify guardian request → email
link → browser reset → app sign-in, and guardian student reset → old
credentials refused → one-time code accepted → new-password sign-in. Do not
call mobile-auth hardening device-verified until both pass.

## Guardian auth & recovery — follow-ups after PR #222 (captured 2026-08-27)

PR #222 shipped guardian sign out and password recovery (F-06) and removed
the obsolete post-login interstitial (F-13). These are the things that slice
found or inherited and deliberately did NOT expand into. None is started;
none has a decision.

### Resend failure visibility — a monitoring gap, not a security one

`PortalAuthService.forgotPassword` creates the token row and its audit row,
commits, logs `[GUARDIAN PASSWORD RESET] <url>`, and only then attempts the
send. A Resend failure is caught, `logger.error`'d, and deliberately does NOT
change the response — varying it would leak account existence, which is the
whole point of the generic acknowledgement.

The consequence is that a failed send leaves a **valid but undelivered**
reset token, live until its 1h TTL expires, and the failure is visible
**only in stdout / Fly logs**. It does not reach Sentry: `Sentry.captureException`
fires solely in `http-exception.filter.ts`, and only for unmodelled exceptions
that actually reach the filter — this one is caught in the service well
before then.

**This is inherited, not introduced.** Staff `AuthService.forgotPassword` and
`GuardiansService.deliverInvitation` behave identically. So the fix, if taken,
should cover all three rather than singling out the guardian path. Options
worth weighing together: a `Sentry.captureMessage` at the catch site; a
counter/alert on the log line; or surfacing undelivered-token counts to the
platform-admin surface. Not a security defect — the token is never exposed
and the response never varies — so this is about operators noticing, not
about exposure.

### Guardian `is_active` / central revocation

Still open, and now the sharpest asymmetry in the auth model. Recorded in
CLAUDE.md's 2026-08-16 SECURITY DEFINER review: `auth_resolve_guardian_session`
returns NO revocation signal, because `Guardian` has no `is_active` column.
Students have two signals (`student_status` AND `portal_enabled`); staff have
one (`user_is_active`); guardians have none.

PR #222 narrows this without closing it: a password reset now deletes every
session for that guardian, so a parent who believes they are compromised has
a self-service lever they did not have before. What is still missing is the
SCHOOL's lever — an administrator cannot cut off a guardian's access centrally.
Clearing `password_hash` prevents future logins but does not invalidate a live
session, which can run for up to 30 days.

### Multi-school same-password ambiguity

`Guardian.email` is unique only per school (Decision C), so one address can
own accounts at several schools. `PortalAuthService.login` verifies the typed
password against every candidate and throws `AMBIGUOUS_GUARDIAN_ACCOUNT` when
more than one matches — a documented interim strategy (approved 2026-07-16)
whose real fix was always going to be a school selector in the portal login
flow.

PR #222 does not change login, but it does establish that recovery can serve
all of a person's accounts at once (one token and one email per school, each
naming its school). Whoever builds the school selector should look at that
pattern first: the recovery email already tells a parent which schools they
have accounts at, which is most of the information a selector needs.

### Guardian account lockout

Guardian login now carries both a per-IP throttle (10/min) and
`RateLimitByEmailGuard` (20 attempts / 15 min), the latter added by PR #222
for parity with staff login, which had it since Phase 0. What neither
principal has is a real lockout — a sustained low-rate attack against one
address is still only rate-limited, never stopped.

Student portal lockout is already logged as approved-but-not-built
(Phase 6 / Slice 3 follow-ups). Guardians have the identical gap. These are
the same decision and should be taken together rather than one principal at
a time.

### Public-origin config hardening — a tiny, separate infra decision

`PORTAL_BASE_URL` is a **public hostname, not a credential**, yet it lives
only as a Fly secret. `apps/api/fly.toml` declares `NODE_ENV`, `API_PORT` and
`RENDER_WORKER_URL` — and `RENDER_WORKER_URL` was deliberately moved INTO
that `[env]` block on 2026-08-14 for exactly this reason, with a comment that
names PORTAL_BASE_URL as the cautionary precedent: "Same failure shape as the
PORTAL_BASE_URL miss: config that exists in the repo but was never set on the
running app."

The proposal is one line: move `PORTAL_BASE_URL = "https://portal.schoolkit.ng"`
into `fly.toml [env]`, turning "verify a secret exists" into "it is in version
control and reviewable in a diff." Two things to settle first, which is why
this is logged rather than done:

1. **Precedence.** If the value stays set as a Fly secret as well, which wins?
   That must be confirmed against Fly's actual behaviour before relying on the
   `[env]` entry, or the change is cosmetic at best and misleading at worst.
2. **Scope.** `WEB_BASE_URL`, `CORS_ORIGIN` and `CORS_ORIGIN_PORTAL` are the
   same category — public origins currently held as secrets, and the first two
   have already caused a documented production incident (2026-07-19). Doing
   one and not the others would leave the inconsistency that makes this class
   of bug easy to reintroduce.

Deployment-ordering note, observed during PR #222's own rollout and worth
remembering for any future feature that spans both apps: **Vercel deploys
apps/portal on push to main, while the Fly API deploys only after `ci`
passes.** For roughly eleven minutes the production portal offered
"Forgot password?" against an API that did not yet have the endpoint
(`POST /api/v1/portal/reset-password` returned `Cannot POST`). Harmless here —
the feature was unannounced and the window was short — but a UI-first,
API-second ordering is the wrong way round for anything a parent might be
told about in advance.

Not started. No decision taken on any item above.

## Session expiry — follow-ups after PR #225 (captured 2026-08-28)

PR #225 fixed F-10's *authentication continuity* half for the two web
principals: a session that ends now says why, and the page the user was
trying to reach survives the round trip through login. Two things were
deliberately left out, both confirmed by PM as separate work. Neither is
started.

### A. HIGH PRIORITY — unsaved work is silently destroyed by a forced sign-out

This is the half of F-10 that PR #225 did **not** solve, and it is the one
with real cost to a real person.

`beforeunload` guards already exist on the gradebook
(`components/teacher/gradebook/gradebook-grid.tsx`), lesson plans
(`app/(teacher)/teacher/lesson-plans/[id]/page.tsx`) and the class-subject
matrix (`components/settings/academic/class-subject-matrix.tsx`). **None of
them protects against this**, because `beforeunload` does not fire for a
client-side navigation — and a forced sign-out is exactly that. PR #225 in
fact made the navigation a full-document `window.location.replace`, which
does fire `beforeunload`; but that produces a *browser-native "leave site?"
dialog* at the moment the session is already gone, which is worse than
useless: answering "stay" cannot save the work, because the credential
needed to save it no longer exists.

So the shape of the problem is: a teacher spends twenty minutes entering a
column of scores, the session lapses, the save 401s, and the grid is gone.
PR #225 ensures they are now *told* they were signed out — which is what
stops them believing the save succeeded — but the scores are still lost.

**Do NOT assume platform-wide draft persistence is the answer.** Three
candidate approaches, to be decided on evidence rather than instinct:

1. **Re-authenticate in place.** Keep the component mounted, put a password
   prompt over it, re-mint the session, retry the failed write. Preserves
   everything and needs no storage at all. Costs the most: it means the 401
   handler can no longer unconditionally tear the tree down, which is the
   property that just fixed two navigation races (see #225's commit history
   before assuming this is free).
2. **Narrowly scoped draft preservation.** Only the specific dirty surfaces,
   only in memory or `sessionStorage`, only until the next successful save.
   Cheaper, but it means unsaved *student scores* sit in browser storage —
   which needs its own look at the PII rules in CLAUDE.md before anyone
   writes a line of it.
3. **Something else** — e.g. make the surfaces autosave a server-side draft
   while the session is still valid, so there is nothing to preserve
   client-side when it ends.

The right first step is probably to measure how often this actually bites
(session TTL vs. how long a gradebook column really takes) rather than to
pick a mechanism.

Known affected surfaces: gradebook, lesson plans, class-subject matrix.
Others almost certainly exist — the three above are simply the ones that
already carry a `beforeunload`, which is a marker of "someone noticed this
form has unsaved state", not a complete inventory. Teacher attendance was
being worked on concurrently and was not surveyed.

### B. Mobile session-end UX

All three mobile principals — guardian, student, staff — still sign out
**silently** on a 401. The cause is one line: `UnauthorizedListener` in
`apps/mobile/src/lib/api/client.ts` is typed `() => void`, so
`notifyUnauthorized()` cannot pass the server's error code on, and
`session.tsx` calls `signOut()` with nothing to display.

The server-side half is already done and needs no change: `AuthGuard`,
`GuardianAuthGuard` and `StudentAuthGuard` all emit `SESSION_EXPIRED`,
`INVALID_SESSION` and `MISSING_BEARER_TOKEN` as distinct codes, and
`StudentAuthGuard` additionally distinguishes a withdrawn student from a
guardian-disabled account. So this is a client-side plumbing job of roughly
the shape #225 did for web: widen the listener signature, carry the code,
map it to copy on the login screen.

Two things make it a **dedicated slice with real-device verification**
rather than a quick follow-on:

- Mobile has no browser E2E. Every claim about what a user sees has to be
  checked on a device or simulator, which is why #225 stopped at the web
  boundary rather than half-doing React Native without a way to prove it.
- Mobile deliberately does NOT sign out on `ApiNetworkError` (only on a real
  401), so that going offline never dumps a user to login and discards their
  cached view — a documented phase-6 requirement. Any change here must
  preserve that distinction exactly, and it is precisely the kind of
  behaviour a careless refactor of the 401 path would break.

Worth pairing with the mobile lock-screen behaviour already in
`session.tsx`, since both are "what the user sees when the app decides they
are no longer authenticated".

Neither item is started. No mechanism has been chosen for A.

## Session-end work loss — what PR #228 did NOT fix (captured 2026-08-29)

PR #228 removed the *false choice* a forced sign-out used to offer: a
`beforeunload` dialog whose "Stay" cancelled only the navigation, while the
already-queued guest state still unmounted the dirty form and RequireAuth
still ejected the user with no reason. Three things it deliberately left.

### A — deliberate sign-out with a dirty form (P1/P2)

`logout()` awaits `logoutRequest()` — which destroys the server session —
*before* it clears local state and calls `window.location.replace("/login")`.
The native dirty-form prompt therefore fires with the credential already gone,
exactly as the forced path did. "Stay" cannot save anything.

Unlike the forced path, this one is fixable *properly*: a sign-out is a choice
the user makes in advance, so the prompt can be moved to before the destructive
call. The blocker is that there is no central dirty-state registry — the Sign
out button lives in the shell and has no handle on whichever form is dirty
several levels down.

So the shape of the fix is: **detect dirty state BEFORE server logout, not
after.** Not "suppress the dialog" — that was right for eviction, where nothing
could be saved, and would be wrong here, where something still can.

Deliberately not folded into #228, which is about forced termination.

### B — gradebook durability

**This is not "turn on autosave".** Established constraints, from reading the
endpoint rather than guessing:

- `POST /assessment-scores/bulk` is idempotent at score-row level — a multi-row
  `INSERT … ON CONFLICT (school_id, student_id, subject_id, term_id,
  component_id) DO UPDATE`. Replaying an identical payload is safe.
- Autosave changes `entered_by` / `entered_at` semantics. Both are overwritten
  on every conflict, so they would come to mean "last autosave fired" rather
  than "a teacher committed this" — a change to the meaning of an assessment
  record, not an implementation detail.
- **Any score write clears an existing sign-off** (`subjectSignedOffAt`/`By`
  → null, the Q6 implicit unlock). A debounced autosave would silently
  un-sign-off a signed column while the teacher types. Any design must gate on
  `!isSignedOff` or sign-off stops meaning anything.
- Per-cell autosave multiplies request AND audit volume substantially: one
  audit row per call today, so ~40 rows and ~40 requests for a class where
  there is now 1. Each carries the full preamble — term / component /
  enrollment / scope / released-card checks plus `materializeSummaryBatch`.
- That endpoint has **prior transaction-timeout history**: the 2026-08-04
  production incident is why `BULK_SAVE_TRANSACTION_TIMEOUT_MS` is 15s and why
  the round-trip count was cut. It is high-frequency and multi-teacher-
  concurrent; a 40× multiplier lands there.
- Any autosave requires explicit **Saved / Unsaved / Saving / Failed** state.
  A silent failure is worse than no autosave: it turns "I know it didn't save"
  into "I assumed it did". Today a network failure sets a visible banner.

Needs a dedicated product/technical decision. Not approved.

### C — shared dirty-state infrastructure

Four hand-written `beforeunload` guards now exist (gradebook, class-subject
matrix, lesson plans, teacher attendance), each with its own click-capture
companion and, in attendance's case, a `popstate` guard too. #228 added a
fifth thing each must remember.

Deliberately NOT extracted in #228 — the diff would have collided with PR #226,
which landed the attendance guard the same week. The standing gate is
`apps/web/src/lib/auth/session-end-invariants.spec.ts`, which walks the source
tree and fails on any `beforeunload` guard it does not know about, so the count
can grow without the invariant rotting. Extraction is owed; it is a refactor,
not a fix, and it is what A above needs to exist first.

Not started. No decision taken on any item above.

## First-school setup / owner onboarding — follow-ups after PR #232 (captured 2026-08-29)

PR #232 closed F-25: a fresh school's dashboard now carries a tiered,
server-derived setup checklist, and four workflow screens explain their
missing prerequisite instead of quietly doing nothing. See
`docs/modules/first-school-setup.md` for the dependency map and the evidence
behind each tier.

Three things were deliberately left. All were known and accepted at PM review,
not discovered afterwards.

### A — teacher screens still have no prerequisite messaging

`GET /schools/me/setup-state` is owner/admin only, on purpose: every step it
returns is an owner/admin action, and offering one to a teacher would be
handing them a button that 403s — the misleading navigation the slice existed
to remove.

The cost is that a teacher who logs in to an empty gradebook, or a form
teacher with nothing to mark, still gets only that screen's own empty state.
They are told there is nothing there; they are not told that their admin has
not enrolled anyone yet, or has not assigned them a subject.

A fix needs a *separate, teacher-safe* read — not a widening of this one. The
distinction matters: the teacher-facing answer is "what is missing that
affects you", which is a different (and much narrower) shape than "what should
you go and configure", and it must not leak school-wide configuration state to
a teacher. Cheapest honest version is probably a scope-derived message from
`TeacherScopeService.getMyScope`, which the teacher already calls and which
already knows whether their scope is empty.

Not started. No decision taken.

### B — the onboarding guide implies a ClassSubject dependency that does not exist

`docs/onboarding-guide.md` lists the class-subject matrix at stage 6 of a
sequence whose own preamble says "each stage depends on the one before it".
That reads as a prerequisite. It is not one.

Verified 2026-08-29 by grepping every consumer: `ClassSubject` is read by its
own CRUD module and by nothing else in `apps/` or `packages/`. It does not
gate the gradebook (built from `TeacherAssignment` via
`TeacherScopeService`), report cards, or teacher assignment —
`TeacherAssignmentsService.create` validates that the subject is *active*,
never that it is linked to the level.

PR #232 acted on this where it was load-bearing (the step is tiered
`optional`, and `SetupStateService`'s header records why) but did NOT rewrite
the guide, which is a larger docs pass and outside the slice.

The rule going forward: the guide should not describe the matrix as a
dependency unless and until a workflow actually reads `ClassSubject`. If one
ever does, the step must be re-tiered in `SetupStateService` and given a
`PrerequisiteNotice` in the same PR — the tiering test
(`setup-state.service.spec.ts`, "keeps fees, staff and the subject matrix off
the required list") will fail until it is, which is the intended forcing
function.

Not started.

### C — "established" counts a cancelled invoice as progress

`SetupStateService.hasRealActivity` is true once the school has marked a
register, issued an invoice, or entered a score. `db.invoice.count()` is
unfiltered, so an invoice that was later CANCELLED still counts.

The practical case: a school that issued exactly one invoice, cancelled it,
and did nothing else reads as `established` and stops seeing setup UI while
recommended steps are still outstanding.

This is product semantics, not a bug, and the current behaviour is arguably
the right one — the school demonstrably found and used the invoicing flow,
which is what the signal is actually measuring. Filtering to non-cancelled
invoices would also make the status flap: a school could look established on
Monday and be back in `finishing` on Tuesday because a bursar reversed a
mistake, which is a worse experience than the thing it fixes.

Recorded so the choice reads as deliberate rather than overlooked. Not a
blocker. No change proposed.

## Discount-rule Deactivate is not permission-gated (captured 2026-09-01)

- [ ] Gate the discounts page's **Deactivate** row action on the
  `discount-rule.deactivate` permission, using PR #241's exact pattern.

  **Found while** verifying the discount-rule deactivation path in a real
  browser for PR #242. That PR fixed the missing confirmation and deliberately
  stopped there; this is the remaining half, kept separate so the confirmation
  fix stayed focused.

  **The gap.** `DELETE /discount-rules/:id` is declared
  `@Permissions("discount-rule.deactivate")` on the server
  (`discount-rules.controller.ts`). The page
  (`apps/web/src/app/(admin)/finance/discounts/page.tsx`) does not read the
  signed-in user's grant at all — it never calls `useAuth()` — so the action
  renders for anyone who can reach the page, and a 403 is the only thing that
  would stop them. Same class as the invoice-cancel affordance PR #241 fixes:
  the frontend deferring a money-adjacent permission decision to a downstream
  4xx.

  **The pattern to copy, from PR #241** (`lib/finance/invoice-cancel.ts`):
  1. Extend the existing pure module — here `lib/finance/discount-deactivate.ts`,
     which already holds this action's policy and is unit-tested — with a
     wildcard-aware `hasPermission` and a `DEACTIVATE_DISCOUNT_PERMISSION`
     constant pinned to `"discount-rule.deactivate"`.
  2. Make the permissions argument **required**, not optional-with-a-default,
     so a call site that forgets it fails typecheck rather than silently
     reverting to ungated rendering.
  3. Fail closed on an empty grant — that is also `AuthProvider`'s initial
     loading state, and a destructive money action must not be offered before
     the app knows whether it is allowed.
  4. Cover it both ways: the permitted case, the under-privileged case, the
     empty/loading case, the owner `"*"` wildcard, and a near-miss grant
     (`discount-rule.read`) that must not satisfy it.

  **Severity: latent, not exploitable today.** Every role that can currently
  reach the discounts page — owner, admin, bursar — holds
  `discount-rule.deactivate`; teacher holds no discount permissions. It
  matters for custom per-school roles (`Role.isSystem` exists for exactly
  that) and because the affordance should be honest regardless. Worth doing,
  not urgent.

  Note this would add an eleventh copy of the two-line `hasPermission` helper
  unless the shared-hook extraction above is done first — see the
  `usePermissions` entry, whose recount found ten. Doing that extraction and
  this gate together is a reasonable pairing.

## NDPR compliance posture for third-party AI / embeddings vendors has never been formally reviewed (captured 2026-09-01)

- [ ] **NDPR compliance posture for third-party AI/embeddings vendors has never
  been formally reviewed — applies to current production Anthropic usage as
  well as any future embeddings vendor.**

  **This needs real legal review. It is not an engineering decision and must
  not be closed by one.** No amount of code review, redaction auditing or
  vendor documentation reading substitutes for a qualified answer on what the
  Nigerian Data Protection Regulation requires when a Nigerian school's data —
  including data about children — is processed by a third-party AI provider
  outside Nigeria. Engineering can describe precisely what is sent, to whom,
  and under what controls; engineering cannot decide whether that is lawful.

  **Scope is broader than Phase 7.** It was surfaced while choosing an
  embeddings vendor for Phase 7 (curriculum RAG + student tutor, HELD per
  `docs/ARCHITECTURE.md`), but it is not a Phase 7 question. The same question
  sits underneath the Anthropic integration that Phase 5 already shipped
  (lesson plans, report-card comments, parent summaries, admin insights). A
  second vendor widens the exposure; it did not create it.

  **What is already true in our favour, and what it does not settle.**
  `CLAUDE.md`'s AI hard rules already forbid sending student PII to the model
  for derived features, mandate opaque IDs and class-level context only, and
  pin a deliberate allowlist of exactly one PII-bearing prompt
  (`student-list-extraction`) with its own sign-off. That is a genuinely
  strong engineering posture and it is why this is a question rather than an
  incident. It does not settle the legal question: NDPR concerns itself with
  cross-border transfer, lawful basis, consent scope, processor agreements and
  data-subject rights, none of which are answered by "we redact PII well."
  Onboarding step 4 collects an NDPR consent confirmation — whether that
  consent's wording actually covers third-party AI processing is precisely
  the sort of thing that needs reading by someone qualified.

  **Open factual question to resolve before or during the review:** whether
  Anthropic-backed features are currently reachable in production at all.
  `AI_ENABLED` defaults to `true` when unset (`ai-generation.service.ts`), and
  there is a separate per-school `School.aiEnabled` gate, but production is
  believed to run with `AI_ENABLED=false` as a deliberate staged-off state.
  That could not be verified while writing this entry (no `flyctl` access from
  this host). It matters a great deal to the review: "shipped but gated off"
  and "processing real school data today" are materially different starting
  positions, and the answer should be confirmed from the running app rather
  than assumed in either direction.

  **Decision status (2026-09-01).** Voyage AI is the approved vendor choice
  and the engineering-readiness findings are accepted. Phase 7 planning may
  proceed on that assumption. **Implementation — actual API integration and
  actual curriculum content processing — waits** for either (a) confirmation
  that the NDPR question has been addressed, or (b) a deliberate, recorded
  decision to proceed despite it. Option (b) is a legitimate business call,
  but it should be made knowingly and written down here, not arrived at by
  someone simply starting the integration.

  **Recorded from Arinzechukwu's instruction, 2026-09-01.** The supporting
  Phase 7 plan-first and vendor comparison are not committed to this repo —
  see the note in the same PR. This entry deliberately states the compliance
  question and its status only, and does not restate vendor analysis it cannot
  cite.
