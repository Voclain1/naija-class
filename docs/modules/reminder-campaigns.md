# Fee reminder campaigns (durable backend)

Status: backend built on 2026-11-09 (branch `agentic/reminder-campaigns`).
The frontend is ChatGPT's: `frontend/reminder-campaign-workflow`, which today
calls only `POST /finance/debtors/remind`. The `reminder-campaigns` switch is
off for every school. Nothing is enabled, deployed or approved for a pilot.

The brief is `docs/reviews/reminder-campaign-backend-brief.md`, on the
frontend branch.

## What it does

A bursar's reviewed selection of debtors becomes a **campaign**. The steps:

1. **Prepare.** The server resolves the explicit selection and computes each
   student's balance, exclusions and reachable channels. It returns a preview
   with a fingerprint.
2. **Confirm.** One request creates the campaign and a **journal** of planned
   sends, in one transaction. Repeating it returns the same campaign.
3. **Send.** A worker works through the journal in bounded batches:
   - It re-checks each student's debt and plan just before that student's sends.
   - It **claims** each send and commits the claim, then calls the provider.
   - It records the outcome after the provider answers.
4. **Read.** The requester reads progress and a per-send outcome at any time.
5. **Halt or resume.** The requester can halt; the switch halts everything.
   Resuming is explicit and sends only what was never attempted.

Messages use the existing fee-reminder templates (`fee-reminder@1`,
`buildReminderHtml` and `buildReminderSms`) and the existing rails:

- email to every linked guardian with a usable address;
- one push-or-SMS per child, push first.

**No model is involved.** The feature is not on the PII allowlist, and nothing
reaches an AI log.

`POST /finance/debtors/remind` is unchanged: same DTO, at most 50 ids, and
not behind the switch.

## Endpoints

The base path is `/api/v1/finance/reminder-campaigns`. Every route needs
`finance.debtors.remind`. Inside its own transaction, the service also
requires:

- `finance.debtors.read`;
- an active account;
- a live school;
- for prepare, refresh, confirm and resume, the school's `reminder-campaigns`
  switch.

Only the requester can read, confirm, halt or resume their own proposal or
campaign; anyone else gets 404. Whether a second person should approve is not
decided.

### `GET /availability`

Returns `{ "enabled": false }`.

### `POST /proposals` (prepare)

```json
{
  "clientRequestId": "1c3f0b0e-8d1b-4b1e-9a55-0f2b8a0c5d11",
  "termId": "<uuid>",
  "studentIds": ["<uuid>", "<uuid>"],
  "options": { "includePaymentPlans": false, "overdueOnly": false }
}
```

- Between 1 and 500 unique `studentIds`.
- `options` defaults to the values shown.
- `clientRequestId` is a UUID made once per reviewed selection and reused on
  retries. The same id with a different body returns 409
  `REMINDER_REQUEST_ID_REUSED`.

Response, 200 (`ReminderCampaignProposalDto`):

```json
{
  "id": "<uuid>", "status": "PENDING", "previewHash": "<64 hex>",
  "expiresAt": "2026-11-09T10:30:00.000Z", "createdAt": "…",
  "termId": "<uuid>", "termLabel": "2026/2027 · First Term", "templateVersion": "fee-reminder@1",
  "options": { "includePaymentPlans": false, "overdueOnly": false },
  "channels": { "email": { "enabled": true, "configured": true },
                "sms": { "enabled": true, "configured": true, "sender": "SCHOOLKIT" },
                "push": { "enabled": false } },
  "counts": { "selected": 5, "eligible": 2, "plannedSends": 5,
              "excluded": { "NOT_FOUND": 0, "NO_BALANCE": 1, "ON_PAYMENT_PLAN": 1, "NOT_OVERDUE": 0, "NO_GUARDIAN": 1, "NO_CONTACT": 0 } },
  "batchErrors": [],
  "batchWarnings": [{ "code": "SHARED_GUARDIANS", "message": "1 guardian has more than one selected child …" }],
  "canConfirm": true,
  "students": [
    { "studentId": "<uuid>", "name": "Ada Okafor", "admissionNumber": "A1", "classLabel": "JSS 1 · JSS 1A",
      "balance": 5500000, "invoiceCount": 2, "earliestDueDate": "2026-10-01",
      "onPaymentPlan": false, "overdue": true, "eligibility": "ELIGIBLE",
      "planned": { "emailGuardians": 2, "mobile": "SMS_ONLY" } }
  ],
  "dataCleared": false, "campaignId": null,
  "limits": "Accepted means the email or SMS provider … took the message. It does not prove delivery …"
}
```

