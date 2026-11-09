# Reviewed student intake (server-owned proposals)

Status: backend built 2026-11-09 (branch `agentic/guided-student-intake`).
Frontend not built: it belongs to the guided intake screen (PR #514, which
today calls `POST /students/bulk`). The `student-intake` switch is off for
every school. Nothing here is enabled, deployed or approved for a pilot.

## Purpose

Adding a batch of students is now a four-step, server-owned workflow:

1. **Prepare.** The client sends structured rows and an explicit placement. The
   server validates the whole batch and stores a proposal.
2. **Review.** The server's preview is authoritative. It shows the rows as they
   will be written, the destination's labels, counts, errors and warnings.
3. **Confirm.** One authenticated request. The server re-checks everything and
   writes the students, their enrolments and the audit rows exactly once.
4. **Recover.** After a timeout or a lost response, the client reads the
   outcome, or repeats the confirm, and gets the same result. Nothing is
   written twice.

The proposal table (`workflow_proposals`) is generic and kind-tagged, so later
workflows can reuse it. Student intake is the first kind (`student-intake`).

**No model is involved.** Rows come from the person's own entry, paste or
file. They are treated as data and never sent to a model. Student intake is
**not** on the PII allowlist in `CLAUDE.md`. The help-assistant exception does
not cover it, and it is not on the assistant tool registry. Any future use by
an assistant needs its own decision. If one is added, it would call these same
endpoints, so the same confirmation gate applies.

## Before and after

| | `POST /students/bulk` (unchanged) | Reviewed intake (new) |
|---|---|---|
| Preview | None (the client renders its own grid) | The server's, with a fingerprint |
| Placement | Optional; absent means "not placed" | Required choice: `ENROL` (class + term) or `DEFER` |
| Duplicate typed numbers | 409 on submit | Row errors in the preview, before any write |
| Automatic numbers | Assigned at write | Shown as "assigned on confirm", assigned at write |
| Lost response | The caller cannot tell whether it was written | `GET` the proposal, or repeat the confirm |
| Double submit | Second request 409s (numbers taken) or, with automatic numbers, **creates a second set** | Exactly one set; every caller gets the same outcome |
| Audit `via` | `bulk` / `student-bulk-create` | `student-intake`, plus `proposalId` |

Both paths write through one shared function, `insertStudentBatchInTx` in
`students.service.ts`. The bulk endpoint keeps its request, response,
all-or-nothing 409 and allocation behaviour.

## Endpoints

Base path `/api/v1/student-intake`. Every route needs `AuthGuard` and the
`student.create` permission. Inside its own transaction, the service also
requires:

- an active account;
- an `owner` or `admin` role;
- a school that is active and not suspended;
- for prepare, confirm and refresh, the school's `student-intake` switch.

Errors use the standard `{ error: { code, message, details? } }` shape.

### `GET /student-intake/availability`

`{ "enabled": false }`. Use it to decide whether to show the reviewed flow.

### `POST /student-intake/proposals` (prepare)

```json
{
  "clientRequestId": "5b1c7c1e-1f3a-4c1e-9d0b-6f6c2c7f1a10",
  "placement": { "mode": "ENROL", "termId": "<uuid>", "classArmId": "<uuid>" },
  "students": [
    { "firstName": "Ada", "lastName": "Okafor", "dateOfBirth": "2014-03-12", "gender": "FEMALE" },
    { "firstName": "Tobi", "lastName": "Ade", "dateOfBirth": "2013-11-02", "gender": "MALE", "admissionNumber": "JSS1/014" }
  ]
}
```

- `placement` is `{ "mode": "DEFER" }` to add without placing. There is no
  default.
- Each `students[]` row is exactly a bulk-add row (`createStudentSchema`
  without `enrollment`). The batch holds 1–200 rows (`MAX_STUDENT_INTAKE_ROWS`).
