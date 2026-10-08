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
