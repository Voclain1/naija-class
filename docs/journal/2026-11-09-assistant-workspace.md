# 2026-11-09 — SchoolKit Assistant, unified workspace

## Scope

The owner asked for one globally reachable staff assistant that does work
through the four reviewed workflows (#512 invoices, #519 reminder campaigns,
#517 intake, #520 corrections), as one PR. #521 (the corrections page) is open
and was not touched; the assistant calls the #520 API directly.

## Built

- `assistant-workspace` switch (off everywhere) and
  `GET/POST /assistant/workspace/{capabilities,help}`: availability from the
  same switches, permissions, roles and active status the workflows enforce;
  guide search with no model and nothing stored.
- `routeAssistantRequest` in `@school-kit/types`: deterministic routing,
  clarification, refusals with the right next step, structural hints only.
- Web: `AssistantStore` in the root providers (memory only, keyed to
  `schoolId:userId`, 15-minute idle clear, references kept for open
  operations), the launcher and panel in both staff shells, and one card per
  workflow driving its existing session or a new store-held session
  (`InvoiceRunSession`, `CorrectionSession`, `IntakeTask`).
- Evals (`assistant-router`), a real-Postgres API spec, web units and a
  Playwright spec with desktop and phone screenshots.

## Decisions taken here (reversible)

- **No model routing.** Operational chat is not covered by any approved
  prompt; the `help-assistant` exception is for help and settings questions
  and its pilot is inactive. `modelRouting` is hard-wired unavailable and the
  decision needed is written in the module doc.
- Requester confirms, as in each workflow; separation of duties undecided.
- Suggestions use only the first path segment; no page content is read.

## Verification

See the PR: lint, typecheck, unit, API, evals, web build and Playwright.
