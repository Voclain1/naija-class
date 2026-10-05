# Platform-admin tools

The super-admin surface (`/super-admin`, `apps/api/src/modules/platform-admin/`)
is where the platform operator looks after schools across tenants. What existed
before this doc, and is not re-scoped here:

- the read-only roster of schools and staff (PR #142);
- school provisioning with an owner invitation (PR #149);
- the early-access marker, the per-school AI switch, staff-mobile visibility;
- the Paystack assisted-setup queue.

Access is `User.isPlatformAdmin`. It is granted only by a direct database
update, and `PlatformAdminGuard` re-reads it on every request. Every action
writes a `platform_admin.*` audit row with `school_id = NULL`.

This doc turns the "Platform super-admin — expansion scope" list in
`docs/deferred.md` into slices.

## Slices

| Slice | What | Status |
|---|---|---|
| 1 | Slug on the roster, AI budget control, owner-invitation resend/cancel | **Built 2026-10-06** |
| 2 | School lifecycle: suspend / reactivate, and delete | **Built 2026-10-07** |
| 3 | Reading the audit trail (platform admins, the platform's own rows) | **Built 2026-10-07** |
| 4 | Platform analytics (signups, activation, adoption) | Needs an anonymisation design |
| — | Billing management | Blocked on pricing |
| — | Impersonation ("act as this school") | A decision, not a feature — not started |

## Slice 1 — built 2026-10-06

None of this needed a product decision, so it went first.

**D1. The roster shows each school's slug.** Two production schools share the
name "Virgo Fidelis Montessori School". The roster is the list an operator
picks a school from before a write, and the slug is the human-readable field
that tells them apart. Slugs are public: students type one to sign in.
`platform_admin_list_schools()` previously omitted `slug`. Migration
`20261006120000_platform_admin_roster_slug_budget_owner` reverses that
explicitly, rather than silently.

**D2. `PATCH /platform-admin/schools/:schoolId/ai-budget`.**
- Takes `{ aiMonthlyTokenBudget: number | null }`, a whole number of tokens
  from 0 to 1,000,000,000. `null` means "use the platform default".
- Until this, capping a school meant a raw production `UPDATE` with a
  hand-written audit row (2026-08-16, Virgo Fidelis at 750,000).
- Same shape as the AI switch: `schools` has no RLS policy, so it is a
  one-column update plus an audit row (`platform_admin.schools.set-ai-budget`,
  the action name the hand-written row used).
- The roster now returns both the stored value and the effective one
  (`aiEffectiveMonthlyTokenBudget`), so the dashboard never carries its own
  copy of the default. That is the second omission revisited explicitly in the
  migration: a write with no read is the blind-write gap `ai_enabled` and
  `staff_mobile_enabled` were each added to close.

**D3. Resending or cancelling an owner invitation.** Previously cut from PR
#149; a lapsed or mistyped invitation needed SQL.

| Route | What it does |
|---|---|
| `POST /platform-admin/schools/:schoolId/owner-invitation/resend` | Ends every open owner invitation for the school and sends a fresh one, to the last address or a corrected one. |
| `POST /platform-admin/schools/:schoolId/owner-invitation/cancel` | Ends every open owner invitation and sends nothing. |

- "Ends" means `expires_at` is set to the transaction's start time. The row
  stays as the record of what was sent, and a link already in someone's inbox
  then reads as **expired** (410), not as unknown.
- The time is set in SQL, truncated to milliseconds. JavaScript's "now" lands
  after the transaction's `now()`, and a `timestamp(3)` column rounds
  microseconds up half the time. Either way the invitation would still look
  live to the availability check that follows, which would then refuse a
  resend to the same address. The rounding case was found as a 50%-flaky spec.
- **Resend is refused once the school has an owner** (`409 SCHOOL_HAS_OWNER`).
  From then on, inviting people is the owner's job, in the school's own
  settings.
- The availability check runs **inside** the resend transaction, so it sees the
  just-ended invitations. An address that already has an account is still
  refused (`EMAIL_TAKEN`), and the whole transaction rolls back, leaving the
  open link working.
- Audit actions: `platform_admin.owner-invitation.resend` (email redacted,
  `emailChanged`, `endedCount`) and `platform_admin.owner-invitation.cancel`.

**D4. `has_owner` on the roster.** `owner_invite_pending` only counts
**unexpired** invitations, so an expired one made a school look like an
ordinary active school. `has_owner` (does any staff account hold the `owner`
role?) lets the dashboard say **No owner** and offer a resend, whether the
last invitation expired or was cancelled.

**D5. UI: a "Manage" dialog per school, not more columns.** The table was
already nine columns wide, and the operator often works from a tablet. The
roster gains only:
- the slug, under the name;
- the effective AI budget, under the AI switch ("750k/mo", or "2M/mo
  (default)");
- the "No owner" status.

The dialog holds the budget editor (with "Use platform default") and the owner
invitation actions. Both actions ask for confirmation, and the new link is
shown in case the email does not arrive.

**Unchanged:** SECURITY DEFINER count stays 23 (`platform_admin_list_schools`
changed shape; nothing was added). Still omitted from the roster: address,
phone, email, colours, logo, onboarding step, NDPR consent, Paystack fields,
`parent_summary_enabled`.

**Tests:**
- `platform-admin-access.spec.ts`: 44 tests, including the allow-list shape
  test, which now lists the four new keys with reasons.
- `school-manage.spec.ts`: pure helpers.
- E2E `platform-admin-tools.spec.ts`: real sign-in at `/super-admin/login`,
  provision, cap, reset, resend to a corrected address (old link 410, new link
  200), cancel, and the audit trail.

## Slice 2 — school lifecycle (built 2026-10-07)

**Owner's decisions (2026-10-05):**
- Suspending blocks every sign-in — staff, parents, students — but parents can
  still pay fees through payment links.
- A school may be deleted only if it has never recorded a payment, after
  typing its slug; everything else can only be suspended.
- The `virgo` duplicate is test data, to be deleted.
- The audit trail is readable by platform admins only, to start (slice 3).

**D6. Suspension is a timestamp, `schools.suspended_at`, not `status = SUSPENDED`.**
`status` also carries ONBOARDING vs ACTIVE, and overwriting it would lose where
a suspended school had got to. It is the same choice as
`guardians.portal_disabled_at`. `SchoolStatus.SUSPENDED` stays unused.

**D7. Where suspension is enforced.**
- **Sign-in.** `createSession`, `createGuardianSession` and
  `createStudentSession` refuse a suspended school
  (`common/auth/school-suspension.ts`). Every sign-in path goes through one of
  the three: password, staff mobile, web handoff, invitation accept and
  password reset. The check runs *after* a credential has been verified, so it
  never tells a stranger which schools are suspended.
- **Live sessions.** The three session resolvers return `school_suspended`,
  and the three guards refuse with `401 SCHOOL_SUSPENDED`. The message is "This
  school's School Kit account is suspended. Please contact the school."
- **Timing.** Staff sessions are cached for 30 seconds, so a staff session ends
  within 30 seconds. Parent and student sessions end at their next request.
- **Payments still work.** Payment links and the Paystack webhook are not
  sessions, so fees can still be paid.
- **Background jobs** (reminders, announcements) are not paused in this slice.
- **Platform admins are untouched.** `platform_admin_resolve_session` is not
  changed. The API instead refuses to suspend or delete a school that holds a
  platform admin (`409 SCHOOL_HAS_PLATFORM_ADMIN`), so the operator can never
  lock out the school they work from.

**D8. Delete.**

| Route | What it does |
|---|---|
| `GET …/deletion-check` | Counts what a delete would remove (students, staff, parents, payments) and lists any blockers. Audited, like every read on this surface. |
| `POST …/delete` with `{ confirmSlug }` | Deletes the school. It is a POST because the web proxy does not forward a DELETE body. Throttled to 5 a minute. |

- The payment and platform-admin checks run again inside the deleting
  transaction, so a payment recorded after the check still stops the delete.
- **Order.** Rows are deleted child-before-parent over the foreign-key graph,
  computed from the catalog. This is the same approach as
  `scripts/prune-smoke-schools.sql`: several foreign keys are RESTRICT, so a
  plain cascade from `schools` fails.
- **Every delete is an ordinary `app_user` DELETE** under the school's own
  GUC. RLS bounds it to that school, so a bug here cannot reach another
  tenant's rows. Proven by a spec that checks the neighbouring school's row
  count is unchanged.
- **Where the code lives.** The logic is in `school-deletion.ts`, not
  `platform-admin.service.ts`, whose import-boundary spec keeps it away from
  financial tables. This file reads one thing about payments: a count, under
  RLS.
- **The audit row** (`platform_admin.schools.delete`) has `school_id = NULL`
  and names the slug, name and counts, so it outlives the school.
- **Files in storage** (a logo, expense receipts) are not removed. A school
  that never took a payment has few, so this is left as a follow-up.

**D9. Exam-paper freeze vs deleting a school.** CP5c's
`exam_paper_frozen_guard` refused to delete a FINAL paper under any
circumstances. That made a school holding one undeletable, both here and by
the smoke prune. It now steps aside only when
`schools.deletion_started_at` is set. That column is set inside the delete
transaction and disappears with the row. It is a property of the data, set by
the two paths that delete schools, not a session setting any caller could
flip. The prune script sets it too.

**Unchanged:** SECURITY DEFINER count stays 23. Four functions change shape:
the three principal session resolvers and `platform_admin_list_schools`, which
gains `suspended_at`. None is added.

**Tests:**
- `platform-admin-school-lifecycle.spec.ts` (12 tests):
  - suspension through all three guards and all three session helpers;
  - reactivation, the audit trail, and the operator's own school refused;
  - delete of a school holding a FINAL exam paper and RESTRICT chains, with no
    rows left behind and the neighbour untouched;
  - a wrong slug, a paid school and a platform admin's school refused;
  - staff refused.
- **Mutation checks:** dropping `deletion_started_at`, or the guardian guard's
  check, each fails the spec.
- **E2E (`platform-admin-tools.spec.ts`, second test):** suspend a real school,
  its owner's sign-in is refused, reactivate, then delete by typing the slug.

## Slice 3 — the platform's audit trail (built 2026-10-07)

**Owner's decision (2026-10-05): platform admins only, to start.**

**D10. What it shows: the platform's own rows, and nothing else.**
`GET /platform-admin/audit-log` reads `audit_logs` rows with
`school_id IS NULL`. That is exactly what this surface writes for provisioning,
the AI switch and budget, owner invitations, suspension, deletion and sign-ins.
It is also exactly what `audit_logs`' RLS policy lets a read without a GUC see.
- No GUC is set, and no SECURITY DEFINER function is used.
- A school's own audit rows (grades, payments, staff changes) are hidden by
  the policy itself, not by a filter someone could forget. The spec writes one
  and checks it never appears.
- Reading a school's own trail is the separate, still-open question in
  `docs/deferred.md`: who at a school may read it, and redacted how.

**D11. What each entry carries.**
- **Kept:** the action, when, who (the name from the staff roster, via
  `platform_admin_list_users`), the school (named live from `schools`) and the
  metadata as written. Emails are already redacted at write time.
- **Never returned:** `ip_address`.
- **A deleted school stays named.** Its name comes from the delete entry's
  metadata, for its earlier entries too.

**D12. Changes only, by default.** Page views (the schools list, the staff
list, the Paystack queue, deletion checks, reading this log) are each audited,
but they would bury the changes. They are hidden unless the operator asks for
them with `includeViews=true`. Reading the log is itself audited
(`platform_admin.audit-log.read`).

**D13. Paging.** Newest first, 50 to a page by default. A
`before = "<time>|<id>"` cursor gives stable paging, with no repeats or gaps
when two entries share a millisecond.

**UI:**
- **"Platform activity" card** at the foot of the dashboard: every school,
  each entry written as a sentence (`audit-entry.ts`), with a "Show page views
  too" switch and "Load more".
- **"History" section** in each school's Manage dialog. It reloads after any
  change made in the dialog.

**Tests:**
- 6 new cases in `platform-admin-school-lifecycle.spec.ts`:
  - staff are refused;
  - entries come newest first, with who and which school, and no IP address;
  - a school's own row never appears;
  - views are hidden unless asked for;
  - the cursor neither repeats nor skips;
  - a deleted school stays named.
- `audit-entry.spec.ts` covers the sentence formatter.
- E2E: the dialog's History shows the suspension straight away, and the
  dashboard's activity card shows the suspend, reactivate and delete of a
  school that no longer exists.
