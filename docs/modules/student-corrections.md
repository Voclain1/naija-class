# Reviewed student-record corrections

Status: backend built on 2026-11-09 (branch `agentic/student-corrections`).
The frontend is ChatGPT's. The `student-corrections` switch is off for every
school. Nothing is enabled, deployed or approved for a pilot.

## What it does

A batch of corrections to **existing** students goes through four steps:

1. **Prepare.** Send each student's patch.
2. **Review.** The server's preview is named, with before and after values,
   errors and warnings.
3. **Confirm.** The batch is applied once, atomically.
4. **Recover.** After a timeout, read the outcome or repeat the confirm, and
   get the same result.

**Fields:** `firstName`, `middleName`, `lastName`, `dateOfBirth`, `gender`
and `email`. Nothing else.

**Not here, by design:** admission numbers, status transitions, enrolment
moves, guardian links, credentials, health, behaviour, grades, money and
deletion. Each of those keeps its own audited path.

`PATCH /students/:id` is unchanged.

**No model is involved.** The feature is not on the PII allowlist, and nothing
reaches an AI log.

Records are matched **by id only**. A row is never found or merged by name;
the name is shown so a person can check they have the right child.

## Patch semantics

| In `changes` | Meaning |
|---|---|
| key absent | Unchanged, and not listed in the preview |
| `"firstName": "Adaeze"` | Set |
| `"middleName": null` / `"email": null` | **Clear** this optional field |
| `"firstName": null` (any required field) | Invalid: 400 at the boundary |
| `{}` | Invalid: give at least one field |

- `dateOfBirth` is `YYYY-MM-DD` and must be a real calendar date.
- `email` is trimmed and lower-cased.
- Unknown keys, such as `admissionNumber` or `status`, are rejected with 400.
- A batch holds 1–100 rows, each student at most once.

## Endpoints

The base path is `/api/v1/student-corrections`. Every route needs
`student.update`. Inside its own transaction, the service also requires:

- `student.read`;
- an `owner` or `admin` role (as `PATCH /students/:id`);
- an active account and a live school;
- for prepare, confirm and refresh, the school's switch.

Only the requester can read or act on their proposal; anyone else gets 404.
Whether a second person should approve is not decided.

### `GET /availability`

Returns `{ "enabled": false }`.

### `POST /proposals` (prepare)

```json
{
  "clientRequestId": "6a4e3d8e-2f5b-4c0e-8f61-6f3f1f0d2a77",
  "corrections": [
    { "studentId": "<uuid>", "changes": { "firstName": "Adaeze", "middleName": null, "email": null } },
    { "studentId": "<uuid>", "changes": { "dateOfBirth": "2013-01-05", "gender": "MALE" } }
  ]
}
```

`clientRequestId` makes prepare idempotent. The same id with a different batch
returns 409 `CORRECTION_REQUEST_ID_REUSED`.

Response, 200 (`StudentCorrectionProposalDto`):

```json
{
  "id": "<uuid>", "status": "PENDING", "previewHash": "<64 hex>",
  "expiresAt": "…", "createdAt": "…", "confirmedAt": null,
  "counts": { "rows": 2, "withErrors": 0, "withWarnings": 0, "toUpdate": 2, "fieldChanges": 5, "clears": 2 },
  "batchErrors": [], "canConfirm": true,
  "rows": [
    { "index": 0, "studentId": "<uuid>",
      "current": { "name": "Ada Mid Okafor", "admissionNumber": "C1", "status": "ACTIVE" },
      "fields": [
        { "field": "firstName",  "before": "Ada", "after": "Adaeze", "change": "SET" },
        { "field": "middleName", "before": "Mid", "after": null,     "change": "CLEAR" },
        { "field": "email",      "before": "c1@school.ng", "after": null, "change": "CLEAR" }
      ],
      "errors": [], "warnings": [] }
  ],
  "dataCleared": false, "outcome": null
}
```

A field's `change` is `SET`, `CLEAR`, or `SAME` (named in the patch, but the
value already matches; nothing is written). Fields the patch did not name are
not listed.

**Row errors** (they block confirmation):

- `STUDENT_NOT_FOUND`: not in this school; another school's id reads the same;
- `DATE_OF_BIRTH_IN_FUTURE`.

**Row warnings:**

- `NO_CHANGE`: every value given already matches;
- `STUDENT_NOT_ACTIVE`: the student is withdrawn or graduated, and the
  correction still applies;
- `EMAIL_SHARED`: another student of this school has this email;
- `DATE_OF_BIRTH_UNUSUAL`: the student would be younger than 2 or older than
  25 today.

**Batch error:** `NOTHING_TO_APPLY`, when no record would change.

### `GET /proposals/:id` (status and outcome)

Returns the same DTO; it works with the switch off. Once completed:
`status: "COMPLETED"`, `rows: []` and `dataCleared: true`, with:

```json
"outcome": { "updatedCount": 2, "students": [
  { "studentId": "<uuid>", "changed": ["firstName", "middleName", "email"] },
  { "studentId": "<uuid>", "changed": ["dateOfBirth", "gender"] } ] }
```

### `POST /proposals/:id/confirm`

Body: `{ "previewHash": "<reviewed hash>" }`. Returns 200 with the completed
DTO. A repeat returns the same outcome and writes nothing.

