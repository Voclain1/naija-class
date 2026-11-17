# 2026-11-17 — Sprint 4 core journey validation

Started the final UX programme validation from deployed main commit `15cc79ab`.
The existing browser suite covered the core screens individually but had no
single-school proof across owner, teacher, bursar and guardian hand-offs.

Added `e2e/tests/core-school-lifecycle.spec.ts`. It provisions one isolated
school and carries the same child through class placement, teacher attendance,
owner score entry and sign-off, the controlled report-card workflow, and the
guardian's released-results screen. It also creates a real bursar session and
proves finance is available while Gradebook is not.

No production records, permissions, workflow states or feature defaults were
changed. The validation matrix is recorded in
`docs/reviews/sprint-4-core-journey-validation.md`.

CI #1385 passed all 246 pre-existing browser tests and failed only the new
journey at the teacher register. The child had been enrolled with today's
timestamp while the stable fixture term/register date is in 2025; attendance
correctly excludes a pupil who joined after the selected date. The composed
fixture now backdates that one disposable enrolment to the fixture term start,
matching the established `seedAttendanceRoster` setup. Product attendance
logic was not changed or weakened.

The next run passed the attendance hand-off and all 246 existing browser
tests, then reached the final-term approval safeguard. Because the fixture has
one term, SchoolKit correctly requires a promotion decision for every pupil.
The composed journey now marks the child's card **Promoted** through the real
promotion-status endpoint after form review and before principal approval.
The approval rule remains unchanged.