- `balance` is in kobo, summed by the server over the term's open invoices.
  Term and supplementary invoices give one row per student, not one per
  invoice. The frontend shows it, never computes it.
- Students are matched by id only, never by name.

**Eligibility, per student:**

| Value | Meaning |
|---|---|
| `ELIGIBLE` | Will be reminded |
| `NOT_FOUND` | Not a student of this school |
| `NO_BALANCE` | Owes nothing this term |
| `ON_PAYMENT_PLAN` | A plan covers any open invoice; excluded unless `includePaymentPlans` |
| `NOT_OVERDUE` | Only with `overdueOnly`: the student has no `OVERDUE` invoice |
| `NO_GUARDIAN` | No guardian is linked |
| `NO_CONTACT` | No usable email and no push or SMS route |

**Batch errors** (they block confirmation): `TERM_NOT_FOUND`, `NO_CHANNEL`,
`NOTHING_TO_SEND`.

**Batch warnings:**

| Code | Meaning |
|---|---|
| `QUIET_HOURS_HOLD` | Sending waits until 06:00 |
| `SMS_SENDER_SCHOOLKIT` | The school's own sender name is not approved, so SMS shows SchoolKit |
| `EMAIL_UNAVAILABLE` | Email is off or not set up |
| `SMS_UNAVAILABLE` | SMS is off or not set up |
| `SHARED_GUARDIANS` | A guardian of several selected children gets one reminder per child |

No provider price is quoted, and no delivery is promised.

### `GET /proposals/:id`

Returns the same DTO. Once the proposal is confirmed: `status: "CONFIRMED"`,
`campaignId` set, `students: []` and `dataCleared: true`.

### `POST /proposals/:id/refresh`

Body: `{ "clientRequestId": "<new uuid>" }`. Builds a new preview from the
same selection and options, and retires the old one. A retry with the same id
returns the same new preview. A confirmed proposal returns 409
`REMINDER_ALREADY_CONFIRMED`; a cleared one returns 409
`REMINDER_PREVIEW_EXPIRED`.

### `POST /proposals/:id/confirm`

Body: `{ "previewHash": "<the reviewed hash>" }`. Returns 200 with a
`ReminderCampaignDto` (below). A repeat returns the same campaign.

| 409 code | Meaning |
|---|---|
| `REMINDER_PREVIEW_MISMATCH` | Not this proposal's hash |
| `REMINDER_PREVIEW_STALE` | A balance, plan, contact, channel or setting changed; refresh |
| `REMINDER_PREVIEW_EXPIRED` | Past `expiresAt`, or retired by a refresh |
| `REMINDER_PREVIEW_BLOCKED` | The preview has batch errors |

Nothing is sent before a successful confirm.

### `GET /:campaignId`

```json
{
  "id": "<uuid>", "proposalId": "<uuid>", "termId": "<uuid>",
  "status": "RUNNING", "haltReason": null, "templateVersion": "fee-reminder@1",
  "createdAt": "…", "haltedAt": null, "completedAt": null, "heldForQuietHours": false,
  "counts": { "PENDING": 2, "SENDING": 0, "ACCEPTED": 3, "SKIPPED": 0, "FAILED": 0, "UNKNOWN": 0, "NOT_REQUESTED": 0 },
  "students": [
    { "studentId": "<uuid>", "name": "Ada Okafor", "admissionNumber": "A1",
      "sends": [
        { "guardianId": "<uuid>", "slot": "EMAIL", "channelUsed": "EMAIL", "outcome": "ACCEPTED", "reason": null, "finishedAt": "…" },
        { "guardianId": "<uuid>", "slot": "MOBILE", "channelUsed": "SMS", "outcome": "UNKNOWN", "reason": "PROVIDER_NO_ANSWER", "finishedAt": "…" }
      ] }
  ],
  "limits": "…"
}
```

`status` is `RUNNING`, `HALTED` or `COMPLETED`. `haltReason` is one of:

- `HALTED_BY_REQUESTER`;
- `FEATURE_OFF`;
- `SCHOOL_UNAVAILABLE`;
- `CONFIRMER_ACCESS_REVOKED` (the confirmer's access was removed or their
  account deactivated);
- `NO_CHANNEL`.

**Outcomes:**

