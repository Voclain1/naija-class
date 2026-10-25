# Account deletion requests

Built 2026-10-24, for the app stores. Apple (and Google's Data safety form)
require that an app which signs people in offers a way to ask, **from inside
the app**, for the account to be deleted.

## Decision

The school holds the records, so deleting is the school's call, not the
app's. A request only **tells the school**. The school removes the account
with the tools it already has, or keeps it and says why, then marks the
request handled. A student's school record stays with the school whatever
happens to their app access.

## What people see

- **App:** a **Delete my account** card, with **Request account deletion**
  (and a confirmation), on the staff profile, the parent's Settings and the
  student's home screen (`src/components/account-deletion-card.tsx`). Once
  sent, the card says when they asked. Asking twice changes nothing.
- **School (web):** **Settings → Account deletion requests**
  (`/settings/account-deletion-requests`): who asked and when, what to do for
  each kind of account (deactivate a member of staff under Users; switch off
  a parent's portal access), and **Mark handled**. Also a line on the
  dashboard's "needs you today", on the web and in the staff app.

## Data and API

- `account_deletion_requests`: school, principal (`STAFF`, `GUARDIAN`,
  `STUDENT`, CHECKed), the person's id, requested at, handled at and by. A
  partial unique index keeps one open request per person. FORCE RLS on the
  school's GUC (`policies/account-deletion-requests.sql`).
- `GET|POST /users/me/deletion-request` (staff), `/portal/me/deletion-request`
  (parent), `/student-portal/me/deletion-request` (student).
- `GET /account-deletion-requests` and `POST /account-deletion-requests/:id/handled`:
  `user.deactivate` and the owner or admin role.
- Audited: `account.deletion_requested`, `account.deletion_request_handled`.
- No SECURITY DEFINER function; count stays 23.

Tests: `account-deletion.service.spec.ts` (one open request, names, the role
check, handled once, each school's requests kept to itself).
