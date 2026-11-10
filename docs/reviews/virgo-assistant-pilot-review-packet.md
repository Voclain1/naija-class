# Virgo Fidelis Montessori School — controlled assistant pilot review packet

**Status: DRAFT FOR INDEPENDENT LEGAL/DATA-PROTECTION REVIEW. NOT APPROVED FOR ACTIVATION.**
Prepared 2026-11-11. Scope: one named school only, staff-facing SchoolKit Assistant model orchestration; no platform-wide rollout. This is an operational review packet, not legal advice.

## 1. What is ready and what is not

- The manual live-model evaluation run [42925059216](https://github.com/Voclain1/naija-class/actions/runs/42925059216) completed with **56 passed, zero failed/skipped**. This is scenario coverage, not a proof of all production behaviours.
- Anthropic API connectivity and the GitHub Actions secret were verified separately. The provider's **account-specific** data terms have not been verified.
- The `assistant-orchestrator` prompt is still **not on the named PII allowlist** in `CLAUDE.md`; `ASSISTANT_ORCHESTRATOR_APPROVAL` remains `pending`.
- No school is authorised by this packet to have model routing activated. Do not flip a school flag, modify a deployment secret, bypass consent or deploy an approval change on the strength of this draft.

## 2. Processing and data-flow summary for counsel

Staff enter free-text requests in the staff web assistant. The server checks school/user permissions, school-scoped personal-data detectors and model-routing gates before making a bounded call to Anthropic's Messages API. The model receives the staff message, recent conversational context, structured task state and tool-visible labels/counts. Names in supported student lookup requests are replaced with markers; the server resolves names and returns student details to the authorised browser, **not to the model**. The assistant can prepare an invoice preview, configure reminder/intake/correction cards and request read-only status. It has no tool that approves or executes a write; authorised staff must explicitly approve in the server-backed card.

**Residual risk:** staff can type personal information the detectors fail to recognise; task and class labels, prior history or unexpected text may also carry personal data. This is why the new named prompt requires its own explicit approval and legal review. The model must not receive raw student names or records from student lookup tools.

**Retention:** the design aims to keep conversation text in browser memory only, clear it on sign-out, account/school switch and 15-minute inactivity, and retain server-side metadata rather than question/answer text. Counsel and engineering must verify actual runtime behaviour and provider retention; these are not guarantees made by this packet.

## 3. Draft notice for school staff and school administrators

> **SchoolKit Assistant (optional school feature).** When your school enables the model-backed assistant, authorised staff can ask questions and prepare school-administration tasks in everyday language. Each request may send the current message, earlier messages in that conversation, task context and limited school information to an external AI model provider for processing. We use checks designed to prevent identifiable student and family information being sent, but these checks cannot detect everything. Do not type personal details into the chat; use the dedicated student and finance forms. The assistant may prepare a preview, but it cannot approve, issue, send or save school changes on your behalf. You must review and confirm changes using the relevant card. SchoolKit records usage and security metadata; the intended design does not store chat questions and answers on its servers. The provider's applicable retention, processing locations and training terms will be stated in the final privacy notice after account-specific verification. Your school can ask SchoolKit to disable this feature.

**Not publication-ready.** Reconcile with the actual privacy policy and D6 account facts; do not promise zero retention, fixed residency, or guaranteed PII detection.

## 4. School agreement wording — draft for review

> **Optional AI-assisted administration.** On behalf of our school, I understand that enabling SchoolKit's model-backed staff assistant may transmit staff-entered messages, conversation context and limited school information to an external AI model provider. SchoolKit applies privacy checks and requires staff to use dedicated forms for personal details, but cannot guarantee that every personal detail in free text is detected. The assistant cannot complete financial or student-record changes without an authorised user's separate review and confirmation. We will inform and instruct our staff and fulfil any notices or permissions required for pupils and guardians under applicable law. We understand we may request that the feature be disabled.

**Consent-version decision:** counsel must confirm the lawful basis, controller/processor responsibilities, final text and whether `SCHOOL_CONSENT_VERSION` must be bumped (recommended in the existing approval brief). Counsel must separately decide whether `PARENT_CONSENT_VERSION` changes; **do not bump either silently or as part of this documentation PR**.

## 5. Evidence required from the actual Anthropic organisation (D6)

Collect without exposing the API key:
1. Organisation name/identifier and the governing Commercial Terms and DPA, including dates and any amendments.
2. Training opt-in status and whether feedback has been submitted.
3. Standard or custom retention arrangements, exceptions and eligibility for zero-data-retention (do not claim ZDR without proof).
4. Processing region, storage location, regional restrictions and any configured residency options.
5. Terms specific to the deployed Haiku model and enabled Messages API features.
6. Whether `ANTHROPIC_BASE_URL` or another route is overridden in the deployed environment; never print the environment file or secrets.
7. Evidence of model input/output logging, caching and incident-handling configuration.

The public provider baseline described in `docs/reviews/agentic-f16-f17-approval-brief.md` is **not** sufficient evidence for SchoolKit's organisation.

## 6. Questions for the Nigerian data-protection reviewer

- Is the controller/processor classification correct for staff prompts, student record lookup and prepared financial actions?
- What is the lawful basis for processing incidental child/guardian personal data and transferring it outside Nigeria? What contractual transfer safeguards are required under NDPA 2023 and applicable guidance?
- Is the draft staff notice adequate? Must school administrators reaccept the agreement? Must guardians receive notice or re-consent?
- Are retention, metadata-only logging, browser session limits and data-subject rights mechanisms sufficient and accurately described?
- Does the assistant require a DPIA or other documented risk assessment before pilot activation?
- What additional controls or contractual commitments are needed before a one-school pilot?

**Reviewer:** __________________  **Qualification:** __________________
**Review date:** _______________  **Outcome:** Approve / Approve with conditions / Do not approve
**Conditions and evidence references:** ______________________________________

## 7. Release checklist — all must be explicitly complete

- [ ] Counsel signs the review and closes the applicable issues in `docs/legal/ndpr-ai-review.md`.
- [ ] D6 organisation-specific provider facts verified and archived without secrets.
- [ ] Final privacy-policy and staff notice published in the marketing-site repository.
- [ ] School and parent consent-version decisions recorded; required wording/version changes deployed.
- [ ] Virgo Fidelis school owner/admin accepts the new applicable terms.
- [ ] The owner explicitly approves the **named** `assistant-orchestrator` PII allowlist entry and its narrow residual risk, and code-level approval is changed in the same reviewed PR.
- [ ] Confirm super-admin-only school enable/disable, kill switch, per-school budget, role/tenant isolation, audit logging and human approval gates on production.
- [ ] Re-run CI and live-model evaluations on the release commit.
- [ ] Enable model routing **only for Virgo Fidelis**, then perform a supervised read-only smoke test before any write-preview workflow.
- [ ] Record rollback procedure, monitoring owner, and pilot stop conditions.

**References:** `docs/reviews/agentic-f16-f17-approval-brief.md`, `docs/legal/ndpr-ai-review.md`, `docs/modules/assistant-workspace.md`, `docs/modules/data-protection.md`, `CLAUDE.md`.
