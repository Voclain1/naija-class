# Sprint 4 — core journey validation

Date: 2026-11-17

## Purpose

Sprints 1–3 simplified individual screens. Sprint 4 verifies that the hand-offs
between roles still work for a non-technical school: the same child placed by
an owner must reach the teacher's register and gradebook, the released result
must reach only that child's guardian, and a bursar must reach finance without
gaining academic permissions.

## Production-critical matrix

| Role | Journey | Browser proof |
|---|---|---|
| Owner/admin | Create school, finish setup and invite staff | `phase-0-happy-path.spec.ts`, `first-school-setup.spec.ts` |
| Owner/admin | Add and place students | `guided-student-intake.spec.ts`, `bulk-student-add.spec.ts`, `csv-import-students.spec.ts` |
| Teacher | Open assigned register, mark and recover attendance | `teacher-attendance-safety.spec.ts` |
| Owner/teacher | Enter, save and sign off scores | `admin-gradebook.spec.ts`, `gradebook-out-of.spec.ts` |
| Owner/admin | Build, approve and release reports | `admin-gradebook.spec.ts`, `report-card-release-confirmation.spec.ts` |
| Guardian | Sign in and see only released results for their child | `guardian-released-results.spec.ts` |
| Bursar | Reach finance without gradebook authority | `admin-gradebook.spec.ts`, `finance-invoice-journey.spec.ts` |
| All four | Carry one child's record across every role boundary | `core-school-lifecycle.spec.ts` |

## Invariants

- Every test school is newly provisioned and tenant-isolated.
- Setup may use authenticated APIs; user-visible assertions use real browser
  screens. No production school or real person's record is touched.
- The composed test uses the real attendance, assessment, report workflow and
  guardian-result services. It does not write final states directly to the
  database.
- The bursar is checked both for the finance destination and the absence of the
  Gradebook navigation permission.
- Parent visibility is asserted only after the owner releases the report.

## Gate

Sprint 4 is complete only when the ordinary lint/typecheck/test/build job and
the full Playwright job pass on the PR head. The composed lifecycle is additive;
existing focused journeys remain the diagnostic source when it fails.
