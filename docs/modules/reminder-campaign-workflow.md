# Fee reminder runs — frontend workflow (2026-11-09)

## Ownership and scope

ChatGPT owns the staff-web workflow and browser tests. Claude owns the backend
campaign executor. This frontend composes the existing debtor and reminder APIs;
it introduces no model call, message drafting, scheduler, database table or
provider configuration. No policy or pilot activation is approved by this PR.

`/finance/reminders` offers a term-scoped selection, filters, refreshed review,
explicit confirmation and batch results. The finance sub-navigation exposes it
only with both `finance.debtors.read` and `finance.debtors.remind`. Direct access
has the same frontend gate; the existing API remains the authorization authority.
The debtor list's immediate-send button now opens the same review instead.

## Audience and review

- Default: overdue invoices only, exclude any student with an outstanding
  invoice on a payment plan. Staff may deliberately change these filters.
- Filter by class label, fee-risk level or student name/admission number.
  Changing a filter clears selections. Risk remains staff-only.
- Term and supplementary invoices are grouped by student id, not name. A
  student is selected once; every outstanding invoice balance remains visible.
  No aggregate money figure is computed in this workflow's frontend.
- A student matches class/risk/overdue filters if any outstanding invoice
  matches. A plan on any outstanding invoice excludes that whole student.
- Review reloads the term's debtor list and reapplies the frozen filters and
  selection. Paid/cancelled/non-matching students are removed and counted.
- A payment plan added after review is not atomically excluded by the current
  send API. Refresh the selection/review after an arrangement changes; the
  backend brief requires enforcing this server-side at execution.
- The review shows the term, named students, invoice balances, standard-message
  behaviour, channel preferences where permitted, and the request boundaries.
- Counts are **students**, not unique households, email addresses or SMS
  recipients. Siblings may generate separate reminders.
- There is no exact outbound message preview or provider cost quote API. The
  screen describes the existing template; it does not invent either a final
  combined balance or a price. The server calculates the sent balance.

## Execution and outcomes

Existing contracts:

- `GET /finance/debtors?termId=…` → `DebtorDto[]`.
- `GET /notification-preferences` → `NotificationPreferenceDto`, only when
  `notification-preferences.read` is held. No forbidden fetch for a bursar.
- `POST /finance/debtors/remind` with `{ termId, studentIds }`, max 50 ids
  → `SendRemindersResult`. Existing notification preference and push/SMS rules
  remain authoritative. The frontend never enables a channel itself.

The frontend caps one run at 500 students (10 requests). A single explicit
confirmation starts sequential requests, never parallel sends. A double click
cannot start a second loop. Confirmed results are retained per batch. The API's
`noChannel` special response has zero classified skip reasons; it stops further
requests and tells the user to ask an administrator to check setup.

Any failed/unverified send response stops the run. Its batch becomes **unknown**;
earlier confirmed results remain, and later batches are **not requested**. There
is no retry/resume button and no claim of rollback. Even a 5xx can arrive after
some external notifications were accepted. Leaving/reloading a sending or
uncertain run prompts the browser's standard beforeunload warning.

Account changes or lost frontend permission unmount the workspace and stop
subsequent requests. A request already in flight cannot be cancelled as a
promise that external delivery will not happen.

The current API returns aggregate per-batch counts, not per-student outcomes or
provider delivery receipts. The UI reports those limits and provides permission-
checked links to guardian records/settings for follow-up.

## Privacy and limits

Drafts, selection and the local result journal stay in component memory. No
browser storage, chat transcript, new analytics event or model input is added.
The page and portalled review are marked for analytics exclusion and Sentry
masking. API operational audit behaviour is unchanged.

**There is no durable campaign id, recipient dedupe, recovery/status endpoint,
per-recipient result or scheduled recheck yet.** Reloading loses the local run
journal. Do not interpret the disabled retry button as server-side exactly-once
sending or protection across devices, tabs or later runs. Guardian invitation
and WhatsApp messaging are not automated by this workflow.

## Backend work

The complete next backend chunk is specified in
`docs/reviews/reminder-campaign-backend-brief.md`. It can be implemented without
frontend edits or a clarification round; publish the actual contract for the
frontend adapter rather than guessing endpoints here.


## Durable backend integration (#519)

The availability endpoint selects the server-owned campaign path when enabled;
only a deliberate off/legacy-404 uses the ordinary sender. A failed availability
check blocks sending and offers a retry. Saved preview and campaign pages do not
require the feature to remain on for their status reads.

`durable-api.ts` uses the published shared DTOs and endpoints. Preparation keeps
one client UUID across retries. Confirmation recovery reads the same proposal
and follows its campaignId; it never prepares another selection after an
uncertain confirmation. Stale/expired previews require refresh and another
unchecked approval. Refresh retries keep the same identity.

Authorised routes `/finance/reminders/proposals/[id]` and
`/finance/reminders/runs/[id]` survive reload. They hold opaque ids only in the
URL, never names, contacts, balances or text. Status polling stops when the page
unmounts, pauses longer during quiet hours, and reads only the original campaign.
Provider acceptance is explicitly distinct from delivery. Each guardian/channel
slot shows its own outcome/reason; UNKNOWN has no retry action. Halt/resume
commands re-read status if their response is lost. Resume needs an explicit
acknowledgement and is offered only for HALTED campaigns.

The server owns persistence, journal claims and eligibility checks; the legacy
local-loop limitations above apply only while saved campaigns are off. There is
no new frontend storage, automatic feature enablement or backend implementation
change in this integration. Tests use fresh tenants and push-only fake guardian
fixtures, never real family emails/SMS. One synthetic UNKNOWN journal fixture
checks presentation only; backend worker/crash guarantees remain backend tests.