| Outcome | Meaning | Reasons |
|---|---|---|
| `ACCEPTED` | Resend, Termii, or SchoolKit's own app-alert queue took it. **Not** delivery, and never a read. | `QUEUED_FOR_APP` for push |
| `SKIPPED` | Deliberately not sent | `NO_BALANCE`, `ON_PAYMENT_PLAN`, `NOT_OVERDUE`, `CHANNEL_OFF`, `NO_CONTACT`, `EMAIL_SUPPRESSED`, `GUARDIAN_UNLINKED`, `NO_ROUTE` |
| `FAILED` | The provider refused it; nothing was sent | `PROVIDER_*`, `INVALID_PHONE` |
| `UNKNOWN` | It may have gone out. **Never retried automatically.** Check with the family before sending again. | `PROVIDER_NO_ANSWER`, `PROVIDER_HTTP_5xx`, `INTERRUPTED`, `PUSH_QUEUE_NO_ANSWER`, `SEND_ERROR` |
| `NOT_REQUESTED` | The campaign is halted and this was never attempted | |
| `PENDING` / `SENDING` | Still to do, or in flight now | |

### `POST /:campaignId/halt`

Stops the campaign before its next send. A send already in flight finishes and
is recorded. Calling it again changes nothing.

### `POST /:campaignId/resume`

Explicit recovery, and the only way a halted campaign restarts:

- It needs the switch on (403 otherwise) and the person's access re-checked.
- It sends only `PENDING` sends. `UNKNOWN` and `FAILED` sends stay as they are.
- It returns 409 `REMINDER_CAMPAIGN_NOT_HALTED` for a finished campaign.
- On a running campaign it changes nothing.

## Guarantees and limits

- **Confirmation is exactly once.** The proposal row is locked, the
  fingerprint is recomputed, and the campaign, its journal and the proposal's
  COMPLETED marker commit together.
- **No send is attempted twice by SchoolKit.** Each journal row has a unique
  `(campaign, student, channel, guardian)`. A row is claimed (`SENDING`) and
  committed before the provider call. Claims use `FOR UPDATE SKIP LOCKED`,
  so concurrent workers never share one.
- **Lost answers are reported, not repeated.** A claim still `SENDING` after
  the 10-minute lease becomes `UNKNOWN` (`INTERRUPTED`), and `UNKNOWN` is never
  retried. A whole batch claimed together turns `UNKNOWN` together, even the
  sends that never reached the provider, because the journal cannot tell which
  did. That is conservative by design. If a late answer arrives for its own
  claim, it is recorded.
- **Exactly-once delivery is not claimed.**
  - A Resend `Idempotency-Key` (`reminder-send/<id>`) is passed, as the SDK
    documents.
  - Resend's and Termii's official docs could not be read from this build
    environment, so no safety property rests on either provider's idempotency
    or status APIs. Termii gets no key.
  - Push outcomes mean "queued for the app", not delivered.
- **Eligibility is re-checked just before each student's sends are claimed.**
  A balance paid, or a plan added, after confirmation means `SKIPPED`. The
  message quotes the balance at send time, as the existing button does.
- **Before every batch**, the worker re-checks the confirmer's active status
  and `finance.debtors.read` and `finance.debtors.remind`, the school, the
  switch (including `FEATURES_DISABLED`) and the channel settings. A failure
  halts the campaign. Halted campaigns never restart without `resume`.
- **Quiet hours:** no campaign sends between 21:00 and 06:00 Lagos; sends wait
  until 06:00. This differs from the one-click
  `POST /finance/debtors/remind`, which sends when the person presses it
  (`quiet-hours.ts`), because a campaign may still be running hours later.
- **Channel rules are the existing ones:**
  - email follows Settings → Notifications and Resend's configuration;
  - suppressed addresses are skipped;
  - push or SMS is decided by `NotificationDispatchService`, push first;
  - SMS goes under the school's approved sender name, or SchoolKit's.
- **Siblings** are reminded separately, one reminder per child.

## Execution

Sending starts in-process right after confirm or resume. A scheduled runner
(`ReminderCampaignRunnerService`, every 2 minutes, at most 20 batches of 10
students per campaign per tick) continues running campaigns after a restart
or a quiet-hours hold. It lists schools whose stored switch is on, and
respects `SCHEDULED_JOBS=off`.

If the switch is turned off, campaigns stop being processed by the runner.
The next worker pass that reaches a campaign marks it `HALTED` (`FEATURE_OFF`),
and no new send starts either way. If the switch is turned on again, the
campaign is resumed only by an explicit `resume`.

## Data and retention

