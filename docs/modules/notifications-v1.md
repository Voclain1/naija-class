
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

**Part 2 built (2026-09-23): the two teacher reminders.**

- **Register not taken** — 10:00 Lagos on weekdays. Only on a real school day:
  weekends, holidays and breaks are excluded by the same `computeSchoolDays`
  the completeness report uses, reading the school's own merged calendar, so a
  teacher is never chased on a day the school was shut. One notification per
  TEACHER (a teacher who forms two classes hears once), keyed on the date so
  the sweep is safe to re-run.
- **Marks not entered** — the honest version. **The schema carries no
  per-assessment deadline**, so "your marks are due today" would have been an
  invented rule about someone's work. What it does carry is the TERM'S END
  DATE, and marks are what a term ends with. So the reminder fires exactly
  seven days before the term ends, to teachers with an assigned subject that
  has no marks at all, and says precisely that. Keyed on the term, so it is a
  deadline reminder rather than a daily nag.
- Both sweeps copy the shape `FinanceService.transitionOverdueInvoices` and
  `OnboardingNudgeService` already use — walk ACTIVE schools, each inside its
  own tenant transaction, never let one school's failure stop the next — and
  `teacher-reminders.service.ts` was added to the `basePrisma` allowlist with
  that justification, as the allowlist requires.

**Part 3 built (2026-09-23): the mobile half.**

- Staff register a device at sign-in and release it at sign-out, on the same
  fire-and-forget path families use — a permission prompt must never stand
  between a teacher and their register.
- **Correction to N2 as written:** this plan said a staff device should also
  be released at the 2-minute background lock. That is wrong, and it is not
  built. The lock hides the screen; it does not end the session, and a
  notification carries nothing private (N3). Releasing it there would stop a
  teacher being told their register is missing precisely while the app is in
  their pocket, which is when the telling is worth anything.
- Tapping a notification opens what it was about, by principal: the same
  "results" hint is a parent's children list, a student's results screen and
  a head's approvals. An unknown hint goes home rather than nowhere, because
  a tap that appears to do nothing reads as a broken app. The cold-start tap
  (app not running, notification tapped hours later) is handled too.
