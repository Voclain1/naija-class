# Agentic opportunity audit

**Status:** inventory only. Nothing is implemented. No phases are proposed here.
**Date:** 2026-11-06. **Branch audited:** `ccr-35452a47-n0c74g` at `3884623`.
**Purpose:** list every workflow in SchoolKit that agentic capabilities could help with, so we can agree on phases together afterwards.

---

## 0. How to read this document

### Evidence labels

| Label | Meaning |
|---|---|
| **[V]** | Verified in code during this audit. The file is cited. |
| **[D]** | Stated in a doc (`docs/…`, `CLAUDE.md`), but the code was not re-read to confirm it. |
| **[A]** | Assumption or inference. Confirm it before planning. |

Unless a path says otherwise, it is relative to the repo root. `M/` means `apps/api/src/modules/`.

### Method

- **Roles:** read from `packages/db/src/seeds/system-roles.ts` and `packages/types/src/permissions.ts`.
- **API:** every `M/*/*.service.ts` public method and every controller's `@Permissions` were listed. There are 70 API modules.
- **Front ends:** every page and screen in `apps/web`, `apps/portal`, `apps/mobile/app` and `apps/cbt` was listed.
- **Background work:** every `@Cron`, BullMQ queue and processor.
- **AI layer:** `packages/ai`, `apps/api/src/common/ai` and `apps/api/src/common/embeddings`.
- **Data model:** the 157 Prisma models in `packages/db/prisma/schema.prisma`.
- **Known gaps and decisions:** `docs/deferred.md`.

A model or a menu item was not treated as proof that a feature works. Where only a schema, placeholder screen or permission exists, this audit says so.

### The three access modes

Each workflow is tagged with the modes that fit it:

- **Chat**: a conversational request, such as "who hasn't paid in JSS2?"
- **In-screen**: a contextual action on an existing screen, such as a "Check before sign-off" button in the gradebook.
- **Background**: work triggered by a schedule or an event, such as "registers not taken by 10:00".

### What "needs an agent" means here (field 12)

- **Agent**: the work needs judgement over several steps, natural-language input, or coordination that cannot be fixed in advance. An LLM with tools adds real value.
- **AI-assist**: one bounded model call (draft, extract, classify, narrate) inside an existing flow. No multi-step planning.
- **Automation**: a rule, cron or event handler does the job better than a model. It is deterministic, cheap and auditable.
- **UX**: the friction is in the screen itself. A better form, bulk action or shortcut fixes it.
- **Hybrid**: deterministic detection, followed by agent explanation or preparation.

---

## A. Evidence-based map of roles and modules

### A.1 Principals (who can sign in)

| Principal | Guard | Surfaces | Evidence |
|---|---|---|---|
| Staff (all staff roles below) | `AuthGuard` + `PermissionsGuard` | Staff web (`apps/web`, base path `/staff`), staff mobile (`apps/mobile/app/staff/*`) | [V] `apps/api/src/common/auth/auth.guard.ts`, `permissions.guard.ts` |
| Guardian (parent) | `GuardianAuthGuard` | Parent portal (`apps/portal`), parent app (`apps/mobile/app/students/*`, `messages/*`, etc.) | [V] `common/auth/guardian-auth.guard.ts` |
| Student | `StudentAuthGuard` | Student app (`apps/mobile/app/me/*`); CBT candidate (`apps/cbt`) | [V] `common/auth/student-auth.guard.ts` |
| Platform admin (SchoolKit staff) | `PlatformAdminGuard` | `apps/web/src/app/super-admin/*` | [V] `common/auth/platform-admin.guard.ts` |
| Public (no sign-in) | none, rate-limited | Admissions apply/track, result checker, school website, invitation and reset pages, ID verification | [V] `apps/portal/src/app/apply`, `result-checker`, `school/[code]`, `id/[token]` |

### A.2 Staff roles (system roles)

Source: [V] `packages/db/src/seeds/system-roles.ts`.

| Role key | Held by default? | What it can do (summary) | Notable exclusions |
|---|---|---|---|
| `owner` | The school's signer-up | `*` (everything) | — |
| `admin` | Invited | Everything except owner-only permissions: `academic-year.delete`, `term.delete`, `enrollment.delete`, `report-card.reopen`, `auth.2fa.manage` | Owner-only deletes and reopen |
| `teacher` | Invited | Read-only structure; scoped gradebook, attendance (daily and subject), sign-off, form review, comments, lesson plans, curriculum, homework, behaviour (create/read), question bank (all four), exam papers, CBT, assignments, library resources, health note, own timetable, messages read/reply, hostel `house` | No `messages.start`, no finance, no `report-card.release` or `principal-approve`, no `ai-usage.read`, no `parent-summary.manage`, no `insight.read` |
| `bursar` | Invited | Fee catalogue, discounts, invoices, payments (record), payment plans, debtors and reminders, expenses, finance dashboard, payroll run (`payroll.process`), student charges, store sell/approve, transport and hostel read, messages, read-only year/term/arm, homework read | `payment.refund`, `payroll.transfer`, staff BVN, academic, roster, settings |
| `health_officer` | Invited | `health.read`, `health.manage`, `sickbay.manage` | Nothing else |
| `librarian` | Invited | Library catalogue, lending, digital resources | `library.settings` |
| `storekeeper` | Invited | Store items, receiving, issuing, stock takes, assets, table export | `store.sell`, `store.approve` |
| `house_master` | Optional | `hostel.house` (service scopes it to assigned hostels) | — |
| `admission_officer` | Optional, held alongside a person's own role | `admission.read`, `admission.manage` | `admission.admit` (owner/admin) and settings |
| `principal` | Appointed in Settings → Messaging, held alongside the person's own role | `messages.read`, `messages.reply` **only** | Report-card approval is **not** in this role [V]. `report-card.principal-approve` is held only by owner/admin. |
| `head_teacher` | Appointed, held alongside own role | Messages only | Same as above |
| `inbox_officer` | Appointed, held alongside own role | Messages + `messages.start` | — |

**Responsibilities that come from scope, not from a role** [V]:

- **Form (class) teacher**: `ClassArm.classTeacherId` (`schema.prisma` ~L720). This unlocks form review and form comments for that arm. The scope comes from `getTeacherScope` in `M/teacher-scope/teacher-scope.helper.ts:48`.
- **Subject teacher**: `TeacherAssignment` (arm × subject × term). The question bank, exam papers, CBT and assignments are held to the teacher's (class level, subject) pairs.
- **House master**: `HostelHouseMaster` assignment. A teacher can be one without changing role.
- **"Principal approval" of report cards**: the `report-card.principal-approve` permission. Only owner and admin hold it. In practice the principal signs in as an admin. **[A]** that this is how schools actually operate; see question F-3.
- **Accountant**: no role of that name exists. The `bursar` role covers it [V].
- **Custom roles**: a `role.update` permission exists, and `Role.schoolId` is nullable. **[A]** whether schools can create custom roles in the UI. This was not verified.

### A.3 Module map

Status meanings:

- **Built**: API, UI and tests exist.
- **Partial**: some surfaces are missing.
- **Stub**: a placeholder only.
- **Missing**: nothing exists.

"Bg" is background work. API counts are endpoints per module [V].

| Domain | Module(s) (API endpoints) | Staff web | Staff mobile | Parent | Student | Bg | Status |
|---|---|---|---|---|---|---|---|
| Setup & onboarding | `schools` (18), `academic-calendar` (2), `setup-state` (1), `activation` (5), `onboarding-call` (5) | `/onboarding/1-5`, `/welcome`, setup checklist, first-login tour, `/help/guide` | — | — | — | Activation reminder emails, daily 07:41 UTC (`M/activation/activation.service.ts:175`) | Built |
| Academic structure | `academic-years`, `terms`, `class-levels`, `class-arms`, `subjects`, `class-subjects` (bulk), `subject-hides`, `teacher-assignments`, `teacher-profiles`, `teacher-scope` | `/settings/academic/*` | — | — | — | — | Built |
| Students & families | `students` (bulk), `enrollments` (bulk, move), `guardians`, `imports` (CSV jobs), `student-scan` (AI register scan), `photos`, `admission-numbers` | `/students/*`, `/enrollments/*`, `/guardians/*`, `/students/scan` | `staff/students/*` (new, link parent) | `/students/[id]` | — | Imports queue (`M/imports/workers/imports.processor.ts`) | Built |
| Staff | `users` (invite, BVN), `teacher-profiles`, `staff-bank-accounts`, `id-cards` | `/staff/*`, `/settings/users`, `/id-cards/*` | `staff/profile` | — | — | — | Built |
| Attendance | `attendance` (3), `subject-attendance` (3) | `/teacher/attendance/*`, `/settings/attendance` | `staff/attendance/[armId]` | Absence push to guardians | `me/attendance` | Register-not-taken reminder, weekdays 10:00 Lagos (`teacher-reminders.service.ts:43`); `attendanceAbsent` event (`event-notifier.service.ts:295`) | Built |
| Assessment & gradebook | `grading`, `assessment` (bulk upsert, preview, sign-off), `subject-hides` | `/gradebook/*`, `/teacher/gradebook/*`, `/settings/grading/*` | `staff/gradebook/*` (incl. comments) | — | — | Marks-not-entered reminder, 7 days before term end (`teacher-reminders.service.ts:52`) | Built |
| Report cards | `report-cards` (build, board, render, release, reopen), `report-comments` (AI), `result-checker` (PINs), `promotions` | `/report-cards/*`, `/report-cards/pins`, `/enrollments/promote` | `staff/approvals/*`, `staff/report-cards/*` | Released results (`/students/[id]/results`), result checker | `me/results` | Render queue (`render.processor.ts`); results-released event | Built |
| Finance | `fee-catalog`, `discounts`, `invoices` (generate per arm, preview, payment links), `payments` (manual, Paystack, webhooks, receipts), `refunds`, `payment-plan`, `finance` (debtors, reminders, dashboard, fee risk, charges), `expenses`, `payroll` (incl. Paystack transfer), `portal-finance`, `portal-payments` | `/finance/*` | `staff/collections/*`, `staff/receipts/*`, `staff/expenses` | Invoices, pay online, bank details | `me/fees` | Overdue invoice transition daily 00:05 (`finance.service.ts:789`); Paystack webhooks | Built |
| AI teaching tools | `lesson-plans`, `curriculum` (upload, review, RAG), `question-bank`, `exam-papers`, `cbt`, `cbt-delivery` | `/teacher/lesson-plans`, `/teacher/curriculum`, `/teacher/question-bank`, `/teacher/exam-papers`, `/teacher/cbt` | `staff/lesson-notes`, `staff/question-bank/*`, `staff/exam-papers`, `staff/online-exams/*` | — | CBT exam app | Curriculum ingest/embed queue | Built. CBT not live in production [D] (`docs/deferred.md` §3). |
| Homework & assignments | `homework` (5), `assignments` (24), `assignment-feedback` (AI) | `/homework`, `/teacher/homework` | `staff/homework/*` | Homework (app) | `me/homework`, `me/assignments/[id]` | Staged-file sweeper | Built. Homework has no submissions; assignments do [V]. |
| Behaviour & discipline | `behaviour` (18): records, incidents, categories, points, discipline propose/decide, notices | `/behaviour`, `/teacher/behaviour`, `/settings/behaviour` | `staff/behaviour`, `staff/discipline`, `staff/classes/incident` | Discipline notices (`listNoticesForGuardian`) | — | — | Built |
| Health | `health` (16): profiles, vaccinations, documents, sickbay visits, medications, teacher note | `/health/*`, `/sickbay` | `staff/health/*` | Health profile and sickbay visits, **read-only** [V] (`health/portal-health.controller.ts`: GET only) | — | — | Built (parents cannot update) |
| Boarding | `hostels` (34): hostels, rooms, beds, house masters, visits, exeats | `/hostels/*`, `/boarding`, `/teacher/boarding` | `staff/boarding/*` | Exeat request (`students/[id]/exeat`) | — | — | Built |
| Transport | `transport` (23): vehicles, drivers, routes, stops, places, daily list, fees | `/transport/*` | `staff/transport/*` | `transportForGuardian` | — | — | Built |
| Library | `library` (28) | `/library/*` | `staff/library/*` | `libraryForGuardian` | `me/library` | **No overdue sweep** [V] | Built |
| Store & assets | `store` (26) | `/store/*` | `staff/store` | Price list (`store-prices`) | — | — | Built. No parent ordering [D]. |
| Communications | `announcements` (incl. email via Resend), `messages` (threads, pass, flag, close), `notifications` (push rail, preferences, quiet hours), `calendar` (+ RSVP) | `/announcements`, `/messages/*`, `/events`, `/settings/notifications`, `/settings/messaging` | `staff/announcements`, `staff/messages/*`, `staff/calendar/*` | `/messages/*`, `/announcements`, `/calendar` | `me/announcements`, `me/calendar` | Push queue; RSVP reminders daily 08:00 Lagos; message close/purge daily 02:45; announcement email queue | Built. SMS sender name waits on CAC; WhatsApp to families missing [D] (`deferred.md` §3). |
| Admissions | `admissions` (21): public form, tracking, review, assessment, offer, accept, admit, documents, purge | `/admissions/*`, `/teacher/admissions/*`, `/settings/admissions` | — | Public `/apply/[slug]` and tracking | — | Stale close and purge, daily 02:35 (`admissions-purge.service.ts`) | Built |
| Timetable | `timetable` (13): bell schedule, lessons, clashes, fork/copy, publish | `/timetable`, `/settings/bell-schedule`, `/teacher/timetable` | `staff/timetable` | `/students/[id]/timetable` | `me/timetable` | — | Built. **No automatic solver** [V]. |
| Reports & analytics | `reports` (completeness, teacher activity, academic/attendance/enrolment analytics, exports), `dashboard`, `insights` (AI) | `/reports/*`, `/dashboard`, `/insights`, `/finance/dashboard` | `staff/reports/*` | — | — | Export sweeper | Built. Outcome analytics wait on a trigger [D]. |
| Website | `school-website` (26) | `/settings/website`, `/news` | `staff/website/*` | Public site `/school/[code]` | — | — | Built |
| Data protection | `data-protection`, `account-deletion` | `/settings/data-protection`, `/settings/account-deletion-requests` | — | Consent at portal | — | — | Built |
| Platform admin | `platform-admin` (22) | `/super-admin/dashboard/*` | — | — | — | — | Built. No impersonation; no platform-admin deactivation [D]. |
| AI tutor | none | — | — | — | `me/tutor.tsx` is a **"Not ready yet" placeholder** [V] | — | Stub |
| Mastery tracking | `MasteryRecord` model and a `mastery.read` permission only | — | — | — | — | — | Missing. The model is unused by any service [V]. |
| Multi-campus | `Branch` CRUD only | — | — | — | — | — | Missing. No operational table carries `branchId` [V]. |
| Audit log viewer | `audit_logs` written inline in 109 API files [V] | — | — | — | — | Monthly partition cron | Missing. `audit.read` exists, but **no endpoint uses it** [V]. |

