# Guided student intake — frontend chunk (2026-11-09)

## Scope and ownership

ChatGPT owns this frontend delivery; Claude owns API/database/agent execution.
This PR changes staff web, browser tests and documentation only. It composes the
existing student creation and enrollment contracts, not a new conversational
agent or new model processing permission.

The `/students/intake` entry offers the existing single form, spreadsheet import
and register scan, plus an embedded guided class-list grid. The grid requires an
explicit placement/defer decision and term, validates rows and repeated admission
numbers, shows the exact pending students and destination before confirmation,
then saves through `POST /students/bulk`. Saved rows are never resubmitted.
The ordinary grid keeps its direct save flow, with the same unknown-outcome
stop and stricter calendar/gender validation.

The reviewed rows exist only in component memory. No browser persistence,
transcript, analytics content or model call is introduced. Photo extraction and
CSV jobs continue to use their existing screens and permissions/consent gates.

## Safety and limits

- Existing all-or-nothing guarantee is **per request**, up to 200 students.
  Larger lists are separate sequential requests; the review says so explicitly.
- This frontend preview is not a server reservation or authoritative duplicate
  check. The server revalidates on save. No name-based merge is inferred.
- A network failure or 5xx can leave the outcome unknown. Both grid flows stop
  and disables retry, telling the person to inspect the roster. It never claims
  an unacknowledged request saved nothing, especially with automatic numbering.
- No guardian is linked or invited automatically, and no notification is sent.
  Successful students have links to their existing records for those next steps.
- No class or term is silently guessed in the guided flow. No carry-over wizard
  is enabled. Existing backend permission and enrollment audit gates remain.

## Existing contract

`POST /students/bulk`: `{ students: CreateStudentInput[], enrollment?:
{ classArmId, termId } }` → `{ created: StudentDto[] }`. Each request commits its
students and selected enrollments together. `ADMISSION_NUMBERS_TAKEN` returns
batch-relative row indexes; known successes are retained and only pending rows
are considered for a later reviewed attempt.

## Backend handoff for Claude

No endpoint is needed to ship this frontend. A later conversational intake agent
should supply reviewable rows and scope to this UI through an agreed typed
contract. Server-owned proposal snapshots, idempotency keys and an outcome/read
endpoint are needed before an unknown automatic-number save can be retried
automatically. These are requirements, not endpoints implemented by this PR.
Do not expand the PII allowlist or reuse the help prompt for student writes.

## Verification

Unit checks: review summary and uncertain-outcome classification. Browser cases:
review is read-only; cancel/edit; explicit term; atomic create+enroll; saved
student links; unknown-response stop; duplicate rows; permission refusal.
Verification results and remaining limits are recorded in the journal and PR.