- `clientRequestId` is a UUID that the client creates once per batch and
  reuses on every retry of this prepare.
  - The same id with the same body returns the same proposal, whatever its
    status is now.
  - The same id with a different body returns 409 `INTAKE_REQUEST_ID_REUSED`.

Response, 200 (`StudentIntakeProposalDto`):

```json
{
  "id": "<uuid>",
  "status": "PENDING",
  "previewHash": "<64 hex>",
  "expiresAt": "2026-11-09T10:30:00.000Z",
  "createdAt": "2026-11-09T10:00:00.000Z",
  "confirmedAt": null,
  "placement": { "mode": "ENROL", "termId": "<uuid>", "classArmId": "<uuid>",
                 "termLabel": "2026/2027 · First Term", "classLabel": "JSS 1 · JSS 1A" },
  "counts": { "rows": 2, "withErrors": 0, "withWarnings": 1, "assignedOnConfirm": 1 },
  "batchErrors": [],
  "batchWarnings": [],
  "canConfirm": true,
  "rows": [
    { "index": 0, "values": { "firstName": "Ada", "lastName": "Okafor", "dateOfBirth": "2014-03-12", "gender": "FEMALE" },
      "admissionNumber": null, "admissionNumberSource": "ASSIGNED_ON_CONFIRM", "errors": [],
      "warnings": [{ "code": "POSSIBLE_DUPLICATE_ON_ROLL", "message": "…", "relatedStudentIds": ["<uuid>"] }] },
    { "index": 1, "values": { "…": "…" }, "admissionNumber": "JSS1/014", "admissionNumberSource": "TYPED",
      "errors": [], "warnings": [] }
  ],
  "dataCleared": false,
  "duplicateRule": "Possible duplicate: same first name, last name and date of birth …",
  "outcome": null
}
```

A batch with errors is still stored and returned, with `canConfirm: false`, so
the screen can mark every problem at once. Fix the rows, then prepare again
with a **new** `clientRequestId`.

### `GET /student-intake/proposals/:id` (status and outcome)

Returns the same DTO. Only the person who prepared the proposal can read it;
anyone else gets 404. This works whatever the switch says, so a confirmed
outcome can always be recovered.

### `POST /student-intake/proposals/:id/confirm`

```json
{ "previewHash": "<the previewHash the person reviewed>" }
```

Response, 200: the DTO with `status: "COMPLETED"`, `rows: []`,
`dataCleared: true` and:

```json
"outcome": {
  "createdCount": 2, "enrolledCount": 2,
  "students": [
    { "index": 0, "studentId": "<uuid>", "admissionNumber": "ADM/2026/031", "enrollmentId": "<uuid>" },
    { "index": 1, "studentId": "<uuid>", "admissionNumber": "JSS1/014", "enrollmentId": "<uuid>" }
  ]
}
```

`enrollmentId` is `null` under `DEFER`. Repeating the confirm with the same
hash returns this same outcome and writes nothing.

| Code | Status | Meaning | Client action |
|---|---|---|---|
| `INTAKE_PREVIEW_MISMATCH` | 409 | The hash is not this proposal's | `GET` it and review again |
| `INTAKE_PREVIEW_STALE` | 409 | Something the preview showed has changed | `refresh`, review, confirm the new one |
| `INTAKE_EXPIRED` | 409 | Past `expiresAt`, or retired by a refresh | `refresh` if it still has rows; otherwise prepare again from the client's rows |
| `INTAKE_BLOCKED` | 409 | The preview has errors | Fix the rows and prepare again |
| `INTAKE_RETRY` | 409 | A concurrent write collided; everything rolled back | `refresh`, then confirm |
| `FORBIDDEN` / `USER_INACTIVE` | 403 / 401 | Permission, role, school or switch | Stop |
| `INTERNAL_ERROR` | 500 | Unknown failure; nothing is logged with row values | `GET` the proposal before retrying |

For all of these except a successful repeat, nothing was written.

### `POST /student-intake/proposals/:id/refresh`

