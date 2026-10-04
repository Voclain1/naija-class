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
| 2 | School lifecycle: suspend / reactivate, and removing test schools | Needs decisions (below) |
| 3 | Reading the audit trail | Needs decisions (below) |
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

## Slice 2 — school lifecycle (needs decisions)

`SchoolStatus` has `SUSPENDED` and `ARCHIVED`, but nothing moves a school into
either, and nothing reads them. Production also carries test schools
(`smoke-*` rows from every deploy, and the near-empty duplicate Virgo Fidelis)
that need SQL to remove, because there is no `DELETE /schools/:id`.

Questions for the owner:

1. **What does "suspended" stop?**
   - Proposed: every sign-in (staff, parents, students) is refused with a
     "contact School Kit" message, and existing sessions stop at their next
     request.
   - Data is untouched, and parents can still pay outstanding invoices (or
     not — decide).
2. **Hard delete: for whom?**
   - Proposed: only schools with no payments ever recorded, after typing the
     school's slug to confirm. That covers smoke-test rows and empty sign-ups,
     never a school with money history.
   - Everything else is archived, not deleted.
3. **The `virgo` duplicate** (1 student, 1 staff, 1 enrolment): is that student
   real, so it should be moved, or a test record to discard?

## Slice 3 — reading the audit trail (needs decisions)

See `docs/deferred.md` "No audit trail is inspectable through the product".
The open questions are recorded there:
- who may read it;
- how it is scoped across monthly partitions;
- how `ip_address` and `metadata` are redacted;
- keeping platform-admin rows (`school_id IS NULL`) out of a school's view.

A platform-admin-only view of the operator's own `platform_admin.*` actions is
the smallest safe first step.
