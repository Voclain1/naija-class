# Bulk student placement — audit SK-01

## Problem and minimum fix

The grid linked to `/enrollments/bulk` without the context the old carry-over
wizard requires. That wizard is intentionally disabled after the August
carry-over incident. Its parameter error rendered before its disabled notice.
The grid already sent atomic placement through `POST /students/bulk`, but only
when automatic admission numbers used per-class ordering.

Expose the existing class/term picker for every numbering mode. The owner
must choose a class or explicitly defer placement before submitting whenever
classes can be loaded. No class is preselected. A school with no classes or
calendar can still create its roster, as with the single-student form.

## Contract and limits

- Reuse `BulkCreateStudentsInput.enrollment`; no API, schema, migration, RLS,
  permissions or finance changes.
- One class/term for the new rows in this grid only. Existing pupils are never
  candidates for this operation. Different classes need separate batches.
- Continue using the existing service transaction, validation and enrollment
  audit events. All-or-nothing remains per request, up to 200 rows.
- Per-class automatic numbering still requires placement for blank numbers.
- Lock placement after any successful rows, including partial multi-request
  completion, so a retry cannot quietly split a batch across classes.
- Keep `CARRY_OVER_ENABLED` false. Gate the route before mounting its loader;
  parameterless and bookmarked links show the same disabled notice and links
  to the new grid or the roster for existing pupils' Enrollments tabs.
- Do not add browser persistence for pupil data; the standing no-draft
  decision remains in force.

## Acceptance and checks

1. Manual, school-sequence, random and class-sequence numbering each support
   explicit class placement through the grid.
2. With classes available, an unanswered placement question sends no create
   request. Explicitly choosing later creates pupils without enrollments.
3. Saving a placed row creates its enrollment for the selected term and class;
   an existing unplaced pupil stays unplaced, and another class stays empty.
4. Existing duplicate-number checks, atomic-batch behavior, no-class intake and
   automatic-number display continue to work.
5. Old carry-over links, with or without parameters, load no candidates, expose
   no technical parameter error and never submit an enrollment request.
6. Update the getting-started guide to describe placement during bulk entry.

Browser regression coverage lives in `e2e/tests/bulk-student-add.spec.ts`.
Existing API coverage remains in `students.service.spec.ts`,
`student-create-enrollment.spec.ts` and `admission-numbers.spec.ts`.
Verification and release status belong in the session journal; this spec is
not evidence that tests ran or a production release occurred.