### A.4 AI and automation already in the product (the agent's starting kit)

**AI calls.** All go through `AiGenerationService` [V]:

| Prompt (`packages/ai/src/prompts/`) | Feature | Model | Shape | Human gate |
|---|---|---|---|---|
| `lesson-plan.ts` | Lesson plan + quiz (`M/lesson-plans/lesson-plans.service.ts:86`) | Sonnet 5 | Structured JSON, RAG-grounded | Teacher edits |
| `report-card-comment.ts` | Subject comments, batch via AI queue (`report-comments.service.ts:116`) | Haiku 4.5 | Batch drafts | Teacher accepts (`accept`) |
| `report-card-form-comment.ts` | Form-teacher comments (`form-comments.service.ts:101`) | Haiku 4.5 | Batch drafts | Form teacher |
| `parent-weekly-summary.ts` | Weekly parent summary (`parent-summaries.service.ts:140`, cron) | Haiku 4.5 | Per student per week, skips quiet weeks | School opt-in (`parent-summary.manage`) |
| `insights.ts` | Admin "ask" (`insights.service.ts:88`) | — | **Router** (free text → one of four closed intents) + **narration** over SQL-computed figures. The model never sees PII or computes numbers. | Read-only |
| `exam-questions.ts` | Question drafts (`question-bank.service.ts:394`) | — | RAG-grounded drafts | `question.approve` |
| `assignment-feedback.ts` | Marking drafts (`assignment-feedback.service.ts:223` `draftAll`) | — | PII allowlist row 2 | Teacher's own "Save mark"; school switch off by default |
| `student-list-extraction.ts` | Register photo → rows (`student-scan.service.ts:203`) | — | Vision, PII allowlist row 1 | `commitScan` after human review |

**AI infrastructure** [V]:

- **`AiGenerationService`** (`apps/api/src/common/ai/ai-generation.service.ts`):
  - reserve → call → settle;
  - per-school monthly token budget (default 2,000,000);
  - per-user daily call cap of 200 (`ai.constants.ts:14,25`);
  - a row in the `ai_generations` ledger for every call;
  - platform and per-school kill switches (`School.aiEnabled`, `smartImportEnabled`).
- **ESLint** bans importing `@anthropic-ai/sdk` anywhere except `packages/ai/src/client.ts`.
- **AI queue** with `AiJobRegistry`: named handlers, tenancy-checked job data (`common/ai/ai-jobs.registry.ts`).
- **`EmbeddingService`** and curriculum RAG: pgvector, `CurriculumRetrievalService.retrieve` (`M/curriculum/curriculum-retrieval.service.ts:106`).
- **`AIInteractionLog`**: a conversation/session content record with a PII-free payload. Today only the two report-comment services write to it [V].
- **`AnthropicPort.create`** takes **one `userContent` string** plus an optional JSON schema and images. **It has no tool use, no multi-turn messages and no streaming** [V] (`packages/ai/src/client.ts:44-86`).
- **Models registered:** only `claude-haiku-4-5` and `claude-sonnet-5` (`packages/ai/src/models.ts`) [V].

**Scheduled jobs** (`@Cron`, all [V]):

| Job | Schedule | Purpose |
|---|---|---|
| Activation reminders | daily 07:41 UTC | Setup nudges to owners |
| Overdue invoices | daily 00:05 | Status transition |
| Registers not taken | weekdays 09:00 UTC | Push to teachers |
| Marks not entered | daily check | Fires 7 days before term end |
| Weekly parent summaries | weekly | AI summaries |
| RSVP reminders | daily 08:00 Lagos | Push to unanswered parents |
| Message close/delete | daily 02:45 | Retention |
| Admissions close/purge | daily 02:35 | Stale applications |
| Staged files sweeper | daily 02:55 | Clean-up |
| Report export sweeper | daily 01:25 | Clean-up |
| Session sweeper | daily 03:40 | Clean-up |
| Audit partitions | monthly | DDL |

**Event notifications** (`EventNotifierService`, `M/notifications/event-notifier.service.ts`) [V]:

- `resultsReleased`
- `paymentRecorded`
- `registersNotTaken`
- `marksNotEntered`
- `attendanceAbsent`
- `announcementPosted`

They are delivered through `NotificationDispatchService`:

- lockscreen-safe bodies;
- quiet hours;
- once-only via the `notification_deliveries` unique index;
- "push or SMS, never both".

**Preview → commit primitives.** An agent can drive these, with a human approving the commit [V]:

| Area | Preview | Commit |
|---|---|---|
| Imports | `applyMapping` (`imports.service.ts:302`) | `triggerCommit` (`:781`) |
| Invoices | `previewForArm` (`invoice-generation.service.ts:202`) | `generateForArm` (`:70`) |
| Waiting charges | `previewWaitingCharges` (`:296`) | `billWaitingCharges` |
| Promotions | `preview` (`promotions.service.ts:63`) | `commit` (`:259`) |
| Scores | `previewScores` (`assessment.service.ts:425`) | `bulkUpsertScores` (`:270`) |
| Register scan | `extractFromImage` | `commitScan` |
| Discipline | `propose` | `decide` (`discipline.service.ts:117,192`) |

**Exception detectors that already exist** [V]:

- Setup checklist with 10 keys (`setup-state.service.ts:81`): academic calendar, class-subjects, enrolments, fee catalogue, form teachers, guardians, staff, students, teacher, teacher assignments.
- Recording completeness, including missing register rows (`reports/completeness.service.ts:144,270`).
- Timetable year clashes (`timetable.service.ts:880`).
- Fee-default risk (`finance.service.ts:195`).
- Debtor list (`:95`).
- Assignment similarity (`assignments.service.ts:638`).
- Report-card board (`report-card.service.ts:323`).

**Quick navigation** [V]:

- Command palette: ⌘K, filtered to the person's own menu (`apps/web/src/components/admin/command-dialog.tsx`).
- Quick-action pills (`quick-actions.ts`).
- A first-login tour.

The palette is **navigation only**, not a command system. Its own header comment says so.

---

## B. Workflow inventory by role

Each entry uses the 12 fields in order:

1. Workflow and eligible roles
2. Current process and friction
3. Example request or trigger
4. Agent steps
5. Data, services and integrations
6. Reusable capabilities
7. Missing prerequisites or blockers
8. Permissions and approval points
9. User benefit
10. Complexity
11. Readiness
12. Best served by

**Readiness codes:**

- **Ready**: possible with existing capabilities.
- **Ext**: needs extensions.
- **Blocked**: a prerequisite or decision is missing.

The shared prerequisite **P-TOOLS** (tool use in the AI port, see §D) is assumed for every **Agent** item. It is not repeated as a blocker in each entry.

Shared multi-role workflows are described once in **§C** and only referenced here.

### B.1 School leadership: owner and administrator

The owner holds everything. An admin holds everything except the owner-only acts listed in A.2. Every owner-only act is **excluded from agent execution** (see L-24).

**L-01 · Guided school setup ("setup copilot")** · owner, admin · Chat + In-screen

1. **Who:** owner, admin.
2. **Today:** a five-step onboarding wizard, a 10-item setup checklist, activation emails, a first-login tour and a 732-line onboarding guide. An owner new to software still has to translate "we run JSS1–SS3 with arms A–C, these subjects, these teachers" into dozens of CRUD screens. The deferred notes show schools stalling on missing terms and form teachers.
3. **Example:** "We're a secondary school, JSS1 to SS3, three arms each, 2026/27 session starting 8 Sept. Set it up."
4. **Agent steps:**
   1. Read `getSetupState`.
   2. Propose the session, terms (using the national calendar), class levels, arms, subjects per level and the class-subject matrix as one reviewable plan.
   3. On approval, create the records through the services in dependency order.
   4. Report what was created and the next checklist item.
5. **Data and services:** `schools`, `academic-years`, `terms`, `academic-calendar.createForSchool`, `class-levels`, `class-arms`, `subjects`, `class-subjects.bulk` (`M/class-subjects/class-subjects.service.ts:211`), `setup-state`.
6. **Reuse:**
   - `setup-state.service.ts:81`
   - `academic-calendar.service.ts` (`createForSchool`)
   - the class-subject `bulk` endpoint
   - the onboarding guide text (`docs/onboarding-guide.md`) as grounding
7. **Missing:**
   - a "plan document" object holding a proposed multi-record change set;
   - idempotency for partial failure (most CRUD services have no idempotency key [V]);
   - Nigerian curriculum templates (subject lists per level) as data.
8. **Permissions:** `academic-year.create`, `term.create`, `class-*.create`, `subject.create`. The plan as a whole needs approval. Deletes are excluded.
9. **Benefit:** the biggest activation blocker for new schools. Turns hours into minutes.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Agent. Templates alone would also help: UX.

**L-02 · Ask the school (conversational records Q&A)** · owner, admin (later other roles, scoped) · Chat

1. **Who:** owner, admin.
2. **Today:** the answers are spread over dashboards, reports, the debtors list and student pages. `/insights` answers exactly four closed questions (`INSIGHT_INTENTS`: at-risk students, underperforming classes, weakest subjects, attendance concerns) [V].
3. **Example:** "Which JSS2 students were absent more than 3 days this month and also owe fees?"
4. **Agent steps:**
   1. Plan the tool calls: attendance summary, then debtors.
   2. Join the results server-side.
   3. Return a table rendered by the UI, plus a narration over counts.
   4. Offer follow-ups ("message their guardians?").
5. **Data and services:** `attendance.getSummary`, `finance.listDebtors`, `analytics.*`, `completeness.*`, `students.list`.
6. **Reuse:** the insights router/narration split (`packages/types/src/insights/insights.dto.ts`). It is the existing safety pattern: numbers from SQL, prose from the model.
7. **Missing:**
   - P-TOOLS;
   - **P-PII**: the hard rule forbids student names to the LLM for derived features, so tools must return opaque handles, with names rendered client-side;
   - typed read tools with scope enforcement;
   - a conversation store.
8. **Permissions:** read-only. Every tool checks the caller's permission (`userHoldsPermission`, `common/auth/role-check.ts:85`). `reports.analytics.read` and `finance.debtors.read` gate their respective tools.
9. **Benefit:** high and daily for owners, who are often off-site and on a phone.
10. **Complexity:** High.
11. **Readiness:** Blocked on P-TOOLS and P-PII.
12. **Best served by:** Agent.

**L-03 · Morning brief / daily digest** · owner, admin · Background (+Chat follow-up)

1. **Who:** owner, admin.
2. **Today:** the owner opens the dashboard, finance dashboard, messages, sickbay and admissions separately. No digest exists [V].
3. **Trigger:** 07:30 Lagos on school days.
4. **Steps:** compute, deterministically:
   - registers not yet taken (yesterday);
   - sickbay visits;
   - new admissions;
   - flagged messages;
   - payments received;
   - overdue invoices;
   - report cards waiting on approval;
   - expiring invitations.

   Then optionally narrate, and deliver by push (lockscreen-safe) and email.
5. **Data and services:** `dashboard.getAdminDashboard` (`dashboard.service.ts:70`), `completeness`, `sickbay.listVisits`, `admissions.list`, `messages.list` (flagged), `finance.getDashboard`, `report-card.getBoard`.
6. **Reuse:**
   - the cron sweep shape (walk active schools, one tenant transaction each; `teacher-reminders.service.ts`);
   - `computeSchoolDays`;
   - `NotificationDispatchService`;
   - quiet hours.
7. **Missing:**
   - a digest preference per user;
   - an email template;
   - a decision on whether digest content (names) may go by email.
8. **Permissions:** each section is filtered by the recipient's permissions (an admin without `finance.dashboard.read` gets no finance section, for example).
9. **Benefit:** high frequency, low effort.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ready (automation) / Ext (narration).
12. **Best served by:** Automation first. Narration is optional AI-assist.

**L-04 · End-of-term close-out coordinator** · owner, admin · Background + Chat

1. **Who:** owner, admin.
2. **Today:** the admin checks the completeness report, chases teachers by phone or WhatsApp, watches the report-card board and releases arm by arm. The only automated chase is "marks not entered" 7 days before term end [V].
3. **Trigger:** 14 days before `Term.endDate`, or a request: "What's left before we can release JSS results?"
4. **Agent steps:**
   1. Build the outstanding list: missing scores by teacher and subject, unsigned columns, arms not form-reviewed, comments missing, cards not built.
   2. Rank it by blocking impact.
   3. Draft targeted nudges to the specific teachers.
   4. After approval, send the nudges as in-app or push notifications.
   5. Re-check daily and escalate to the admin.
