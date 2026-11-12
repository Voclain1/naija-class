# 2026-11-11: SchoolKit Assistant, controlled activation

Branch `agentic/assistant-activation`.

## What was asked

One bounded PR to finish controlled activation: the Super Admin alone
switches the Assistant on per school, off by default, schools cannot enable
it themselves, effective status with exact blocking reasons, real-model
verification, the approval wording still needed, and a runbook.

## What was built

- `AssistantActivationService` and `GET /platform-admin/schools/:schoolId/assistant`:
  per switch, `switchOn`, `working` and `blockers`. The blockers come from the
  functions the request path uses (`modelRoutingBlockers`,
  `orchestratorApproval`), so the report and the gate cannot disagree.
- `ModelRoutingGate` now builds on those functions; its answers are unchanged.
- `AiGenerationService.availability()`: which half of "configured" is missing
  (booleans only).
- `PATCH …/features` refuses switching `assistant-model-routing` on in
  production while the approval is pending (409, nothing stored, no audit row).
- Console: a **SchoolKit Assistant** section in the school's Manage dialog,
  with "Switch on/off" and "Working / Not working" badges and each blocker in
  words. The six keys left the generic pilot list.
- Live scenarios: permissions (a refused task, a refused record section), a
  reminder paraphrase and revision, injection inside a tool result. 19 in all.

## Decisions made here

- **Refuse the write, not only the turn.** The gate already refused every
  turn in production. Refusing the switch as well means a stored "on" can
  never exist for an unapproved prompt.
- **No test-school exception to the approval.** A synthetic school in
  production cannot use the model before AO-1. An exception keyed on a school
  would be a bypass that a real school could be put behind. Real-model
  behaviour is verified by the live evaluations until then.
- **Budget is reported, not gated.** `BUDGET_EXHAUSTED` is in the admin's
  report; the turn path already refuses at reserve.

## Not done, on purpose

- `ASSISTANT_ORCHESTRATOR_APPROVAL` is still `"pending"`; CLAUDE.md's
  allowlist still has three rows; no consent version changed; no school was
  switched on.
- Consent enforcement at switch-on (a school cannot have AI understanding
  switched on without current consent) belongs to the consent release
  (`docs/reviews/virgo-assistant-consent-release-spec.md`, step 2), once the
  wording is approved.