```json
{ "clientRequestId": "<new uuid for the new proposal>" }
```

Re-prepares the same stored rows and placement as a **new** proposal (new
`id`, new `previewHash`, a new 30 minutes). The old proposal is retired: it
becomes `EXPIRED` and its rows are cleared, so it can no longer be confirmed.

- A retry with the same `clientRequestId` returns the same new proposal.
- A confirmed proposal returns 409 `INTAKE_ALREADY_CONFIRMED`.
- A proposal whose rows are already cleared returns 409 `INTAKE_EXPIRED`.
  Prepare again from the client's copy.

## Problems

An **error** blocks confirmation. A **warning** is shown and does not.

| Level | Code | Rule |
|---|---|---|
| Row error | `ADMISSION_NUMBER_REPEATED` | The same typed number appears on several rows (`relatedIndexes`) |
| Row error | `ADMISSION_NUMBER_TAKEN` | The typed number belongs to a student of this school |
| Row error | `ADMISSION_NUMBER_REQUIRED` | The number is blank and the school types its own |
| Row error | `ADMISSION_NUMBER_NEEDS_CLASS` | The number is blank, numbering is per class, and the placement is `DEFER` |
| Row warning | `POSSIBLE_DUPLICATE_ON_ROLL` | Matches a student on the roll under the duplicate rule (`relatedStudentIds`) |
| Row warning | `POSSIBLE_DUPLICATE_IN_BATCH` | Matches another row under the duplicate rule (`relatedIndexes`) |
| Row warning | `DATE_OF_BIRTH_IN_FUTURE` | After today in Lagos |
| Batch error | `TERM_NOT_FOUND`, `CLASS_ARM_NOT_FOUND` | Not in this school (another school's ids are not found) |
| Batch error | `CLASS_ARM_INACTIVE` | The class is switched off |
| Batch error | `PLAN_STUDENT_LIMIT` | Only under `PLAN_ENFORCEMENT=enforce`: the batch would pass the cap |
| Batch error | `ADMISSION_FORMAT_INVALID` | Blank numbers, and the school's automatic format no longer parses |
| Batch warning | `TERM_NOT_CURRENT` | The chosen term is not the current one |
| Batch warning | `CLASS_OVER_CAPACITY` | `details: { capacity, enrolledNow, afterIntake }` |

**Duplicate rule (disclosed and deterministic).** Two records are a possible
duplicate when they have the same first name, the same last name and the same
date of birth, ignoring case, accents and spacing. On-roll matches include
students of any status. The rule is advisory: nothing is merged, and a
flagged row is still added on confirm. The exact text is `INTAKE_DUPLICATE_RULE`
and is returned as `duplicateRule`.

**Admission numbers.** Typed numbers are checked against the roll and the
batch. Blank numbers are not shown and not reserved at prepare. They are
assigned at confirm by the existing allocator (`assignAdmissionNumbers`), in
the same transaction as the insert. Its counter row lock serialises
concurrent confirms. A crash rolls the counter back with the rows.

## Guarantees

**Server-owned.** At prepare, the proposal is bound to the school, the
requester, the kind, the placement and the normalised rows. Confirm takes only
`previewHash`. The client cannot change the school, class, term or a student
afterwards; changing the batch means preparing a new proposal.

**Fingerprint.** `previewHash` is SHA-256 over a stable serialisation of:

- the rows as stored;
- every problem;
- the placement facts (ids, labels, academic year, class code, active and
  current flags, capacity);
- the school's numbering (mode, format, order).

Confirm recomputes the preview inside its transaction and writes only if the
hash is unchanged. Anything the person was shown that has since changed makes
the confirm refuse with `INTAKE_PREVIEW_STALE`. This includes:

- a class switched off or renamed;
- a typed number taken in the meantime;
- a new possible duplicate;
- capacity figures moving;
- the numbering mode changed.

**One transaction per confirm** (Read Committed, 60 s, no automatic connection
retry). In order:

1. Re-check the school, the switch, the person and their grants. The school
   row and the grants are locked `FOR SHARE`, so a revocation cannot land
   halfway through.
2. Lock the proposal `FOR UPDATE`.
3. If it is already `COMPLETED`, return the stored outcome.
4. Refuse an expired proposal or a mismatched hash.
5. Recompute the preview and compare.
6. Assign numbers, then insert students, audit rows, enrolments and their
   audit rows.
7. Set the proposal `COMPLETED`, store the outcome and clear its rows.
8. Write the `student-intake.confirm` audit row.

All of this commits together or not at all. A database `CHECK` makes
`COMPLETED` impossible without an outcome, a confirmer and a time. Because the
write and its marker are atomic, no multi-step journal is needed. This
executor is bounded to one batch of 200, the bulk-add limit.

**Concurrency.**

- **Two confirms of the same proposal:** the second waits on the row lock,
  then finds `COMPLETED` and returns the same outcome.
- **Two prepares with the same `clientRequestId`:** the unique index and
  `ON CONFLICT DO NOTHING` give both the same proposal.
- **A typed number taken by a different request mid-confirm:** the unique
  index rolls the whole confirm back, which answers `INTAKE_RETRY`.

**Partial execution is not supported.** A batch is all or nothing.

**Limits.**

- The plan cap is still count-then-insert without a lock (plans.md D3). Two
  confirms taking the last places together can both succeed, as with bulk add.
- Duplicate warnings are advisory and can miss spelling variants.
- The outcome lists ids and numbers only. To show names, fetch the students.
- The person who prepares is the only person who can confirm. Separating
  requester and approver is not decided.

## Privacy and retention

- **Row data** (names, dates of birth, contacts) lives in `payload` only while
  the proposal can be confirmed. It is cleared:
  - at confirm;
  - when a refresh retires the proposal;
  - on expiry, at the next intake call from that school or by the hourly
    sweeper (`WorkflowProposalsSweeperService`, `:17` past each hour, every proposal kind), whichever
    comes first.

  At most, rows outlive the 30-minute expiry by about an hour.
- **Kept after that:** the proposal's metadata. This covers the ids,
  requester, confirmer, timestamps, fingerprints, counts, placement labels,
  batch problems and the outcome (student ids, admission numbers, enrolment
  ids). This is operational and audit metadata like `audit_logs`. **No
  retention period for it has been decided.** It is deleted with the school
  (school deletion discovers it by its `school_id`). A purge period is an
  owner decision, not made here.
- **Audit rows** carry counts and ids only, never a name or a date.
- **Logs:**
  - errors are reported as `Student intake <operation> failed: school=<id>; details omitted`;
  - driver errors (which can quote row values) are never passed to the logger
    or Sentry;
  - nothing is sent to PostHog;
  - no row goes to `ai_interaction_logs` or `ai_generations`.
- **No guardian invitation, no notification, no SMS or email.** Tests assert
  this.

## Frontend integration (for PR #514)

```
prepare ──► review ──► confirm ──► outcome
   ▲           │           │
   │           │ 409 STALE / RETRY / EXPIRED (rows still held)
   │           ▼           ▼
   └──── refresh ◄─────────┘
```

1. **Start.** Call `GET /student-intake/availability`. If it is off, keep the
   existing `POST /students/bulk` path.
2. **Prepare.**
   - Create one `clientRequestId` (`crypto.randomUUID()`) when the person
     presses Review. Keep it until the rows or the placement change.
   - `POST /proposals`. On a network error, resend with the same id.
3. **Review.**
   - Render `rows[]` from the response, not from local state. Show
     `admissionNumberSource: ASSIGNED_ON_CONFIRM` as "assigned when you confirm".
   - Show `batchErrors` and `batchWarnings`, `placement.termLabel` and
     `classLabel`, `counts`, and `duplicateRule` next to any duplicate warning.
   - Disable Confirm unless `canConfirm`, and show `expiresAt`.
   - To fix a row: edit it locally, create a new `clientRequestId`, and
     prepare again.
4. **Confirm.**
   - `POST /proposals/:id/confirm` with that proposal's `previewHash`. Disable
     the button while it is in flight.
   - On a timeout or a network error, **do not prepare again**. `GET
     /proposals/:id`, or repeat the confirm with the same hash.
   - `COMPLETED` means done. `PENDING` means it did not commit, so confirm
     again.
5. **Recover.** Keep the proposal `id` in memory until the outcome is shown.
   Do not keep row data in browser storage.
6. **On 409.**
   - `STALE`, `RETRY`, or `EXPIRED` with rows still held: `POST …/refresh`
     with a new UUID, show the new preview, and ask for confirmation again.
   - `EXPIRED` from refresh: prepare again from local rows.
   - `BLOCKED`: return to editing.
7. **Outcome.** `outcome.students[index]` maps back to the reviewed row by
   `index`. Link each to `/students/:studentId`. Invitations to guardians stay
   a separate, later action.

Types: `@school-kit/types`, from `students/student-intake.dto.ts`:

- schemas: `prepareStudentIntakeSchema`, `confirmStudentIntakeSchema`,
  `refreshStudentIntakeSchema`;
- the response: `StudentIntakeProposalDto`;
- codes: `STUDENT_INTAKE_CONFLICT_CODES`, `INTAKE_*_CODES`.

## Data

`workflow_proposals` (migration `20261209120000_workflow_proposals`):

- **Columns:** `id`, `school_id`, `kind`, `requested_by`, `confirmed_by`,
  `status` (`PENDING`|`COMPLETED`|`EXPIRED`), `client_request_id`,
  `request_hash`, `preview_hash`, `payload` (nullable), `summary`, `result`,
  `expires_at`, `created_at`, `confirmed_at`, `data_cleared_at`.
- **Indexes:** unique on (`school_id`, `kind`, `requested_by`,
  `client_request_id`); an index on (`school_id`, `kind`, `created_at DESC`).
- **Security:** FORCE RLS with the standard `tenant_isolation` policy
  (`policies/workflow-proposals.sql`).
- **No foreign keys,** like `assistant_billing_runs`. School deletion removes
  the rows through their `school_id`.
- **No SECURITY DEFINER function;** the count stays at 23.

## Deployment

- The migration is additive: one new table, no backfill and no lock on an
  existing table.
- The new code paths stay dark until an operator turns on `student-intake`
  for a school (`PATCH /platform-admin/schools/:id/features`).
  `FEATURES_DISABLED=student-intake` kills it platform-wide.
- The hourly sweeper respects `SCHEDULED_JOBS=off`.
- Rollback: turn the switch off. Reverting the code leaves an unused table.

## Tests

`apps/api/src/modules/student-intake/student-intake.service.spec.ts` has 18
cases, run against real PostgreSQL as `app_user`:

- prepare, then confirm, with attribution and clearing;
- `DEFER`, with no invitations, notifications or AI rows;
- cross-tenant isolation and foreign placement ids;
- requester-only access;
- a teacher refused, plus permission removal, deactivation, suspension and the
  switch turned off between prepare and confirm;
- invalid placement and a class deactivated after prepare, then refresh;
- the warnings and the disclosed duplicate rule;
- typed numbers repeated or taken, and a number taken after prepare;
- automatic numbers unreserved at prepare and unique under concurrent confirms;
- per-class and manual numbering, and a numbering change after prepare;
- three simultaneous confirms;
- idempotent prepare, including a concurrent duplicate;
- a committed confirm whose response is lost;
- a crash before the completion marker, which rolls everything back, including
  the counter;
- expiry, the sweeper and a forged hash;
- idempotent refresh;
- the plan cap under enforcement;
- `POST /students/bulk` compatibility.

Browser integration is not tested here; it belongs to the frontend PR.