| 409 code | Meaning | Client action |
|---|---|---|
| `CORRECTION_PREVIEW_MISMATCH` | Not this proposal's hash | `GET`, review again |
| `CORRECTION_PREVIEW_STALE` | A shown value or status changed (an edit, another batch) | `refresh`, review, confirm the new one |
| `CORRECTION_EXPIRED` | Past `expiresAt`, or retired by a refresh | `refresh` if values are still held; otherwise prepare again |
| `CORRECTION_BLOCKED` | Row or batch errors | Fix the patches, prepare again |
| `CORRECTION_RETRY` | A concurrent write collided; rolled back | `refresh`, confirm |

On any of these, nothing is written.

### `POST /proposals/:id/refresh`

Body: `{ "clientRequestId": "<new uuid>" }`. Builds a new preview of the same
patches against current records, and retires the old one. A retry with the
same id returns the same new preview. An applied batch returns 409
`CORRECTION_ALREADY_CONFIRMED`.

## Guarantees

- **One transaction per confirm**, in this order:
  1. Re-check the school, the switch, the person, their role and grants
     (`FOR SHARE`).
  2. Lock the proposal `FOR UPDATE`. If it is already `COMPLETED`, return the
     stored outcome.
  3. Lock every affected student `FOR UPDATE`, in id order, so two batches
     cannot deadlock.
  4. Recompute the preview from the locked rows. Write only if the fingerprint
     is unchanged.
  5. Update each student, with one `student.update` audit row each:
     `metadata: { changed: [field names], via: "student-corrections", proposalId }`.
     Like PATCH, the audit holds no values.
  6. Mark the proposal `COMPLETED` with its outcome, clear its values, and
     write a `student-corrections.confirm` audit.

  All of this commits together, or none of it does.
- **The fingerprint** covers every shown before and after value, every
  problem, and the reviewed state of each record: its six fields, admission
  number and status. An edit to a field the batch does not show (for example
  the address) does not make it stale.
- **Concurrency:**
  - Simultaneous confirms of one proposal: one write, and every caller gets the
    same outcome.
  - Two batches touching the same student: the second waits on the row lock,
    then finds the record changed and returns `CORRECTION_PREVIEW_STALE`.
- **Partial application is not supported.** A batch is all or nothing.

## Privacy and retention

- **Values** (names, dates, emails) live in the proposal only while it can be
  confirmed. They are cleared at confirm, refresh or expiry, or by the hourly
  `WorkflowProposalsSweeperService`.
- **Kept after that:** ids, counts, the outcome's field names and timestamps.
  No retention period for that metadata has been decided.
- **Logs and audits** carry ids, counts and field names only.

## Frontend integration

1. **Start.** Call `GET …/availability`. If it is off, keep using
   `PATCH /students/:id`.
2. **Build the patch.** Include only the fields the person changed.
   - Send `null` to clear the middle name or email.
   - Omit a field to leave it unchanged.
   - Make one `clientRequestId` per batch and reuse it on retries.
3. **Review.**
   - Render `rows[].fields` as named before/after values, with a "will be
     cleared" label for `CLEAR` and "no change" for `SAME`.
   - Show `current.name` and `admissionNumber` so the right child is checked.
   - Enable Confirm only when `canConfirm` is true.
4. **Confirm** with `previewHash`.
   - On a timeout, **do not prepare again**: `GET …/proposals/:id`, or repeat
     the confirm. `COMPLETED` means applied.
   - On `STALE`, `RETRY` or `EXPIRED`, call `refresh` with a new UUID, show the
     new before values and confirm again.
5. **Outcome.** `outcome.students[].changed` lists what was written.

Types are in `@school-kit/types` (`students/student-correction.dto.ts`):

- `prepareStudentCorrectionsSchema`, `confirmStudentCorrectionsSchema`,
  `refreshStudentCorrectionsSchema`;
- `StudentCorrectionProposalDto`;
- `STUDENT_CORRECTION_CONFLICT_CODES` and `STUDENT_CORRECTION_FIELDS`.

## Data and rollout

- **No migration.** Corrections reuse `workflow_proposals` (kind
  `student-correction`) and write to the existing `students` columns.
- This PR also carries the shared workflow helpers (fingerprint, expiry, a
  sweeper for every kind) in `apps/api/src/common/workflow/`. They are
  identical to PR #519's, so the two PRs merge in either order.
- To enable, turn on `student-corrections` for one school. Kill it
  platform-wide with `FEATURES_DISABLED=student-corrections`.
- To roll back, turn the switch off.

## Tests

`apps/api/src/modules/student-corrections/student-corrections.service.spec.ts`
has 11 cases, run against real PostgreSQL as `app_user`:

- the named before/after preview, with `SET`, `CLEAR` and `SAME`;
- an atomic apply with attributed, value-free audits, and untouched fields
  kept;
- cross-tenant and requester-only access;
- a teacher refused, and confirms refused after permission revocation,
  deactivation, suspension or the switch going off;
- stale previews: a shown value changed, a status changed, but not an
  unrelated field;
- patch validation, including explicit clears and rejected fields;
- concurrent confirmations, and two batches on one student;
- rollback before the marker, then a retry;
- a lost response;
- idempotent prepare, refresh and expiry;
- `PATCH` compatibility and the AI-import boundary.

Browser integration is not tested here; it belongs to the frontend PR.
