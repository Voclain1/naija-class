# 2026-11-09 — reviewed student-record corrections, backend

## Scope

After the reminder-campaign backend (#519), the owner asked for reviewed
corrections to existing students as one complete backend PR. Six fields:
first, middle and last name, date of birth, gender, email. Frontend is
ChatGPT's.

## Built

- Contracts in `@school-kit/types` with explicit patch semantics (absent =
  unchanged; `null` clears an optional field; required fields cannot be
  cleared; unknown fields rejected).
- `student-corrections` module on `workflow_proposals` (kind
  `student-correction`): prepare (idempotent), get (requester only), confirm
  (locks students in id order, recomputes the fingerprint from locked rows,
  writes updates + value-free audits + marker together), refresh.
- `student-corrections` switch, off by default. No migration.
- The shared `common/workflow` helpers, identical to #519's, so either PR can
  merge first.

## Decisions taken here (reversible)

- Requester-only; separation of duties not decided.
- The fingerprint covers shown values and each record's status and admission
  number, not unrelated fields.
- All or nothing; at most 100 rows.

## Verification

11 real-Postgres cases plus related suites; lint and typecheck clean. Final
CI on the PR.
