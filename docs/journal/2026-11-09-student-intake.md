# 2026-11-09 — reviewed student intake, backend

## Scope

Owner asked for one complete backend chunk after #512: reliable, reviewable
student intake and enrolment (prepare → authoritative preview → human confirm
→ safe write → recovery without duplicates), reusable for later school work.
Frontend is ChatGPT's (#514); this branch touches no `apps/web` code.

## What was built

- `workflow_proposals`: generic, kind-tagged, FORCE RLS, unique per
  (school, kind, requester, clientRequestId), `CHECK` that COMPLETED carries
  an outcome, confirmer and time.
- `student-intake` module: prepare (idempotent), get (requester only, works
  with the switch off), confirm (one Read Committed transaction, proposal row
  locked, fingerprint recomputed, shared writer, marker in the same commit),
  refresh (new proposal from stored rows; old one retired).
- `insertStudentBatchInTx` extracted from `StudentsService.bulkCreate`; the
  bulk endpoint keeps its contract and audit `via` values.
- Hourly sweeper clears expired proposals' rows.
- `student-intake` feature key, off by default.

## Decisions taken here (reversible, recorded in the module doc)

- Same person prepares and confirms; others get 404. Separation of duties is
  not decided.
- Single transaction, ≤200 rows, so no multi-step journal; partial execution
  not supported.
- Row data cleared at completion/expiry; proposal metadata kept with no
  retention period chosen (owner decision, open).
- Audit attribution `via: "student-intake"` + `proposalId`; never "assistant".

## Not done / not decided

- No model, no assistant tool registration, no PII-allowlist change, no
  switch enabled, no consent or legal change, no pilot.
- Browser integration not tested (frontend not wired).
- Plan cap remains count-then-insert (plans.md D3).

## Verification

See the PR for the final run. Locally: 18 intake integration cases plus the
students, feature-switch, platform-admin, RLS, audit, RBAC and assistant
conformance suites (673 tests) passed against PostgreSQL 16.