5. **Data and services:** `completeness.getCompleteness`, `getTeacherActivity` (audited read), `report-card.getBoard`, `assessment.aggregate` status, `teacher-reminders`.
6. **Reuse:** `remindAboutMarks` (`teacher-reminders.service.ts:53`), `EventNotifierService`, `notification_deliveries` once-only keys.
7. **Missing:**
   - a staff-to-staff nudge channel: messaging today is parent ↔ staff only [A, from `messages.service.ts` and `portal-messages.service.ts`];
   - per-assessment deadlines (none in the schema [V], `notifications-v1.md`).
8. **Permissions:** `reports.completeness.read`. `reports.teacher-activity.read` is audited on every read. Sending nudges needs admin approval of the batch.
9. **Benefit:** high at a high-stakes moment, three times a year.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Hybrid (automation detects, agent coordinates).

**L-05 · Report-card approval review (principal approval)** · owner, admin · In-screen (web + `staff/approvals` mobile)

1. **Who:** owner, admin (holders of `report-card.principal-approve`).
2. **Today:** the approver opens each arm's board and cards and approves. Nothing helps them spot problems.
3. **Example:** "Check SS1B before I approve."
4. **Steps:**
   - Run deterministic checks: missing subject scores, totals out of range, positions tied or odd, missing or duplicate comments, comment tone outliers, an attendance figure absent, the promotion decision inconsistent with the school's rule.
   - Summarise by severity.
   - Deep-link to each card.
5. **Data and services:** `report-card.getBoard`, `getRenderData`, `grading.*`.
6. **Reuse:** `getBoard` (`report-card.service.ts:323`); the roster reconciliation fix (`docs/modules/report-card-roster-reconciliation.md`).
7. **Missing:**
   - a rule set for "anomaly";
   - comment-quality checks would need the comment text sent to the LLM. Comments are PII-free by design [D], so this is lower risk but must be confirmed.
8. **Permissions:** approval stays a human click. The agent never approves, releases or reopens (`report-card.reopen` is owner-only and excluded).
9. **Benefit:** fewer reissued report cards. A reissued card is costly and embarrassing for a school.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Hybrid.

**L-06 · Staff onboarding in bulk** · owner, admin · Chat + In-screen

1. **Who:** owner, admin.
2. **Today:**
   - CSV teacher import with mapping and preview (`imports.uploadTeachers`);
   - one-by-one invites (`users.invite`, `users.service.ts:133`);
   - teacher assignments created separately;
   - form teachers set per arm.

   That is four separate places.
3. **Example:** "Here's our staff list [pasted/photo]. Mrs Okafor teaches maths in JSS1 A–C and is form teacher of JSS1A…"
4. **Agent steps:**
   1. Parse the list.
   2. Match it against existing users.
   3. Propose invitations, roles, teacher profiles, assignments and form-teacher links as one plan.
   4. After approval, execute it.
   5. Report bounced or duplicate emails.
5. **Data and services:** `users.invite`, `teacher-profiles.create`, `teacher-assignments.create`, `class-arms.update` (`classTeacherId`).
6. **Reuse:** the imports mapping/preview/commit pipeline; the setup-state keys `staff`, `teacher-assignments`, `form-teachers`.
7. **Missing:**
   - staff names to the LLM: staff PII is not covered by the student-PII rule, but NDPR still applies, so this needs a decision (F-5);
   - a photo of a staff list is not on the allowlist.
8. **Permissions:** `user.invite`, `teacher-assignment.create`, `class-arm.update`. Inviting is an outward email, so the batch needs approval.
9. **Benefit:** high once per year per school, plus at every mid-year hire.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Agent (text parsing) + UX (unify the screens).

**L-07 · Staffing-gap and load checker** · owner, admin · Background + In-screen

1. **Who:** owner, admin.
2. **Today:** the setup checklist says whether *any* form teachers or assignments exist. It cannot say that JSS3B has no physics teacher, or that a teacher has 38 periods [A on what the checklist reports, partly verified: the keys are coarse].
3. **Trigger:** term start, any assignment change, or "Who isn't teaching anything this term?"
4. **Steps:**
   - subjects in the matrix with no assigned teacher per arm;
   - arms without a form teacher;
   - teachers with no assignment;
   - deactivated users still assigned;
   - period load against the timetable.
5. **Data and services:** `class-subjects`, `teacher-assignments`, `class-arms`, `users`, `timetable.getView`.
6. **Reuse:** `setup-state`; `timetable.getYearClashes`.
7. **Missing:** the rules themselves.
8. **Permissions:** read-only (`teacher-assignment.read`).
9. **Benefit:** prevents empty gradebooks and missing report-card subjects.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation (+ UX surfacing).

**L-08 · Timetable drafting and clash repair** · owner, admin · Chat + In-screen

1. **Who:** owner, admin.
2. **Today:** a manual grid builder with clash detection, fork/copy and publish. **There is no solver** [V].
3. **Example:** "Fill JSS2's timetable: maths 5 periods, English 5, … no teacher twice at once, doubles for science."
4. **Steps:**
   - Gather the constraints (bell slots, assignments, teacher availability).
   - Generate a candidate with a constraint solver, not the LLM.
   - Show clashes and unmet constraints.
   - Save as a draft fork.
   - A human publishes it.
5. **Data and services:** `timetable.*` (bell schedule, `saveLesson`, `forkTimetable`, `publishTimetable`).
6. **Reuse:** `getYearClashes`, `forkTimetable`, `TimetablePublication`.
7. **Missing:**
   - a CP-SAT-style solver service;
   - teacher availability data (none in the schema [A]).
8. **Permissions:** `timetable.manage`. Publishing is human-only.
9. **Benefit:** saves days each session for medium and large schools.
10. **Complexity:** High.
11. **Readiness:** Blocked (no solver).
12. **Best served by:** Automation (solver) + an agent only to collect constraints in conversation. **This is a future product idea.**

**L-09 · Announcement and notice drafting** · owner, admin · In-screen + Chat

1. **Who:** owner, admin.
2. **Today:** the admin writes announcements by hand. They go out as push, in-app and email, optionally to the website.
3. **Example:** "Tell JSS parents school resumes Monday 8th, PTA meeting Friday 4pm, bring the signed form."
4. **Steps:**
   1. Draft a title and body in the school's tone, plus an optional website version.
   2. Pick the audience from structured options.
   3. Show the email preview.
   4. A human posts it.
5. **Data and services:** `announcements.create` (`announcements.service.ts:60`), `announcement-email.preview`, `setShowOnWebsite`, `calendar.createSchoolEvent`.
6. **Reuse:** the email preview; the website flag; calendar events.
7. **Missing:** a new prompt and its eval.
8. **Permissions:** `announcement.create`. **External communication**, so it is always human-sent.
9. **Benefit:** medium, weekly.
10. **Complexity:** Low.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**L-10 · Event planning with RSVP follow-up** · owner, admin · Chat + Background

1. **Who:** owner, admin.
2. **Today:** create the event and ask for RSVP. One reminder goes out the day before the reply-by date (`event-rsvp.service.ts:254`) [V].
3. **Example:** "Set up the inter-house sports day on 14 March, ask JSS parents to RSVP, remind non-responders."
4. **Steps:**
   1. Create the event (draft).
   2. Set the RSVP audience.
   3. Schedule the reminder.
   4. After the date, summarise the responses.
5. **Data and services:** `calendar`, `event-rsvp`.
6. **Reuse:** all of it exists.
7. **Missing:** nothing material.
8. **Permissions:** `calendar-event.create`. Notifying parents needs approval.
9. **Benefit:** low–medium.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** UX / AI-assist. **A low-value candidate for an agent.**

**L-11 · End-of-year promotion and new-session rollover** · owner, admin · see **C-9**

**L-12 · Data-quality sweeps** · owner, admin · Background + Chat

1. **Who:** owner, admin.
2. **Today:** no detector exists [V]. Problems surface only when a parent can't sign in or an invoice goes nowhere.
3. **Example:** "Find problems in our student records." Or a weekly sweep.
4. **Steps:** detect:
   - students with no guardian;
   - guardians with no phone or email;
   - duplicate guardians (same phone, different rows);
   - likely duplicate students (same name and DOB);
   - active students not enrolled this term;
   - enrolled students without an admission number;
   - guardians never invited, or invited and expired;
   - students missing a photo or DOB.

   Then group them and offer fix-it screens.
5. **Data and services:** `students`, `guardians`, `enrollments`, `photos`, `admission-numbers`.
6. **Reuse:** guardians `invite`, `resendInvite`, `linkExisting`; students `update`.
7. **Missing:**
   - duplicate-detection logic;
   - a merge operation (no guardian or student merge exists [A]).
8. **Permissions:** read: `student.read`, `guardian.read`. Fixes go through the normal screens or need approval. A merge would be high risk.
9. **Benefit:** high. It drives every downstream channel (fees, results, messages).
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation (+ agent explanation).

**L-13 · "Who changed this, and when?" (record history)** · owner, admin · Chat + In-screen

1. **Who:** owner, admin.
2. **Today:** audit rows are written by 109 files, but **nobody can read them in the product** [V] (`audit.read` is unused).
3. **Example:** "Who changed Chidi's maths CA score last week?"
4. **Steps:** query `audit_logs` by entity, under tenancy; explain the before and after.
5. **Data and services:** `AuditLog`, which is partitioned monthly and has no PII field [V].
6. **Reuse:** the monthly partitioning.
7. **Missing:**
   - a read API;
   - consistent `metadata` shapes across the 109 writers [A];
   - an index on `entity_id`. **[A]** that it exists; verify.
8. **Permissions:** `audit.read`, owner/admin. Reads themselves should be audited.
9. **Benefit:** high trust value in disputes about grades and payments.
10. **Complexity:** Medium.
11. **Readiness:** Blocked (no read API).
12. **Best served by:** UX + agent explanation.

**L-14 · Report and analytics explanation** · owner, admin · In-screen + Chat

1. **Who:** owner, admin.
2. **Today:** the Academic, Attendance and Enrolment tabs, plus teacher activity, with Excel/PDF export. No narrative.
3. **Example:** "Why did SS2's average drop this term?"
4. **Steps:**
   1. Pull the analytics aggregates.
   2. Compare with previous terms (`previousTerms`).
   3. Narrate over the computed deltas only.
5. **Data and services:** `analytics.getAcademic` (`analytics.service.ts:95`), `getAttendance`, `getEnrolment`, `getTeacherTrend`.
6. **Reuse:** the insights narration prompt pattern.
7. **Missing:** new narration intents; outcome analytics deliberately wait on a data-sufficiency trigger [D].
8. **Permissions:** `reports.analytics.read`. Exports are separately audited (`reports.export`).
9. **Benefit:** medium.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**L-15 · Settings and policy explainer** · owner, admin (and others for their own areas) · Chat + In-screen

1. **Who:** owner, admin.
2. **Today:** the help guide (`/help/guide`) and docs.
3. **Example:** "Why did Ada get a C when she scored 59?" or "What does turning on the parent summary do?"
4. **Steps:**
   - Read the grading scheme and boundaries, notification settings or plan limits.
   - Explain them with links to the setting.
   - For "why this grade", recompute with the grading service and show the rule.
5. **Data and services:** `grading.*`, `notification-preferences`, `schools.getPlan`, the onboarding guide.
6. **Reuse:** the onboarding guide as a retrieval corpus (the embedding pipeline exists for curriculum).
7. **Missing:** a help-content index.
8. **Permissions:** read-only, scoped to readable settings.
9. **Benefit:** fewer support calls to SchoolKit.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** Agent (help) / UX.

**L-16 · Website content assistant** · owner, admin · In-screen

1. **Who:** owner, admin.
2. **Today:** the admin writes news posts and photo captions by hand.
3. **Example:** "Turn last week's sports-day announcement and these photos into a news post."
4. **Steps:** draft the post from the announcement or event; suggest captions; save as a draft. A human publishes.
5. **Data and services:** `school-website.createPost`, `setPostPublished`, `announcements`.
6. **Reuse:** the `showOnWebsite` path.
7. **Missing:**
   - a prompt;
   - **photos of children** must never go to the LLM unless a decision allows it (vision is allowlisted only for registers).
8. **Permissions:** `website.manage`. Publishing is public, so it is human-only.
9. **Benefit:** low–medium.
10. **Complexity:** Low.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**L-17 · Staff offboarding / role change** · owner, admin · Chat

1. **Who:** owner, admin.
2. **Today:** deactivate the user. Their assignments, form classes, house-master links, messaging appointments, admissions-officer role, pending payroll items and open message threads are left for someone to notice [A: no cascade found].
3. **Example:** "Mr Bello is leaving on Friday. Hand his classes to Mrs Ade."
4. **Steps:**
   1. List everything that references the user.
   2. Propose the reassignments.
   3. After approval, apply them, then deactivate.
5. **Data and services:** `users.update` and deactivate, `teacher-assignments`, `class-arms`, `hostels.setHouseMasters`, `messages-settings.setRoles`, `admissions-settings.setOfficers`, `payroll`.
6. **Reuse:** the individual services.
7. **Missing:** a "references to user" query.
8. **Permissions:** `user.deactivate`, `teacher-assignment.update`. The whole plan needs approval.
9. **Benefit:** medium.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Agent.

**L-18 · Plan, cap and AI-budget awareness** · owner, admin · Background

