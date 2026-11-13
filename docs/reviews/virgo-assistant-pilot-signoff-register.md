# Virgo Fidelis assistant pilot — approval and evidence register

**Status: OPEN / NO ACTIVATION AUTHORISED.** Prepared 2026-11-11. Owner decision: retain the current working Anthropic API key; rotate before public rollout only if necessary.

This register is the decision tracker for the existing [pilot review packet](virgo-assistant-pilot-review-packet.md) and [consent release specification](virgo-assistant-consent-release-spec.md). It is not a substitute for a lawyer's opinion, provider agreements or a production verification.

| Gate | Responsible decision-maker | Current evidence | Remaining action | Status |
|---|---|---|---|---|
| Live-model scenarios | Engineering | [Run 42925059216](https://github.com/Voclain1/naija-class/actions/runs/42925059216): 56 passed, 0 failed/skipped | Re-run on final release commit | Passed for evaluated commit |
| Provider organisation identity | SchoolKit owner | Console screenshot: individual organisation, displayed organisation identifier | Confirm deployed key belongs to this organisation without exposing it | Open |
| Provider retention | SchoolKit owner | Console: organisation default 30 days, ZDR not enabled | Verify exceptions and applicable model/features | Partially evidenced |
| Training and feedback | SchoolKit owner | Feedback off, Development Partner Program shows Join, metrics logging on | Verify any historical opt-ins, agreement and feedback | Partially evidenced |
| Provider contract and transfers | Counsel + owner | Links to provider Commercial Terms, privacy and usage policy; engineering draft transfer assessment in [assistant-orchestrator-transfer-assessment-draft.md](assistant-orchestrator-transfer-assessment-draft.md) | Identify applicable versions, DPA, dates, sub-processors and lawful international transfer basis | Open |
| Privacy-policy wording | Counsel + marketing-site maintainer | Draft in consent release specification | Approve and publish final text, verify public page | Draft |
| School agreement | Counsel + SchoolKit owner | Draft consent clause | Determine final terms and bump school consent version if materially changed; obtain Virgo school acceptance | Draft |
| Parent notice/consent | Counsel + pilot school | Draft parent notice | Decide if notice, re-consent or other basis is required; decide parent consent version | Open |
| Child-data risk / DPIA | Counsel + owner | PII detector and opaque marker design; engineering draft DPIA in [assistant-orchestrator-dpia-draft.md](assistant-orchestrator-dpia-draft.md) (Part B also covers Smart Import, live since 2026-10-25) | Determine and document DPIA necessity, residual risk acceptance and child safeguards | Open |
| Runtime privacy and authorisation | Engineering | Architecture and test descriptions | Verify browser memory expiry, no text logging, tenant isolation, tool redaction, human approval, school kill switch | Not independently reverified |
| Named prompt PII exception | SchoolKit owner | Existing allowlist has no `assistant-orchestrator` row | Separate explicit owner approval after legal review, update allowlist and pinned test | Pending |
| Code-level model approval | SchoolKit owner + engineering | `ASSISTANT_ORCHESTRATOR_APPROVAL = "pending"` | Separate reviewed PR after all preceding approvals | Pending |
| Pilot-school enablement | Super admin | Virgo Fidelis selected as proposed pilot | Verify all gates, school acceptance and release CI; enable only this school | Not authorised |

## Reviewer's required written decisions

1. **Lawful basis:** Is staff-initiated model processing, including possible incidental pupil or guardian data, lawful for this pilot? Specify the basis and limitations.
2. **Controller and processor roles:** Who is controller for staff prompts and task records, and what contracts are required?
3. **International transfer:** Are provider terms and safeguards sufficient under the Nigeria Data Protection Act 2023 and applicable regulations/guidance?
4. **Children and families:** What parent notice or consent is required, and does the parent consent version change?
5. **School consent:** Approve final school wording and whether existing schools must reaccept (recommended).
6. **Privacy and retention:** Approve the final notice against verified runtime behaviour and provider retention/region facts.
7. **DPIA and records:** State whether a DPIA is required and any record-of-processing or breach-response changes.
8. **Decision:** Approved / approved subject to written conditions / not approved. Record reviewer name, qualification, date and any expiry or conditions.

**Reviewer name:** __________________
**Professional qualification / organisation:** __________________
**Date:** __________________
**Written conclusion / attached reference:** __________________
**Conditions:** __________________

## Engineering work permitted before sign-off

- Read-only audits of current privacy, session expiry, logging, authorisation, PII filtering and feature flags.
- Tests and documentation for consent enforcement and safe fallback, without changing active consent versions.
- Preparation of draft implementation PRs that do not enable model routing or expose new data.
- Confirming the production key's provider organisation through a safe metadata/console check, not by printing secrets.
- Recording pilot budget, support contact, monitoring and rollback instructions.

## Release stop conditions

Stop and disable the pilot if any cross-school data is visible, a model receives raw student names or other prohibited records, a task executes without explicit authorised card confirmation, a privacy/consent gate is bypassed, unredacted prompts appear in logs, or provider settings materially differ from the approved review. Document the incident and do not re-enable until reviewed.

**No merge of this document authorises any school switch, key change, consent bump or production model routing.**
