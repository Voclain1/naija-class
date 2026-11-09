# 2026-11-09 — durable fee reminder campaigns, backend

## Scope

The owner asked to finish the active reminder-campaign backend chunk (brief
`docs/reviews/reminder-campaign-backend-brief.md` on ChatGPT's frontend
branch) before reviewed student-record corrections. Backend only; no
`apps/web` change.

## Built

- Proposal lifecycle on `workflow_proposals` (kind `fee-reminder-campaign`):
  prepare (idempotent), refresh, confirm (one transaction creating the campaign
  and its journal), requester-only reads.
- `reminder_campaigns` and `reminder_campaign_sends` (FORCE RLS, ids and
  states only).
- Worker: per-batch access, switch and channel re-check; per-student debt and
  plan re-check; claim-commit-send-record; lease → UNKNOWN; quiet-hours hold;
  halt and explicit resume; a two-minute scheduled runner.
- `EmailService.sendWithOutcome` and `TermiiService.sendSmsWithOutcome`
  classify ACCEPTED / REJECTED / UNKNOWN without logging contacts or text.
- Shared workflow helpers moved to `common/workflow` (fingerprint, expiry,
  sweeper for all proposal kinds).

## Decisions taken here (reversible, in the module doc)

- Requester-only control; separation of duties not decided.
- Quiet hours hold campaign sends (the one-click endpoint keeps sending at
  press time).
- No automatic retry of UNKNOWN; a batch claimed together goes UNKNOWN
  together after a crash.
- Provider idempotency not relied on: Resend and Termii docs were not
  reachable from this environment. A Resend Idempotency-Key is still sent.

## Open, recorded once

- Retention of campaign and send metadata: no period decided.

## Verification

17 real-Postgres campaign cases; related finance, notifications, intake,
feature-switch, RLS, audit, RBAC and conformance suites (797 tests) pass;
lint clean. Final CI on the PR.
