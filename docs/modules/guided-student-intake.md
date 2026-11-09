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
- A network failure or 5xx can leave the outcome unknown. The legacy bulk flows stop
  and disable retry, telling the person to inspect the roster. It never claims
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

## Server-reviewed intake (backend PR #517)

When `/student-intake/availability` reports enabled, the guided grid prepares
one server-owned proposal (maximum 200 rows) and renders its normalised rows,
placement, blocking problems and advisory warnings. Confirmation sends only
the proposal identifier and preview hash. An expired or stale preview must be
refreshed and reviewed again, including a new unchecked acknowledgement.

A lost prepare retries the same client request id and immutable payload. A lost
confirm reads the original proposal: completion maps the server's indexed
outcome to saved rows; a pending proposal needs another human confirmation.
If status cannot be read, the dialog locks editing and new preparation and
provides **Check save outcome**. It works after the feature is switched off.
Do not reload or leave while checking an uncertain outcome: proposal identity
and unsaved rows are intentionally in page memory only.

Feature off (or a backend without the availability endpoint) retains the
existing client-review/bulk path. Other availability errors block saving and
offer a retry, never silently fall back. The direct bulk grid remains unchanged
apart from the uncertain-outcome stop and stricter local calendar validation.

The backend contract and transaction guarantees live in
`docs/modules/student-intake-proposals.md`. No backend file is changed by this
frontend integration. All switches remain operator-controlled and off unless
explicitly enabled; integration tests enable only their fresh test school.

## Verification

Unit checks: review summary and uncertain-outcome classification. Browser cases:
review is read-only; cancel/edit; explicit term; atomic create+enroll; saved
student links; unknown-response stop; duplicate rows; permission refusal.
Verification results and remaining limits are recorded in the journal and PR.