1. **Who:** owner, admin.
2. **Today:** the plan notice under `PLAN_ENFORCEMENT=warn` and an AI usage page (`/settings/ai-usage`).
3. **Trigger:** 80% of the student cap, or 80% of the monthly AI tokens.
4. **Steps:** notify, and explain what happens next.
5. **Data and services:** `schools.getPlan`, `ai-usage.getUsage`, `AIBudgetPeriod`.
6. **Reuse:** all of it.
7. **Missing:** threshold events.
8. **Permissions:** `ai-usage.read`.
9. **Benefit:** low–medium. It becomes important if agent features consume budget.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation.

**L-19 · Parent-portal adoption drive** · owner, admin (also inbox officer) · Background + Chat

1. **Who:** owner, admin.
2. **Today:** invite, resend and revoke per guardian (`guardians.service.ts:288`). Nobody tracks who never activated.
3. **Example:** "How many parents haven't activated? Resend to those whose invite expired."
4. **Steps:** segment guardians into never invited, expired, pending and active; propose a bulk invite or resend; send after approval; re-check in 7 days.
5. **Data and services:** `guardians.list`, `invite`, `resendInvite`.
6. **Reuse:** `auth_resolve_guardian_invitation_by_token_hash` revocation on resend.
7. **Missing:**
   - a bulk invite endpoint [A];
   - SMS invites depend on the sender ID (waiting on CAC) [D].
8. **Permissions:** `guardian.invite`. Outbound to parents, so batch approval.
9. **Benefit:** high. Every parent-facing feature depends on it.
10. **Complexity:** Low.
11. **Readiness:** Ready / Ext.
12. **Best served by:** Automation + UX.

**L-20 · ID-card issuance batches** · owner, admin · In-screen

Issuing and printing per class already exists (`id-cards.issue`, `print`). An agent adds little.

- **Complexity:** Low. **Readiness:** Ready.
- **Best served by:** UX. **Not an agent candidate.**

**L-21 · Result-checker PIN batches** · owner, admin

Generating a batch returns the only plaintext copy of the PINs (`result-pin.service.ts:79`) [V].

- **Excluded from agent execution.** Plaintext secrets must never enter model context or logs.
- **Best served by:** UX only.

**L-22 · Data-protection and deletion requests** · owner, admin · Background + In-screen

1. **Who:** owner, admin.
2. **Today:** a list of requests with "mark handled" (`account-deletion`).
3. **Trigger:** a new request.
4. **Steps:** summarise what records the person has, list the steps and deadlines, track the request until it is handled.
5. **Data and services:** `account-deletion.list`, `markHandled`, `data-protection`.
6. **Reuse:** the list.
7. **Missing:**
   - a records inventory per person;
   - a legal policy on retention.
8. **Permissions:** `user.deactivate`. Deletion is human-only and legally sensitive.
9. **Benefit:** compliance.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation (tracking).

**L-23 · Admissions decisions (admit)** · see **C-3**

**L-24 · Explicit non-candidates (agent must never execute)** [V permissions]

- `academic-year.delete`, `term.delete`, `enrollment.delete`
- `report-card.reopen`, `report-card.release`, `report-card.principal-approve`
- `payment.refund`, `payroll.transfer`
- `staff-bvn.reveal`
- `result-pin.manage` (generation)
- `promotion.commit`
- `auth.2fa.*`
- `school` deletion and suspension (platform admin)
- `question.approve`, `exam-paper.finalise`
- `behaviour.decide`
- `admission.admit`

An agent may **prepare** most of these and route them to a human. It must never perform them. This list is the proposed basis of an "approval-required" tool class (§D, P-APPROVE).

### B.2 Admissions officer (and owner/admin)

**ADM-01 · Application triage and follow-up** · admission_officer, admin, owner · Background + In-screen

1. **Who:** admission_officer, admin, owner.
2. **Today:**
   - applications arrive from the public form;
   - an alert goes to staff (`admission-alerts.newApplication`);
   - officers review, book assessments, offer or reject;
   - stale applications are auto-closed by `closeStale` (`admissions-purge.service.ts:48`) [V].
3. **Trigger:** a new application; an application idle for 7 days; or "Which applications are waiting on documents?"
4. **Steps:**
   - Check that the application is complete (required documents, fields).
   - Flag duplicates (same child, same parent).
   - Draft the next-step email (assessment booking, offer).
   - Queue it for the officer.
   - Remind about pending acceptances before the offer expires.
5. **Data and services:** `admissions.list`, `get`, `admission-decisions.review`, `bookAssessment`, `offer`, `admission-mail.send`.
6. **Reuse:** the state machine in `admission-decisions.service.ts` (review, bookAssessment, offer, reject, withdraw, recordAcceptance, admit).
7. **Missing:**
   - **applicant-supplied text is untrusted** (P-INJECT);
   - document review would mean sending PII and document images to the LLM, which is **not allowlisted**.
8. **Permissions:** `admission.manage`. Offers and rejections are outward and consequential, so human-only. Admit is `admission.admit` (owner/admin).
9. **Benefit:** medium, seasonal. It peaks before each session.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation (completeness, reminders) + AI-assist (email drafts).

### B.3 Teachers (subject teachers)

All teacher actions are scoped by `getTeacherScope` to their own (arm, subject) pairs [V]. Any agent tool must call the same service methods with the teacher's `AuthContext`, so it inherits that scope. Calling Prisma directly would skip it.

**T-01 · Teacher's day brief** · teacher · Background + Chat

1. **Who:** teacher.
2. **Today:** the teacher dashboard; the register reminder at 10:00; separate pages for timetable, homework, marking and messages.
3. **Trigger:** 07:00 on school days, or "What do I have today?"
4. **Steps:** today's lessons (own timetable), registers still to take, assignments waiting to be marked, homework due, unanswered parent messages, CBT sittings today.
5. **Data and services:** `timetable.getView` (own), `attendance.getRegister`, `assignments.marking`, `homework.list`, `messages.list`, `cbt-sittings.list`.
6. **Reuse:** `TIMETABLE_OWN_READ_PERMISSIONS`; teacher reminders; the staff push rail.
7. **Missing:** a digest builder.
8. **Permissions:** the teacher's own scope only.
9. **Benefit:** high frequency.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation (+ Chat follow-ups later).

**T-02 · Register taking by exception or by voice** · teacher (form teacher for daily, subject teacher for subject attendance) · In-screen (mobile) + Chat

1. **Who:** teachers.
2. **Today:** a roster with taps per child (`attendance.markBulk`, `attendance.service.ts:94`). Parents of absent children are pushed (`attendanceAbsent`).
3. **Example:** "Everyone present except Chidi and Amaka; Tunde late."
4. **Steps:**
   1. Resolve the names **on the device or server**, against the roster.
   2. Show the filled register.
   3. The teacher confirms.
   4. Call `markBulk`.
5. **Data and services:** `attendance.getRegister`, `markBulk`, `subject-attendance.*`.
6. **Reuse:** `markBulk`; the absence notification.
7. **Missing:**
   - a "mark all present" button may already solve 90% of this [A: verify the UI];
   - name matching must not send the roster to the LLM (P-PII). Deterministic fuzzy matching is enough.
8. **Permissions:** `attendance.mark`, scoped. Confirming triggers parent notifications, so the teacher must confirm.
9. **Benefit:** high frequency, small saving each time.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** UX. **An agent is not needed.**

**T-03 · Score entry from a mark sheet (photo, paste or spreadsheet)** · teacher · In-screen

1. **Who:** teacher.
2. **Today:** type into the gradebook grid. A paste preview exists (`previewScores`, `assessment.service.ts:425`).
3. **Example:** a photo of a handwritten CA sheet.
4. **Steps:**
   1. Extract (row → student, score).
   2. Match to the roster.
   3. Show the preview with mismatches highlighted.
   4. The teacher confirms.
   5. Call `bulkUpsertScores`.
5. **Data and services:** `assessment.previewScores`, `bulkUpsertScores`.
6. **Reuse:** the preview path; vision is already wired for `student-list-extraction`.
7. **Missing:**
   - **a mark sheet carries student names, so it would need a third allowlist row** (P-PII, F-5);
   - an eval set.
8. **Permissions:** `assessment-score.create`, scoped. Never auto-save. Sign-off stays separate.
9. **Benefit:** high for schools that record on paper first [A: common in Nigerian schools].
10. **Complexity:** Medium.
11. **Readiness:** Blocked (policy).
12. **Best served by:** AI-assist.

**T-04 · Pre-sign-off score check** · teacher (and form teacher/admin) · In-screen

1. **Who:** teacher.
2. **Today:** the teacher signs off a column or subject (`signOff`, `assessment.service.ts:442`). There is no sanity check beyond validation [A].
3. **Trigger:** the "Sign off" press.
4. **Steps:** flag missing scores, scores at the maximum for everyone, scores pasted in the wrong column (big deviation from CA to exam), duplicates, and enrolled students missing from the column.
5. **Data and services:** `assessment.getFeed`, `aggregation.getStatus`.
6. **Reuse:** the existing aggregation.
7. **Missing:** rules.
8. **Permissions:** `assessment.sign-off`.
9. **Benefit:** fewer wrong report cards.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation. **No LLM needed.**

**T-05 · Report-card subject comments** · teacher · In-screen (exists)

1. **Who:** teacher.
2. **Today:** **built.** A batch AI draft goes through the queue (`report-comments.service.ts:116`), then the teacher accepts.
3. **Example:** "Draft comments for my SS1 maths class, firmer for those below 40."
4. **Steps:** an agent-style refinement: regenerate with a tone instruction, flag comments that contradict the score band, and flag students without drafts.
5. **Data and services:** `report-comments.*`.
6. **Reuse:** the full flow.
7. **Missing:** a "regenerate with instruction" option.
8. **Permissions:** `report-card-comment.generate`, `report-card-comment.write`. The teacher's accept is the hard-rule gate.
9. **Benefit:** medium (already largely delivered).
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** UX on top of the existing AI-assist.

**T-06 · Term scheme to weekly lesson plans** · teacher · Chat + In-screen

1. **Who:** teacher.
2. **Today:** one lesson plan per generation (`createAndGenerate`, `lesson-plans.service.ts:86`), grounded in the school's approved curriculum chunks.
3. **Example:** "Plan weeks 1–12 of JSS2 Basic Science from our scheme of work."
4. **Steps:**
   1. Retrieve the week-by-week topics.
   2. Generate the plans in a queued batch.
   3. Link each plan to its week.
   4. The teacher reviews and edits.
5. **Data and services:** `curriculum-retrieval.retrieve`, `lesson-plans.*`, the AI queue.
6. **Reuse:** RAG retrieval, the lesson-plan prompt, `AiJobRegistry`.
7. **Missing:**
   - batch generation;
   - budget pre-check for N calls (the reservation is per call);
   - curriculum eval queries are author-written [D].
8. **Permissions:** `lesson-plan.create`. There is no PII.
9. **Benefit:** high per teacher, once a term.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist (batch) / light agent.

**T-07 · Homework from the lesson plan** · teacher · In-screen

