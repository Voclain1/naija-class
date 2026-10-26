# Setup calls (2026-10-26)

Owner's request, 26 October: when a new school finishes the setup wizard, show a
good-looking page offering a free call with the SchoolKit team to finish setting
up. The page asks for a day and a time, has our contact details at the foot,
and can be skipped. Each booking reaches our WhatsApp.

## What a school sees

- **When.** Straight after **Finish setup** (step 5), the owner goes to
  `/staff/welcome` rather than the dashboard. The page shows **once per
  school**: booking or skipping closes it for good.
  - An owner who leaves without choosing, by signing out or opening another
    page, is taken back to it from any admin page.
  - The check is a gate around the admin layout (`SetupCallGate`), not a
    redirect after render: the dashboard's term selector rewrites the address
    and would otherwise win the race.
  - Once the answer is "not shown", it is remembered for the browser session.
  - Only the owner is asked. Every school that existed before this shipped was
    stamped closed by the migration.
- **The page** (`apps/web/src/components/onboarding/book-setup-call.tsx`):
  - Header: the SchoolKit mark and **Skip for now**.
  - A two-part card:
    - Emerald side: "Let's finish setting up {school} together", one line, and
      three things the call covers.
    - White side:
      - **Choose a day**: the next 14 days, Monday to Saturday, from tomorrow.
      - **Choose a time**: 9:00 am to 4:30 pm starts, 30 minutes each, Lagos
        time.
      - Name and phone, filled in from the owner.
      - **+ Add a note** (optional).
      - **Book**, and a quiet **Skip for now, I'll set up on my own**.
  - Footer: hello@schoolkit.ng, +234 704 967 7393 (phone) and WhatsApp, each a
    link.
  - Only tints and shadows; no accent borders. Fits a 360 px phone with no
    sideways scroll.
- **After booking:**
  - **You're booked** with the day and time.
  - **Send to SchoolKit on WhatsApp**: a `wa.me` link to +234 704 967 7393 with
    the booking already written, sent from the school's own WhatsApp.
  - **Go to my dashboard**.

## What we receive

1. **Saved:** `onboarding_call_bookings`, tenant-scoped under FORCE RLS like
   every school table.
   - Fields: day (`DATE`), start as minutes since midnight (`INTEGER`, CLAUDE.md's
     time-of-day rule), name, phone, note, `done_at`.
   - The school's `onboarding_call_prompt_closed_at` and
     `onboarding_call_booked_at` are stamped.
   - The audit row carries the slot, never the phone number.
2. **Emailed** to `ONBOARDING_CALL_ALERT_EMAIL` (default hello@schoolkit.ng).
   What the school typed is HTML-escaped.
3. **WhatsApp (automatic):** the API sends an approved template to our number
   through Meta's WhatsApp Cloud API (`common/whatsapp/whatsapp-cloud.ts`).
   - It is off until its settings exist: `docs/runbooks/whatsapp-alerts.md`.
   - Template parameters: {{1}} school, {{2}} day and time, {{3}} name,
     {{4}} phone.
   - Neither the email nor WhatsApp can fail a booking. Failures go to the log
     and Sentry, with the purpose but never the phone number.
4. **Platform admin → Setup calls:**
   - Every booking, newest first, open ones first in view.
   - A **WhatsApp** button opens a chat with the school.
   - **Mark done** / **Not done**.
   - It reads `schools` for the schools holding a booking, then each school's
     bookings under its own GUC. There is no SECURITY DEFINER function; the
     count stays 23.

## API

| Route | Who | What |
|---|---|---|
| `GET /schools/me/onboarding-call` | staff | `{ show, booking, suggestedName, suggestedPhone }`; `show` only for the owner of an ACTIVE school whose page is open |
| `POST /schools/me/onboarding-call` | owner, admin | book; the day and time must be offered ones (`ONBOARDING_CALL_DAY`, `ONBOARDING_CALL_TIME`) |
| `POST /schools/me/onboarding-call/skip` | owner, admin | close the page (204); twice changes nothing |
| `GET /platform-admin/onboarding-calls` | platform admin | every booking |
| `PATCH /platform-admin/onboarding-calls/:schoolId/:bookingId` | platform admin | `{ done }`; audited with no school |

## Not built

- Taken slots are not hidden; the team confirms the time.
- No calendar invite.
- No staff-app screen: setup is finished on the web.

## Tests

- `onboarding-call.service.spec.ts`:
  - shown only to the owner of a set-up school;
  - days and times checked;
  - booking saves, closes the page, audits without the phone number and emails
    the team;
  - a failed email does not fail the booking;
  - skipping is idempotent;
  - each school's bookings are its own;
  - the platform list and Mark done;
  - the email escapes what the school typed;
  - the WhatsApp sender is off without settings, flattens its parameters, and
    reports a refusal as failed.
- `e2e/tests/setup-call.spec.ts`: book (the page, the WhatsApp link, never
  again) and skip.
- `apiActivateSchool` skips the page for every other spec, like the
  first-login tour; `phase-0-happy-path` skips it through the UI.
