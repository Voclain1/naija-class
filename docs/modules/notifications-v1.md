
## Status

**Part 1 built (2026-09-23): the rail, and the two family events.**

- `PrincipalType.STAFF` and `device_tokens.user_id`, in **two** migrations:
  Postgres refuses to use a new enum value in the transaction that added it,
  and the second migration needs `'STAFF'` inside a CHECK. Both CHECKs that
  make a device row routable were widened — exactly one owner, and
  `principal_type` agreeing with it — or a staff device could not be stored
  at all.
- `POST /devices` and `DELETE /devices/:token` under the staff guard.
- `notification_deliveries` with its unique (school, event, event id,
  principal) index, RLS ENABLE + FORCE. The row is claimed BEFORE the send,
  so a crash between them means a missed notification rather than a duplicate.
- `notifyOfEvent` — every principal, quiet hours, once-only, **never SMS**.
- `EventNotifierService` owns the audiences, so the report-card workflow and
  the payments service stay about report cards and payments. Both call it
  after their transaction commits, and neither can fail because of it.
- Wired: **results released** (a class's guardians once each, plus each
  student) and **payment recorded** (the child's guardians).

**Part 2, still to build:** the two teacher reminders (marks due, register not
taken). Both are time-of-day sweeps — `@Cron` and `ScheduleModule` are already
in use for the overdue-invoice and onboarding-nudge jobs — but "marks are due"
needs a deadline the schema does not obviously carry yet, so it gets its own
research rather than an invented rule.

**Part 3, mobile:** staff device registration at sign-in, removal at sign-out
and at the background lock, and tapping a notification opening the right
screen.
