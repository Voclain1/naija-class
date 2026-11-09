# SchoolKit Assistant (unified workspace)

Status: built on 2026-11-09 (branch `agentic/unified-assistant`). The
`assistant-workspace` switch is off for every school, and so is each
workflow's own switch. Nothing is enabled, deployed or approved for a pilot.

## What staff can do with it

The SchoolKit Assistant is one panel in the staff app. A staff member opens it
from any staff page and describes a task in their own words, or picks a
suggested task. They supply what's missing in structured controls, review the
server's preview of exactly what will change, and approve it with an explicit
control. They then see the server's actual result.

| Task | Backed by | What the assistant does |
|---|---|---|
| **Generate term invoices** | #512 `/assistant/billing/runs` (`docs/modules/assistant-billing.md`) | Choose the term and up to 20 classes (prefilled from the request when it names them) and an optional due date. Shows the server's preview: per-class new and skipped counts, per-student amounts, totals and blockers. **Approve and issue invoices** issues through the existing invoice service. Shows issued and skipped counts. |
| **Send fee reminders** | #519 `/finance/reminder-campaigns` (`docs/modules/reminder-campaigns.md`), driven by #518's `DurableCampaignSession` | Choose the term, class, "overdue only" and "leave out payment plans", then select the families. Shows the server's preview: eligibility per student, channels and warnings. **Confirm and start sending** starts the campaign. Shows the saved campaign: progress, quiet-hours holds, halt and explicit resume, and per-family, per-channel outcomes. UNKNOWN is shown as "may have been sent" and is never retried. |
| **Add and enrol students** | #517 `/student-intake/proposals`, driven by #514's `IntakeSession` | Type rows, or paste them from a spreadsheet (parsed in the browser), and choose a class and term or "place later" in the existing `PlacementPicker`. Shows the server's preview of identities, numbers, placement and warnings. **Confirm and save students** saves them. Links to each new record. Sends no invitations. |
| **Correct student records** | #520 `/student-corrections/proposals` (`docs/modules/student-corrections.md`) | Find each student with the existing roster search, then for each of the six fields choose **Keep**, **Change** or **Clear it** (middle name and email only). Shows the server's before and after. **Confirm corrections** applies them. A stale preview needs **Refresh with current records** and a new confirmation. |
| **Questions about SchoolKit** | `POST /assistant/workspace/help` (lexical search of the Getting started guide) | Returns up to three guide sections, each with a link to the full section. |

The assistant does **not** edit arbitrary records, send arbitrary messages or
SMS, record payments, change grades, behaviour or health, link guardians,
change admission numbers or statuses, move students between classes, or
delete anything. Asked to do one of these, it says so plainly and points to
the right page.

## Where it opens

- **The launcher:** a "SchoolKit Assistant" button fixed to the bottom-right
  corner of every page in the `(admin)` and `(teacher)` shells.
  - It is icon-only on a phone, above the safe area.
  - It stays reachable when the header scrolls away, because it is fixed.
  - It is the only launcher, so the header gets no duplicate.
- **The keyboard:** **Alt+Shift+A** opens and minimises it from anywhere in
  those shells.
- **The panel:**
  - **Desktop:** a side panel 30rem wide. The page stays where it is and
    isn't navigated away from.
  - **Phone:** full screen (`100dvh`), padded for safe areas, with the
    composer pinned to the bottom so the keyboard does not cover it.
- **Accessibility:**
  - The panel is a non-modal `dialog` with a labelled heading, and the
    conversation is a `role="log"` live region.
  - Opening focuses the composer. Minimising (the button or Esc) returns
    focus to the launcher.
  - Slide-in motion runs only for `motion-safe`.
- **Who sees it:** the launcher appears only when `assistant-workspace` is on
  for the school.
  - Tasks are offered only when that task's own switch is on and the person
    holds its permissions. Student tasks also need an owner or admin role,
    exactly as their services require.
  - A teacher sees guide search only.

## How requests are understood (no model)

**No request text goes to an AI model.** Operational chat isn't covered by any
approved prompt:

