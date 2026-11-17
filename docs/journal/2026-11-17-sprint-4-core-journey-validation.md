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
