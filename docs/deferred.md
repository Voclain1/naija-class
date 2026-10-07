# Deferred items

What is known, not done, and still true. **Cleaned up 2026-10-05:** every open
entry was checked against the code. Anything already built or no longer
relevant was dropped from this file. The full previous file, with the
reasoning, incident write-ups and resolved history, is
`docs/deferred-archive.md`. Older references to "`docs/deferred.md`'s X entry"
in code comments point there.

Format for new items:

- [ ] **Short title** — what is missing, and why it matters. **Trigger:** what
  makes it due. **Where:** the files involved.

Keep each entry to what someone picking it up needs. Put the long reasoning in
the module doc or the PR, then link it here.

---

## 1. Up next (owner's order, 2026-10-05)

- [ ] **Web session token still reaches JavaScript.** PR #70 already moved web
  auth to the `sk_session` HttpOnly cookie, and the token is no longer in
  `localStorage`. But it still crosses into page JavaScript in two places:
  - `login`, `signup-owner` and `2fa/challenge` return it in the JSON body;
  - cold-boot hydration reads it back from `GET /api/auth/session`.

  `apiFetch` keeps it in memory and sends it as a bearer token, so an
  injected script could copy it.

  **Decided 2026-10-05 (owner):** the API gets its own schoolkit.ng address
  (`api.schoolkit.ng`). The sign-in cookie is shared across `schoolkit.ng`,
  and the browser calls the API with that cookie. Routing through Vercel was
  rejected because its 4 MB middleware body limit breaks curriculum, register
  photo, receipt and CSV uploads.
  - [x] **API side, done 2026-10-05.** `AuthGuard` accepts `sk_session` as
    well as a bearer token, only when the Origin is the web app's
    (`common/auth/staff-session-token.ts`). CORS allows credentials for that
    origin only. Backward compatible: bearer clients are unchanged.
  - [ ] **Owner:** add a DNS CNAME `api` → `school-kit-api.fly.dev`, and an
    `api.schoolkit.ng` certificate on the Fly app (Certificates in the
    dashboard).
  - [ ] **Web switch-over: built, merge only after the owner's steps**
    (`docs/runbooks/web-session-cookie.md`).
    - `apiFetch` sends `credentials: "include"` and no token.
    - The token is stripped from login, signup and 2FA responses.
      `/api/auth/session` answers `{ authenticated }` and moves a
      pre-switch-over cookie onto `Domain=schoolkit.ng`.
    - A production build refuses to start without `SESSION_COOKIE_DOMAIN`
      and an `NEXT_PUBLIC_API_URL` under it.
    - `e2e/tests/web-session-cookie.spec.ts` proves no API request carries
      `Authorization` and no readable response carries the token.
- [ ] **Paystack mobile checkout has never been round-tripped**, and does not
  return the parent to the app. `PortalPaymentsService.initiate` hard-codes
  the callback to `${PORTAL_BASE_URL}/payments/callback`, so a parent
  finishes in the in-app browser and closes it by hand. Payment correctness is
  unaffected: `runCheckout` polls `GET /portal/payments/:reference`, and the
  webhook is the authority. **Needs:** a Paystack test-mode subaccount on a
  dev school to prove the round trip, and a scheme-aware callback.
- [x] **DONE 2026-10-05 — Playwright coverage of the money path**
  (`e2e/tests/finance-money-path.spec.ts`):
  - **A recorded payment** moves the invoice's Paid and Balance. It also moves
    the term's collected, outstanding and collection rate (0% → 15%). The
    test checks the payment row in kobo and its `payment.record` audit row.
  - **An expense** logged through the form shows in the list and in the
    term's total expenses.
  - **Payroll** goes through run, approve and payslip. Net pay is the
    server's figure, and the stored payslip carries it.
