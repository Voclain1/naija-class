# PR #563 closing sprint disposition

The starting head was `36bb0728d2cebd4367fe3beaf2d820fb6e6e6f51`. The two copies of the original audit have identical SHA-256 digests. The acceptance report preserves the 62 scenario titles and records backend evidence separately from external and frontend acceptance. [Muse acceptance matrix](unified-messaging-muse-acceptance.md)

**Recommendation: keep draft.** This work closes several concrete defects. Finance exception resolution, live cutover evidence, and some provider reconciliations remain merge or activation gates. All new paid dispatch, new top-up checkout, external onboarding and unauthorized shared WhatsApp retain their disabled defaults.

## Critical findings

| ID | Evidence and disposition |
|---|---|
| C1 | Legacy delivery requires a school allowlist, named producer, verified rate, positive school and platform ceilings and active school. SMS readiness is checked by all eight audited legacy producers before selection, with an atomic recheck at egress. Production startup rejects an implicit cutover with an existing credential. Cutover fixture validation is still required. |
| C2 | Verified net credit uses gross less actual Paystack fees exactly once. Operator re-verification accepts no manual amount, fee, wallet credit or refund. A missing actual fee remains an exception. |
| C3 | Amount/currency mismatches produce durable, tenant-scoped exceptions and an audit entry. Operators can acknowledge, escalate, attach evidence and request direct payment re-verification through the existing idempotent verification path. A governed action to adjudicate and allocate proven mismatch funds remains open. |
| C4 | Invoice locks and hard allocation cap preserve invoice state, including for collected funds against closed invoices. Receipts require positive allocation. Acknowledgment separately shows gross and unapplied funds. Governed surplus allocation/refund remains open. |
| C5 | Manual, direct checkout and link payment paths lock and recheck the invoice. Executed PostgreSQL tests exercise concurrent application and replay. |
| C6 | Existing 24-hour escalation retains the hold. Existing platform reconciliation settles/releases against evidence, and the report inbox keeps verified billing evidence while the delivery is unresolved. Ambiguous references and offboarded-school holds still need dedicated operations. |
| C7 | New validity defaults to seven days. Allocation uses independently verified paid-at compared with the recorded local cutoff. Expired links can be replaced atomically, and historical links without TTL keep their old validity policy. Hosted receipt and page acceptance remain open. |
| C8 | Modern SHA-512 is the default. Legacy requires explicit transition configuration and cannot be selected after an invalid modern header. A platform-scoped inbox records safe projections, supports audited dead-letter replay and isolates its contents from normal DB access. Production header delivery and keyring availability remain unverified. |

## Remediation verification findings

| ID | Disposition and remaining risk |
|---|---|
| R-01 | Corrected. Paid-at cutoff is enforced in the invoice transaction. An authenticated archived request can be processed with its matching stored request ID/code and independently verified nested charge. Unproven correlation remains in retries/dead-letter. |
| R-02 | Corrected in code. Both legacy release modes enforce named school and producer, school daily budget, shared platform ceiling and current kill controls. Cutover proof remains. |
| R-03 | Safe manual retry and fee breakdown shipped. No credit while fees lack verified provider evidence. A separate audited financial workflow for resolving unavailable fee data remains open. |
| R-04 | Retryable dead letters can be listed and requeued once per operator action with actor and evidence reference. Payment-request and transfer events use the same queue. Refund/dispute evidence is parked for financial review. Provider history import for events never delivered remains open. |
| R-05 | Modern-first default and explicit compatibility shipped. Verify modern delivery separately before switching an existing integration. |
| R-06 | A confirmed campaign with zero planned WhatsApp slots can send its approved email slots. A price or template halt requires a fresh quote hash before the same journal can continue. Reapproval preserves prior outcomes and only reopens mobile entries known to have skipped before egress. |
| R-07 | Zero allocation creates a funds-received acknowledgment and exception without a normal invoice receipt or paid template. |
| R-08 | Guard and inbox share mode derivation and use matching API key modes. |
| R-09 | Provider resource identity, transition and correlation reference supplement the normalized fallback projection. Paystack history event IDs outside a delivered payload are unavailable to ingress. |
| R-10 | Invoice collection curve uses allocated amounts. Gross and unapplied totals are additive API fields. Provider fee/settlement-net reporting remains separate work. |
| R-11 | Inbox FORCE RLS requires a transaction-local platform marker and no tenant scope. The runtime role cannot truncate it. |
| R-12 | A pre-send price-driven SMS-to-app route change creates a campaign audit entry. The path runs before any SMS attempt. |
| R-13 | PostgreSQL regression covers two concurrent replacement requests and no redistribution of the expired URL. Provider archival is independent of replacement. |
| R-14 | Legacy readiness is producer scoped and quotes the minimum one-segment cost. Egress uses the real segment count and atomic limits. Sweep pacing and deletion-started holds remain open. |
| R-15 | Known refund/dispute events are stored for authorized review with zero automatic effect. Transfer writes lock the payroll item. Automated refund/chargeback settlement and cross-event ordering policy remain open. |