- the `help-assistant` exception in `CLAUDE.md` is scoped to help and settings
  questions;
- that exception is for a pilot that isn't active.

So requests are routed by `routeAssistantRequest` (`@school-kit/types`,
`assistant/index.ts`), a deterministic router that runs **in the browser**.

- **What it recognises:** the four tasks, help questions, greetings and
  ambiguity (it asks which task was meant).
- **What it refuses, with the right next step:** credentials, deletion,
  admission numbers, grades, behaviour, health, guardian links, status
  changes, moving classes, payments and discounts, general messaging, and
  student writing.
- **What it extracts:** structural hints only:
  - the term (current, next, first, second or third);
  - class labels;
  - "all classes", "overdue only" and "include payment plans";
  - a student count;
  - which correction fields were mentioned.

  It never extracts a name, a date or an email. Those are typed into the
  workflow's structured controls and go only to that workflow's API.
- **Hints only prefill controls:** the person sees and can change every
  selection, and nothing happens until they request the server's preview.
- **Help questions** go, in a POST body (never a URL), to
  `POST /assistant/workspace/help`. That endpoint runs the guide's lexical
  search and neither stores nor logs the question.

**Decision needed before any model reads requests.** A model-backed router
(free-text understanding, multi-step agent turns) would send staff-typed text,
which may include personal data, to the model provider. That needs either:

- its own allowlist row in `CLAUDE.md`, with sign-off; or
- a design that never sends the request text, like the #512 billing planner,
  which sends fixed task text and counts only.

`capabilities.modelRouting` is hard-wired to
`{ available: false, reason: "NOT_APPROVED" }`, and no model path exists in
this code. Only `AiGenerationService` may call the model.

## Endpoints

Both endpoints need a signed-in staff member (`AuthGuard`). Neither writes or
calls a model.

- `GET /api/v1/assistant/workspace/capabilities` returns
  `AssistantCapabilitiesDto`:
  ```json
  { "enabled": true,
    "workflows": {
      "invoices":    { "available": true,  "reason": null, "canApprove": false },
      "reminders":   { "available": true,  "reason": null, "canApprove": true },
      "intake":      { "available": false, "reason": "NO_PERMISSION", "canApprove": false },
      "corrections": { "available": false, "reason": "FEATURE_OFF",   "canApprove": false } },
    "help": { "available": true },
    "modelRouting": { "available": false, "reason": "NOT_APPROVED" },
    "inactivityMinutes": 15 }
  ```
  - `available` uses the same rules each workflow's service enforces again on
    every request: the workspace switch and the workflow's switch (with the
    `FEATURES_DISABLED` platform kill), active status, permissions, and the
    owner/admin role for student tasks.
  - `canApprove` adds the approval permission (`invoice.issue` for invoices).
- `POST /api/v1/assistant/workspace/help` takes `{ "question": "How do I add parents?" }`
  (2–300 characters) and returns `{ "hits": [{ "anchor", "title", "path", "excerpt" }] }`.
  It needs the workspace switch on.

The four workflows keep their own endpoints, contracts, proposal hashes,
idempotency, transactions and journals unchanged. The assistant is another
caller of them.

## Session and data handling

- **Memory only.** `AssistantStore` (`apps/web/src/lib/assistant/store.ts`)
  lives in `AssistantProvider`, inside the root `Providers`.
  - So the conversation survives ordinary navigation, including between the
    admin and teacher route groups, and a reload ends it.
  - Nothing goes to `localStorage`, `sessionStorage`, IndexedDB, cookies, the
    Cache API, the URL, analytics or error reports.
  - The panel and every free-text field are marked `ph-no-capture` and
    `data-sentry-mask`.
  - A unit test scans the assistant's code for storage, history, PostHog and
    Sentry calls.
- **Cleared:**
  - on sign-out, a forced session end, or any change of account or school
    (the store is keyed to `schoolId:userId`);
  - after 15 minutes without activity, checked every 30 seconds and on focus;
  - by **Clear conversation**.