- [x] **DONE 2026-10-05 — `apiFetch` network failures.** A rejected
  `fetch()` or a non-JSON body (a gateway's error page) now throws
  `ApiNetworkError`: status 0, code `NETWORK_ERROR`, "Couldn't reach the
  server. Check your internet connection and try again."
  - It extends `ApiError`, so the ~300 `err instanceof ApiError ? err.message : …`
    call sites show that sentence with no edit.
  - A caller's own abort is rethrown untouched.
  - The portal already said this on every page, so it needed nothing.
  - Covered by `apps/web/src/lib/api-client.spec.ts`.
- [ ] **Smart Student Import has no content evals.** `student-list-extraction`
  is the only PII-bearing prompt, and it has never read a real register. Its
  checks are all structural. **Needs:** about 10 photographed pages with
  hand-checked ground truth, a per-field accuracy pass, and probably a prompt
  v2. Its synchronous design (D3) has never been timed against the real API.
  **Trigger:** before the feature is switched on for any school.

## 2. Open engineering work

### Auth and permissions
- [ ] **Two authorization systems that do not consult each other.**
  `assertUserActiveAndHasOneOf` checks role keys in services that controllers
  already gate with `@Permissions`. Three bursar bugs and one admin bug came
  from this.
  - **Fix:** keep the `isActive` re-check, drop the redundant role check on
    read paths, and add a spec that fails when a handler's role list and its
    permission disagree.
  - **Scope:** about 20 call sites. Plan first.
  - Full history: archive, "RECURRING PATTERN".
- [ ] **Staff invitations cannot be resent or revoked** (guardian and owner
  invitations can). To share an older link, an admin re-invites.
- [ ] **`usePermissions` hook.** The shared `lib/auth/has-permission.ts` now
  exists, but 11 pages still carry their own copy of `hasPermission`. Move
  them over.
- [ ] **Deliberate sign-out loses a dirty form.** `logout()` destroys the
  server session before the browser's "leave site?" prompt fires.
  - **Fix:** check for dirty state before the server logout. That needs a
    shared dirty-state registry.
  - Four hand-written `beforeunload` guards exist, gated by
    `session-end-invariants.spec.ts`.
  - Forced expiry still destroys unsaved gradebook work. No mechanism has
    been chosen; measure how often it happens first (archive: "Session
    expiry", "Session-end work loss").
- [ ] **Mobile signs out silently on a 401.** `UnauthorizedListener` in
  `apps/mobile/src/lib/api/client.ts` is `() => void`, so the server's code
  (`SESSION_EXPIRED`, `USER_INACTIVE`, …) never reaches the login screen.
  Needs device verification. It must keep not signing out on
  `ApiNetworkError`.
- [ ] **Resend failures reach only the logs**, not Sentry. This affects staff
  reset, guardian reset and guardian invitations. The response must not vary,
  so this is about operators noticing.

### Money
- [ ] **Double-PENDING overpayment.** Two Paystack payments started for the
  same invoice by different people (a guardian and staff, or two guardians)
  can both complete. `applyPaystackSuccess` then applies both.
  - The portal blocks a second attempt within 30 minutes for the same
    guardian only.
  - **Fix:** re-check `remaining >= amount` when the webhook applies.
  - **Trigger:** before payment volume grows past the pilot.
- [ ] **Finance UX follow-ups from PR #220**, including the F-34 bulk-invoice
  confirmation (archive, "Finance / bursar invoice UX").
- [ ] **`notIn: ["DRAFT", "CANCELLED"]` literals.** Five remain in
  `finance.service.ts`. Move them to the `finance-totals.ts` status sets.

### Data and infrastructure
- [ ] **`schema.prisma` vs migration drift.** Four names are involved:
  - `audit_logs_new_pkey`;
  - `audit_logs_school_id_created_at_idx`;
  - a `fee_items` index name;
  - `payments_school_id_paystack_reference_key`.

  A naive `prisma migrate diff` pulls them in. **Trigger:** before the next
  migration touching `audit_logs`, `payments` or `fee_items`.
- [ ] **`withTenant` retries body timeouts.** `P2028` re-runs the whole
  transaction under pool exhaustion, which adds load at the worst moment.
  Stop retrying body timeouts (`describeAttemptFailure` has `elapsedMs`).
- [ ] **No `[schoolId, date]` index for whole-school attendance reads**
  (dashboard today and the 8-week trend). **Trigger:** slow dashboard queries.
- [ ] **Production `connection_limit` is unverified** (assumed 3). Check
  `app_user` connections in the Neon dashboard.
- [ ] **No expired-session sweeper** for `sessions`, `guardian_sessions` and
  `student_sessions`. This is housekeeping only: guards already reject expired
  rows.
- [ ] **Audit writes are synchronous** rather than queued, as ARCHITECTURE.md
  describes. Revisit only if a write path's latency shows it.

### Observability
- [ ] **Modelled 4xx errors never reach monitoring.** `HttpExceptionFilter`
  returns before Sentry for every `BaseError`. That is why the onboarding
  step-5 date error went unseen for three weeks.
  - **Fix:** count repeated `(endpoint, issue.path)` failures on flows that
    should succeed (PostHog or a metric), not "capture all 4xx".
  - Never log request bodies.
- [ ] **Web builds upload no Sentry source maps** (`withSentryConfig`), and
  there is no server-side PostHog.
- [ ] **The redaction regexes exist twice** (`apps/api/src/observability/redact.ts`,
  `apps/web/src/lib/observability/redact.ts`). Move them to one package.

### Product gaps
- [ ] **Teachers get no prerequisite messaging.** An empty gradebook does not
  say the admin has not enrolled anyone or assigned a subject.
  - Needs a teacher-safe read, probably built from
    `TeacherScopeService.getMyScope`.
  - Do not widen `setup-state`.
- [x] **The onboarding guide implies a class-subject matrix dependency that
  does not exist.** Done 2026-10-06: `docs/onboarding-guide.md` was rewritten
  for a non-technical owner, ordered by the dashboard setup checklist, and the
  Matrix is now described as an optional reference list.
- [ ] **Report cards built after every subject is signed off stay DRAFT.**
  They say "subject teachers need to sign off" because the cascade ran before
  the cards existed. Form review recovers it.
- [ ] **Staff roster has no server-side pagination** (`/staff`).
- [ ] **Bulk student grid** — what is left:
  - bounded-parallel submit;
  - a real `POST /students/bulk`;
  - draft persistence.
- [ ] **Teacher shell sidebar background stops partway down a short page.**
- [ ] **Timetable builder: moving a lesson takes two requests.** If the second
  fails, the lesson shows in both places.
- [ ] **Possible `/dashboard` navigation race.** A click right after landing
  can be undone by the term selector's `router.replace`.

### Docs and tooling
- [ ] **`docs/journal/` stops at 2026-09-06.** Not yet recorded:
  - Phase 8 CP2–CP4;
  - the school day;
  - Phase 8c;
  - platform-admin tools;
  - online exams.
- [ ] **`RESERVED_SLUGS` is exact-match only.** **Trigger:** before adding any
  reserved slug pattern.
- [ ] **Tooling:**
  - Turbo crashes on Windows (run per workspace);
  - root `pnpm dev:api`;
  - the `dotenv-cli` test wrapper;
  - eslint-config-next's native flat config;
  - CI remote cache and parallel jobs;
  - coverage reporting;
  - Dependabot and commitlint.

  All low priority.
- [ ] **Prisma 5 → 7 upgrade.** Plan first. Update CLAUDE.md in the same PR.

## 3. Waiting on the owner or outside parties

- [ ] **NDPR legal review** of third-party AI processing (Anthropic, in
  production since 2026-09). This is a legal question, not an engineering one.
  Phase 7 implementation waits on it, or on a recorded decision to proceed.
  (Archive: "NDPR compliance posture".)
- [ ] **Pricing.** This covers:
  - tier shape;
  - what early access grants;
  - enforcement points;
  - backfilling `earlyAccessGrantedAt`.

  Platform-admin billing waits on it.
- [ ] **Platform admin decisions:**
  - **Impersonation:** read-only or read-write, notification, audit, consent.
  - **Cross-tenant analytics:** needs an anonymisation design.
  - **Platform-admin deactivation:** no flow yet.
- [ ] **Duplicate "Virgo Fidelis Montessori School"** in production. It is not
  empty (1 student, 1 staff), so merging or deleting it is the owner's call.
  The platform-admin roster now shows slugs, so the two can be told apart.
- [ ] **Paystack webhook URL** set in the Paystack dashboard
  (`https://school-kit-api.fly.dev/api/v1/payments/paystack/webhook`). Do this
  before any school goes live on Paystack.
- [ ] **SMS** — Termii sender ID (CAC registration), and the live check that
  `sendReminders` never calls Termii when `smsEnabled` is false.
- [ ] **CP4 curriculum eval queries are author-written.** It needs:
  - 5–10 topics a real teacher would type, labelled by them with the week;
  - one or two near-miss negatives.

  `QUERY_SET_PROVENANCE` keeps the eval warning until then.
- [ ] **Online exams go live** about four weeks before the first exam period
  (`docs/runbooks/cbt-go-live.md`).
- [ ] **Device checks before telling families to use the app.** Not yet run on
  a device or simulator:
  - mobile session-end;
  - calendar;
  - class timetables;
  - the Android and iOS smokes.
- [ ] **Public-origin config.** `PORTAL_BASE_URL`, `WEB_BASE_URL`,
  `CORS_ORIGIN` and `CORS_ORIGIN_PORTAL` are public but held as Fly secrets.
  Move them to `fly.toml [env]` together, after confirming whether a secret
  or `[env]` wins.

## 4. Recurring maintenance

- [ ] **National holidays.** Each January, seed the next year (coverage ends
  31 December 2027). When an Eid is declared, run a one-line confirming
  migration. `national-events-seed.spec.ts` fails on an unconfirmed estimate
  whose date has arrived. Fix it with the migration, never by editing the
  test.
- [ ] **SECURITY DEFINER review** due at count 26 (currently 23). See CLAUDE.md.

## 5. Waiting for a trigger (not to start early)

| Item | Trigger |
|---|---|
| Outcome analytics (averages, pass rates, trends, teacher outcomes) | A school completes a term with ≥ 40 students in ≥ 2 arms, ≥ 80% registers, ≥ 90% scores and released cards (the completeness report shows it) |
| Per-class bell schedules | A real school with different bell times per section |
| Curriculum reranker | A plan whose `modelSaysGrounded` is measurably wrong, or a second subject in the corpus |
| Guardian school selector at login (`AMBIGUOUS_GUARDIAN_ACCOUNT`) | A parent at two schools with one password |
| Gradebook autosave | A product decision. Sign-off, audit volume and `entered_by` meaning all change. |
| Staff-mobile timetable; cross-class timetable copy; publish notifications | A school asking |
| `pg_trgm` student search | Rosters large enough for `ILIKE` to be slow |
| `packages/ui` `main` → `dist/` | Anything outside Next importing it |
| Forced reset for Phase 0-policy passwords | Before public launch |

## 6. Ideas

Long-range feature ideas and the AI wishlist are unscoped. They are kept in
`docs/deferred-archive.md`:
- "Future feature ideas";
- "AI & advanced feature wishlist";
- "Roadmap / strategy".

Promote one to this file only when it is scoped.
