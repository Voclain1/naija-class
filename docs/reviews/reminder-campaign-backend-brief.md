# Next backend chunk: durable fee reminder campaigns

Status: implementation handoff, not a new policy approval. Frontend ownership:
ChatGPT. Backend/API/database: Claude. One complete backend PR for this workflow.

Read AGENTS.md, CLAUDE.md, CODEX_HANDOFF.md, the current workflow chunk order in
agentic-implementation-plan.md and docs/modules/reminder-campaign-workflow.md.
Read the existing finance sendReminders service and notification/email/SMS rails
before designing tables. Reuse merged proposal/execution infrastructure where
appropriate, but external sends cannot be made atomic by a database transaction.

## Deliver a working end-to-end backend

1. **Prepare and preview:** term-scoped filters and explicit selected student
   handles/ids resolved server-side; exclude live payment plans by default;
   deduplicate students across supplementary invoices. Server-computed balances,
   eligibility, linked-guardian reachability, template version, channel/sender
   availability, counts, errors and warnings. No guessed provider cost or
   claimed final-delivery guarantee. Report unknown setup facts honestly.
2. **Durable approved campaign:** tenant/requester binding, immutable reviewed
   selection and template, preview fingerprint, expiry and client idempotency
   identity. Refresh stale previews and require human review again. Preserve
   existing permission splits; do not decide pending separation-of-duties or
   retention policy recommendations for Ben.
3. **Explicit human confirmation and execution:** recheck active status,
   school, current permissions, scope, feature state and expected records.
   Bounded worker batches and a durable per-recipient/channel execution journal
   or outbox. Capture progress so a restart does not forget prior acceptance.
   Server rechecks current debt/plan eligibility before each outbound action.
4. **Dedupe and recovery:** campaign/recipient/channel keys, concurrency claims,
   retries only when provably safe, requester-authorised status/results. Verify
   provider-specific idempotency/status capabilities from official docs before
   using them. If a provider may have accepted a request whose response was
   lost, preserve UNKNOWN and do not blindly resend. Do not claim exactly-once
   external delivery without evidence. Resume unsent work only under documented
   explicit recovery rules; a halted campaign never silently restarts.
5. **Useful results:** per-recipient/channel accepted, skipped, failed, unknown
   and not-requested states with actionable reasons. Distinguish API/provider
   acceptance from actual delivery and parent reads. Financial figures come
   from services only. A kill switch prevents new sends without destroying
   existing outcomes.
6. **Compatibility:** keep POST /finance/debtors/remind and its current DTO
   working for existing callers. Publish shared typed contracts and concrete
   request/response examples for prepare, confirm, status and recovery. Leave
   apps/web and browser tests to ChatGPT. The current frontend intentionally
   calls only existing endpoints; wire it to the new contract after publication.

## Constraints

- The first version uses existing deterministic fee-reminder templates and
  rails. No AI messaging, conversation triage or free-text reply generation.
- No student/family PII or per-family figures go to a model. No expansion of the
  AI allowlist, consent versions, legal approvals or pilot activation.
- No settings automatically enabled, no family WhatsApp integration invented.
  Honour channel preferences, approved sender configuration, quiet hours and
  push-or-SMS rules. Avoid logging message content, contact details or amounts.
- Keep schema changes additive, FORCE RLS and audits attributed accurately.
  No new SECURITY DEFINER function merely for tenant-side campaign work.
- Do not introduce a new retention period as an owner-approved decision. Follow
  existing operational rules and identify a genuinely missing decision once.
- New functionality stays dark under a registered per-school feature switch.
  Do not enable it for real schools.

## Required evidence

Real-Postgres tests: tenant/requester boundaries; missing/revoked permission;
account deactivation and suspended school; stale preview; paid balance or plan
added mid-run; duplicate invoices and sibling guardians; concurrent confirms
and workers; crash before/after a send; lost provider response; restart recovery;
no duplicate accepted send when dedupe/provider support makes that provable;
unknown sends never automatically retried; disabled channels/sender; quiet hours;
kill switch; result reconciliation and backward compatibility. Use fake provider
ports, not real families. Run required checks and final-head CI.

Include migrations, implementation, shared types, tests, module documentation,
journal and CODEX_HANDOFF together in one PR. PR description must contain exact
frontend integration steps, delivery guarantees and limits, rollout/rollback and
verification. Work through routine engineering choices without asking Ben to
relay details. Do not merge, deploy or enable the campaign.