1. **Who:** teacher.
2. **Today:** the teacher writes homework by hand. Homework has no submissions [V].
3. **Example:** "Set homework from today's lesson plan, due Thursday."
4. **Steps:** draft the homework text from the plan, then post it after confirmation.
5. **Data and services:** `homework.create`, `lesson-plans.get`.
6. **Reuse:** both.
7. **Missing:** a prompt (or a plain copy of the plan's homework section [A: verify the plan has one]).
8. **Permissions:** `homework.create`, scoped. Parents see it, so confirm before posting.
9. **Benefit:** low–medium.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** UX / AI-assist.

**T-08 · Marking assistant for submitted work** · teacher · In-screen

1. **Who:** teacher.
2. **Today:**
   - auto-marks for objective questions (`useAutoMarks`, `assignments.service.ts:590`);
   - AI feedback drafts, one or all (`draftAll`), with the school switch off by default;
   - a similarity check (`:638`);
   - manual mark, return and release.
3. **Example:** "Mark JSS3A's essay assignment."
4. **Steps:**
   1. Apply the auto-marks.
   2. Draft feedback for typed answers.
   3. Surface high-similarity pairs and missing submissions.
   4. Present a review queue.
   5. The teacher saves each mark, then releases.
5. **Data and services:** `assignments.*`, `assignment-feedback.*`.
6. **Reuse:** all of it exists. The orchestration is the gap.
7. **Missing:** a single "review queue" UX.
8. **Permissions:** `assignment.mark`. Never auto-finalise a mark (hard rule).
9. **Benefit:** high for teachers who use assignments.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ready.
12. **Best served by:** UX orchestration of existing AI-assist.

**T-09 · Exam paper assembly** · teacher (subject), admin · Chat + In-screen

1. **Who:** subject teacher, admin.
2. **Today:**
   - generate question drafts (`question-bank.generate`, `:394`);
   - approve each;
   - build the paper; `draw` picks questions;
   - finalise and export.
3. **Example:** "Build a 40-question JSS2 maths second-term paper, weeks 1–9, 30% hard, plus 5 theory."
4. **Steps:**
   1. Check the bank's coverage against the blueprint.
   2. Generate drafts for the gaps.
   3. Route the drafts to the teacher for approval.
   4. Draw the paper.
   5. Report the coverage.
   6. The teacher finalises.
5. **Data and services:** `question-bank.list`, `generate`, `exam-papers.create`, `draw`, `save`.
6. **Reuse:** the full pipeline, RAG grounding, the approval gate.
7. **Missing:** a blueprint concept (topic × difficulty matrix) [A: `draw` parameters not checked in detail].
8. **Permissions:**
   - `question.generate` spends the AI budget;
   - `question.approve` and `exam-paper.finalise` are human-only.
9. **Benefit:** high, twice a term.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Agent.

**T-10 · CBT sitting setup and scores to the gradebook** · teacher, admin · see **C-8**

**T-11 · Behaviour note from a narrative** · teacher · In-screen (mobile)

1. **Who:** teacher.
2. **Today:** forms for records and incidents (with witnesses).
3. **Example:** "Tunde and Musa were fighting at break; Ada saw it."
4. **Steps:**
   1. Structure the note into an incident draft: category, students, witnesses.
   2. Resolve names locally against the class roster.
   3. The teacher edits and submits.
5. **Data and services:** `behaviour.createIncident`, `incidentOptions`, `incidentRoster`.
6. **Reuse:** the incident model.
7. **Missing:**
   - **the narrative contains names**, so the text must have names replaced before it goes to the LLM, or a policy row is needed (P-PII);
   - the hard rule: AI never finalises behaviour records.
8. **Permissions:** `behaviour.create`. The teacher submits. Discipline decisions are `behaviour.decide` (admin).
9. **Benefit:** medium.
10. **Complexity:** Medium.
11. **Readiness:** Blocked (policy).
12. **Best served by:** AI-assist. A structured form may be enough: UX.

**T-12 · Reply to parent messages** · teacher (also bursar, principal, head teacher, inbox officer) · see **C-7**

**T-13 · Student context for a teacher** · teacher · Chat + In-screen

1. **Who:** teacher.
2. **Today:** the class roster → student page (`/teacher/classes/[armId]/students/[studentId]`).
3. **Example:** "How is Ada doing across her subjects this term?"
4. **Steps:** gather, within scope only:
   - scores in the teacher's own subjects (others only if they are her form teacher [A: verify scope]);
   - attendance;
   - behaviour;
   - the health **note** (not the record).

   Then summarise.
5. **Data and services:** `teacher-scope.getMyArmRoster`, `assessment`, `attendance.getSummary`, `behaviour.listForStudent`, `health.teacherNoteForStudent`.
6. **Reuse:** the scope helper; `HEALTH_NOTE_PERMISSIONS`.
7. **Missing:** P-PII; P-TOOLS.
8. **Permissions:** strictly the teacher's scope. The health record itself is excluded.
9. **Benefit:** medium.
10. **Complexity:** Medium.
11. **Readiness:** Blocked.
12. **Best served by:** Agent. A better student page would also help: UX.

**T-14 · Curriculum upload and review** · teacher, admin · In-screen

1. **Who:** teacher, admin.
2. **Today:** upload a PDF or text → parse and chunk → review chunks (edit, discard) → approve (`curriculum.service.ts`).
3. **Trigger:** an upload.
4. **Steps:** propose the week and topic labels for each chunk, flag parse junk, and suggest the class level and subject.
5. **Data and services:** `curriculum.updateChunk`, `discardChunk`, `approve`.
6. **Reuse:** the ingestion queue.
7. **Missing:** a labelling prompt.
8. **Permissions:** `curriculum.upload`. Approval is human.
9. **Benefit:** medium. Better grounding for T-06, T-09 and S-01.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**T-15 · Digital resource sharing** · teacher, librarian · In-screen

This is low value. `library-resources.createLink` and `createFile` exist.

- **Best served by:** UX. **Not an agent candidate.**

### B.4 Form teacher (class teacher)

**FT-01 · Form review pipeline** · form teacher · see **C-1**. This role's part is: chase subject sign-offs, draft and accept form comments, then form-review.

**FT-02 · Class wellbeing watch** · form teacher (and admin) · Background

1. **Who:** form teacher, admin.
2. **Today:** the signals are scattered: absences, sickbay notices, behaviour points, a sudden drop in scores.
3. **Trigger:** weekly.
4. **Steps:** detect students with absence streaks, repeated sickbay visits (**count only**; the details stay with the health officer), negative behaviour trends, or a sudden score drop. Then notify the form teacher with links.
5. **Data and services:** `attendance.getSummary`, `behaviour.listForStudent`, `sickbay.listVisits` (counts), `analytics`.
6. **Reuse:** `INSIGHT_INTENTS` `at-risk-students` and `attendance-concerns` computations.
7. **Missing:**
   - a policy on whether sickbay **counts** may reach a teacher (F-6);
   - thresholds.
8. **Permissions:** the form teacher's arm only. Health details are excluded.
9. **Benefit:** high pastoral value.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation.

**FT-03 · Contacting a parent proactively** · form teacher · Chat

1. **Who:** form teacher.
2. **Today:** **teachers cannot start a conversation.** `messages.start` is held only by admin and the inbox officer [V].
3. **Example:** "Message Chidi's parents about his absences."
4. **Steps:** draft the message; send it if allowed, otherwise route it to the inbox officer.
5. **Data and services:** `messages.officeStart`.
6. **Reuse:** the messaging rail.
7. **Missing:** **a product decision** on whether teachers may start conversations (F-7).
8. **Permissions:** `messages.start` today. External communication, so human-sent.
9. **Benefit:** medium.
10. **Complexity:** Low.
11. **Readiness:** Blocked (permission).
12. **Best served by:** UX or a product change. Then AI-assist.

### B.5 Bursar (and owner/admin for finance)

**Money rules apply to every item here:**

- the model never computes fees, discounts or balances;
- money is kobo `bigint`;
- every write goes through the existing services, which write `audit_logs`.

**B-01 · Term billing run** · bursar, admin · see **C-2**. This role's part is: preview per arm, check exceptions, then generate.

**B-02 · Debtor follow-up campaign** · bursar, admin · Background + Chat

1. **Who:** bursar, admin.
2. **Today:**
   - the debtor list (`listDebtors`, `finance.service.ts:95`);
   - "send reminders" by email and SMS, gated by preferences (`sendReminders`, `:558`);
   - payment plans;
   - fee-risk per child (`:195`).

   Follow-up across weeks is manual.
3. **Example:** "Remind everyone over ₦20k overdue, except families on a payment plan; offer a plan to those over ₦100k."
4. **Steps:**
   1. Segment debtors deterministically.
   2. Preview the recipients and the template (amounts inserted by code).
   3. Send after approval.
   4. Schedule a re-check.
   5. Report who paid since.
5. **Data and services:** `finance.listDebtors`, `sendReminders`, `payment-plan.*`, `payments.findAll`.
6. **Reuse:** `sendReminders` (channels, preferences); the payment plan recompute.
7. **Missing:**
   - segmentation parameters on `sendReminders` [A: verify its filter options];
   - campaign history;
   - the SMS sender name waits on CAC [D].
8. **Permissions:** `finance.debtors.remind`. Outbound to parents, so approval per campaign.
9. **Benefit:** **very high.** Cash flow is the owner's top concern [A].
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation + light agent (segmentation in conversation).

**B-03 · Record a manual payment from a teller or transfer alert** · bursar · In-screen (mobile `staff/collections/pay`)

1. **Who:** bursar.
2. **Today:** find the student, find the invoice, type the amount, method and reference (`recordManual`, `payments.service.ts:244`).
3. **Example:** a screenshot or photo of a bank alert or teller slip.
4. **Steps:**
   1. Extract the amount, date, reference and payer name.
   2. Suggest matching invoices.
   3. The bursar confirms.
   4. Call `recordManual`.
5. **Data and services:** `payments.recordManual`, `invoices.findAll`.
6. **Reuse:** the receipt issue; the `paymentRecorded` notification.
7. **Missing:**
   - **the teller slip carries payer and student names, which is not allowlisted** (P-PII);
   - an extraction eval;
   - a duplicate-reference check [A].
8. **Permissions:** `payment.record`. The amount must be confirmed by a human. Never auto-apply.
9. **Benefit:** high frequency in schools without Paystack.
10. **Complexity:** Medium.
11. **Readiness:** Blocked (policy).
12. **Best served by:** AI-assist.

**B-04 · Bank-statement reconciliation** · bursar · Background

**Missing entirely** [V]: there is no statement import and no matching.

- **Future idea.** Import a CSV statement → match credits to invoices by amount, reference and name → propose → confirm.
- **Complexity:** High.
- **Best served by:** Automation (matching) + AI-assist for fuzzy narrations. **This is a future product idea.**

**B-05 · Explain a family's balance** · bursar, admin (and the parent version, P-01) · Chat + In-screen

1. **Who:** bursar, admin.
2. **Today:** open the invoice → lines, discounts, payments, plan.
3. **Example:** "Why does the Okafor family owe ₦185,000?"
4. **Steps:** fetch the invoices, charges, discounts, payments and refunds. Give a line-by-line explanation using **API figures only**.
5. **Data and services:** `invoice-generation.findById`, `payments.findAll`, `student-charge.list`, `discount-rule`.
6. **Reuse:** all of it.
7. **Missing:** P-PII (names → opaque), and a guard that the narration contains no invented numbers (copy the insights pattern).
8. **Permissions:** `invoice.read`, `payment.read`.
9. **Benefit:** medium–high. It makes counter conversations faster.
10. **Complexity:** Medium.
11. **Readiness:** Blocked on P-TOOLS.
12. **Best served by:** Agent / UX (a good statement view may suffice).

**B-06 · Expense capture from a receipt photo** · bursar, admin · In-screen (mobile `staff/expenses`)

1. **Who:** bursar, admin.
2. **Today:** type the expense, then upload the receipt (`expense.uploadReceipt`).
3. **Example:** a photo of a diesel receipt.
4. **Steps:** extract the vendor, date, amount and suggested category; prefill the form; a human saves.
5. **Data and services:** `expense.create`, `uploadReceipt`, `expense-category.findAll`.
6. **Reuse:** the vision call path.
7. **Missing:** a new prompt and eval. Receipts usually carry **no student PII** [A].
8. **Permissions:** `expense.create`. A human confirms the amount.
9. **Benefit:** medium.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**B-07 · Payroll run preparation and checks** · bursar (prepare), owner/admin (approve, transfer) · In-screen + Background

1. **Who:** bursar, owner, admin.
2. **Today:** salaries → create run → approve (`payroll.service.ts:383`) → payslips → transfer (`:525`, owner/admin) with Paystack transfer webhooks.
3. **Trigger:** the 20th of the month, or "Prepare October payroll."
4. **Steps:**
   1. Create a draft run.
   2. Diff it against last month: new staff, leavers, salary changes, staff missing a verified bank account.
   3. Flag the anomalies.
   4. Route it to the approver.
5. **Data and services:** `payroll.*`, `staff-bank-accounts`, `users`.
6. **Reuse:** the run and approve flow.
7. **Missing:** the diff logic.
8. **Permissions:** `payroll.process`. **Approve and transfer are human-only** (`payroll.transfer` is excluded).
9. **Benefit:** medium–high, monthly.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ready.
12. **Best served by:** Automation.

**B-08 · Finance questions and narration** · bursar, owner, admin · Chat + In-screen

1. **Who:** bursar, owner, admin.
2. **Today:** the finance dashboard, collection by level, revenue trajectory.
3. **Example:** "How does this term's collection compare with last term at the same point?"
4. **Steps:** compute in SQL, then narrate.
5. **Data and services:** `finance.getDashboard`, `getCollectionByLevel`, `getRevenueTrajectory`.
6. **Reuse:** the insights pattern.
7. **Missing:** new intents.
8. **Permissions:** `finance.dashboard.read`.
9. **Benefit:** medium.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** AI-assist.

**B-09 · Unbilled-charge and billing exceptions** · bursar · Background

1. **Who:** bursar.
2. **Today:** charges from transport, hostel and store wait until billed (`openForBilling`, `previewWaitingCharges`).
3. **Trigger:** weekly, or before a billing run.
4. **Steps:** list waiting charges, orphans (`reattachOrphan`), cancelled invoices with live charges, and students enrolled without an invoice.
5. **Data and services:** `student-charge.*`, `invoice-generation.*`.
6. **Reuse:** the existing helpers.
7. **Missing:** rules.
8. **Permissions:** `charge.read`, `invoice.read`.
9. **Benefit:** medium (revenue leakage).
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation.

**B-10 · Refunds** · owner, admin only

`payment.refund` is excluded from the bursar and from agents. An agent may prepare a refund request for approval.

- **Best served by:** UX.

**B-11 · New-session fee structure** · bursar, admin · Chat

1. **Who:** bursar, admin.
2. **Today:** fee items are entered by hand per category and level. No copy-forward was seen [A].
3. **Example:** "Copy last session's fees with a 10% increase on tuition, rounded to ₦500."
4. **Steps:** read the current items; compute the new amounts **in code**; show the diff; create after approval.
5. **Data and services:** `fee-item.*`, `fee-category.*`.
6. **Reuse:** CRUD.
7. **Missing:** a copy-forward helper.
8. **Permissions:** `fee-item.create`. Approval is required (money).
9. **Benefit:** medium, yearly.
10. **Complexity:** Low.
11. **Readiness:** Ext.
12. **Best served by:** UX (a copy-forward button) + optional agent.

**B-12 · Store sales and stock-take approval** · bursar, storekeeper · see STK-02.

### B.6 Health officer

Health data is the most sensitive data in the system. **Proposed default: no health content is sent to the LLM** (F-6).

**HO-01 · Sickbay visit and parent notice** · health_officer · In-screen

1. **Who:** health_officer.
2. **Today:** create a visit, add medications; a notice goes to the parent (`sickbay.service.ts:109`).
3. **Trigger:** saving a visit with a medication.
4. **Steps:** check the medication against the child's recorded allergies and conditions **deterministically**; warn before saving.
5. **Data and services:** `sickbay.createVisit`, `addMedication`, `health.getProfile`.
6. **Reuse:** the profile data.
7. **Missing:** structured allergy and medication vocabularies [A: likely free text].
8. **Permissions:** `sickbay.manage`.
9. **Benefit:** safety-critical value.
10. **Complexity:** Low–Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation. **Not an LLM task.**

**HO-02 · Health-record completeness drive** · health_officer, admin · Background

1. **Who:** health_officer, admin.
2. **Today:** parents can only **read** the health profile [V]. The officer collects updates on paper.
3. **Trigger:** term start.
4. **Steps:** list students missing allergies, blood group, emergency info or vaccinations; send parents a request (needs a parent update path).
5. **Data and services:** `health.listStudents`.
6. **Reuse:** the list.
7. **Missing:** **a parent submission or update flow** (future), with officer approval.
8. **Permissions:** `health.manage`.
9. **Benefit:** high safety value.
10. **Complexity:** Medium.
11. **Readiness:** Blocked (no parent write path).
12. **Best served by:** Automation + product feature.

**HO-03 · Teacher note drafting** · health_officer · In-screen

This would draft the plain-language "For teachers" note from the record.

- **Not recommended:** it sends health data to the LLM.
- **Best served by:** UX (templates). **Listed for completeness.**

### B.7 Librarian

**LIB-01 · Overdue loan follow-up** · librarian · Background

1. **Who:** librarian.
2. **Today:** the loans list. **No overdue sweep or reminder** [V].
3. **Trigger:** daily.
4. **Steps:** list overdue loans; notify the student (push) and the parent; give a weekly summary to the librarian.
5. **Data and services:** `library.listLoans` (`library.service.ts:466`), `studentLoans`.
6. **Reuse:** the push rail.
7. **Missing:** a cron and a notification type.
8. **Permissions:** `library.lend`.
9. **Benefit:** low–medium.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation.

**LIB-02 · Catalogue entry from an ISBN or cover photo** · librarian · In-screen

There is no ISBN integration. This is a **future idea** needing an external book API.

- **Complexity:** Medium. **Best served by:** AI-assist / integration.

**LIB-03 · Reading recommendations** · librarian, student · Chat

A **future idea**. Low priority.

### B.8 Storekeeper (with bursar)

**STK-01 · Low-stock and reorder alerts** · storekeeper · Background

- **Today:** `StoreItem.reorderLevel` exists and `lowStockItemCount` (`store.service.ts:89`) computes the count [V]. No push or email alert was found [A].
- **Steps:** notify the storekeeper when an item crosses its reorder level.
- **Missing:** the notification only.
- **Complexity:** Low. **Readiness:** Ready.
- **Best served by:** Automation.

**STK-02 · Stock-take variance explanation** · storekeeper (count), bursar (approve) · In-screen

1. **Who:** storekeeper, bursar.
2. **Today:** start → counts → submit (`:631`) → approve by the bursar (separation of duties).
3. **Trigger:** submit.
4. **Steps:** summarise the variances with the movements since the last count, and highlight large or valuable gaps for the approver.
5. **Data and services:** `store.getStockTake`, `listMovements`.
6. **Reuse:** all of it.
7. **Missing:** none material.
8. **Permissions:** `store.approve` (bursar). Approval stays human.
9. **Benefit:** medium.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** Automation (+ optional narration).

**STK-03 · Asset register upkeep** · storekeeper

- Low value.
- **Best served by:** UX.

### B.9 House master (boarding)

**HM-01 · Exeat handling and overdue returns** · house_master (and parent request, admin) · see **C-6**

**HM-02 · Boarding questions** · house_master · Chat

- **Example:** "Who in Unity House is out on exeat right now?"
- **Reuse:** `hostel-house.boarders`, `hostel-exeat.list`.
- **Best served by:** UX (filters). Low agent value.

### B.10 Appointed messaging roles: principal, head teacher, inbox officer

**MSG-01 · Inbox triage, routing and drafting** · see **C-7**

### B.11 Parents and guardians

Parents use the portal (web) and the parent app. All their reads are scoped to their own linked children through `GuardianAuthGuard` and `StudentGuardian` links [V].

**P-01 · Parent assistant ("ask about my child")** · guardian · Chat (app + portal)

1. **Who:** guardian.
2. **Today:** parents open separate screens for results, timetable, homework, fees, calendar, announcements and messages. Many ask the school on WhatsApp instead [A].
3. **Example:** "Did Ada go to school today? What homework does she have? When does term end? How much do I still owe?"
4. **Steps:**
   1. Resolve the child from the guardian's links; never accept an ID from the model.
   2. Call the guardian-scoped reads.
   3. Answer with deep links.
   4. For anything it cannot answer, offer to message the right staff (C-7).
5. **Data and services:**
   - `portal-students`
   - `homework.forGuardianChild`
   - `portal-invoices.listForStudent`
   - `calendar.getGuardianCalendar`
   - `announcements.guardianFeed`
   - `released-results`
   - `transportForGuardian`, `libraryForGuardian`, `hostel-exeat.listForGuardian`

   Attendance for a guardian is **[A]**: no portal attendance-history endpoint was found; only the absence push exists.
6. **Reuse:** the guardian-scoped service methods above.
7. **Missing:**
   - P-TOOLS;
   - P-PII (the child's name is the parent's own data, but the hard rule still applies to "derived features": decision F-2);
   - a guardian attendance read;
   - multilingual answers (F-9).
8. **Permissions:** guardian scope. Read-only, plus a "start a message" hand-off.
9. **Benefit:** high frequency; deflects calls to the school office.
10. **Complexity:** High.
11. **Readiness:** Blocked.
12. **Best served by:** Agent.

**P-02 · Pay fees / set up a payment plan** · guardian · In-screen

- **Today:** pay online through Paystack (the mobile round-trip has never been tested on a real phone [D]), or see the bank details.
- **Agent steps:** none. An agent may explain the balance (B-05) and deep-link to pay; it must never initiate payment.
- **Best served by:** UX.

**P-03 · Weekly child summary** · guardian · Background

- **Built** (`parent-summaries`, school opt-in).
- Extension: let the parent ask follow-up questions (P-01).
- **Best served by:** existing AI-assist.

**P-04 · Understand a report card** · guardian · Chat + In-screen

1. **Who:** guardian.
2. **Today:** released results; result-checker PIN unlock.
3. **Example:** "What does 'B3' mean, and how can she improve in maths?"
4. **Steps:** explain the grading scale from the school's own scheme; show the trend over terms (computed); give general study guidance.
5. **Data and services:** `released-results`, `grading`.
6. **Reuse:** the result APIs.
7. **Missing:** P-PII; care with tone; never re-interpret the teacher's comment as a new judgement.
8. **Permissions:** guardian scope; released cards only.
9. **Benefit:** medium, three times a year.
10. **Complexity:** Medium.
11. **Readiness:** Blocked.
12. **Best served by:** Agent / UX.

**P-05 · Message the right person** · guardian · see **C-7**

**P-06 · Exeat request** · see **C-6**

**P-07 · Admissions applicant** (public, not yet a guardian) · see **C-3**

The applicant's side is: form help, document checklist, tracking and offer acceptance.

**P-08 · Parent onboarding** · guardian · In-screen

1. **Who:** guardian.
2. **Today:** invitation → set password → consent (versioned) → app install → optionally issue the child's student-account invitation (`student-access.issueInvitation`, `:143`).
3. **Trigger:** first sign-in.
4. **Steps:** a guided checklist; explain each choice (notifications, the child's account).
5. **Data and services:** `portal-auth`, `data-protection.consentGuardian`, `student-access`.
6. **Reuse:** all of it.
7. **Missing:** none for UX. An agent is unnecessary.
8. **Permissions:** consent must be recorded with its version (hard rule). An agent must not tick consent on anyone's behalf.
9. **Benefit:** medium.
10. **Complexity:** Low.
11. **Readiness:** Ready.
12. **Best served by:** UX.

**P-09 · Event RSVP** · built, and automated. Not an agent candidate.

### B.12 Students

Students are children. Any student-facing AI needs a child-safety design (F-8).

**S-01 · AI tutor** · student · Chat

1. **Who:** student.
2. **Today:** a **placeholder screen** [V] (`apps/mobile/app/me/tutor.tsx`). It is deliberately off until the school's curriculum is behind it.
3. **Example:** "I don't understand simultaneous equations."
4. **Steps:** retrieve the school's scheme of work for the child's level and subject; explain step by step; practise questions (approved bank items); never complete assessed work.
5. **Data and services:** `curriculum-retrieval`, `question-bank` (approved items), `AIInteractionLog`.
6. **Reuse:** RAG retrieval, the interaction log, the budget.
7. **Missing:**
   - curriculum coverage per school;
   - safeguarding (self-harm, abuse disclosures, escalation);
   - an anti-cheating policy against open assignments and CBT;
   - age-appropriate evals;
   - the NDPR review [D];
   - per-student cost caps.
8. **Permissions:** student scope. No PII is needed: level and subject only.
9. **Benefit:** high (it is a named product pillar).
10. **Complexity:** High.
11. **Readiness:** Blocked.
12. **Best served by:** Agent. **A future product feature.**

**S-02 · Study planner** · student · Chat + Background

1. **Who:** student.
2. **Today:** separate homework, assignments, timetable and CBT screens.
3. **Example:** "What's due this week? Make me a revision plan for exams."
4. **Steps:** gather what is due; build a plan; remind.
5. **Data and services:** `homework.forStudentSelf`, `assignments.listForStudent`, `timetable`, `cbt` (sittings for the student [A]), the calendar.
6. **Reuse:** the reads.
7. **Missing:** P-TOOLS.
8. **Permissions:** student scope.
9. **Benefit:** medium.
10. **Complexity:** Medium.
11. **Readiness:** Ext.
12. **Best served by:** Automation (a "due this week" list) first; then Agent.

**S-03 · Assignment submission help** · student · In-screen

- Show the due work, submission status and file checks.
- **Must not** generate answers.
- **Best served by:** UX.

**S-04 · Results explanation** · student

Same as P-04, in a student version. **Best served by:** UX / Agent later.

**S-05 · Library and resources** · student

Low value. **Best served by:** UX.

### B.13 Platform admin (SchoolKit operations)

**PA-01 · Activation monitoring and outreach** · platform admin · Background + Chat

1. **Who:** platform admin.
2. **Today:**
   - the "Getting started" list per school (`docs/modules/activation.md`);
   - activation emails (`activation.service.ts:191` `sendDue`);
   - setup-call bookings with WhatsApp alerts to the team;
   - the activity dashboard.
3. **Example:** "Which schools signed up this month but haven't enrolled students? Draft a check-in."
4. **Steps:** rank the schools by stall point; draft personalised outreach; a human sends it.
5. **Data and services:** `activation-platform.list`, `onboarding-call-platform.listAll`, `platform_admin_list_schools`.
6. **Reuse:** all of it.
7. **Missing:** an outreach channel log.
8. **Permissions:** platform admin. Cross-tenant data stays aggregate (SECURITY DEFINER discipline).
9. **Benefit:** medium (business growth).
10. **Complexity:** Low–Medium.
11. **Readiness:** Ready.
12. **Best served by:** AI-assist.

**PA-02 · Support diagnostics** · platform admin · Chat

1. **Who:** platform admin.
2. **Today:** no impersonation; a decision is pending [D].
3. **Example:** "Why can't school X's teacher see the JSS2 gradebook?"
4. **Steps:** inspect the setup state, the teacher's assignments, enrolment counts and term. Explain using counts only.
5. **Data and services:** setup-state, teacher-scope.
6. **Reuse:** the setup state.
7. **Missing:** **a cross-tenant support access decision** (impersonation, audit, consent).
8. **Permissions:** must be audited and consented.
9. **Benefit:** high for a solo operator.
10. **Complexity:** Medium.
11. **Readiness:** Blocked.
12. **Best served by:** Agent.

**PA-03 · Operations queues** · platform admin · In-screen

Covers Paystack setup requests, SMS sender decisions and website reports.

- Low volume.
- **Best served by:** UX.

### B.14 Future product ideas (no current capability to build on)

These are kept apart from the inventory above, because each needs a new module before any agent work.

| Idea | Why it is "future" | Evidence |
|---|---|---|
| AI tutor (S-01) | Placeholder only; curriculum, safeguarding and legal review are prerequisites | [V] `me/tutor.tsx` |
| Timetable auto-generation (L-08) | No solver | [V] |
| Bank-statement reconciliation (B-04) | No statement import | [V] |
| WhatsApp conversations with families | Only team alerts exist; family WhatsApp is "its own later module" | [V] `common/whatsapp/whatsapp-cloud.ts`; [D] `deferred.md` |
| Parent health-profile updates (HO-02) | Portal health is GET-only | [V] |
| Mastery tracking and adaptive practice | `MasteryRecord` model unused | [V] |
| Outcome analytics | Waiting on a data-sufficiency trigger | [D] `deferred.md` §5 |
| Multi-campus agents | No `branchId` on operational tables | [V] |
| Parent store ordering | Price list only | [D] |
| Voice and local-language input (Pidgin, Yoruba, Igbo, Hausa) | No speech pipeline | [A] |
| Library ISBN lookup (LIB-02) | No integration | [V] |
| Staff-to-staff messaging (needed by L-04, C-1) | Messaging is parent↔staff | [A] |
| Audit history viewer (L-13) | No read API | [V] |

---

## C. Cross-role workflows and handoffs

Each workflow is described once, with each role's part. The agent's job across these is mostly **coordination**: knowing whose turn it is, nudging them, and preparing their step. It does not do the step itself.

### C-1 · Report-card pipeline (the most important cross-role workflow)

**States** [V] (`ReportCardStatus`): `DRAFT` → `SUBJECT_REVIEWED` → `FORM_REVIEWED` → `PRINCIPAL_APPROVED` → `RELEASED`.

| Step | Role | Today | Agent opportunity | Gate |
|---|---|---|---|---|
| 1. Enter scores | Subject teacher | Gradebook, paste preview | T-03 extraction (blocked by policy), T-04 checks | Teacher saves |
| 2. Sign off subject | Subject teacher | `signOff` per column or subject | T-04 pre-sign-off check | Human |
| 3. Aggregate and build | Admin / form teacher | `aggregate`, `build` (`report-card.service.ts:71`); cascade to SUBJECT_REVIEWED | Auto-detect "ready to build" | — |
| 4. Subject comments | Subject teacher | AI batch + accept (built) | T-05 refinement | Teacher accepts (hard rule) |
| 5. Form comments and review | Form teacher | AI batch (`form-comments`) + `form-review` | FT-01: chase missing sign-offs from subject teachers | Human |
| 6. Principal approval | Owner/admin (`principal-approve`) | Board + mobile approvals | L-05 anomaly review | **Human only** |
| 7. Render and release | Admin | Render queue → release → `resultsReleased` push | Confirm render complete, then release reminder | **Human only** |
| 8. Result access | Parent / student | Portal, app, result checker (PINs) | P-04 explanation | PIN redemption |
| 9. Promotion decision | Principal approval sets `promotionStatus` | — | Feeds C-9 | — |

**Handoff friction today:** nobody is told when it is their turn. Only "marks not entered" (T−7 days) is automated [V].

**Coordinator agent (L-04):** watches the state per arm and nudges the next owner. It escalates stuck arms to the admin.

### C-2 · Fee cycle: bill → collect → receipt → chase

| Step | Role | Today | Agent opportunity | Gate |
|---|---|---|---|---|
| 1. Fee structure | Bursar/admin | Fee catalogue, discounts | B-11 copy-forward | Approval |
| 2. Ancillary charges | Admin (transport, hostel), bursar (store) | `student-charge.raise` from placements and sales | B-09 unbilled detection | — |
| 3. Generate invoices | Bursar/admin | `previewForArm` → `generateForArm` per arm | Run all arms: preview → exception report (no fee items for a level, students without enrolment, discounts stacking) → one approval | **Human approves the run** |
| 4. Notify parents | System | Invoices visible in the portal [V]; **no "invoice issued" notification** [A] | New event | — |
| 5. Pay | Parent | Paystack (webhook is the authority) or bank transfer | P-01/B-05 explanations | Parent |
| 6. Record offline payment | Bursar | `recordManual` | B-03 extraction (blocked by policy) | Human confirms |
| 7. Receipt and confirmation | System | Receipt PDF; `paymentRecorded` push | — | — |
| 8. Overdue | System | Nightly overdue transition | — | — |
| 9. Chase | Bursar | `sendReminders`, payment plans | B-02 campaigns | Approval per campaign |
| 10. Report | Owner | Finance dashboard | B-08 narration | — |

**Duplicate-prevention notes:**

- Invoice generation per arm must stay idempotent. `generateForArm` returns `{ created, skipped }` [V]. **[A]** that `skipped` covers students already invoiced for the term; verify before any agent drives it.
- Payment idempotency exists in `payments.service.ts` [V].
- Reminders must not double-send. `notification_deliveries` covers push; **[A]** reminder email and SMS dedupe.

### C-3 · Admission → student → family → bill

| Step | Role | Today | Agent opportunity |
|---|---|---|---|
| 1. Apply | Public applicant | `/apply/[slug]`, document upload, tracking link (HMAC) | Form help (low trust) |
| 2. Triage and review | Admissions officer | Review → book assessment | ADM-01 |
| 3. Offer and acceptance | Officer → applicant | Offer email, `acceptOffer` | Expiry reminders |
| 4. Admit | **Owner/admin** (`admission.admit`) | `admit` creates the student (`admission-decisions.service.ts:130`) | Prepare: check the class has space, admission number, duplicate student |
| 5. Enrol | (part of admit) | `admit` creates the enrolment for the chosen term and arm [V] (`admission-decisions.service.ts` ~L183) | — |
| 6. Link guardian and invite | Admin | `admit` links or creates the primary guardian [V]; the portal invite is a separate step (`guardians.invite`) | Prompt the invite |
| 7. Bill | Bursar | Invoice for the arm or a single student | Flag "admitted but not invoiced" |
| 8. Placement (bus, hostel) | Admin | `transport.createPlace`, `hostel.placeStudent` → charges | Checklist |

**Agent value:** a "new-student checklist" that follows each admitted child through steps 4–8 and reports what is missing. **Hybrid.**

### C-4 · Behaviour incident → discipline → parent notice

- **Teacher:** records the incident and witnesses (T-11).
- **Admin:** proposes a discipline action (`propose`, `discipline.service.ts:117`), then **decides** it (`decide`, `:192`, `behaviour.decide`).
- **Parent:** sees the `DisciplineNotice`.

**Agent opportunities:**

- incident structuring (T-11, blocked by policy);
- pattern summary for the decider (prior incidents, points) as **counts and categories only**;
- notice wording draft.

The hard rule applies: there is always a human gate. `decide` is human-only.

### C-5 · Sickbay → parent → teacher

- **Health officer:** records the visit and medication; a notice goes to the parent; may update the teacher note.
- **Form teacher:** sees only the note.

**Agent opportunities:**

- the allergy check (HO-01, automation);
- an "infection cluster" alert to the officer (several visits with the same complaint in one week) as counts. This is a **future idea**.

No LLM, by default (F-6).

### C-6 · Exeat (boarding leave)

- **Parent:** requests the exeat (`requestForGuardian`, `hostel-exeat.service.ts:168`).
- **House master or admin:** approves or refuses (`:113`).
- **Gate:** marks the student left and back.

**Gaps:**

- no overdue-return alert [A: no cron found];
- the parent is not notified on approval [A: verify].

**Best served by:** Automation.

### C-7 · Parent messaging: routing, reply, pass, flag, close

- **Parent:** starts a thread to the form teacher, class teacher, bursar, principal, head teacher or office (`portal-messages.recipients`, `start`).
- **Staff:** reply, or **pass** to a colleague (`messages.service.ts:144`). Anyone can **flag** (`:189`). Flagged threads open to admin, who clears the flag (`messages.oversee`).
- **Nightly:** quiet threads close (`closeQuiet`); deletion after 2 years.

**Agent opportunities:**

- suggest the right recipient before sending (parent side);
- draft replies grounded in records the staff member may read: for example, a bursar replying with the balance from B-05;
- suggest "pass to bursar" when the thread is about fees;
- flag-worthy content detection (safeguarding words) → human review;
- an inbox summary for the inbox officer.

**Constraints:**

- **parent messages are untrusted input** (P-INJECT);
- message bodies contain names, so sending them to the LLM breaks the PII rule unless redacted, or a new allowlist row is added (F-5);
- every send is human.

**Readiness:** Blocked (policy). **Best served by:** AI-assist.

### C-8 · Assessment content → online exam → gradebook

1. **Teacher:** question bank → exam paper → finalise.
2. **Teacher/admin:** schedule the CBT sitting (`cbt-sittings.create`, `publish`); reveal invigilator codes (audited).
3. **Student:** sits the exam on lab PCs (offline-first `apps/cbt`, `cbt-delivery.sync`).
4. **Teacher:** marks theory (`saveTheoryMarks`, `cbt-results.service.ts:46`), chooses attempts, sends scores to the gradebook.
5. **The scores then join C-1.**

**Agent opportunities:**

- T-09 paper assembly;
- a sitting readiness check (candidates, arms, paper finalised, date not clashing with the calendar);
- a theory-answer marking draft. This would reuse the `assignment-feedback` pattern, **but CBT theory is not on the allowlist**;
- a results anomaly check.

Note that CBT is **not yet live in production** [D].

### C-9 · End of year: promotion → new session → re-billing

1. **Principal approval** sets a `promotionStatus` on each card.
2. **Admin:** promotion preview (`promotions.service.ts:63`), then **commit** (`:259`). This is the single largest write in the product. A carry-over incident happened on 2026-08-25 [D].
3. **Admin:** new academic year and terms, `setCurrent`, re-check class-subjects and teacher assignments, form teachers.
4. **Bursar:** fees for the new session (B-11), then billing (C-2).
5. **Parents:** told of the new class.

**Agent opportunities:**

- explain the promotion preview's exceptions: no decision recorded, on trial, repeating, graduating, a class with no next class;
- an ordered rollover checklist with progress.

`promotion.commit` is **human only**. **Best served by:** Hybrid / Agent. **Readiness:** Ext.

### C-10 · New-school onboarding (platform → owner → staff → parents → students)

1. **Platform admin:** creates the school, or the owner signs up.
2. **Owner:** setup (L-01).
3. **Owner:** invites staff (L-06).
4. **Staff:** set up their profiles.
5. **Admin:** students — CSV import, scan or bulk grid.
6. **Admin:** guardians, then invites (L-19).
7. **Bursar:** fees (C-2).
8. **Parents:** activate (P-08).
9. **Platform admin:** monitors activation (PA-01).

An "onboarding agent" spans L-01, L-06, L-12 and L-19. **This is the strongest single candidate for a coherent first agent experience** (a judgement, see §E).

### C-11 · Staff leaving or changing role

L-17. It involves the admin, the bursar (payroll), the house master (hostel) and the messaging appointments.

### C-12 · Transport and hostel placement → charge → invoice

- **Admin:** places the student (route stop or bed).
- **System:** raises a `StudentCharge`.
- **Bursar:** bills the waiting charges (B-09).
- **Parent:** sees it.

Exception detection is the main agent value. **Best served by:** Automation.

---

## D. Shared technical prerequisites and blockers

| ID | Prerequisite | Why it matters | Current state (evidence) | Blocks |
|---|---|---|---|---|
| **P-TOOLS** | Tool use and multi-turn messages in the AI port | Any real agent calls functions and loops | `AnthropicPort.create` accepts one `userContent` string, optional JSON schema and images; no `tools`, no message array, no streaming [V] `packages/ai/src/client.ts:44-86` | Every **Agent** item |
| **P-LEDGER** | Ledger rows per agent step | Hard rule: every `messages.create` call → `ai_generations`. A loop makes N calls per user turn. | `AiGenerationService` logs one row per call [V]; the reservation estimate is per call; there is no per-conversation budget | All agents |
| **P-REGISTRY** | A typed tool registry that wraps **services** (not controllers), with permission and scope checks | `@Permissions` is enforced only by `PermissionsGuard` at the controller [V]. Services apply **scope** (teacher scope, guardian links) but mostly **not permission**: a grep found 0 `hasPermission` calls in services [V]. A tool calling a service directly would skip the permission gate. | `userHoldsPermission(authCtx, perm)` exists [V] (`common/auth/role-check.ts:85`), as does `assertUserActiveAndHasOneOf` | All agents |
| **P-PII** | A PII strategy for conversational agents | Hard rule: no student PII to the LLM for derived features; the allowlist is two prompt names | Insights shows the working pattern: the model sees labels and counts; SQL returns named rows straight to the UI [V]. A general agent needs **opaque handles** (`student#7f3a`) resolved server-side and rendered client-side, plus redaction of free text (messages, narratives) | L-02, P-01, T-13, B-03, B-05, T-03, T-11, C-7 |
| **P-APPROVE** | A proposal → approve → execute primitive | Hard rules require human gates; writes must be previewable | Many preview/commit pairs exist (A.4) [V], but each is bespoke. There is no generic "pending agent action" record, expiry or approver routing [V: no such model among the 157]. | Every write workflow |
| **P-AUDIT** | Audit identity for agent actions | Who did it: the person, through the agent? | `AuditLog` has `userId`, `action`, `entityType`, `entityId`, `metadata` [V]; no `actor_kind` or `via` field; 109 files write audit rows inline, with no central helper [V] | All writes; L-13 |
| **P-IDEMP** | Idempotency on writes an agent may retry | Agents retry; models repeat calls | Idempotency logic only in enrolments, aggregation, payroll, payments, parent summaries and curriculum workers [V]. Most CRUD has none. | Bulk and multi-step writes (L-01, L-06, L-17, C-2) |
| **P-INJECT** | Prompt-injection defence for untrusted text | Parent messages, admission forms, uploaded curricula and student answers can contain instructions | The existing prompts take structured input; `assignment-feedback` handles child text but has no tools [A] | C-7, ADM-01, T-08, T-14, any agent reading free text |
| **P-CONV** | Conversation storage and retention | Multi-turn context; NDPR retention | `AIInteractionLog` exists with a PII-free `payload` [V]; a retention policy for chats is undefined | All Chat items |
| **P-UI** | Chat surfaces on web, portal and mobile, with streaming and rendering of tool results (tables, links, approval cards) | — | None. The command palette is navigation-only [V]. | All Chat items |
| **P-EVAL** | Evals per prompt/agent (`pnpm ai:eval` required before any prompt PR) | Agents need task-success and safety evals | Eval harness exists in `packages/ai` [D]; no agent evals | All AI items |
| **P-LEGAL** | NDPR review of third-party AI processing | Gates the curriculum and tutor work and any expansion of PII | Drafted, awaiting the owner's signature [D] (`docs/legal/ndpr-ai-review.md`) | S-01, any PII expansion |
| **P-BUDGET** | Cost model for agents | Agents use many more tokens per task than single drafts | 2M tokens/school/month default; 200 calls/user/day [V]; plan limits on AI (Free tier loses AI comments under `enforce`) [D] | All agents |
| **P-MODELS** | Model choice | Agent planning may need a stronger model than Haiku | Only Haiku 4.5 and Sonnet 5 are registered [V] | Agents |
| **P-NOTIFY** | Outbound channels | Background agents need to reach people | Push rail is solid [V]; email via Resend [V]; SMS waits on the CAC sender name [D]; no WhatsApp to families [V]; no staff-to-staff messaging [A] | L-04, B-02, L-19, FT-02 |
| **P-CRON** | A scheduler for per-school agent tasks | Background assistance | Cron sweeps are hard-coded per job (`@Cron`), walking all schools [V]; no per-school configurable schedules; `SCHEDULED_JOBS=off` exists for rehearsals | Background items |
| **P-AUDIT-READ** | An audit-log read API | Explaining history | None [V] | L-13 |
| **P-SAFE-CHILD** | Child-safety design for student-facing AI | Students are minors | Not designed | S-01, S-02 |
| **P-TZ** | Time zone and school days | "Today", "this week" | `computeSchoolDays` and Lagos-time conventions exist [V] | Background items |

**Tenant isolation for agents (cross-cutting, not optional):**

- every tool call runs through `withTenant(authCtx.schoolId, …)` / `getTenantPrisma`, under RLS, as `app_user` [V];
- the model must never supply `schoolId`;
- IDs the model passes back must be re-resolved and re-validated against the caller's tenant and scope. The insights design already refuses model-supplied IDs [V];
- no new SECURITY DEFINER function should be needed for tenant-side agents;
- the platform-admin agent (PA-02) is the exception, and needs its own decision.

---

## E. Prioritisation matrix

**Scales:**

- **Value**: user value. H, M or L.
- **Freq**: how often the work happens. D = daily, W = weekly, T = per term, Y = yearly.
- **Effort**: the complexity from field 10. L, M or H.
- **Risk**: harm if it goes wrong, covering money, academic records, child data and external communications. L, M or H.
- **Deps**: prerequisites from §D.

This is an input for phasing, not a phase plan.

| ID | Workflow | Mode | Value | Freq | Effort | Risk | Deps | Readiness | Best served by |
|---|---|---|---|---|---|---|---|---|---|
| L-01 | Setup copilot | Chat | H | Y (per school) | M | M | TOOLS, REGISTRY, APPROVE, IDEMP | Ext | Agent |
| L-02 | Ask the school | Chat | H | D | H | M | TOOLS, REGISTRY, PII, UI, CONV | Blocked | Agent |
| L-03 | Morning brief | Bg | H | D | L | L | NOTIFY | Ready | Automation |
| L-04 | Term close-out coordinator | Bg+Chat | H | T | M | M | NOTIFY (staff), APPROVE | Ext | Hybrid |
| L-05 | Approval anomaly review | In-screen | H | T | M | L | — | Ext | Hybrid |
| L-06 | Bulk staff onboarding | Chat | M | Y | M | M | TOOLS, APPROVE, IDEMP, PII (staff) | Ext | Agent |
| L-07 | Staffing gaps | Bg | M | T | L | L | — | Ready | Automation |
| L-08 | Timetable solver | Chat | H | Y | H | M | Solver | Blocked | Automation (future) |
| L-09 | Announcement drafts | In-screen | M | W | L | M (external) | EVAL | Ext | AI-assist |
| L-10 | Event + RSVP | Chat | L | T | L | L | — | Ready | UX |
| L-12 | Data-quality sweeps | Bg | H | W | M | L (read) / H (merge) | — | Ext | Automation |
| L-13 | Record history | Chat | M | W | M | L | AUDIT-READ | Blocked | UX + agent |
| L-14 | Analytics narration | In-screen | M | T | L | L | EVAL | Ext | AI-assist |
| L-15 | Settings/help explainer | Chat | M | W | M | L | UI, help index | Ext | Agent |
| L-16 | Website drafts | In-screen | L | W | L | M | EVAL | Ext | AI-assist |
| L-17 | Staff offboarding | Chat | M | T | M | M | TOOLS, APPROVE | Ext | Agent |
| L-18 | Cap and budget alerts | Bg | L | M | L | L | — | Ready | Automation |
| L-19 | Parent adoption drive | Bg | H | W | L | M (external) | NOTIFY | Ready | Automation + UX |
| L-22 | Deletion request tracking | Bg | M | rare | M | H (legal) | LEGAL | Ext | Automation |
| ADM-01 | Admission triage | Bg+In-screen | M | seasonal D | M | M | INJECT | Ext | Automation + AI-assist |
| T-01 | Teacher day brief | Bg | H | D | L | L | — | Ready | Automation |
| T-02 | Register by exception | In-screen | M | D | L | L | — | Ready | UX |
| T-03 | Scores from a mark sheet | In-screen | H | T | M | H (grades) | PII allowlist, EVAL | Blocked | AI-assist |
| T-04 | Pre-sign-off check | In-screen | H | T | L | L | — | Ready | Automation |
| T-05 | Comment refinement | In-screen | M | T | L | M | — | Ready | UX |
| T-06 | Term lesson plans | In-screen | H | T | M | L | BUDGET | Ext | AI-assist |
| T-07 | Homework from plan | In-screen | L | W | L | L | — | Ready | UX |
| T-08 | Marking review queue | In-screen | H | W | L–M | M (grades) | — | Ready | UX + AI-assist |
| T-09 | Exam paper assembly | Chat | H | T | M | M | TOOLS, BUDGET | Ext | Agent |
| T-11 | Behaviour from narrative | In-screen | M | W | M | H (records) | PII | Blocked | AI-assist / UX |
| T-13 | Student context | Chat | M | W | M | M | TOOLS, PII | Blocked | Agent |
| T-14 | Curriculum labelling | In-screen | M | T | L–M | L | INJECT | Ext | AI-assist |
| FT-02 | Wellbeing watch | Bg | H | W | L–M | M (health) | policy F-6 | Ext | Automation |
| FT-03 | Teacher-initiated parent message | Chat | M | W | L | M | permission decision | Blocked | Product change |
| B-02 | Debtor campaigns | Bg+Chat | H | W | M | H (money, external) | NOTIFY, APPROVE | Ext | Automation + agent |
| B-03 | Payment from teller slip | In-screen | H | D | M | H (money) | PII allowlist | Blocked | AI-assist |
| B-04 | Bank reconciliation | Bg | H | D | H | H | new module | Blocked | Automation (future) |
| B-05 | Explain a balance | Chat | M | D | M | M | TOOLS, PII | Blocked | Agent / UX |
| B-06 | Expense receipt capture | In-screen | M | W | L–M | M | EVAL | Ext | AI-assist |
| B-07 | Payroll checks | Bg | M | Monthly | L–M | H (money) | — | Ready | Automation |
| B-08 | Finance narration | In-screen | M | W | L–M | L | EVAL | Ext | AI-assist |
| B-09 | Unbilled charges | Bg | M | W | L | L | — | Ready | Automation |
| B-11 | Fee copy-forward | Chat/UX | M | Y | L | M | APPROVE | Ext | UX |
| C-2.3 | Billing-run orchestration | In-screen | H | T | M | H | APPROVE, IDEMP | Ext | Hybrid |
| HO-01 | Allergy check | In-screen | H (safety) | D | L–M | H | vocab | Ext | Automation |
| HO-02 | Health completeness drive | Bg | M | T | M | M | parent write path | Blocked | Automation + feature |
| LIB-01 | Overdue loans | Bg | L | D | L | L | — | Ready | Automation |
| STK-01 | Reorder alerts | Bg | L | W | L | L | — | Ready | Automation |
| STK-02 | Variance summary | In-screen | M | T | L | L | — | Ready | Automation |
| C-1 | Report-card coordination | Bg | H | T | M | M | NOTIFY (staff) | Ext | Hybrid |
| C-3 | New-student checklist | Bg | M | seasonal | M | M | — | Ext | Hybrid |
| C-6 | Exeat overdue/notify | Bg | M | W | L | M (safety) | — | Ready | Automation |
| C-7 | Message triage and drafts | In-screen | H | D | M | H (external, PII) | PII, INJECT | Blocked | AI-assist |
| C-8 | CBT readiness and theory marking | In-screen | M | T | M | M | allowlist (theory) | Ext | Hybrid |
| C-9 | Year-end rollover guide | Chat | H | Y | M | H | APPROVE | Ext | Hybrid / Agent |
| P-01 | Parent assistant | Chat | H | D | H | M | TOOLS, PII, UI, CONV, multilingual | Blocked | Agent |
| P-04 | Explain a report card | Chat | M | T | M | M | TOOLS, PII | Blocked | Agent / UX |
| P-08 | Parent onboarding | In-screen | M | once | L | L | — | Ready | UX |
| S-01 | AI tutor | Chat | H | D | H | H (children) | LEGAL, SAFE-CHILD, curriculum | Blocked | Agent (future) |
| S-02 | Study planner | Chat+Bg | M | W | M | L | TOOLS | Ext | Automation → Agent |
| PA-01 | Activation outreach | Bg | M | W | L–M | L | — | Ready | AI-assist |
| PA-02 | Support diagnostics | Chat | H (ops) | D | M | H (cross-tenant) | impersonation decision | Blocked | Agent |

**Patterns visible in the matrix** (observations, not phase proposals):

1. **About 20 items need no LLM at all.** These are the Automation and UX rows marked Ready or Ext: L-03, L-07, L-18, L-19, T-01, T-04, B-07, B-09, LIB-01, STK-02, C-6, HO-01 and others. They reuse the existing cron and push rails and carry low risk.
2. **The highest-value conversational items (L-02, P-01, B-05, T-13) are all blocked on the same three prerequisites:** P-TOOLS, P-REGISTRY and P-PII. Those three are a shared foundation, not per-feature work.
3. **The highest-risk items cluster in money and grades.** These are B-03, T-03, C-2.3, B-02 and C-9. Each already has a preview → commit primitive the agent can sit in front of, without ever owning the commit.
4. **Several "agent" ideas are really UX gaps:** T-02, T-05, T-07, B-11, P-08, L-10 and L-20.

---

## F. Questions and product decisions we need from you

1. **Where does agentic work start: foundation or quick wins?**
   - **Foundation:** P-TOOLS, P-REGISTRY, P-PII, P-APPROVE, P-AUDIT.
   - **Quick wins:** the no-LLM automation set in §E pattern 1.

   This is not a phase choice; it decides which items the phase plan treats as prerequisites.
2. **PII model for conversational agents.** Are opaque handles plus server-side rendering, as in insights, the rule for every chat agent? This applies even to a parent asking about their own child. Or should parent-about-own-child become a named allowlist row? CLAUDE.md requires a named row and a sign-off for each.
3. **Who is "the principal" in practice?** `report-card.principal-approve` is held only by owner and admin. The `principal` role is messaging-only [V]. Should an agent route approvals to the appointed principal? That would need a permission change.
4. **Agent identity in the audit trail.** Should agent-initiated writes be recorded as "user X via assistant"? That needs a new audit field and touches 109 writer files, or a central helper. Or is the user's own identity enough?
5. **New allowlist rows.** Each of these sends names to the model:
   - mark-sheet photos (T-03);
   - teller slips (B-03);
   - behaviour narratives (T-11);
   - parent message drafting (C-7);
   - CBT theory marking (C-8);
   - staff lists (L-06; staff PII is not covered by the student rule, but NDPR applies).

   Which, if any, should be considered, and which are permanently off the table?
6. **Health data.** Confirm that no health content is ever sent to the LLM. Also confirm whether a form teacher may see sickbay **counts** (FT-02).
7. **Teacher-initiated parent messages** (FT-03). Should teachers get `messages.start`, or should drafts route through the inbox officer?
8. **Student-facing AI.** What safeguarding standard (escalation of disclosures, content filters, age policy), anti-cheating rules and per-student budget apply before S-01 or S-02? Does the NDPR review need to be signed first?
9. **Languages.** Should agents answer in Pidgin, Yoruba, Igbo or Hausa for parents? This affects evals and models.
10. **Channels.** Should background agents wait for SMS (CAC) or WhatsApp, or launch on push and email only?
11. **Budget and plans.** Are agent features counted against the school's existing 2M-token monthly budget? Which plans get which agent features? `PLAN_ENFORCEMENT` is still `warn`.
12. **Platform-admin support access** (PA-02). The impersonation decision is pending; an agent would inherit it.
13. **Approval routing.** Should an agent's proposal be approvable by a *different* person than the one who asked? For example: a bursar prepares a billing run, an admin approves it; a storekeeper counts, a bursar approves. The store already encodes separation of duties [V].
14. **Surfaces.** Should chat appear on staff web, staff mobile, parent portal, parent app and student app at once, or first where friction is highest? The owner is often on a phone [A].
15. **Duplicate/merge operations** (L-12). Do you want student and guardian merge as a product feature? Agents would surface duplicates but should not merge without it.
16. **Model choice.** Is a stronger model acceptable for agent planning, at higher cost, with Haiku kept for drafts? Only Haiku 4.5 and Sonnet 5 are registered today.

---

## Appendix: things checked and found absent (verified negatives)

- No tool use, message arrays or streaming in `packages/ai/src/client.ts`.
- No service references `MasteryRecord`.
- No endpoint requires `audit.read`.
- No bank-statement import or reconciliation code.
- No timetable solver.
- No WhatsApp messaging to schools or families. WhatsApp is used only for team alerts in `onboarding-call`.
- No `branchId` used by any operational service.
- The student AI tutor screen is a placeholder.
- The portal health endpoints are read-only.
- No library overdue cron.
- `principal` and `head_teacher` hold messaging permissions only.
- No permission checks inside services (grep for `hasPermission` / `requirePermission` in `*.service.ts` returned 0).
