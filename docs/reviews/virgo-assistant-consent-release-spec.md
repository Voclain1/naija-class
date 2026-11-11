# Virgo Fidelis assistant — consent and privacy release specification

**Status: proposed text and implementation instructions only. Not a legal approval.** 2026-11-11.
Related: `virgo-assistant-pilot-review-packet.md`, `agentic-f16-f17-approval-brief.md`, `docs/legal/ndpr-ai-review.md`.

## Decision boundaries

- **School consent:** recommend a new version after counsel approves a materially updated agreement. The current `SCHOOL_CONSENT_VERSION` is `2026-10-25`; **do not change it until final wording is approved**. Reacceptance must be recorded for the pilot school before model routing is enabled.
- **Parent consent:** counsel decides whether a new version is necessary, including the case of incidental child data in staff chat. Current `PARENT_CONSENT_VERSION` is `2026-10-25`; **do not bump without the decision**. If notice rather than re-consent is sufficient, document the rationale and provide the school a parent notice.
- **Scope:** the named `assistant-orchestrator` prompt needs its **own** PII allowlist approval; the existing `help-assistant` exception does not authorise it. Do not turn on model routing or change `ASSISTANT_ORCHESTRATOR_APPROVAL` in this PR.
- **Provider evidence:** owner Console shows 30-day retention, feedback off and an individual organisation. Production key association, applicable DPA/Commercial Terms acceptance, and location/model exceptions remain unverified. Keep existing key per owner decision; rotation deferred unless necessary before public rollout.

## Draft addition to the SchoolKit Privacy Policy (counsel review)

### Optional staff AI assistant

> If a school enables the model-backed SchoolKit Assistant, authorised school staff may use it to find permitted records, ask questions and prepare administrative actions. Each request may transmit the staff member's message, earlier messages in that conversation, structured task context, limited school settings and necessary tool context to our external AI model provider. We use checks intended to block names and other personal details before transmission and keep student records out of model-visible lookup results, but those checks cannot identify every personal detail. Staff should not enter student, guardian or staff personal information in the chat; dedicated forms should be used instead. The assistant can prepare actions for review, but changes to school records or messages require an authorised person's separate confirmation in the relevant workflow. SchoolKit's intended design stores usage, security and execution metadata, not the text of the questions or answers; conversation history is held temporarily in the staff member's browser and cleared on sign-out, account or school switch, and after 15 minutes without activity. Our model provider's displayed organisation setting retains API inputs and outputs for 30 days by default; exceptions and the applicable processing/storage locations depend on the provider agreement and configuration. We will publish the final verified provider details before enabling this feature. The school may request that model-backed assistance be disabled.

**Publication blockers:** reconcile with actual runtime storage, security telemetry and contractual facts; counsel must approve lawful basis, cross-border transfer and notice obligations. Do not publish the draft's conditional or unverified statements as final facts.

## Draft additional school-owner confirmation (counsel review)

> I am authorised to enable optional model-backed staff assistance for this school. I understand that staff-entered requests, conversation history and limited school information may be processed by an external AI provider, and that screening cannot guarantee all personal details are detected. I will instruct staff not to enter personal details in the assistant chat, use dedicated forms for school records, and provide the notices and obtain the permissions required by law. I understand that the assistant prepares previews and that an authorised person must separately review and confirm any change. I have reviewed SchoolKit's current Privacy Policy and Data Processing Agreement and agree to the additional processing described for this optional feature.

**Implementation:** once legally approved, update `packages/types/src/legal/index.ts` school consent points and bump `SCHOOL_CONSENT_VERSION` in the same release as the matching final public privacy/DPA wording. Existing schools must not be silently treated as having agreed to the new version. The pilot school must explicitly reconfirm before enablement.

## Draft notice to school staff

> SchoolKit Assistant is optional and is enabled by your school. Please do not type student names, phone numbers, email addresses, dates of birth, medical information, admission numbers or pasted registers into the chat. Use the dedicated forms instead. The assistant can help you find records and prepare work, but nothing is issued, sent or changed without your review and confirmation. Some messages may be processed by an external model provider, subject to the school's privacy notice. Ask your school administrator if you have questions or wish to report a problem.

## Parent notice / consent decision

**Proposed school-issued notice if counsel approves notice without re-consent:**

> Our school is considering an optional staff assistant in SchoolKit to help authorised staff find permitted information and prepare administrative tasks. Staff will be instructed not to enter children's or families' personal details in the assistant chat, and the service includes automated screening, but no screening is perfect. Some incidental personal information could be processed by an external AI provider. School records and outgoing messages will continue to require authorised staff review and confirmation. Please contact the school office with questions about how your child's information is handled.

Do **not** send this notice or alter `parentNoticeLetter` until the legal decision is recorded. If counsel requires parental consent, draft the actual consent and version bump instead.

## Release sequencing (two distinct PRs after approval)

1. **Legal/public wording:** counsel-approved privacy and DPA changes in `schoolkit-landing`; verify URLs and published content, including provider data terms.
2. **Consent + enforcement:** update consent points and version(s) in `naija-class`, add regression tests proving older consent is stale and pilot school cannot enable model routing without current consent; only then seek separate named-prompt and code-level activation approval.

No silent auto-accept, no backdating consent and no weakening of the super-admin gate. Production activation requires a separate explicit owner decision after legal sign-off, release verification and 56/56-or-better live-model evaluation.

## Evidence to obtain

- Signed reviewer conclusion on lawful basis, NDPA obligations, DPIA need and cross-border transfers.
- Provider agreement/DPA version and acceptance record, retention exceptions, processing/storage locations and training opt-in status.
- Production-key-to-organisation match (or documented alternative verification without exposing secrets).
- School-owner acknowledgement for Virgo Fidelis and, if counsel requires, parent consent or notices.
- Engineering confirmation of the browser/session retention, PII detection, server logging and per-school gate behaviour.

**Current disposition:** drafting complete; legal approval, publication, consent version changes and activation **not complete**.
