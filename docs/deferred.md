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

- [x] **DONE 2026-10-07 — the web session token no longer reaches
  JavaScript.** The staff web app calls the API at `api.schoolkit.ng` with the
  HttpOnly `sk_session` cookie, shared across `schoolkit.ng`. No response
  carries the token, and no request carries `Authorization`.
  - API side: #380. `AuthGuard` accepts the cookie only from the web app's
    Origin. CORS allows credentials for that origin only.
  - Owner steps done: the `api` CNAME, the Fly certificate, and the Vercel
    `NEXT_PUBLIC_API_URL` and `SESSION_COOKIE_DOMAIN`.
  - Web side: #381. The first production deploy was refused by its own guard,
    because Turbo's strict env mode hid `SESSION_COOKIE_DOMAIN` from the
    build. Fixed in #383, which declares it in `turbo.json`.
  - Steps and rollback: `docs/runbooks/web-session-cookie.md`.
  - Routing through Vercel was rejected: its 4 MB middleware body limit
    breaks curriculum, register photo, receipt and CSV uploads.
- [ ] **Paystack mobile checkout has never been round-tripped.** Returning
  the parent to the app is built (2026-10-07):
  - The app asks for `returnTo: "app"` when it starts a payment. That is a
    fixed choice the API turns into an address, never a URL the client sends.
  - The API then hands Paystack `${PORTAL_BASE_URL}/payments/callback/app`.
  - That portal page sends the browser on to `schoolkit://payments/callback`.
  - The app opened checkout with `openAuthSessionAsync`, which closes the
    in-app browser when it reaches that address. `app/payments/callback.tsx`
    catches the same address on Android, where it also arrives as a deep link.
  - Payment correctness never depends on the redirect: `runCheckout` polls
    `GET /portal/payments/:reference`, and the webhook is the authority.

  **Still needs:** a Paystack test-mode subaccount on a dev school, to pay
  once from a phone and see checkout close and the invoice update.
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
  - The accuracy pass is built (2026-10-07): `pnpm ai:eval:registers` scores
    each page per field, separates safe blanks from silent errors, times every
    call against the 60-second synchronous budget, and answers yes or no
    against a proposed switch-on bar. How to prepare the pages:
    `docs/modules/smart-student-import.md` §8.
  - **Still needs:** the ~10 photographed pages and their ground truth (kept
    out of the repo; the default folder is git-ignored), one run on a real
    key, and the prompt v2 that run will probably call for.

## 2. Open engineering work

### Auth and permissions
- [x] **DONE 2026-10-08 — Two authorization systems that do not consult each
  other.** `assertUserActiveAndHasOneOf` checks role keys in services that
  controllers already gate with `@Permissions`. Three bursar bugs and one admin
  bug came from a role list rejecting a role that held the permission.
  - **The spec already existed:** `rbac-two-gate-conformance.spec.ts` fails
    when a route's role list rejects a role that holds its permission, unless
    the disagreement is a documented design exception.
  - **Its blind spot is closed (2026-10-08).** It only saw a role check
    written directly in the service method the controller calls. A check in a
    private helper, a same-file function or another injected service (for
    example `CbtResultsService` → `CbtSittingsService.resolveScope`) made the
    route look ungated, so its role list was never compared. It now follows
    those calls. Verified by removing `teacher` from the CBT role list: the old
    spec passed, the new one names the 14 CBT routes that would lock teachers
    out.
  - **The ~200 role checks stay.** No school can create a role (only the four
    seeded ones exist), so role keys and permissions come from the same seed
    and the spec keeps them in step. Many role lists are also deliberately
    narrower than the permission (the documented exceptions, such as teachers
    reading rosters only through their scoped endpoint). Removing them in bulk
    would widen access on those routes for no fix. Revisit if custom roles are
    ever added: then role-key checks would reject them everywhere.
  - Full history: archive, "RECURRING PATTERN".