- **Re-checked:**
  - capabilities, which re-read the person server-side, on focus and every
    minute while the panel is open;
  - each workflow request on the server: tenant from authentication, active
    status, permissions and scope.
- **Open operations are never lost by a clear.** A task whose confirmation is
  in flight or uncertain, or whose campaign is running, is reduced to a
  **reference**: its workflow and opaque server ids, with no names or values.
  - Its card has **Check the original outcome**, which only reads the original
    run, proposal or campaign.
  - Clearing or minimising never cancels server work, and the panel says so.
- **Never resends a mutation.**
  - Each card's session reads the **original** run, proposal or campaign after
    a lost response.
  - Changing page, minimising or reloading never repeats a prepare or a
    confirmation: sessions live in the store, not in the page's components.
  - UNKNOWN sends are never retried.
- **Explicit approval only.** Every write is behind a checkbox ("I checked
  this preview…") and a separate button on the server's authoritative preview.
  Nothing the person types, and nothing the router decides, can approve.
- **Stored on the server:** nothing new. Proposals, runs, campaigns and
  journals are kept under their own contracts. The help question is not
  stored or logged.

## Unchanged restrictions

- No AI in messaging. Fee reminders use the existing deterministic templates.
- No behaviour or health information is read.
- No writing of student work.
- No secrets, BVN, OTPs or result PINs: the router refuses them, and the panel
  asks people not to type them.
- No page content is read: suggestions use only the first path segment
  (`/finance`, `/students`) to order tasks.
- Pasted or typed text never gains a write path. It can only prefill controls,
  and every write needs a structured preview and a human's approval.
- `#521` (the corrections page) is open and untouched. The assistant uses the
  #520 API directly with its own compact editor; it does not replace that page.

## Activation gates

To let a real school use the assistant, an operator turns on, for that school:

1. `assistant-workspace`, for the panel;
2. each task's own switch: `assistant-billing`, `reminder-campaigns`,
   `student-intake`, `student-corrections`.

These are product switches, not legal approvals. No model is involved, so no
AI privacy or consent decision is needed for the assistant as built. The open
items:

- **Model routing** (above): not built, not approved.
- **Retention** of proposal and campaign metadata: undecided (the workflows'
  own docs).
- **Separation of duties** (a second approver): undecided. Today the requester
  confirms.
- **Provider idempotency** for reminders: not verified, so it is not relied on.

## Tests

- **Routing evals:** `packages/ai/evals/cases/assistant-router.ts`, run in
  `pnpm ai:eval` as an offline hard gate. They cover routing, clarification,
  refusals, factual claims about capability, and prompt-injection text.
- **API:** `apps/api/src/modules/assistant-workspace/assistant-workspace.service.spec.ts`
  (real PostgreSQL). It covers per-role availability and approval, the
  workspace and workflow switches, the platform kill, deactivation, help
  search, and no AI imports.
- **Web units** (`apps/web/src/lib/assistant/*.spec.ts`):
  - store routing and refusals;
  - wipe on account change and sign-out;
  - the 15-minute clear keeping only references;
  - no close while an outcome is open;
  - no storage, URL or analytics calls;
  - invoice and correction sessions recovering lost responses from the
    original run or proposal, and stale previews needing a fresh preview;
  - term hints and paste parsing.
- **Browser:** `e2e/tests/assistant-workspace.spec.ts`, against the real API.
  It covers:
  - opening from the dashboard, students and finance pages, and navigating
    with the panel open;
  - Esc and focus return, and nothing in storage or the URL;
  - desktop and phone layouts;
  - the workspace switch off, and a teacher with guide search only;
  - the invoice journey, including a lost approval recovered with no
    duplicates;
  - the reminder journey, with one confirmation, halt and resume, and UNKNOWN
    and quiet hours as the server reports them;
  - the intake journey, including a lost confirmation recovered;
  - the corrections journey, including a stale preview and a fresh review;
  - sign-out clearing the conversation.

  Screenshots from the run are in `docs/reviews/assistant-workspace/`.