## Financial pathways

| ID | Exposure, mitigation and open gate |
|---|---|
| P1 | Net top-up only. Actual verified fee is deducted once. |
| P2 | Durable Paystack inbox, owner and platform verification, and scheduled recovery. Provider history recovery for never-delivered records remains open. |
| P3 | Mismatches are audited and reviewable. Allocation of a mismatched charge stays gated on independently governed financial adjudication. |
| P4 | Invoice locking serializes manual allocations. |
| P5 | Manual writes execute inside the tenant transaction. Database connection failure rolls back before retry. |
| P6 | Link overpayments remain auditable and unapplied. No over-allocation or zero-allocation receipts. Financial resolution still requires an authorized action. |
| P7 | Invoice locking serializes checkout initialization. Late external collection remains possible and is capped at allocation. |
| P8 | An uncertain SMS holds funds, escalates after 24 hours and requires verified evidence or audited review. |
| P9 | Verified late billing evidence is preserved. Missing, zero-nonfinal or incompatible provider billing remains unreconciled by design until the account contract is confirmed. |
| P10 | Evidence above the reservation records a discrepancy. It does not overdraw or create unapproved auto-debits. |
| P11 | Colliding references never route to the wrong school. A dedicated operator collision-resolution flow is still required. |
| P12 | Legacy reservation conservatively consumes the daily cap even on uncertain egress. Reliable matching and release of unbilled legacy sends remains open. |
| P13 | School and platform spend limits are now enforced atomically for legacy egress. |
| P14 | Legacy spend records school, producer, event, segment count and rate version. Actual provider invoice matching remains open. |
| P15 | Kill switches are rechecked before egress. Wallet release on pre-egress rejection is independent from the conservative platform daily counter. |
| P16 | Definite local rejection differs from uncertain carrier cost. Release requires evidence of no bill. |
| P17 | School-owned WhatsApp stays wallet-neutral. The local estimate/cap cannot prevent vendor price differences. Require school-authorized account data before live release. |
| P18 | Effective dates, version, evidence and numeric policy bounds are required. Real Termii and Meta rates remain external gates. |
| P19 | SMS count uses effective encoding and segment widths. Provider-specific DND billing must be reconciled against account evidence. |
| P20 | Signed refund/dispute events are retained for review. No automatic reversal or credit clawback is implemented. Do not activate top-ups until finance handling is agreed. |
| P21 | Wallet ledger guards and locks protect the runtime path. Runtime TRUNCATE is revoked. Reversal and independently reconciled zero-floor audit remain release work. |
| P22 | Existing provider-event reconciliation is not a complete invoice-to-ledger importer. Account-specific statement formats and supported identifiers are release gates. |
| P23 | Blank non-payment SMS copy now blocks before the zero-unit price calculation. These paid SMS event types need approved copy before activation. |

## Muse section 9 merge conditions

| Condition | Status |
|---|---|
| 1. Written C1 policy, bounded migration and cutover preflight | Implemented and isolated-tested. Before production, run compatibility preflight against an agreed school/producer inventory and approved capacity evidence. |
| 2. Link expiry applied to money movement and regression coverage | Backend timestamp allocation, pending archival and concurrent replacement cases passed in isolated PostgreSQL. |
| 3. Modern Paystack delivery and key material verified in the target deployment | Code and example configuration default to modern. Target deployment remains unverified. |
| 4. Dead-letter recovery | Retryable dead-letter list and requeue passed with competing replay requests. Never-delivered history recovery and external adjustments remain separate. |
| 5. No receipts for zero allocations | The timestamp case asserts null receipt and zero allocation. Parent acknowledgment distinguishes the funds received. |
| 6. Execute the regression suites | Focused results below. Use exact-head CI before interpreting full-suite or fresh-schema status. |

## Executed evidence and external gates

- On isolated PostgreSQL with fixture provider responses, `vitest run src/common/termii src/common/paystack src/modules/payments src/modules/invoices/payment-links.service.spec.ts src/modules/notifications/messaging src/modules/reminder-campaigns src/modules/finance src/modules/payroll src/modules/admissions src/modules/health src/modules/hostels src/modules/messages src/modules/behaviour src/modules/guardians` passed 593 tests in 42 files.
- Existing-schema rehearsal applied migrations `20270121090000` through `20270121120000` over the previous branch schema using `prisma migrate deploy`. A separate local container could not start because Docker storage was full. Use GitHub CI for evidence from an empty schema.
- Outstanding production evidence includes modern Paystack signing delivery, archived request payload/correlation, Termii account signing, sender approval, pricing/settlement statements, Meta App Review, account ownership, approved template variants and school billing evidence, and consent review. No account API, real provider transaction, real messaging or external spend was used in this verification. [Paystack webhooks](https://paystack.com/docs/payments/webhooks/) · [Paystack payment requests](https://paystack.com/docs/api/payment-request/#archive-payment-request)
