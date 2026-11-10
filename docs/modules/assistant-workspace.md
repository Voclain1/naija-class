# SchoolKit Assistant (unified workspace)

Status: the workspace was built on 2026-11-09 (#522). Model orchestration
was built on 2026-11-09 (branch `agentic/assistant-orchestration`) behind its
own switch and a code-level approval gate; see
[Model orchestration](#model-orchestration). The `assistant-workspace` switch
is off for every school, and so are each workflow's own switch and
`assistant-model-routing`. Nothing is enabled, deployed or approved for a
pilot.

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

## How requests are understood

Two paths. When model routing is available for the school (it is not, anywhere
today) a request goes to the model: [Model orchestration](#model-orchestration).
Otherwise, and whenever the model path is unavailable or blocks a message, the
request is understood on the device, as below.

### On the device (no model)

**On this path no request text goes to an AI model.** Operational chat isn't
covered by any approved prompt:

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

The model-backed path is built, but it is gated off and its approval is
pending: [Model orchestration](#model-orchestration).

## Model orchestration

Built 2026-11-09 behind a disabled switch and a code-level approval gate.
**Not approved for any school.** Approval needs its own allowlist row; the
proposed wording is [below](#proposed-allowlist-row-for-owner-review-not-approved).

### The loop

Request → the per-school detectors → one bounded, budgeted model turn with
tools → a clarifying question or the server's own preview in a card → the
person's explicit approval on that card → the existing executor → the
authoritative result read back from the server.

- **Endpoint:** `POST /api/v1/assistant/workspace/turn` (`AuthGuard`, 20 a
  minute). The body is the conversation the browser holds in memory, plus a
  structured summary of its open tasks (`assistantTurnSchema`,
  `packages/types/src/assistant/orchestration.ts`). Tenant and user come from
  the session, never the body. The reply is checked text plus **actions**,
  built by code from validated tool calls (`AssistantTurnDto`).
- **Prompt:** `assistant-orchestrator@2` (Haiku 4.5, 700 output tokens),
  `packages/ai/src/prompts/assistant-orchestrator.ts`. It runs through
  `AiGenerationService.runConversationTurn`. Every model step is reserved
  against the school's monthly budget before the call, settled after it, and
  written to `ai_generations`. A step refused for budget or the per-user cap
  makes no call.
- **Bounds:**
  - 6 model steps and 24,000 input tokens per turn;
  - no tool runs after 45 seconds;
  - tool output capped at 8,000 characters;
  - the browser gives up after 60 seconds and says nothing was approved or
    changed.
- **Service:** `apps/api/src/modules/assistant-workspace/orchestrator/`, its
  own Nest module, the only part of the assistant that imports the AI stack.

### The tools

All go through `ToolRegistry`. On every call it re-reads the person's active
status and current grants, validates arguments strictly and cuts the output
to an allowlist of fields. Each tool also re-checks its workflow's
availability: the switches, the `FEATURES_DISABLED` kill and the owner/admin
role.

| Tool | Effect | What it does |
|---|---|---|
| `school_structure` | read | Term and class labels. |
| `prepare_invoices` | **prepare** | Resolves term and class labels in code. Ambiguous or unknown labels return a question, never a guess. Calls `BillingRunsService.prepare` for a **PENDING** preview. Returns counts. |
| `plan_reminders` | read | Sets the reminder card's term, one class (by ID) or all, and its options. The card selects the matching families and asks the server for its preview. The class scope goes with the request (`options.classArmIds`), and the server enforces it at preview and confirm. |
| `plan_student_intake` | read | Sets the intake card's class and term, or "place later". Students are typed or pasted into the card. |
| `plan_corrections` | read | Chooses which of the six fields the correction card changes. |
| `task_status` | read | Reads the original run, proposal or campaign of a task, and shows it in a card. |
| `recent_campaigns` | read | The person's own last three campaigns: status and counts. |
| `search_guide` | read | Getting started guide sections. |
| `find_student` | read | Takes a name MARKER (`P1`) and an optional class label. The server resolves the name it holds for that marker. Returns handles (`s1`…) and class labels; the names go to the browser. |
| `select_student` | read | Makes a found student the selected one. |
| `student_record` | read | Shows the person a section of a found student's record (summary, attendance, released results) in a card. The model does not see the record. |

**There is no approval tool.**
- The registry refuses any tool named like an approval or an execution
  (`APPROVAL_LIKE_NAME`: approve, confirm, issue, send, run, resume, halt,
  delete, apply, save, pay, enrol…).
- "Prepare" is the only effect beyond "read". It creates a server-owned
  preview, never a school record.
- Approval stays each workflow's own permission-checked endpoint, called by
  the person from the card with the preview's hash.

### Follow-ups and revisions

- **Task handles.** The browser describes its open tasks as `t1…t9`, each
  with a workflow, status (editing, review, confirming, uncertain, done), its
  scope as ids, and counts. The server checks the ids against the school and
  drops any that aren't its own.
- **What the model sees of a task.** Handle, status, term and class labels,
  and counts.
- **Revising.** The model revises a task by calling the same tool with the
  task's handle and only what changes ("leave JSS 2C out" →
  `exclude_classes`). The card applies the new plan once (`revision`).
  - Invoices: the card shows the new PENDING run with the approval box
    unticked.
  - Reminders: a card showing an unapproved preview starts again with a fresh
    session, so the old preview can't be confirmed.
- **Locked tasks.** A task that is confirming, uncertain or done is locked. The
  tool returns `locked`, and the browser also refuses to re-plan it.
- **Duplicates.** Calling a tool twice with the same scope in one turn
  prepares once.

### Revisions invalidate previews (all four workflows)

One rule, held in `AssistantStore`, for invoices, reminders, intake and
corrections:

- **Each plan has a revision.** A card records the revision it has applied
  (`markApplied`). While a newer plan is not yet applied (`planPending`), the
  preview on screen is out of date and **cannot be approved**: the approval
  control is disabled, and `store.approve` refuses even a click that gets
  through.
- **The card then starts again.** A card showing an unapproved preview drops
  its session (`resetSession`), applies the new scope or fields, and needs a
  fresh server preview. The approval box starts unticked.
- **What the person typed is kept.** Intake rows and picked correction
  students live in the task's memory (`store.memo`), not the session's, so
  they survive the reset. They are dropped by clear, wipe and close.
- **In-flight work is never touched.** A task that is confirming, checking,
  uncertain or done is never reset or re-planned.
- **Races.** Approval takes a lock at the click, synchronously.
  - A plan that arrives after the click is not applied, and the person is told
    ("this was already being approved or is finished, so that change was not
    applied").
  - A click that lands after a plan arrived, but before the card applied it,
    does nothing.

### Named student lookup

The owner's requirement (2026-11-09): staff can ask for "the records of Samuel
in JSS 2" and get them. Built so that **names still never reach the model**.

- **On the model path:**
  1. The server replaces every roster name in every message with an opaque
     marker (`⟨P1⟩`), by the detector's own matching rules
     (`redactRosterNames`). A name no longer blocks the turn. Every other
     detector still does: contacts, ID-like numbers, dates, pasted rows and
     admission numbers.
  2. The model calls `find_student` with the marker and the class label.
  3. The server looks the name up (`StudentLookupService`) and returns handles
     and class labels to the model, and the matches (names, admission numbers)
     to the browser in an action.
- **On the device** (no model): the router recognises a lookup request and
  opens a search card, prefilled from the request and editable. It calls
  `POST /assistant/workspace/students/find`.
- **Who can find whom.** Decided by existing services, re-read on every call:

  | Caller | Finds |
  |---|---|
  | Owner or admin with `student.read` | Students through `StudentsService.list`. |
  | Teacher with `student.read` | Only students in their own classes, through `TeacherScopeService` (the trimmed roster). |
  | Anyone else | Refused (`STUDENT_LOOKUP_NOT_PERMITTED`). |

  Another school's students never match.
- **Matching never guesses:**
  - One exact match: shown and selected.
  - Several: a choice. The person picks in the card, or says which class.
  - No exact match: close spellings, marked "similar" and never selected for
    the person. Each part typed must be one of the student's names or a close
    spelling of one (one or two letters off, two letters swapped, or its
    beginning), so "Samual Okoro" suggests Samuel Okoro.
  - Nothing: said plainly.
- **Possessives are grammar, not names.** "Samuel Okoro's attendance" is
  looked up as "Samuel Okoro", and gets the same marker as "Samuel Okoro"
  elsewhere in the conversation (`stripPossessive`).
- **Answers come from the whole scope, never page one.** The Students list
  pages 200 at a time; the lookup reads every page before it answers.
  - With a class: every student of each requested class, whatever their name.
  - Without one: the list's search, once per name part typed (by its first
    three letters), so a full name with one misspelt part is found through the
    other.
  - A search too broad to read completely (over 100 pages) is refused with
    `STUDENT_LOOKUP_TOO_BROAD`; the person is asked for the class or more of
    the name. It is never answered from part of the roster.
  - Known limit: a single name misspelt within its first three letters, with
    no class given, is not found. Giving the class finds it.
- **Follow-ups.** The browser sends found students as handles with ids
  (`students: [{ handle, studentId, selected }]`). The server re-checks each id
  against tenant and scope every turn and drops any it can't confirm (a forged
  or another school's id resolves to nothing). The model sees `<students>`:
  handles, selected or found, and class labels.
- **Record sections.** The card reads each from its own existing,
  permission-checked endpoint:

  | Section | Source | Needs |
  |---|---|---|
  | Summary | The lookup match, with a link to the student's page | `student.read` |
  | Attendance this term | `GET /attendance/summary` | `attendance.read`, and the arm in scope |
  | Released results | `GET /report-cards?status=RELEASED` | `report-card.read`, and the arm in scope. Unreleased cards are never requested. |

  Behaviour, health, contacts and fees are not sections. No new record
  endpoint was added.
- **Reads need no approval.** Changing a record still goes through the
  corrections card's preview and confirmation.
- **Nothing rendered goes back.** Matches and record cards are UI messages;
  model history is only the person's own accepted text (re-redacted each turn)
  and the model's replies.
- **Approval status.** Named lookup is authorised as product behaviour, and
  this design sends the model no names, so it needs no approval beyond the
  orchestrator's own pending row. The residual is unchanged: a name the
  detector's matching misses (a nickname, a misspelling beyond one edit) is
  neither redacted nor blocked.

### What the model receives (field by field)

| Path | Sent to the model |
|---|---|
| System prompt | Fixed text (`ASSISTANT_ORCHESTRATOR_SYSTEM`). |
| The person's messages | Staff-typed text, newest last, at most 12 messages of 1,000 characters (500 from the composer). **Every message is processed again each turn.** Names on the school's roster are replaced by markers (`⟨P1⟩`). The redacted text is then checked by the per-school detectors (`checkConversation`: admission numbers, emails, phones, long ID-like numbers, full dates, pasted rows, over-long text). Any hit stops the turn before the model: no call, no ledger row. The browser hears the categories, never the text, and gets the on-device router instead. Only messages the server accepted are ever resent: a blocked, unavailable, failed or timed-out request stays on screen but never re-enters model history. |
| Earlier assistant replies | The model's own earlier replies (marked by the browser), after the server's check. |
| Task summary | `<tasks>` block: handles, workflow, status, term and class labels (`safeLabel`: letters, digits and ordinary punctuation, 40 characters), field names, counts. `<students>` block: handles, selected or found, class labels. |
| Tool results | Term and class labels; counts (classes, new invoices, already invoiced, problems, sends by outcome, saved, changed); statuses; guide section titles and excerpts. |

**Never sent:** student, guardian or staff names; admission numbers; contacts;
dates of birth; money; record ids; page content, URLs or query strings; form
values (intake rows, correction values, debtor lists); campaign recipients.

- **Proven by:** the FD-3b conformance gate. It runs every orchestration tool
  over planted names, contacts, admission numbers and kobo amounts, and fails
  if any reach the model. The scripted-model spec also inspects everything the
  model was sent.
- **The model's reply:** the server replaces any money figure ("see the
  card"), and the card shows the server's figures. Rows pasted into the chat
  never leave the device: they go into the intake form.
- **What the detectors can't catch:** they reduce what reaches the model; they
  don't prove a message holds no personal data. Nicknames, descriptions, other
  schools' pupils and addresses can pass them. That residual is why this path
  needs its own allowlist row.

### Holding nothing

- The conversation stays in browser memory under the approved clearing rules:
  sign-out, account or school change, 15 minutes idle, reload, or **Clear
  conversation**. A late answer after a clear or an account change is dropped.
- The server stores no request, reply or tool content, and puts none in a
  queue, cache, log, error report or analytics event. Logs carry the school,
  the outcome and tool names only.
- Each turn writes one `ai_interaction_logs` row with no content
  (`{ feature: "assistant-orchestration" }`) and one `ai_generations` row per
  model call.
- Proposals, runs, campaigns and journals keep their own contracts.

### Gates (all required)

1. `ASSISTANT_ORCHESTRATOR_APPROVAL` (`packages/ai`) is `"pending"`. In
   production, `ModelRoutingGate` reports `NOT_APPROVED` and the turn endpoint
   refuses, whatever a school's switch says.
2. The school's `assistant-model-routing` switch is on. It is off by default,
   and the `FEATURES_DISABLED` platform kill applies.
3. AI is configured on the deployment and not off platform-wide.
4. AI is on for the school.
5. The workspace switch, each workflow's own switch, and the person's
   permissions and role, re-checked on every tool call.

### Proposed allowlist row (for owner review; NOT APPROVED)

Proposed as a fourth row of CLAUDE.md's PII-bearing prompt allowlist. **Not
added to CLAUDE.md; not approved.**

> | `assistant-orchestrator` | SchoolKit Assistant model orchestration (`docs/modules/assistant-workspace.md`, "Model orchestration") | **Not the payload — incidental, and accepted as a residual.** The assistant prepares invoices, reminder campaigns, intake and corrections through their existing reviewed workflows and needs no personal data: students are found and edited in structured forms the model never sees, and tools return labels and counts only. A staff member may still type some. Mitigated, not exempted: roster names are replaced by opaque markers (the server resolves them; named records go to the browser only), and per-school detectors block admission numbers, emails, phones, long ID-like numbers, full dates and pasted rows, in every message, every turn; pasted rows are kept on the device; a standing notice asks for none; nothing the model does can approve a write (no approval tool, approval is the person's control on the server's preview). What the detectors miss reaches the model: this row accepts that residual for this prompt only. Optional at every level: the code-level approval flag, the platform's switch, the school's own `assistant-model-routing` switch (off by default), and the staff member's choice to type. Rule 1 applies as for `help-assistant`: the conversation is held only in browser memory, resent with each request, and stored nowhere on the server. |

Before activation, the owner also needs to decide:
- **Provider terms.** Same as the help assistant's D6: the API organisation's
  retention and training settings.
- **Privacy policy and consent.** Whether the privacy policy names this
  processing, and whether consent wording changes (`SCHOOL_CONSENT_VERSION`).
  **No consent version was changed here.**
- **Pilot.** Which schools pilot it, after the live evals pass on the chosen
  model.
- **Code.** Flip `ASSISTANT_ORCHESTRATOR_APPROVAL` to `"approved"` in the same
  change as the CLAUDE.md row. The evals pin both.

### Tests for this path

- **PR #523 review fixes:**
  - `student-lookup.service.spec.ts` (real PostgreSQL): several same-name
    students within and across arms, similar names, no match, another school,
    teacher scope, missing permission, revocation, deactivation, forged ids.
  - `student-lookup.pagination.spec.ts` (real PostgreSQL, 450+ students):
    matches beyond page one, a namesake on a later page, a class larger than a
    page, a too-broad search refused, full names with one part misspelt, and
    possessives through redaction to lookup.
  - The orchestration spec: names redacted, handles only, follow-up selection,
    a section refused without its permission, forged handles, behaviour not a
    section.
  - `reminder-campaigns.service.spec.ts`: two levels with an arm called "A",
    scoped by ID through preview, confirm and send.
  - `orchestration.spec.ts` (web): blocked and failed text never resent,
    revision and approval races, lookup state.
  - `e2e/tests/assistant-revisions-lookup.spec.ts`: an intake revision with the
    box ticked, the confirm-then-revision race, a corrections revision, and
    lookup with the model and on the device.
- **API (real PostgreSQL, scripted model port):**
  `orchestrator/assistant-orchestrator.service.spec.ts`. It covers:
  - prepare, revise across turns, and approval only of the new preview;
  - model-bound data inspection;
  - "yes, go ahead" and a requested approval tool;
  - detectors blocking before any call;
  - every gate, including production `NOT_APPROVED`;
  - locked tasks and another school's ids;
  - a permission revoked mid-conversation, and deactivation;
  - ambiguous and unknown classes and terms;
  - budget exhaustion, model failure, duplicate calls and money in a reply;
  - the reminder, intake and correction plans;
  - injected labels.
- **Conformance gate:** `__tests__/assistant-tool-conformance.spec.ts` runs
  every orchestration tool over planted personal data and money.
- **Registry:** `tool-registry.spec.ts` covers approval-like names refused and
  `prepare` accepted.
- **Web units:** `apps/web/src/lib/assistant/orchestration.spec.ts`. It covers:
  - what a turn sends;
  - revisions on the same task;
  - locked tasks;
  - blocked, unavailable, failed and timed-out turns;
  - late answers dropped;
  - pasted rows kept on the device;
  - shown operations;
  - unavailable workflows.
- **Evals:**
  - `assistant-orchestrator` (offline contract, always runs).
  - `assistant-orchestrator-live` (14 scenarios on the real model with
    simulated tools: paraphrase, refinement, task switching, intake,
    corrections, campaign status, ambiguity, refusal, approval wording,
    injection in the request and in history). It is **skipped without a key**,
    and a skip is not a pass.
  - `pii-safety` pins the prompt as proposed, not allowlisted, and its
    approval flag as pending.
- **Browser:** `e2e/tests/assistant-orchestration.spec.ts`. The model is faked
  at the HTTP boundary with actions that point at real server objects. It
  covers:
  - an invoice preview from a turn, revised by a follow-up, "yes" approving
    nothing, and the new preview approved by the person;
  - a reminders plan that auto-requests the server preview, with confirming
    left to the person;
  - pasted rows that never reach the model;
  - correction plans prefilling the card while the panel sends counts, not
    names;
  - blocked text, an outage and a lost answer, with nothing replayed.

  It also checks that no request carries a student's name or admission
  number.

## Endpoints

Both endpoints below need a signed-in staff member (`AuthGuard`). Neither
writes or calls a model. The model turn, `POST /assistant/workspace/turn`, is
described under [Model orchestration](#model-orchestration).

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
    "modelRouting": { "available": false, "reason": "FEATURE_OFF" },
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

These are product switches, not legal approvals. With only these on, no
model is involved, so no AI privacy or consent decision is needed.

AI understanding is a third, separate step, and **must not be taken yet**:

3. `assistant-model-routing`. It needs, first:
   - the owner's approval of its own allowlist row;
   - `ASSISTANT_ORCHESTRATOR_APPROVAL` set to `"approved"` in the same change;
   - the provider, privacy and consent decisions;
   - passing live evals.

   Until then production refuses it whatever the switch says.

The open items:

- **Model routing**: built, gated off, **not approved**. The proposed
  allowlist row and the remaining decisions are under
  [Model orchestration](#model-orchestration).
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
  - the reminder journey, with a real preview and one real confirmation that
    saves one campaign. Halt, resume, UNKNOWN and quiet hours are then shown
    from the real campaign with its status set by the test, because a
    one-family campaign can finish before a click lands and a lost provider
    answer cannot be produced on demand. The server's own halt, resume,
    UNKNOWN and quiet hours are covered by the reminder-campaign API tests;
  - the intake journey, including a lost confirmation recovered;
  - the corrections journey, including a stale preview and a fresh review;
  - sign-out clearing the conversation.

  Screenshots from the run are in `docs/reviews/assistant-workspace/`.
