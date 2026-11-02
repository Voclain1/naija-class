# Getting started: activation (2026-10-30)

Owner's request, 30 October. About 100 of the 131 real schools had **no
students**, and most of the rest had one or two: owners signed up and stopped.
This bundle helps them start and lets SchoolKit see where each school is.

Owner's decisions (30 October):

1. The owner's contacts are **visible** on every row of the platform admin's
   Getting started page (not behind a reveal).
2. Reminders go to **existing stuck schools and new schools**, with tracking.
3. The setup-call page opens again for schools with **fewer than 5 students**.

The platform admin was redesigned in the same bundle
(`docs/modules/platform-admin.md`, "Console redesign").

## The stages

Each school is at the furthest stage its live counts show
(`activationStage` in `@school-kit/types`). Nothing is stored: the counts are
the same ones the dashboard checklist reads (`SetupStateService`).

| Stage | Means |
|---|---|
| 1. Signed up | Has not finished the setup wizard (status not ACTIVE). |
| 2. Set up | Finished the wizard; no students. |
| 3. Students added | Has students, none in a class this term. |
| 4. Students in classes | Students enrolled this term; no teacher invited. |
| 5. Staff invited | Teachers with accounts or live invitations. |
| 6. In use | Has marked a register, issued an invoice or entered a score. Any stage reaches it. |

**Stuck** means stage 1 to 3 and a week or more since sign-up
(`isStuck`, `STUCK_AFTER_DAYS = 7`).

## Setup reminders

`ActivationService` (`apps/api/src/modules/activation/`) runs daily at 07:41
UTC (08:41 in Lagos). It replaced the one-shot `OnboardingNudgeService`, whose
module was removed; `schools.onboarding_nudge_sent_at` stays as history.

- **Who gets them:** the first owner of a school at stage 1 to 3 that is not
  suspended and has not stopped them. Not an owner whose invitation is still
  unaccepted: the links need a sign-in. Not an address that bounced or
  complained (`email_suppressions` ALL).
- **When** (`nextActivationEmail`, pure):
  - FIRST: two days after sign-up.
  - SECOND: seven days after sign-up, and at least five after the first.
  - THIRD: 21 days after sign-up, and at least seven after the second.

  The "after the previous one" floors space out schools that signed up before
  reminders existed: they get the first, then the others five and seven days
  apart.
- **Catching up:** existing schools whose first reminder is more than a week
  overdue go **25 a day** (`MAX_CATCH_UP_PER_RUN`), newest sign-ups first, so
  the first sends are spread over the first week.
- **What it says** depends on the stage (`reminderStep`):
  - stage 1: finish the wizard;
  - stage 2: add students, with Smart Import;
  - stage 3: put students in classes.

  Every reminder offers the free setup call and SchoolKit's contacts, and
  ends with **Stop these emails**. It also carries the one-click
  `List-Unsubscribe` header.
- **Links:** every link goes through the API, which counts the click and then
  redirects: `GET /api/v1/activation/c/:schoolId/:emailId/:target/:sig`.
  - The signature is an HMAC under `RESULT_PIN_HMAC_KEY` with its own label,
    the pattern the unsubscribe and admission-tracking links use. Nothing
    extra is stored.
  - Targets are a fixed list (`next-step`, `setup-call`, `smart-import`,
    `help`), so the redirect can never go to an address taken from the link.
  - `next-step` goes to the school's current next step.
  - A link that does not verify goes to the staff sign-in and counts nothing.
  - The links point at `API_PUBLIC_URL` (default `https://api.schoolkit.ng`
    in production).
- **Stop:** `GET` (a page) and `POST` (one-click) `/api/v1/activation/stop/...`.
  Each stamps `schools.setup_emails_stopped_at` and writes an audit row. A
  second press changes nothing.
- **Tracking:** `activation_emails`, one row per reminder per school, under
  FORCE RLS:
  - `status`: SENT, then DELIVERED, BOUNCED or COMPLAINED from the Resend
    webhook, which tells these apart by the `stream: activation` tag. A
    reminder bounce suppresses nothing the school itself sends.
  - FAILED when the send failed; a failed reminder is retried on the next run.
  - `click_count` and `first_clicked_at`.
  - `stage_at_send`.
- **Audit:** `activation_email.sent` (kind and stage, never the address) and
  `activation_email.stopped`.

## The setup call, again

- Migration `20261130120000_activation` reopens the setup-call page once for
  schools that finished setup with fewer than 5 students and no booking. It
  reads `students` under FORCE RLS, so it runs only for a role that bypasses
  RLS (school_kit on the VPS). Anywhere else it changes nothing, rather than
  reopening it for everyone.
- **`/welcome?book=1`** opens the form for the owner or an admin of a set-up
  school that has not booked, even after the page has closed
  (`OnboardingCallStateDto.canBook`). A school that has booked sees its
  booking again. The dashboard checklist links there while setup is
  unfinished ("Would you like a hand?"), and so do the reminders.
- **The wizard** footer says "Stuck? We'll help." with WhatsApp, phone and
  email. The booking form needs a set-up school, so it is not offered there.

## Platform admin: Getting started

`GET /api/platform-admin/activation` (PlatformAdminGuard):

- **What it reads:**
  - `schools` for the list (no RLS);
  - then, for each school, under its own GUC: the counts, the owner (first
    active owner, or the pending owner invitation) and the reminders.
- **No SECURITY DEFINER function:** the count stays 23.
- **One school at a time, kept for five minutes.** The pool holds three
  connections for the whole API; a sweep that took all three would stall every
  other request while it ran (seen in testing: a school deletion timed out
  behind it). Requests made during a sweep share it. The page shows when the
  list was read and has **Refresh** (`?fresh=1`).

**The page** (`/super-admin/dashboard/getting-started`):

- **Stage tiles:** six, one per stage; each one filters the list.
- **Reminder figures:**
  - sent, delivered and clicked;
  - schools emailed;
  - schools that moved on after a reminder, counted from their first
    reminder's stage;
  - stopped.
- **Views:**
  - **Stuck**, the default, oldest sign-up first;
  - **Emailed, not moved**;
  - **All**;
  - plus a search box for school, code or owner.
- **Each row:**
  - stage, Stuck, Call booked and Stopped reminders;
  - days since sign-up, and the student, in-class and teacher counts;
  - each reminder's state (sent, delivered, clicked ×n, bounced);
  - "Moved on since" or "Not moved since";
  - the owner's name and last sign-in;
  - email and phone links, a WhatsApp button with a short message ready, and
    **Manage**, which opens the school on the Schools page.
- **Colour:** stuck rows are tinted amber and labelled "Stuck"; no accent
  borders.

## Tests

- `activation.service.spec.ts`:
  - the stages, stuck, the reminder schedule (new and catching-up schools);
  - wa.me digits;
  - the link signatures and targets, and the email's escaping;
  - on a real database:
    - the first reminder to the owner, tagged, audited without the address;
    - nothing twice in a day;
    - FAILED retried;
    - clicks counted and redirected; a bad link counts nothing;
    - the webhook's statuses;
    - the stop link and a forged one;
    - the platform list and summary.
- `e2e/tests/platform-console.spec.ts`: the console with a stuck school on
  Getting started, every page, and the phone menu.
- `e2e/tests/setup-call.spec.ts`: the checklist's link books a call after a
  skip.