- [x] **DONE 2026-10-08 — Staff sign-in works on Vercel preview deployments
  again** (broken since #381). A preview (`*.vercel.app`) could not send the
  `schoolkit.ng` cookie to the API, and its origin is not one the API allows.
  Preview builds now send the browser's API calls to their own
  `/api/preview-api/*`, which reads the HttpOnly cookie on the server and
  forwards with a bearer token, so the token still never reaches page
  JavaScript. The route answers 404 outside a preview, refuses cross-site
  writes, and the preview's cookie is host-only. Production is unchanged and
  keeps calling the API directly (Vercel's 4.5 MB body cap would break uploads
  through a proxy; acceptable on a preview). The Preview environment on
  `school-kit-web` needs `NEXT_PUBLIC_API_URL` set, or a preview calls
  `localhost`.
- [x] **DONE 2026-10-08 — Staff invitations can be resent and revoked.**
  `POST /users/invitations/:id/resend` ends the old link and issues a new one
  for the same person and role; `POST /users/invitations/:id/revoke` ends a
  pending one. Both need `user.invite`, are audited, and leave owner
  invitations to the platform admin. On `/settings/users` an invitation whose
  link is no longer on screen offers "New link", and every row has "Cancel";
  the staff roster's invitation rows link there.
- [x] **DONE 2026-10-08 — One `hasPermission`.** The 11 local copies now
  import `lib/auth/has-permission.ts` (`invoice-cancel.ts` re-exports it for
  its own callers and spec).
- [ ] **Deliberate sign-out loses a dirty form.** `logout()` destroys the
  server session before the browser's "leave site?" prompt fires.
  - **Fix:** check for dirty state before the server logout. That needs a
    shared dirty-state registry.
  - Four hand-written `beforeunload` guards exist, gated by
    `session-end-invariants.spec.ts`.
  - Forced expiry still destroys unsaved gradebook work. No mechanism has
    been chosen; measure how often it happens first (archive: "Session
    expiry", "Session-end work loss").
- [x] **Mobile no longer signs out silently on a 401** (found already built,
  2026-10-08). The API client passes the server's code to `onUnauthorized`,
  `session.tsx` turns it into a message (`session-end.ts`), and the sign-in
  screen shows it. Network failures still never sign anyone out. Seeing it on
  a device is part of "Device checks" below.
- [x] **DONE 2026-10-08 — Email failures reach Sentry.** `EmailService.send`
  reports every failed send (API-level error or network throw) as a Sentry
  error tagged with its `purpose` (`staff-password-reset`,
  `guardian-password-reset`, `guardian-invitation`, …) and the address
  redacted; the subject is left out because it can carry a child's name.
  Callers' responses are unchanged, so forgot-password still reveals nothing.

### Money
- [x] **DONE 2026-10-08 — Double-PENDING overpayment.** Two Paystack
  checkouts on one invoice could both be paid, and both were applied with
  nothing to say so.
  - **Prevention:** both ways a checkout starts (staff `initPaystack` and the
    parent's `PortalPaymentsService.initiate`) now share
    `assertNoPaystackInFlight`: one live checkout per invoice, whoever opened
    it, inside a 30-minute window.
  - **Backstop:** when Paystack confirms a payment that takes the invoice past
    what it owes, the payment still stands, because the money really left the
    parent's account. The excess gets a `payment.paystack-overpayment` audit
    row and a Sentry warning. The invoice page shows "Overpaid" with a note to
    refund the extra payment.
  - Still possible, by design: a checkout older than the window, or cash
    recorded while a parent is mid-checkout. Both now land on the backstop
    rather than going unnoticed.
- [ ] **Finance UX follow-ups from PR #220**, including the F-34 bulk-invoice
  confirmation (archive, "Finance / bursar invoice UX").
- [x] **DONE 2026-10-08 — `notIn: ["DRAFT", "CANCELLED"]` literals.** All
  five in `finance.service.ts` now use `BILLED_EXCLUDED_STATUSES`.

### Data and infrastructure
- [x] **DONE 2026-10-08 — `schema.prisma` vs migration drift.** Diffing a
  fully migrated database against the schema found a real bug behind it:
  `audit_logs` had **no `(school_id, created_at)` index** since the June
  partitioning migration, whose `CREATE INDEX IF NOT EXISTS` was skipped
  because the table being replaced still held an index of that name. Every
  per-school audit read scanned every partition. Migration
  `20261011120000_audit_logs_school_created_index` creates it on the parent
  (and so on every partition). The primary key and the `fee_items` index now
  carry their real names via `map:`.
  - Three differences remain and are expected, because Prisma 5 cannot
    express them: the pgvector HNSW index on `curriculum_chunks`, the partial
    unique index `payments_school_id_paystack_reference_key`
    (`WHERE paystack_reference IS NOT NULL`), and the `school_week_days` array
    default. A naive `prisma migrate diff` proposes all three; ignore them.
- [x] **DONE 2026-10-10 — `withTenant` no longer retries body timeouts.**
  Only the never-started `P2028` ("Unable to start a transaction") is
  retried; a body that outlived its budget ("Transaction already closed" /
  "Transaction not found") is thrown at once with a `not retrying` warning.
  Told apart by Prisma's message, not by elapsed time: a never-started
  transaction also waits out `maxWait` first. Pinned in
  `tenant-timeout.spec.ts` (the body ran twice before).
- [ ] **No `[schoolId, date]` index for whole-school attendance reads**
  (dashboard today and the 8-week trend). **Trigger:** slow dashboard queries.
- [ ] **Production `connection_limit` is unverified** (assumed 3). Check
  `app_user` connections in the Neon dashboard.
- [x] **DONE 2026-10-08 — Expired-session sweeper.**
  `SessionSweeperService` (daily, 03:40 UTC) deletes staff, guardian and
  student sessions more than a day past expiry, school by school under
  `withTenant` (no new SECURITY DEFINER function).
- [ ] **Audit writes are synchronous** rather than queued, as ARCHITECTURE.md
  describes. Revisit only if a write path's latency shows it.

### Observability
- [x] **DONE 2026-10-10 — Repeated validation failures reach Sentry.** A
  single 400 is still not captured. `ValidationFailureMonitor`
  (`apps/api/src/observability/validation-failure-monitor.ts`) counts every
  `ValidationError` per route template, issue path and issue code, and raises
  one fingerprinted Sentry warning (plus a log line) when a key reaches 5 in an
  hour; Sentry's event count on that issue is the trend. It never reads the
  body, the URL's ids, or any message (Zod's quote the rejected value).
  Counts are per API machine and reset on deploy. What it cannot see: whether
  the person then gave up. That funnel view would be a PostHog event on the
  web side, still not built.
- [x] **DONE 2026-10-08 — Web source maps to Sentry.** `next.config.mjs` is
  wrapped in `withSentryConfig`, which uploads the maps (then deletes them from
  the build) only when `SENTRY_AUTH_TOKEN` is set; build-time
  auto-instrumentation is off, so runtime is unchanged. **To switch on:** set
  `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` (and `SENTRY_PROJECT_WEB` if the
  project slug is not `school-kit-web`) on `school-kit-web` in Vercel; all
  three are declared in `turbo.json`.
- [ ] **No server-side PostHog.** Browser capture only.
- [x] **DONE 2026-10-10 — One redactor.** `packages/types/src/redact.ts`
  (exported from `@school-kit/types`) is used by the API's Sentry and both web
  Sentry configs. The web copy had drifted: it masked only credential keys, so
  a browser event could carry a student's name, date of birth or medical
  notes. Pinned by `apps/web/src/sentry-redaction.spec.ts`.

### Product gaps
- [x] **DONE 2026-10-10 — Teachers' gradebook explains why it is empty.**
  `GET /teacher-scope/me` now returns `enrolledCountByArm` (this term's
  students in each of the teacher's OWN arms, nothing outside their scope;
  `setup-state` untouched). The gradebook picker shows each class's count,
  says when none of the teacher's classes has students and that the admin
  enrols them, and says when no subject is assigned; the grid's empty state
  says the same for its class. `TeacherPrerequisiteNotice` has no action
  button, since a teacher cannot take the step.
- [x] **The onboarding guide implies a class-subject matrix dependency that
  does not exist.** Done 2026-10-06: `docs/onboarding-guide.md` was rewritten
  for a non-technical owner, ordered by the dashboard setup checklist, and the
  Matrix is now described as an optional reference list.
- [x] **DONE 2026-10-10 — Report cards built after every subject is signed
  off are built SUBJECT_REVIEWED.** `ReportCardService.build` runs the same
  `cascadeSubjectReviewedIfComplete` the sign-off path runs, at the end of the
  build, so the order (sign off then build, or build then sign off) no longer
  matters. Pinned in `report-card-workflow.service.spec.ts` and
  `e2e/tests/admin-gradebook.spec.ts`.
- [x] **DONE 2026-10-10 — Staff roster's 200-profile cap.** `GET /users`
  now returns each user's `teacherProfileId` (one join), so `/staff` no
  longer reads one page of `GET /teacher-profiles`, which marked every teacher
  past the 200th "Pending profile". `GET /users` still returns the full set,
  deliberately: five screens (payroll, class arms, staff detail and edit, the
  roster) need every staff member, and the roster's search, filters and CSV
  export work over all rows. Add a cursor only if a school's staff list itself
  becomes slow.
- [ ] **Bulk student grid** — what is left:
  - bounded-parallel submit;
  - a real `POST /students/bulk`;
  - draft persistence.
- [ ] **Teacher shell sidebar background stops partway down a short page.**
- [x] **DONE 2026-10-10 — Moving a timetable lesson is one request.**
  `PUT /timetable/lessons` takes an optional `moveFrom` (day, start period,
  span); the API clears that block in the same transaction as the save, so a
  failed move leaves the lesson where it was and a successful one never
  leaves it in both places. The old cells count as free, so a lesson may move
  onto its own old cell (which used to fail with `CELL_OCCUPIED`). A stale
  source answers `MOVE_SOURCE_EMPTY`; the audit row records `movedFrom`.
- [x] **DONE 2026-10-10 — The `/dashboard` navigation race.** The term
  selector's automatic default-term write (`router.replace`) is skipped once
  the person has started to leave: a click on a link to another app page, or
  Back/Forward. Choosing a term from the select still navigates. Reproduced
  in `e2e/tests/dashboard-navigation-race.spec.ts` by releasing the held terms
  response while the click is in flight. **Not covered:** a navigation started
  from code rather than a link (the command palette's `router.push`) while the
  dashboard is still loading. **Do not** switch the write to
  `history.replaceState`: with Next's own state it is never synced into
  `useSearchParams` (the dashboard stays loading), and without it Next's sync
  cancels the in-flight navigation exactly as `router.replace` does. Both were
  tried on PR #388.
- [x] **DONE 2026-10-10 — Staff roster's 200-profile cap.** `GET /users`
  now returns each user's `teacherProfileId` (one join), so `/staff` no
  longer reads one page of `GET /teacher-profiles`, which marked every teacher
  past the 200th "Pending profile". `GET /users` still returns the full set,
  deliberately: five screens (payroll, class arms, staff detail and edit, the
  roster) need every staff member, and the roster's search, filters and CSV
  export work over all rows. Add a cursor only if a school's staff list itself
  becomes slow.
- [ ] **Bulk student grid** — what is left:
  - bounded-parallel submit;
  - a real `POST /students/bulk`;
  - draft persistence.
- [ ] **Teacher shell sidebar background stops partway down a short page.**
- [x] **DONE 2026-10-10 — Moving a timetable lesson is one request.**
  `PUT /timetable/lessons` takes an optional `moveFrom` (day, start period,
  span); the API clears that block in the same transaction as the save, so a
  failed move leaves the lesson where it was and a successful one never
  leaves it in both places. The old cells count as free, so a lesson may move
  onto its own old cell (which used to fail with `CELL_OCCUPIED`). A stale
  source answers `MOVE_SOURCE_EMPTY`; the audit row records `movedFrom`.
- [x] **DONE 2026-10-10 — The `/dashboard` navigation race.** The term
  selector's automatic default-term write is skipped once the browser has left
  the page that started it, and uses `history.replaceState` (kept in step with
  `useSearchParams`, but not a navigation), so it can no longer cancel a click
  made while it was loading. Choosing a term from the select still navigates.
  Reproduced deterministically in `e2e/tests/dashboard-navigation-race.spec.ts`
  by holding the terms response until after the click.

### Docs and tooling
- [x] **DONE 2026-10-08 — `docs/journal/` caught up** with a single catch-up
  entry, `docs/journal/2026-10-08.md`, covering 2026-09-06 to today by theme.
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