- **`workflow_proposals`**, kind `fee-reminder-campaign`: the preview, with
  names and balances, while it is pending. Cleared at confirmation or expiry,
  or by the hourly `WorkflowProposalsSweeperService`.
- **`reminder_campaigns`**: one row per campaign, holding ids, state, options
  and timestamps.
- **`reminder_campaign_sends`**: the journal. It holds ids, slot, channel used,
  outcome, reason, timestamps and the provider's message id. It stores **no**
  contact detail, message text or amount; those are read when sending and
  held only in memory.
- Both campaign tables have FORCE RLS with `tenant_isolation`. Sends link to
  campaigns with `ON DELETE CASCADE`, and both are removed with the school.
  No SECURITY DEFINER function is added; the count stays 23.
- **Open decision, recorded once:** no retention period has been set for
  campaign and send metadata. It is kept like `audit_logs` until the owner
  decides.
- **Audit:** `reminder-campaign.prepare`, `.confirm`, `.halt`, `.resume` and
  `.complete`, with counts and ids only. Worker-initiated halts and completion
  carry no user.
- **Logs** carry ids, counts and reason codes only.

## Frontend integration (`frontend/reminder-campaign-workflow`)

1. **Start.** `GET …/availability`. If it is off, keep the current sequential
   `POST /finance/debtors/remind` flow.
2. **Prepare.**
   - Apply the filters client-side as now, then send the explicit `studentIds`
     (up to 500) with a fresh `clientRequestId`.
   - Render the review from the response's `students`, `counts`,
     `batchWarnings` and `limits`.
   - Show each `eligibility` reason, and `balance` as returned.
   - Enable Confirm only when `canConfirm` is true.
3. **Confirm.**
   - `POST …/proposals/:id/confirm` with `previewHash`.
   - On a timeout, `GET …/proposals/:id`: if `campaignId` is set, it was
     confirmed. Never prepare again on a timeout.
   - On `STALE` or `EXPIRED`, call `refresh` with a new UUID and review again.
4. **Progress.**
   - Poll `GET …/:campaignId` every few seconds while `status` is `RUNNING`.
   - Show `heldForQuietHours`.
   - The page can be left and reopened from the campaign id; the server keeps
     the state.
   - Drop the `beforeunload` warning for campaign runs, since the server
     continues.
5. **Results.**
   - Group by student and show each send's `outcome` and `reason`.
   - Show `UNKNOWN` prominently: "may have been sent, check before sending
     again".
   - `ACCEPTED` is "sent to the provider", never "delivered".
6. **Halt and resume.**
   - Halt: `POST …/:campaignId/halt`.
   - Resume (only when `HALTED`): `POST …/:campaignId/resume`. Explain that it
     sends only what was never attempted.

Types are in `@school-kit/types`, from `finance/reminder-campaign.dto.ts`:

- schemas: `prepareReminderCampaignSchema`, `confirmReminderCampaignSchema`,
  `refreshReminderCampaignSchema`;
- DTOs: `ReminderCampaignProposalDto`, `ReminderCampaignDto`;
- `REMINDER_CAMPAIGN_CONFLICT_CODES` and `REMINDER_CAMPAIGN_LIMITS`.

## Rollout and rollback

- Migration `20261210120000_reminder_campaigns` is additive: two new tables.
- Turn on `reminder-campaigns` for one school at a time
  (`PATCH /platform-admin/schools/:id/features`).
- Kill platform-wide with `FEATURES_DISABLED=reminder-campaigns`.
- Rollback: turn the switch off. Running campaigns halt (`FEATURE_OFF`) and
  existing outcomes stay readable.

## Tests

`apps/api/src/modules/reminder-campaigns/reminder-campaigns.service.spec.ts`
has 17 cases. They run against real PostgreSQL as `app_user` with fake
providers:

- the preview, exclusions, duplicate invoices and siblings;
- the journal sending each slot once;
- tenant and requester boundaries;
- refusal after permission removal, deactivation, suspension or the switch
  going off;
- a running campaign halting on revocation, deactivation or suspension;
- stale preview and refresh;
- a balance paid and a plan added mid-run;
- concurrent confirms and concurrent workers;
- a crash after sending (UNKNOWN after the lease, never re-sent);
- a crash before claiming;
- a lost provider answer and a provider refusal;
- channel changes, push before SMS, and no channel;
- quiet hours;
- the kill switch and explicit resume;
- requester halt and resume;
- idempotent prepare and the scheduled runner;
- compatibility with `POST /finance/debtors/remind` and the AI-import
  boundary.

Browser integration is not tested here; it belongs to the frontend PR.
