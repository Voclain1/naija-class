# 2026-11-09 — SchoolKit Assistant: model orchestration

## Scope

The owner authorised building real model-backed orchestration for the merged
assistant workspace (#522), as one PR. The authorisation covers implementation
only, not new personal-data processing, legal changes or activation. #521 was
merged first, as asked earlier; its changes are on main and preserved.

## Built

- **Prompt.** `assistant-orchestrator@1` (Haiku 4.5). The tool specs are
  shared by the API and the live eval. `ASSISTANT_ORCHESTRATOR_APPROVAL =
  "pending"`.
- **Endpoint.** `POST /assistant/workspace/turn`. It runs: detectors →
  `AiGenerationService.runConversationTurn` (budget, ledger) → tools through
  `ToolRegistry` → checked reply plus code-built actions.
- **Tools.** Eight. Only `prepare_invoices` writes, and only a PENDING billing
  run (a preview). Labels and counts only. Term and class labels are resolved
  in code; ambiguity returns a question.
- **Registry.** It now accepts a `prepare` effect, and refuses any tool named
  like an approval or an execution.
- **Gate.** `ModelRoutingGate` checks four things: approval (production),
  `assistant-model-routing`, AI configured, and AI on for the school.
  Capabilities report it.
- **Panel.**
  - Model replies (marked "AI"), progress, and plain budget, rate, failure,
    timeout and unavailable states.
  - Task handles and structure-only task state sent each turn.
  - Cards apply plans once per revision. Invoices adopt the prepared run;
    reminders auto-select and request the preview; intake and corrections are
    prefilled.
  - Pasted rows never leave the device.
  - Model-shown operations read the server's record.
- **Tests and evals.** Real-PG specs with a scripted port, the conformance gate
  over the new tools, web units, an offline eval contract, 11 live scenarios
  (skipped without a key), and Playwright journeys with the model faked at the
  HTTP boundary.

## Decisions taken here (reversible)

- **Labels.** Class and term labels go to the model: school structure, not
  personal data. They pass through `safeLabel` and are fenced as data.
- **Model.** Haiku 4.5, for cost and latency. The live evals decide whether
  it is good enough.
- **Reminders:** one class or all, as the card supports.
- **Deadlines.** 45 s server-side tool deadline; 60 s client wait. No retries.

## Not decided (owner)

- **Allowlist row.** The prompt's own allowlist row: proposed wording in the
  module doc, NOT added to CLAUDE.md.
- **Other decisions.** Provider terms, privacy-policy wording, consent version
  (unchanged), pilot schools.
- **Live evals.** They were not run here: no Anthropic credential can be
  provided to this environment.

## Verification

See the PR.

## Review fixes on PR #523 (same day)

ChatGPT reviewed head 01261566. Each finding was reproduced first.

1. **Stale previews stayed approvable after a conversational revision.**
   - Reproduced in the browser on the original intake and correction cards.
   - Cause: revisions were applied only inside each card's Editor, so a card
     showing its Review never saw them.
   - Fix: one rule in the store for all four workflows. A pending plan disables
     approval, the card resets its unapproved session, typed rows and picked
     students live in task memory, and approval takes a lock at the click.
2. **A blocked request poisoned later turns.**
   - Reproduced in the store: the blocked text was resent as history.
   - Fix: user messages carry `eligible`; only server-accepted text is resent.
3. **Reminder audiences were filtered by class name.**
   - Fix: debtor rows carry `classArmId`, the card filters by ID, and
     `options.classArmIds` is enforced by the server at preview and confirm
     (`OUT_OF_SCOPE`).
4. **Named student lookup (owner requirement).**
   - Roster names become `⟨P#⟩` markers before the model.
   - The server resolves them under tenant, role and teacher scope.
   - The model sees handles and class labels; matches and records go to the
     browser only.
   - Sections reuse existing endpoints: attendance summary and RELEASED report
     cards.
   - An on-device search covers the no-model path.

Prompt bumped to `assistant-orchestrator@2`. No approval changed: the prompt
stays pending and off. Live evals (now 14 scenarios) still not run: no key.

