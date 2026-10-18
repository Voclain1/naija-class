# Phase 9 — the remaining modules (plan)

**Status:** draft for the owner's review, 2026-10-14. Nothing in this document
is built. No checkpoint starts until the owner has answered the questions in §3
that it depends on.

**Scope:** items 2–10 of the 2026-10-14 gap list. The AI tutor (Phase 8b) is
excluded by the owner.

| # | Area | Source in ARCHITECTURE.md |
|---|---|---|
| 2 | Assignments: submissions and marking | §6.8 |
| 3 | Communication: messaging, WhatsApp, email broadcasts, translation | §6.9 |
| 4 | Library | §6.11 |
| 5 | Transport (no GPS) | §6.12 |
| 6 | Hostel / boarding | §6.13 |
| 7 | Health records and sickbay | §6.14 |
| 8 | Behaviour: points, incidents, discipline workflow | §6.15 |
| 9 | Reports and analytics, with exports | §6.17 |
| 10 | Online admission applications; event RSVPs; fee-default risk | §6.3, §6.16, §6.10 |

## 0. Why this document exists

This is about nine modules of work. Three of them reverse decisions already
written down and approved, and four touch children's sensitive data or money.
A plan written first catches the places where "build what the 2026 spec says"
and "what we have since decided" disagree. Catching them in review is cheaper
than finding them in a merged PR.

The rules below hold for every checkpoint. Each checkpoint also gets its own
short plan-first section, which the owner approves, before code starts. This
document is not that approval.

## 1. Ground rules for every checkpoint

1. **One checkpoint = one PR** (a large one may split into a server PR and a
   UI PR). CI must be green before merge, as for every PR so far.
2. **CLAUDE.md "Adding a new module", all 13 steps.** In order: spec →
   Prisma → migration → RLS → Nest module → Zod DTOs → service test-first →
   controller with both gates → API client → web → mobile → e2e → doc update.
3. **Tenancy:**
   - Every new table carries `school_id`, with `ENABLE` + `FORCE ROW LEVEL
     SECURITY` and the `tenant_isolation` policy.
   - Every new table gets composite `(school_id, id)` foreign keys, and a
     `*-rls.spec.ts` proving a school-A session sees nothing of school B.
   - No new SECURITY DEFINER function is expected. If one becomes necessary,
     that is a stop-and-ask, plus a row in CLAUDE.md's inventory.
4. **Two gates:**
   - `@Permissions` on the controller and `assertUserActiveAndHasOneOf` in the
     service.
   - New permissions go in their own named constant in `permissions.ts`.
   - Grants are pinned in `permissions-coverage.spec.ts`; every mutation is
     pinned in `audit-coverage.spec.ts`.
5. **Money:**
   - Every charge is `Int` kobo, created and changed only through the finance
     service, and audited.
   - The frontend never computes a fee, fine or balance.
6. **AI:**
   - Every new prompt goes in the registry with a version, through
     `AiGenerationService` (budget first, then the `ai_generations` row).
   - Every new prompt is covered by `pnpm ai:eval`, and nothing is
     auto-final.
   - No student name or other PII goes to the model. The one-prompt PII
     allowlist does not grow without a separate, explicit sign-off (§3, Q6).
7. **Sensitive records** (health, behaviour, discipline):
   - Reads are audited, as behaviour reads already are.
   - The free text never goes into audit metadata.
   - Who may read is pinned in a spec.
8. **Surfaces:**
   - Every staff feature lands on the web and in the app in the same
     checkpoint, unless §3 agrees it is web-only. That avoids a second
     pre-build audit.
   - The phone-fit e2e check runs on every new page, at 320px and 390px.
9. **Docs:** each checkpoint closes with an "as built" section here and a
   `deferred.md` entry for anything left out.

## 2. Earlier decisions this work collides with

These are written, approved decisions. The spec asks for things they rule
out. The owner chooses; I will not quietly override any of them.

| Earlier decision | Where | What the spec asks for | Conflict |
|---|---|---|---|
| **D11** — "No general messaging. Not now, possibly not ever" | the-school-day.md | Parent ↔ teacher and teacher ↔ teacher messaging (§6.9) | Direct. D11 cites safeguarding duty, moderation, retention and support load. |
| **D13** — a reply path, if ever, is parent → admin inbox only, never a child | the-school-day.md | Parent ↔ teacher threads | Partial. D13 allows a narrow parent → school inbox. |
| **C14** — behaviour records are internal; parents never see them | the-school-day.md | "Parent notification on serious incidents" (§6.15) | Direct. C14 says parent visibility needs a right-of-reply design first. |
| **C15** — no AI anywhere near behaviour | the-school-day.md | Nothing in §6.15 asks for AI | None. Recorded so no checkpoint adds any. |
| **Phase 8 D4** — no RSVP in v1 | phase-8.md | Event RSVPs (§6.16) | v1 is over, so this is an extension, not a reversal. |
| **PII hard rule** — no student PII to the model for derived features | CLAUDE.md | AI translation of teacher messages; AI essay feedback | Messages and essays contain children's names. See Q6. |

## 3. Questions for the owner (answer before the checkpoint that needs them)

Each question has my recommendation. "Needed by" names the first checkpoint
blocked by it.

| Q | Question | My recommendation | Needed by |
|---|---|---|---|
| Q1 | **Messaging scope.** Reverse D11 fully (parent ↔ teacher, teacher ↔ teacher), or the D13 shape (parent → school inbox, answered by the admin)? | **D13 shape first**: one inbox per school, any staff member with the permission answers as "the school", never a child, all threads visible to admins. Teacher ↔ teacher only if you want it; it is lower risk than parent ↔ teacher. | CP8 |
| Q2 | **Parent notice of serious incidents** (reverses C14 in part). | Yes, but narrowly. Only a **discipline action** (suspension and above) that an admin has approved sends the parent a factual notice: dates and the action, not the teacher's note. Ordinary records stay internal. **Owner, 2026-10-15: approved as recommended.** | CP2 |
| Q3 | **Health records: who may read.** | Owner, admin and a new **school nurse** role (sickbay). Teachers see only an "allergies and conditions" line, for safety on trips and in class, and never the sickbay log. Every read audited. **Owner, 2026-10-15:** the role is called **health officer**, not nurse. Owner, admin, health officer and the child's **parent** may read. A teacher sees only what the health officer chooses to share with teachers (for example the allergies line or a summary), never the rest. | CP3 |
| Q4 | **Transport, library and hostel fees.** Invoices are one per student per term and cannot have lines added after issue. | A new **student charge** primitive (§4, CP5). Charges are created through the finance service, then picked up by the next invoice run, or issued as a small "supplementary invoice" per charge if you approve one. **Owner, 2026-10-14 (transport):** the admin sets each route's fee on that route's own page; the fee is not typed per student. **Owner, 2026-10-16: supplementary invoices yes**, issued only when the bursar presses **Bill waiting charges** (§13 CP5-D3). | CP5 |
| Q5 | **WhatsApp Business.** Needs a Meta-approved business number and a provider (Termii proxies it). That is your side, not code. | Build the channel behind a per-school switch with SMS fallback, but only once you have an approved number. Until then, keep the `wa.me` share links that already work. | CP9 |
| Q6 | **AI and children's text** (essay feedback, message translation). **Owner, 2026-10-14:** students get no AI writing help of any kind; they type or paste their own work. **Owner, 2026-10-14: approved** for teachers — AI may draft marking feedback, name removed, teacher approves (CP4b). The `assignment-feedback` allowlist row is added to `CLAUDE.md` in CP4b's own PR, as a visible edit. Translation stays unbuilt. Both send text that may name children. | **Essays:** strip the student's own name and send only the answer text, under a new prompt that **you** add to the allowlist table by name. Feedback is a draft the teacher approves. **Translation:** do not build until you have decided; it is the weaker case (a parent can use their phone's own translator), and it would be a second allowlist row. | CP4b, CP9 |
| Q7 | **Detecting AI-written student work** (spec §6.8). | **Do not build.** These detectors are unreliable, and a false "you cheated" against a child is a real harm. Offer the in-class similarity check (plagiarism between submissions) instead. **Owner, 2026-10-14:** no detector. Approved instead: the similarity check, and a **paste indicator** (the teacher sees how much of a typed answer was pasted rather than typed — a fact, never an accusation, and it never changes a mark). | CP4 |
| Q8 | **Students uploading files** (photos of handwritten work). The student account has no upload today. | Yes, from the app only, images and PDF up to 10 MB, three files per submission. They are stored privately and visible only to the teacher, admin, the student and that student's linked guardians. **Owner, 2026-10-16: approved as recommended.** | CP4 |
| Q9 | **Online admissions: public form.** Strangers can submit a child's details and documents. | Yes, behind a per-school switch, with rate limits, a hidden honeypot field (new; nothing in the codebase uses one yet), an NDPR consent tickbox, and a 90-day purge of rejected applications. Accepting creates the student through the existing create path. | CP7 |
| Q10 | **Fee-default risk** (spec says AI). | **Rules, not AI.** A transparent score from payment history (late terms, part-payments, current balance), shown only to owner, admin and bursar, with the reasons listed. No family data goes to a model. | CP10 |
| Q11 | **Excel export** needs one new library (`exceljs`, MIT). | Yes. CSV stays the default. **Owner, 2026-10-14: approved, and PDF too wherever possible.** | CP1 |
| Q12 | **Order.** §5 proposes an order by value and risk. | Approve or reorder. **Owner, 2026-10-14: approved as listed.** | — |

## 4. Shared pieces built once, before the modules that need them

- **F1. Private file attachments.**
  - A storage key kind per use: `submission-file`, `health-document`,
    `admission-document`, `library-resource`.
  - The existing multipart path (Multer, size cap), with `uploadMultipart` on
    mobile.
  - Short-TTL presigned GET, as for receipts.
  - Built with CP4 and reused by CP3, CP6 and CP7.
- **F2. Student charges** (needs Q4). A `student_charges` table holds:
  - the student and term;
  - the kind (TRANSPORT, LIBRARY_FINE, HOSTEL, OTHER) and the amount in kobo;
  - the source module and source id, created and voided only through the
    finance service, with audit.

  The invoice snapshot includes open charges when an invoice is generated.
  Charges raised after issue become a supplementary invoice, if Q4 approves
  it. Built in CP5 and reused by library, transport and hostel.
- **F3. Exports.**
  - A server-side tabular export helper (CSV and, with Q11, XLSX).
  - The existing Puppeteer renderer for PDF.
  - Built in CP1 and reused by every list that needs exporting.

## 5. Checkpoints, in the proposed order

Estimates are working days for engineering only, with the same review and
manual-gate rhythm as Phase 8. They are honest ranges, not promises; Phase 8's
own estimates ran over.

| CP | What | Depends on | Estimate |
|---|---|---|---|
| CP1 | Reports and analytics, with exports (F3) | Q11 | 6–9 |
| CP2 | Behaviour: points, incidents, discipline workflow | Q2 | 6–8 |
| CP3 | Health records and sickbay | Q3, F1 | 6–8 |
| CP4 | Assignments: submissions, manual and automatic marking, similarity check (F1) | Q7, Q8 | 10–14 |
| CP4b | AI-assisted marking (draft feedback) | Q6 | 4–6 |
| CP5 | Student charges (F2), then Transport (no GPS) | Q4 | 8–11 |
| CP6 | Library | F1, F2 | 6–8 |
| CP6b | Hostel / boarding | F2, CP3 | 7–10 |
| CP7 | Online admission applications | Q9, F1 | 7–9 |
| CP8 | Messaging (shape per Q1), email broadcasts | Q1 | 8–14 |
| CP9 | WhatsApp channel; translation (only if approved) | Q5, Q6 | 4–8 |
| CP10 | Event RSVPs; fee-default risk (rules) | Q10 | 5–7 |
| | **Total** | | **≈ 77–112 working days** |

The order puts the lowest risk and highest daily use first:
- **CP1** uses data schools already enter.
- **CP2–CP3** extend records that exist.

Money (CP5) comes after the shared primitive is reviewed on its own.
Messaging, which needs the most policy, comes late.

### CP1 — Reports and analytics, with exports

- **Academic:**
  - class and subject averages per term;
  - a subject × class heatmap;
  - top and bottom students per class (owner/admin only);
  - term-on-term movement.

  All of it reads released assessment totals only, never drafts.
- **Attendance:** weekly trend per class, chronic absence (below a threshold
  the school sets), and days with no register.
- **Enrolment:** this term against the last, by level, with joiners and
  leavers.
- **Teacher views:** recording completeness per teacher; the report exists,
  and this adds a trend. Owner/admin only. It shows what was recorded and
  never ranks teachers by their pupils' marks.
- **Exports:** CSV and XLSX for every table, and PDF for the summary pages.
- **Surfaces:** web `/reports` tabs. The app gets the summaries without the
  heatmap (it does not fit a phone well; the app links to the web for it).
- **Tests:** aggregates against seeded fixtures with known answers, RLS, the
  export round-trip, and the phone-fit check.

### CP2 — Behaviour: points, incidents, discipline workflow

- **Points:**
  - The school turns points on or off and sets a value per category (for
    example "Helping others +2", "Late to class −1").
  - Each record may carry a category and its points; a term total per
    student.
  - C16 stays: commendations as well as concerns.
- **Incidents:** a record with a date, place, the students involved (more
  than one) and witnesses (staff names). The free text stays as it is today.
- **Discipline workflow:** Warning → Detention → Suspension (dates) →
  Exclusion.
  - The teacher proposes; an owner or admin approves or rejects with a reason.
  - Withdrawable, not deletable.
- **Parents** (only with Q2 approved): an approved suspension or exclusion
  sends the guardian a factual notice (action and dates) by push, then SMS.
  The parent never sees notes or incident text.
- **C15 holds:** no AI.
- **Tests:**
  - A teacher cannot approve their own proposal.
  - Parent notice fires only on approval and carries no note text.
  - Reads are audited.

### CP3 — Health records and sickbay

- **Medical profile:**
  - allergies, conditions, medication, GP or clinic, emergency notes;
  - vaccination records (name, date, optional document via F1).

  The existing `bloodGroup` and `medicalNotes` move into the profile with a
  data migration.
- **Sickbay log:** visit time, complaint, action taken, medication given
  (name, dose, time, given by), and sent home or not.
- **Parents** are told of a visit by push (SMS if no app), with time and
  "visited the sickbay", and details only if the nurse ticks "share details".
- **Access** per Q3:
  - a new `nurse` role;
  - teachers see a one-line safety summary;
  - every read is audited;
  - the bursar has none.
- **Tests:** access per role pinned, read audit, and parent notice content.

### CP4 — Assignments: submissions and marking

This builds on the homework board without changing what is already shipped.
A homework item gets an optional "**collect work**" switch, which turns it
into an assignment.

- **Students** submit typed or pasted text, or files from the app (Q8),
  before or after the due date; late work is marked as late. There is no AI
  writing help for students anywhere (owner, 2026-10-14).
- **Questions:** multiple choice and fill-in-the-blank, reusing the question
  bank's shapes.
  - Marked automatically.
  - Fill-in answers match a teacher-given list, ignoring case and spaces.
- **Manual marking:** a mark out of the total and written feedback per
  submission. The teacher can return work for resubmission.
- **Gradebook:** an assignment can feed a gradebook column, scaled by the
  same "out of" rule (D60), with a preview first, as online exams do.
- **Similarity check** (Q7): flags pairs of typed submissions in the same
  class whose text overlaps strongly. Teacher-only, worded as "look at these
  two", never "plagiarised".
- **Paste indicator** (Q7, owner 2026-10-14): the answer box counts typed and
  pasted characters; the teacher sees "about 80% pasted". Pasting stays
  allowed. Shown to the teacher only, never to parents, and never used in a
  mark.
- **Parents** see what is due, what was submitted, and the mark once the
  teacher releases it.
- **Surfaces:**
  - teacher: web and app;
  - student: app;
  - parent: app and portal.
- **Tests:**
  - A student sees only their own submissions.
  - Auto-marking edge cases.
  - Late flag on the Lagos date.
  - Release gates parent visibility.

### CP4b — AI-assisted marking (only with Q6 approved)

- **Scope:**
  - Teacher-requested only, per submission or per class.
  - The model sees the question, the teacher's marking guide and the answer
    text, with the student's name removed.
  - It returns a suggested mark and feedback as a **draft** that the teacher
    edits and approves. Nothing reaches the student until a person approves
    it.
- **Prompt:** a new `assignment-feedback` prompt.
  - Budget-checked and logged to `ai_generations`.
  - Eval cases for fairness (the same answer gets the same mark) and for not
    inventing errors.
  - A row in the PII allowlist only if Q6 approves it.

### CP5 — Student charges (F2), then Transport

- **F2 first, as its own reviewed PR:** charges, how invoices pick them up,
  supplementary invoices (Q4), and void with audit. All money is tested
  test-first, as finance always has been.
- **Transport:**
  - **Records:** routes with ordered pickup points, vehicles (plate,
    capacity) and drivers (name, phone, licence expiry).
  - **Assignments:** students to a route and stop per term; route capacity is
    enforced.
  - **Fees:** the admin opens a route and sets its fee there (owner,
    2026-10-14). Assigning a student to the route raises a student charge for
    that fee each term; nobody types a transport amount per student.
  - **Lists:** a daily route list for the driver, printable or in the app.
  - **Parents** see the route, stop and driver's phone.
  - **Out of scope:** GPS.

### CP6 — Library

- **Catalogue:** title, author, ISBN, copies, shelf location.
- **Issue and return** to students and staff, with a due date and renewals.
- **Overdue:**
  - Overdue lists, and an optional fine per day after a grace period.
  - The fine becomes a student charge when the book is returned or written
    off, never computed in the app.
- **Digital resources:** PDFs or links linked to a subject and class, readable
  by those students.
- **Role:** a new `librarian` role.

### CP6b — Hostel / boarding

- **Records:** hostels and rooms with bed counts; bed allocation per term,
  with no double booking; a house master per hostel.
- **Movements:**
  - A visitor log (visitor, relationship, times).
  - Leave-out (exeat) requests: the parent requests in the app, the house
    master approves, and departure and return are logged.
- **Links:** to sickbay visits (CP3). Hostel fees go through student charges.

### CP7 — Online admission applications

- **Form:** a public page per school (`/apply/<school-slug>`), switched on by
  the school (Q9).
  - It asks for the child's details, guardian contact and documents
    (passport photo, birth certificate) via F1.
  - It has an NDPR consent line.
- **Applications:**
  - Statuses: Submitted → Under review → Offered → Accepted / Rejected /
    Withdrawn.
  - An optional entrance-exam date.
  - The applicant gets status emails.
- **Accepting** creates the student and guardian through the existing create
  paths, so the admission number rule, plan limits and duplicate checks all
  apply as they do today.
- **Protections:**
  - per-address rate limits, using the existing signed-address scheme;
  - a honeypot field;
  - a file-type check;
  - rejected or withdrawn applications purged after 90 days.

### CP8 — Messaging and email broadcasts

- **Messaging** in the shape the owner chooses in Q1. In the recommended
  D13 shape:
  - **Inbox:** one inbox per school. A parent starts a thread about one of
    their children, and staff with `messages.reply` answer as the school.
  - **Oversight:** admins see every thread; threads close after a period of
    no replies.
  - **Never:** student accounts, family-to-family messages, or attachments in
    v1.
  - **Safety:**
    - a report button;
    - keyword alerts to admins for safeguarding words;
    - retention per NDPR (decided with Q1);
    - push, then SMS for "you have a reply".
- **Email broadcasts:** announcements gain an optional email channel to
  guardians with an email address, through Resend, with an unsubscribe link,
  per-school daily caps and delivery status.
- **Read state** for messages only; announcements keep A5 (no read receipts).

### CP9 — WhatsApp; translation

- **WhatsApp** (Q5): approved message templates for absence alerts, fee
  reminders and announcements.
  - It falls back to SMS when WhatsApp fails or the guardian has not opted
    in.
  - Per-school switch and cost reporting, as SMS has.
- **Translation:** build only if Q6 approves it as its own allowlisted prompt.

### CP10 — Event RSVPs; fee-default risk

- **RSVPs:**
  - The school marks an event "ask families to reply" with an optional
    deadline.
  - Guardians answer yes/no/maybe and the number attending.
  - Staff see counts and the list.
  - A reminder push goes out before the deadline.
- **Fee-default risk** (Q10):
  - A score per family from their own payment history, with the reasons
    shown ("paid late 2 of the last 3 terms").
  - On the debtors page, for owner, admin and bursar.
  - No AI and no external data. It is a prompt to talk to the family, never
    an automatic action.

## 6. Risks across the phase

- **Scale:** about four months of work. Schools are not yet using what is
  built (phase-8.md §19). Building ahead of feedback risks building the wrong
  thing. The order in §5 lets you stop after any checkpoint with nothing half
  done.
- **Sensitive data** (health, discipline, admissions, children's work):
  - The NDPR review in `deferred.md` is still open.
  - CP3, CP4 and CP7 should not go live in a school before that review
    covers them.
  - They can be built behind per-school switches, off by default.
- **New roles** (nurse, librarian) change who may log in and see what. Each
  is pinned in `permissions-coverage.spec.ts` before its screens exist.
- **Mobile:** most checkpoints add app screens, so the app needs a new build
  after each, or batched builds. The "Build the app" workflow makes that
  cheap.

## 7. What happens next

1. The owner answers Q1–Q12, all at once or as each checkpoint comes up.
2. I write CP1's own plan-first section (data, endpoints, screens, tests)
   here for approval, then build it.
3. The same for each checkpoint, in the agreed order. Each one closes with an
   "as built" section.

## 8. CP1 plan-first — Reports and analytics, with exports

Status: **approved by the owner as listed, 2026-10-14.** Build starts with CP1.1.

### 8.1 What exists today (read from the code, 2026-10-14)

- `apps/api/src/modules/reports/` serves two reports, both owner/admin only
  (`REPORTS_PERMISSIONS`) and both audited on read:
  - `GET /reports/completeness`, registers and score entry per class;
  - `GET /reports/teacher-activity`.
- The web `/reports` page shows both. The app has `staff/reports` (index, teachers).
- **CSV export exists only in the browser** (`apps/web/src/lib/csv-export.ts`).
  It is used by the reports, students, staff, invoices, debtors, expenses, PIN
  and gradebook pages. The API has no export endpoint. No Excel library exists.
- **PDF** is rendered only for report cards, by the separate render worker
  (Puppeteer, `report-cards/render/`), queued through BullMQ and stored in
  R2.
- The data the new reports need already exists:
  - **Results:** `Assessment.totalScore` per student, subject and term.
    `ReportCard.overallAverage` (hundredths) and `status = RELEASED` mark the
    released results.
  - **Attendance:** `AttendanceRecord` (one row per student per day). The rate
    rule `rateHundredths` is (present + late) ÷ days marked.
    `computeSchoolDays` gives the school days of a term.
  - **Enrolment:** `Enrollment`, one row per student per term, with its status.

### 8.2 Decisions taken here (owner may overrule any)

| D | Decision | Why |
|---|---|---|
| CP1-D1 | **Excel and PDF files are made on the server**, by one export helper. Browser CSV stays as it is. | The app needs the same files as the website. Making them once on the server means both get the same file and the web page doesn't grow by a 1 MB library. |
| CP1-D2 | **Excel files are built in the API** with `exceljs`. They download straight away. | Building a report sheet is fast (well under a second for a school), so it needs no queue. |
| CP1-D3 | **PDFs are made by the existing render worker**, as report cards are. The page shows "Preparing PDF…" and then downloads it. | Chrome lives only in the worker. Putting it in the API too would double memory on the machine that answers every request. The worker already sleeps and wakes on demand. |
| CP1-D4 | **Analytics read released results only.** A subject counts only for students whose report card for that term is RELEASED. | A draft mark that is shown in a chart, then changed, misleads. This keeps one rule: what parents can see is what the reports count. |
| CP1-D5 | **"Chronic absence" threshold is set by the school**, default 90% attendance. It is a new `schools` column, edited in Settings. | Schools differ. `schools` has no RLS policy, so this is a plain column. |
| CP1-D6 | **Who sees what.** Owner and admin see everything. Teachers, bursars and parents see none of the new reports in CP1. | This matches the reports that exist. Teacher views of their own classes can come later, if you want them. |
| CP1-D7 | **Every export is audited** (`reports.export`, with report, format and term), like the existing report reads. | An export takes children's data out of the system, so who took what, and when, is on record. |
| CP1-D8 | **No teacher league table.** The teacher view shows what each teacher recorded (registers, scores) over time, never their pupils' marks side by side. | This is the rule from §5. Ranking teachers on pupils' marks punishes those given the weakest classes. |
| CP1-D9 | **Money stays out of CP1's analytics.** Finance already has its own dashboard and debtors list; they gain Excel and PDF in step 4 below, with figures exactly as the API returns them. | The money rules: nothing is recomputed outside `FinanceService`. |

### 8.3 What gets built

**Academic tab** (term picker):
- Class and subject averages: each class's average per subject, to 2 decimal
  places, and the number of students counted.
- Subject × class heatmap on the web: cells are shaded and show the number.
- Top 5 and bottom 5 students per class, by overall average.
- Term-on-term: each class's average against the previous term, with the
  change, ↑ or ↓, and the figures.

**Attendance tab:**
- Weekly attendance rate per class across the term.
- Chronic absence: the students below the school's threshold, with their rate
  and days missed.
- Days with no register: each class's school days with nothing marked. This
  reuses the completeness rules, so the two reports can never disagree.

**Enrolment tab:**
- Students per class level, this term against last term.
- Joiners (in this term, not last) and leavers (in last, not this), with the
  leaving status: withdrawn, transferred, graduated.

**Teachers tab:**
- Each teacher's register and score-entry completeness for the last 3 terms,
  as figures.
- It adds history to the existing teacher-activity report and does not
  replace it.

**Exports:**
- Every table on every tab has **CSV, Excel and PDF**. Excel keeps numbers as
  numbers, so a school can sort and total them.
- Each PDF page carries the school's name, logo, term and date printed.
- The two existing reports gain Excel and PDF too.

**Step 4, existing lists** — Excel and PDF added beside today's CSV on:
- students and staff;
- invoices, debtors and expenses;
- result PINs, exam papers and the gradebook.

Each list uses the same filters the screen shows. "Where possible" per the
owner: a list too wide for a page (for example the gradebook with many
components) gets Excel only, and the button says so.

**App:**
- The `staff/reports` section gains Academic, Attendance and Enrolment
  summaries as lists that fit a phone.
- No heatmap; a "See the full chart on the website" link opens the web page,
  signed in.
- Each summary has "Share as Excel" and "Share as PDF". The file is downloaded,
  shared and then deleted from the phone, as the PIN cards are.

### 8.4 Data and API

- **Migration:**
  - Add `schools.chronic_absence_threshold` (INTEGER, default 90, CHECK 50–100).
  - Add a table `report_exports` for PDF jobs:
    - columns: id, school_id, requested_by, report, params JSONB, status,
      storage key, created_at, finished_at;
    - RLS enabled and forced, with the standard `tenant_isolation` policy.
  - No SECURITY DEFINER function. The count stays at 23.
- **Storage:**
  - A new key kind, `report-export`, extension `pdf`.
  - Presigned GET with a 15-minute TTL, as for receipts.
  - A daily cleanup deletes export files older than 24 hours.
- **Permissions:**
  - `reports.analytics.read` and `reports.export`, both in `REPORTS_PERMISSIONS`
    (owner and admin).
  - Each one goes into three places: the seed, an append migration and
    `permissions-coverage.spec.ts`.
- **Endpoints** (all `AuthGuard` + `PermissionsGuard`, both RBAC gates, `withTenant`):
  - `GET /reports/academic?termId=`
  - `GET /reports/attendance?termId=`
  - `GET /reports/enrolment?termId=`
  - `GET /reports/teacher-trend?termId=`
  - `GET /reports/:report/export?format=csv|xlsx&…filters` returns the file.
    The report name is checked against a fixed list.
  - `POST /reports/:report/pdf` queues a PDF and returns `{ exportId }`.
  - `GET /reports/exports/:exportId` returns the status and, once done, a
    short-lived URL. It is tenant-checked through RLS.
  - `PATCH /schools/me` gains `chronicAbsenceThreshold`.
- **Speed:** each report runs a handful of grouped SQL queries, not a query per
  class, inside one `withTenant` transaction with the reports timeout. The
  pool has 3 connections, so nothing fans out in parallel.
- **DTOs:** Zod schemas in `packages/types/src/reports/`. Averages and rates
  are integers in hundredths, as `overallAverage` already is, and formatted
  only at display.

### 8.5 Tests (written first for the sums)

- **Aggregates against a seeded school with known answers:**
  - averages, including a class where one report card is unreleased, which
    must not count;
  - term-on-term with a missing previous term;
  - joiners and leavers across a promotion;
  - chronic absence at exactly the threshold.
- **RLS and permissions:**
  - school B never appears in school A's reports or exports;
  - a teacher or bursar gets 403 on every new endpoint;
  - a PDF export id from another school returns 404.
- **Export round-trip:**
  - the Excel file opens and its cells equal the API's JSON, with numbers
    typed as numbers;
  - the CSV equals the browser CSV for the same rows;
  - the PDF job ends GENERATED with a non-empty file.
- **Audit:** every export writes `reports.export`, and the existing
  `audit-coverage` and two-gate conformance specs include the new endpoints.
- **Phone fit:** the app summaries render at 360 px with nothing spilling off
  the screen, checked in the browser build as before.
- **End-to-end (Playwright):** an admin opens Reports → Academic, sees a
  class average, and downloads Excel.

### 8.6 How it lands

Three PRs, in order, each green before the next. CP1 is split because one PR
would be too large to review well:

| PR | Contents | Estimate |
|---|---|---|
| CP1.1 | Export foundation: `exceljs`, the export helper, PDF jobs in the worker, `report_exports`, permissions; Excel and PDF on the two existing reports | 2–3 days |
| CP1.2 | Academic, Attendance, Enrolment and Teachers tabs (API and web) and the chronic-absence setting | 3–4 days |
| CP1.3 | App summaries and sharing; Excel and PDF on the existing lists (step 4) | 2–3 days |

Total: 7–10 working days (the §5 estimate plus step 4). Each PR updates this
section with what was actually built.

### 8.7 As built — CP1.1, export foundation (2026-10-16)

- **Export helper** (`apps/api/src/common/export/tabular-export.ts`): a table
  is described once, as columns with a header and a value per row. The same
  table becomes:
  - an Excel workbook (`exceljs` 4.4.0): one sheet per table, a frozen header
    row, numbers stored as numbers, text never stored as a formula;
  - print HTML for a PDF: A4 landscape, the header row repeated on each page,
    "Page X of Y", every value escaped, and numbers and dates never wrapped.

  Checked by printing real reports through Chromium and looking at the pages.
- **Routes.** Each report has its own export routes, so each route declares
  `reports.export` **and** the report's own read permission. The guard needs
  both, so an export can never reach a report the person cannot open. This is
  a change from §8.4's single `:report` route.
  - `GET /reports/completeness/export?section=registers|scores&termId=&format=xlsx`
  - `POST /reports/completeness/pdf`
  - `GET /reports/teacher-activity/export`
  - `POST /reports/teacher-activity/pdf`
  - `GET /reports/exports/:exportId`
- **PDFs** go to the render worker as `export-pdf` jobs on the **report-cards
  queue**, handled by the same single processor. The worker therefore still
  holds one Chromium page at a time, the memory rule that worker depends on.
  - The job carries ids only.
  - The API writes the laid-out HTML on the `report_exports` row, the worker
    prints it and the HTML is cleared at once. Pupils' and teachers' names
    never pass through Redis.
  - The row commits before the job is queued. If queuing fails, the row is
    marked FAILED straight away.
- **Clean-up:** `ReportExportSweeperService` runs daily at 01:25 UTC and
  deletes copies older than 24 hours, the file before its row. It is listed
  in the `basePrisma` allowlist under the same category as the session
  sweeper: it reads only the school ids, and every delete runs under that
  school's own RLS.
- **`reports.export`** is in `REPORTS_PERMISSIONS`: admin is given it in the
  seed and in an append migration, and teacher and bursar get nothing. Every
  Excel and PDF export writes `reports.export` with the report, the format and
  the row count.
- **Found and fixed on the way:** the API's CORS did not expose
  `Content-Disposition`, so every file download from the website silently lost
  the file name the API chose (the import error reports included). It now
  exposes it.
- **Website:** one **Export** menu (CSV, Excel, PDF) replaces the CSV button on
  the registers and score-entry tables. The teacher-activity tab gains Excel
  and PDF.
  - CSV is still built in the browser.
  - A PDF shows "Preparing…" and then an **Open PDF** button. It is not opened
    automatically because browsers block a window opened after a wait.
- **Tests:**
  - helper unit tests;
  - the export service against a real database (cells, audit, RLS WITH CHECK,
    unset GUC, the worker, failure, clean-up);
  - permission coverage;
  - an end-to-end test: Excel and CSV download, PDF queued, a teacher refused
    all four routes.

### 8.8 As built — CP1.2, report tabs (2026-10-16)

- **Routes:**
  - `GET /reports/academic`, `/reports/attendance` and `/reports/enrolment` need
    `reports.analytics.read`. It is new, admin only: seed and append migration
    `20261017120000_reports_analytics`.
  - `GET /reports/teacher-trend` needs `reports.teacher-activity.read`, like the
    per-term view, and is audited the same way (`reports.teacher-activity.view`,
    metadata `view: "trend"`).
  - Each analytics tab exports whole, as one workbook (a sheet per table) or
    one PDF (a section per table):
    - `GET /reports/analytics/:report/export` and `POST /reports/analytics/:report/pdf`,
      with `:report` checked against academic, attendance and enrolment;
    - `/reports/teacher-trend/export` and `/reports/teacher-trend/pdf`.
- **Rules**, each in one place (`analytics.service.ts` header):
  - Results come from RELEASED report cards only: a draft card counts in no
    average, cell or ranking.
  - Attendance is (present + late) ÷ records marked, the rate every other
    screen uses.
  - "On roll" means an enrolment for the term that is not WITHDRAWN or
    TRANSFERRED.
  - Chronic absence is **below** the school's line, not at it.
  - Top and bottom come from one ordering, so a tie can never put a student in
    both lists. A class with fewer than ten students has a shorter bottom list.
- **Shared with the Recording report:** "days with no register" and the teacher
  trend reuse `CompletenessService`'s school days and term context through new
  helpers (`termForReport`, `previousTerms`, `missingRegisterRows`,
  `teacherRowsForTerm`). The two reports therefore cannot disagree.
- **The teacher trend** runs one transaction per term, because three full term
  contexts in one transaction would crowd the 15-second reports timeout.
- **Setting:** `schools.chronic_absence_threshold` (default 90, CHECK 50–100),
  edited under Settings → Attendance → "Often absent". It rides `PATCH /schools/me`.
- **Website:**
  - `/reports` gains a section bar: Recording, Academic, Attendance, Enrolment.
    Each tab is its own page.
  - The subject heatmap and the weekly table are grids: they scroll inside
    their own box on a phone. Every other table stacks into cards. Shading is a
    background tint with the number printed and a legend in words; there are no
    accent borders.
  - Each table has its own Export menu: CSV of that table, and Excel or PDF of
    the whole tab.
  - The teacher trend loads only when "Compare the last three terms" is pressed,
    so opening the teacher tab still writes exactly one audit row (the Phase 8
    e2e test pins this).
- **Tests:**
  - `analytics.service.spec.ts`, against a real database, with every figure
    counted by hand in its header:
    - a draft card excluded;
    - change from the previous term;
    - weekly rates;
    - the threshold boundary;
    - missing registers;
    - joiners and leavers with their reasons;
    - the teacher trend with a form teacher;
    - another school's term returns 404.
  - Export spec: the academic workbook's sheets and number formats.
  - Permission coverage for all the new handlers.
  - e2e `report-analytics.spec.ts`: the three tabs, Excel, the threshold setting
    driving the report, and a teacher refused.

### 8.9 As built — CP1.3a, Excel and PDF on the existing lists (2026-10-17)

CP1.3 lands as two PRs: this one (the website's lists), then CP1.3b (the app's
report summaries).

- **CP1-D10, new: the lists use one shared formatter, not one export route per
  list.** The page sends the rows it is already showing, the same rows its CSV
  writes, as a small JSON file. The API only lays them out (`TableExportsService`).
  - Why this is safe: the API reads no table to do it, so it adds no data-access
    path. A person can export exactly what their own list showed them, under
    that list's own permission. This is the reasoning `csv-export.ts` already
    rested on, moved to the server only because Excel and PDF are built there.
  - Why one permission is enough: the formatter grants no data, so a single
    `export.table` serves every staff role (admin, teacher and bursar are
    granted it, the owner holds it by wildcard).
  - Why it was chosen over per-list routes: those would have meant eight new
    queries, each repeating its list's filters and permission checks, and
    eight places to drift from the screen.
  - **Routes:** `POST /exports/table/xlsx`, `POST /exports/table/pdf`, and
    `GET /exports/:exportId`. A PDF's status is readable only by the person who
    asked for it, so even the owner cannot fetch another person's list copy.
  - **Audit:** every copy is recorded as `export.table`, with its title, format
    and row count.
  - **Why a file, not a JSON body:** a school's student list can pass the API's
    100 KB body limit. A 3 MB cap on these two routes is narrower than raising
    the limit for every route.
  - **Validation:** at most 10,000 rows and 60 columns, cells of at most 2,000
    characters, and every row must have one value per column.
  - **Width:** a PDF wider than 14 columns is refused with the reason, and the
    menu shows PDF as unavailable ("too many columns for a page — use Excel").
    This is the gradebook case §8.3 foresaw.
- **PDF path:** PDF queueing moved into `PdfExportQueue`, used by both the
  report and the list exports, so they keep the same guarantees:
  - the row commits before the job exists;
  - a job that cannot be queued is marked FAILED;
  - the job carries ids only.

  List copies are stored with `report = "table"`, and the daily clean-up
  covers them.
- **Website:** one `ListExportMenu` (CSV, Excel, PDF), built from the columns
  each page already defined for CSV, so the three files always agree. It is
  now on:
  - Students and Staff;
  - Invoices, Debtors and Expenses;
  - the finance dashboard's collection-by-level table;
  - the gradebook.

  The old `ExportCsvButton` is gone. On Invoices and Students the rows are
  still fetched page by page first, and a failure part-way downloads nothing,
  in any format.
- **Left CSV-only, on purpose:**
  - **Result PINs.** PINs are hashed so that the server never keeps a
    plaintext PIN after issuing it. A PDF copy would sit in storage for a day
    holding live PINs.
  - **Exam papers.** They already export to Word and print, which suit a paper
    better, and keeping copies of exam content on the server is a risk for no
    gain.
- **Tests:**
  - `table-exports.service.spec.ts` (real database):
    - parsing refuses bad input;
    - Excel keeps numbers as numbers and formula-looking text as text, and is
      audited;
    - a too-wide PDF is refused;
    - a PDF is queued with ids only, and another user, even the owner, cannot
      read it.
  - Permission coverage for the new controller and grants.
  - Web helper tests.
  - e2e `list-exports.spec.ts`: the Students list as Excel, CSV and PDF; a
    bursar using the formatter; a malformed table refused.

### 8.10 As built — CP1.3b, the reports in the app (2026-10-17)

This closes CP1.

- **Where:** Reports in the staff app gains a "More reports" section with
  three screens: Academic results, Attendance and Enrolment. They read the
  same routes as the website's tabs (§8.8), so the two cannot disagree.
- **Who:** the section shows only for the owner and administrators, the same
  people the API serves (`reports.analytics.read`). Anyone else would only be
  refused, so they are not shown a door.
- **What fits a phone:**
  - **Academic:** each class's average; its top five and its bottom list,
    lowest first, numbered under their own headings as on the website. The
    subject chart does not fit a phone, so a button opens it on the website,
    already signed in.
  - **Attendance:** each class's rate and its latest week; students below the
    school's often-absent line; days with no register.
  - **Enrolment:** the number on roll and the change since last term; each
    level's count; who joined and who left (the first 15 of each, then
    "And N more"). In a school's first term this says the joiners and leavers
    will show from its second term.
- **Sharing:** each screen has "Share as Excel" and "Share as PDF", which use
  the same files the website downloads (§8.7):
  - The phone saves the file to its cache, opens the share sheet, and deletes
    the file afterwards, even if sharing fails.
  - Excel is fetched with the person's own session.
  - For a PDF, the app asks for the file, then checks every 2 seconds for up
    to 2 minutes. It downloads the finished file from the short-lived signed
    link, sending no session with it.
  - If the PDF is still being made after 2 minutes, the app says so and asks
    the person to try again.
- **Cache:** the three summaries name students, so their query keys carry the
  `staff` prefix and the school and user. They are never written to the
  phone's offline copy, and they are dropped when the app locks
  (`staff-keys.spec.ts` enforces both).
- **Tests:** unit tests for the PDF wait and the file names
  (`report-wait.spec.ts`), and for the figures' wording (`report-copy.spec.ts`).
  The four screens were checked at phone width (390 px) against a seeded
  school: nothing runs off the screen, including with long class and student
  names.

## 9. CP2 plan-first — Behaviour: points, incidents, discipline

Written 2026-10-15, after the owner approved Q2. Nothing here is built until
the owner approves this section.

### 9.1 What exists today (read from the code)

- **Records:** `behaviour_records` holds one row per note. Each row has:
  - a student;
  - a kind (COMMENDATION or CONCERN);
  - the note text;
  - the day it happened;
  - who wrote it.

  A record is withdrawn, never deleted.
- **Who:**
  - The owner, admins and teachers write and read records. A teacher may only
    touch a student they teach.
  - A teacher withdraws only their own records; an admin withdraws any.
  - Bursars see nothing.
- **Audit:** every write and every read is audited. The note text never goes
  into the audit log.
- **Screens:**
  - the website's student page has a Behaviour tab;
  - the staff app has a behaviour screen per student, reached from a class
    and from the student page.
- **Families:** there is no parent or student endpoint at all (C14). No AI
  (C15).
- **Notifications:** `NotificationDispatchService.notifyGuardian` chooses
  push or SMS for one guardian, never both. Push wins when the school has push
  on and the guardian has a live app. The push text must be safe on a locked
  screen: it names the school and says something happened, never what or about
  whom. SMS may be specific. The notifications rule N4 keeps new events off SMS,
  so this would be the first exception.

### 9.2 Decisions taken here (owner may overrule any)

- **CP2-D1. Points are optional, and off by default.**
  - The school turns points on in Settings → Behaviour and keeps a list of
    categories. Each category has a name, a kind (commendation or concern) and
    a value. Commendations score +1 to +10; concerns score −1 to −10.
  - A record may name a category. When it does, the record **copies** the
    category's value at the time of writing, so changing a value later does
    not rewrite past terms.
  - A student's term total is the sum of their live (not withdrawn) records
    dated inside the term. Totals show on the student's Behaviour tab and in
    the app; there is no school-wide league table, because ranking children
    by conduct points is the punishment-log failure C16 warns about.
  - With points off, everything works exactly as today.
- **CP2-D2. An incident groups the records of several students.**
  - An incident has a date, a place (free text, for example "Playground"), a
    short description, the students involved and the staff who saw it.
  - Each student involved gets their own CONCERN record linked to the
    incident, so their history stays complete. The incident's description is
    shared; each student's record keeps its own note.
  - The usual scope applies: a teacher names only students they teach. An
    owner or admin names any student. (A playground fight between pupils the
    teacher does not teach goes to an admin to record. This keeps one rule for
    who may write about a child.)
  - Witnesses are staff members chosen from a list, not typed names.
- **CP2-D3. Discipline actions are proposed, then decided.**
  - The four actions are Warning, Detention (a date), Suspension (first and
    last day) and Exclusion (first day).
  - An action may link to a record or an incident. Its reason is internal
    text.
  - A teacher **proposes**. An owner or admin **approves** or **rejects**; a
    rejection needs a reason.
  - **No one decides their own proposal.** An admin's proposal waits for the
    owner or another admin. The owner's own proposals are approved when made,
    because there is no one above the owner. Each one is recorded as
    "proposed and approved by the owner".
  - A school with a single admin and no other decider: the owner decides.
  - Any action can be **withdrawn**, before or after the decision, but never
    deleted. The person who proposed it or an admin may withdraw it.
- **CP2-D4. Parents hear about approved suspensions and exclusions only (Q2).**
  - Warnings and detentions, records, points and incidents stay staff-only,
    as today.
  - On approval of a suspension or an exclusion, every linked guardian is
    notified once:
    - **App (push):** the locked-screen text is the school's name and "The
      school has sent you a notice. Open the app to read it." It names no
      child and no action.
    - **SMS (when there is no live app):** "{School}: {first name} has been
      suspended from 20 Oct to 22 Oct 2026. Please contact the school."
      Exclusion reads "…has been excluded from 20 Oct 2026…". This is the
      first exception to N4, by the owner's decision. It is
      sent under the school's own sender name and costs one SMS per guardian.
  - **In the app and on the parent website**, the child's page gets a
    "Notices from the school" card listing only the action, the dates, the
    date it was decided, and "Please contact the school". It never shows the
    reason, the notes, the incident or who proposed it.
  - **If an approved suspension or exclusion is withdrawn,** guardians who
    were told get a second notice: "The notice of {date} has been withdrawn."
    The card then shows it as withdrawn rather than hiding it.
  - The student's own app shows nothing.
  - The notice is sent once per guardian per action, enforced by a unique
    row, so a retry or a second click cannot send twice.
- **CP2-D5. Permissions.**
  - The existing `behaviour.read` and `behaviour.create` stay as they are.
  - New `behaviour.manage` (settings and categories) and `behaviour.decide`
    (approve and reject) are owner and admin only. The service checks the
    role as well, as every other write does.
  - The parent-side read is a new portal route returning only the notice
    fields. There is still no route that can return a note to a family.
- **CP2-D6. Audit.**
  - Every proposal, decision, withdrawal and notice sent is audited, with the
    action type and dates, never the reason text.
  - Reads stay audited as today.
- **C15 holds:** no AI anywhere in CP2.

### 9.3 What gets built

| Slice | What | Where |
|---|---|---|
| **CP2.1** | Points: the school's switch, categories, a category on each record, term totals | API, website (Settings → Behaviour, the student's Behaviour tab), staff app |
| **CP2.2** | Incidents: several students, witnesses, place | API, website (a new Behaviour page listing incidents, and the student tab), staff app |
| **CP2.3** | Discipline: propose, decide, withdraw; parent notices by push then SMS | API, website (a decisions queue on the Behaviour page), staff app (propose; decide for admins), parent app and parent website (the notices card) |

Each slice is one PR, merged before the next starts.

### 9.4 Data

- **CP2.1:**
  - `schools.behaviour_points_enabled` (default false).
  - A new `behaviour_categories` table (school, name, kind, points, active,
    order). The value is a `CHECK` between −10 and 10, never 0, and its sign
    must match the kind.
  - Two nullable columns on `behaviour_records`: `category_id` and `points`.
- **CP2.2:**
  - `behaviour_incidents` (school, date, place, description, recorded by,
    withdrawn).
  - `behaviour_incident_witnesses` (incident, staff user).
  - A nullable `incident_id` on `behaviour_records`.
- **CP2.3:**
  - `discipline_actions`, holding:
    - the school and student;
    - an optional record or incident;
    - the type;
    - the start and end dates (`DATE`);
    - the reason;
    - the status (PROPOSED, APPROVED, REJECTED, WITHDRAWN);
    - proposed by and when;
    - decided by and when, with the reason;
    - withdrawn by and when.
  - `CHECK`s keep the dates consistent with the type: a suspension has both
    dates, end not before start.
  - `discipline_notices` (action, guardian, kind SENT or WITHDRAWN, channel,
    sent at), unique on action, guardian and kind.
- Every new table is tenant-scoped with RLS (FORCE), like
  `behaviour_records`. No SECURITY DEFINER function is needed: every read
  happens after the tenant is known.

### 9.5 Tests (the rules first)

- **CP2.1:**
  - A category's value is copied, and changing the category later leaves old
    records alone.
  - The term total counts only live records inside the term's dates.
  - With points off, a category is refused.
  - A teacher cannot manage categories.
- **CP2.2:**
  - An incident creates one linked record per student.
  - A teacher naming a student they do not teach is refused, and nothing is
    written.
  - A witness must be a staff member of the same school.
- **CP2.3:**
  - A teacher cannot approve.
  - No one approves their own proposal, except the owner, as D3 says.
  - The parent notice fires only when a suspension or exclusion is approved,
    never on a proposal, rejection, warning or detention.
  - The push text names no child and no action.
  - The SMS is sent only when push is not available, and carries no reason
    text.
  - The notice is sent once per guardian, even on a retry.
  - Withdrawing a notified action sends one withdrawal notice.
  - The parent route returns no reason, note or proposer.
  - Another school's parent gets nothing (RLS).
- **e2e per slice:**
  - CP2.1: the owner sets up categories and a teacher records with one.
  - CP2.2: an incident with two students.
  - CP2.3: a teacher proposes a suspension, the owner approves, and the
    guardian sees the card in the portal.
- **Phone-fit check:** every new app screen at 390 px.

### 9.6 How it lands

- **CP2.1**, then **CP2.2**, then **CP2.3**, each squash-merged when CI is
  green.
- `the-school-day.md` C14 gets a dated note pointing here: the narrow reversal
  is the parent notice in D4, and nothing else.
- An estimate of six to eight days, as §5 says.

### 9.7 Left out on purpose

- Suspended days do not change the attendance register. A suspended student
  is still marked by the teacher, as today. Linking the two is a later
  decision.
- No parent reply or appeal inside the system. The notice asks the parent to
  contact the school, which is what C14's "right of reply" needs until a real
  design exists.
- No printed letter. The school can still print one from its own records.

### 9.8 As built — CP2.1, behaviour points (2026-10-15)

- **Data:** migration `20261019120000_behaviour_points` adds:
  - `schools.behaviour_points_enabled`, default false;
  - the `behaviour_categories` table (RLS forced, unique name per school);
  - `category_id` and `points` on `behaviour_records`.

  Two `CHECK`s hold the rules in the database: a commendation's value is 1 to
  10 and a concern's −10 to −1, and a record carries points only together
  with a category. No SECURITY DEFINER function; the count stays 23.
- **Permission:** `behaviour.manage` is new, held by admin (owner by
  wildcard). Teacher and bursar never hold it, which
  `permissions-coverage.spec.ts` pins.
- **API**, on the existing `/behaviour` controller:
  - `GET /behaviour/settings` (`behaviour.read`) returns the switch and every
    category, so a writer can offer them.
  - `PATCH /behaviour/settings`, `POST /behaviour/categories` and
    `PATCH /behaviour/categories/:id` need `behaviour.manage`.
  - `POST /behaviour` takes an optional `categoryId`. It is refused while
    points are off, for a switched-off category, or for a category of the
    other kind. The value is copied onto the record.
  - `GET /behaviour?studentId=` adds each record's category name and points,
    and `termPoints`: the sum of live records dated inside the current term.
    It is null when points are off or there is no current term.
  - Every settings and category change is audited with before and after.
- **Categories:**
  - A category's kind cannot change; its name and value can, and past records
    keep the value they copied.
  - A category is switched off rather than deleted, because records point at
    it.
  - Names are unique per school, ignoring case.
  - Sorting is commendations first, then the larger value, then the name. The
    planned manual order (§9.4) was left out: the fixed order is enough for a
    short list.
- **Website:**
  - **Settings → Behaviour** has the switch, the category list (edit, switch
    off, switch on) and an add form. Points are entered as a size from 1 to
    10; the sign comes from the kind.
  - **The Behaviour tab** (admin and teacher pages) offers the categories of
    the chosen kind and shows each record's category with its points, plus
    "+3 points this term" beside the counts.
- **App:**
  - The staff behaviour card offers the categories as choices, shows each
    record's category and the term total, and uses the new staff-prefixed
    key `staffBehaviourSettings`.
  - Categories are managed on the website only.
  - All chip pickers in the app now wrap a long label inside the chip instead
    of running off the screen. This was found at 390 px with a long category
    name.
- **Tests:**
  - 11 new service tests:
    - the value is copied;
    - the total counts only live, in-term records;
    - points off, a switched-off category and the wrong kind are refused;
    - the sign stays with the kind;
    - names are unique;
    - a teacher cannot manage;
    - another school's category is refused.
  - Permission coverage.
  - e2e `behaviour-points.spec.ts`: the owner sets up categories and a
    teacher scores a child.
  - The website screens (390 px and 1280 px) and the app card (390 px) were
    checked with long names, and nothing runs off the screen.

### 9.9 As built — CP2.2, behaviour incidents (2026-10-15)

- **Data:** migration `20261020120000_behaviour_incidents` adds:
  - `behaviour_incidents` (date, place, description, who recorded it,
    withdrawn);
  - `behaviour_incident_witnesses` (incident and staff user);
  - a nullable `incident_id` on `behaviour_records`.

  Both new tables have RLS forced. No new permission and no SECURITY
  DEFINER function; the count stays 23.
- **API**, on the `/behaviour` controller:
  - `POST /behaviour/incidents` (`behaviour.create`) takes:
    - a date, a place and a description;
    - 1 to 30 students, each with an optional note of their own;
    - up to 10 witnesses;
    - an optional concern category.

    It writes the incident and one CONCERN record per student in a single
    transaction. A student without their own note gets the description. One
    student the teacher does not teach refuses the whole incident, and
    nothing is written. A witness must be an active staff user of the
    school.
  - `GET /behaviour/incidents` (`behaviour.read`, optional `from` and `to`)
    returns the newest 200. An owner or admin sees all of them. A teacher sees
    only those they recorded or witnessed. The read is audited.
  - `GET /behaviour/incidents/:id` follows the same rule. "Not yours" reads
    as not found, so an id cannot be probed.
  - `POST /behaviour/incidents/:id/withdraw` is for the person who recorded it
    or an owner or admin. It withdraws the incident and every live record in
    it.
  - `GET /behaviour/incident-options` and
    `GET /behaviour/incident-options/arms/:armId/students` (`behaviour.create`)
    feed the form:
    - the classes the person may name students from (all of them for an owner
      or admin, their own for a teacher);
    - the active staff names;
    - one class's current-term roster.

    They return names only.
  - Each record now carries `incident: { id, place }` when it is part of one.
  - Audit metadata holds ids and counts; the description and notes never go
    into the audit log.
- **Website:**
  - A new **Behaviour** page in the admin menu (`/behaviour`, gated on
    `behaviour.read`, so a bursar never sees it) and the teacher menu
    (`/teacher/behaviour`). One shared panel lists incidents and records new
    ones.
  - Students are picked class by class, and the choices build up across
    classes. Each chosen student can have a note of their own.
  - The student's Behaviour tab shows "Part of an incident: {place}".
- **App:**
  - A teacher's class screen has **Record an incident**. It opens a form
    with the place, what happened, the class's students, the staff who saw it
    and an optional concern category.
  - Per-student notes and students from several classes are on the website
    only. In the app, the description is every student's note.
  - The behaviour card shows when a record is part of an incident.
  - New staff-prefixed keys `staffIncidentOptions` and
    `staffIncidentRoster`.
- **Tests:**
  - 8 new service tests:
    - one linked record per student, and a student's own note wins;
    - a teacher naming a child they do not teach writes nothing;
    - a witness who is not staff is refused;
    - a category applies to every student, and only a concern category is
      accepted;
    - each teacher sees only their own incidents;
    - withdrawing withdraws every record, and only the recorder or an admin
      may;
    - the audit log holds no text;
    - a teacher's options and rosters are their own.
  - Permission coverage.
  - The admin-menu spec.
  - e2e `behaviour-incidents.spec.ts`: the owner records an incident with
    two students and the student's tab shows it.
  - The website page and the app's class and incident screens were checked
    at 390 px with long names, and nothing runs off the screen.

### 9.10 As built — CP2.3, discipline and parent notices (2026-10-15)

- **Data:** migration `20261021120000_discipline_actions` adds:
  - `discipline_actions` (student; optional record or incident; type; start
    and end `DATE`; reason; status; proposed, decided and withdrawn by and
    when; the decision's reason);
  - `discipline_notices` (action, guardian, kind SENT or WITHDRAWN, channel
    PUSH, SMS or NONE), UNIQUE on action, guardian and kind.

  `CHECK`s hold the rules in the database: the dates follow the type (a
  warning has none, a detention one day, a suspension a first and last day
  with the last not before the first, an exclusion a first day), a decision
  always has its decider, and a rejection always has a reason. Both tables
  have RLS forced. No SECURITY DEFINER function; the count stays 23.
- **Permission:** `behaviour.decide` is new, held by admin (owner by
  wildcard), appended to the admin system role in the same migration.
  Teacher and bursar never hold it, which `permissions-coverage.spec.ts`
  pins.
- **API**, a new `DisciplineController` at `/behaviour/discipline`:
  - `POST /behaviour/discipline` (`behaviour.create`) proposes. A teacher
    names only a child they teach (the check now lives in
    `behaviour/teaches-student.ts`, shared with records and incidents). A
    linked record must be about the child, and a linked incident must
    include them. **The owner's own proposal is approved when made**, and is
    recorded as proposed and approved by the owner.
  - `POST /behaviour/discipline/:id/decide` (`behaviour.decide`, and the
    service checks the owner or admin role) approves or rejects; a
    rejection needs a reason. **No one decides their own proposal**: an
    admin's waits for the owner or another admin. The update is conditional
    on the action still being PROPOSED, so two people deciding at once
    cannot both succeed, and cannot both notify parents.
  - `POST /behaviour/discipline/:id/withdraw` (`behaviour.create`) is for the
    proposer or an owner or admin, before or after the decision. A rejected
    action cannot be withdrawn.
  - `GET /behaviour/discipline?studentId=&status=` (`behaviour.read`): an
    owner or admin sees every action. A teacher sees a child's actions when
    they teach the child, and otherwise only their own proposals. Each row
    carries `canDecide`, `canWithdraw` and how many guardians were told.
  - Every proposal, decision, withdrawal, notice and read is audited with the
    type, dates and counts, never the reason.
- **Parent notices** (CP2-D4):
  - Sent only when a SUSPENSION or EXCLUSION is approved (or proposed by the
    owner, which approves it). Never on a proposal, a rejection, a warning or
    a detention.
  - Each guardian is claimed first with a `discipline_notices` row
    (`skipDuplicates`), so a retry or a second click cannot send twice. The
    channel comes from `NotificationDispatchService.notifyGuardian`: push
    when the school has push on and the guardian has a live app, SMS
    otherwise. The push text is "The school has sent you a notice. Open the
    app to read it." under the school's name. The SMS reads "{School}:
    {first name} has been suspended from 20 Oct to 22 Oct 2026. Please
    contact the school." and goes under the school's approved sender name.
    This is the first exception to N4, as D4 says.
  - Withdrawing an approved suspension or exclusion sends "The notice of
    {date} has been withdrawn." to the guardians who were told, and no one
    else.
  - The notice is sent after the decision commits. A crash between the two
    means a parent was not told (the staff page then shows "0 parents
    told"), never that a parent was told about a decision that did not
    happen.
  - `GET /portal/students/:id/discipline-notices` (`GuardianAuthGuard`,
    `withTenant` + `withGuardian`) returns approved suspensions and
    exclusions, and withdrawn ones that had been approved, marked. Its type,
    `PortalDisciplineNoticeDto`, has fields for the type, the dates, the day
    it was decided and the day it was withdrawn, and nothing else. The
    student's own portal gets nothing.
- **Website:**
  - The student's Behaviour tab has a **Discipline** section: propose an
    action (type, dates, a staff-only reason), and the child's history with
    Approve, Reject (with a reason) and Withdraw where the API allows. The
    tab's "Staff only" note now names the one exception.
  - The **Behaviour** page (admin and teacher) has a **Waiting for a
    decision** queue above the incidents.
  - Approving a suspension or exclusion, and withdrawing one parents were
    told about, both ask for confirmation and say who will be told.
- **Parent website and app:** a **Notices from the school** card on the
  child's page, tinted rather than edged, showing "Suspended from 20 Oct to
  22 Oct 2026" or "Excluded from 20 Oct 2026", the day it was decided, and
  "Please contact the school." It fetches on its own and renders nothing
  when there are no notices or the read fails. The wording comes from one
  helper in `@school-kit/types`, shared with the SMS.
- **Staff app:**
  - A **Discipline** card under the behaviour card, on the teacher's class
    behaviour screen and the admin's student screen: propose (date boxes, not
    a picker) and the child's history with the same actions.
  - A **Behaviour decisions** home tile for an owner or admin with
    `behaviour.decide`, opening the queue at `/staff/discipline`.
  - New staff-prefixed keys `staffDiscipline` and `staffDisciplineQueue`;
    the parent key `disciplineNotices`.
- **Tests:**
  - 19 new service tests against real Postgres, with stand-in notification
    and SMS services that record what reached each parent:
    - a teacher proposes for a child they teach, and is refused (writing
      nothing) for one they do not;
    - the owner's own proposal is approved when made;
    - the dates follow the type in the DTO and in the database `CHECK`;
    - a teacher cannot approve; no admin decides their own proposal;
    - a rejection needs a reason; nothing is decided twice;
    - proposals, rejections and approved detentions and warnings tell no
      parent;
    - an approved suspension tells each guardian once: push for one with
      the app, SMS for one without, and the push text names no child and
      no action; the SMS carries no reason;
    - a retried send tells nobody twice;
    - the parent route returns exactly the six notice fields;
    - withdrawing sends one withdrawal notice per guardian who was told;
      withdrawing a proposal tells no one;
    - an unlinked guardian and another school's guardian get nothing (RLS);
    - the audit log holds no reason text.
  - Permission coverage for the four new routes, and the app's menu spec.
  - e2e `behaviour-discipline.spec.ts`: a teacher proposes a suspension, the
    owner approves it from the queue, and the guardian sees the notice in the
    portal without the reason.

## 10. CP3 plan-first — Health records and sickbay

Written 2026-10-15, after the owner answered Q3. **Owner, 2026-10-15: approved
as written**, including CP3-D6 (SMS only when the child is sent home) and
CP3-D7 (F1 built here).

### 10.1 What exists today (read from the code)

- **Fields:** `students.blood_group` and `students.medical_notes`, free text,
  set on the admin student form and by CSV import (blood group only; import
  refuses free-text medical notes).
- **Who can read them:** owner and admin only. `GET /students/:id` holds
  `student.read`, which teachers also have, but the service refuses anyone who
  is not an owner or admin. The teacher roster and the parent portal's student
  DTO both leave the two fields out on purpose.
- **Not there yet:** no allergies or conditions structure, no vaccinations, no
  sickbay log, no health role, no private upload for documents (F1), and no
  family-facing health route.
- **Notifications:** `NotificationDispatchService.notifyGuardian` picks push
  or SMS for one guardian. N4 keeps new events off SMS; CP2.3 made the first
  exception, by the owner's decision.

### 10.2 Decisions taken here (owner may overrule any)

- **CP3-D1. A new system role, Health officer** (`health_officer`; owner,
  2026-10-15, replacing "nurse").
  - New permissions: `health.read`, `health.manage` (profile and
    vaccinations) and `sickbay.manage` (the visit log). Admin holds all three;
    owner by wildcard; the health officer holds all three, plus `student.read`
    and the class and term reads needed to find a child. Teacher and bursar
    hold none of them.
  - The service checks the role as well, as every other write does.
- **CP3-D2. Teachers see only what the health officer shares** (owner,
  2026-10-15).
  - The profile has a **"For teachers"** note, written by the health officer
    or an admin, for example "Severe peanut allergy. EpiPen in her school
    bag." It is empty until someone writes it.
  - A teacher of the child sees that note and nothing else: not the
    allergies, conditions, medication or vaccinations as recorded, and never
    the sickbay log. A teacher who does not teach the child sees nothing.
  - It shows on the teacher's class list and the child's page, on the website
    and in the app.
- **CP3-D3. Parents read their own child's health record** (owner,
  2026-10-15).
  - The profile (allergies, conditions, medication, GP or clinic, emergency
    notes, blood group), the vaccinations, and the sickbay visits.
  - A visit shows the time and "visited the sickbay". It shows the complaint,
    action and medicine given only when the health officer ticked "share
    details with the parent".
  - The "For teachers" note is shown to the parent too, so a family can see
    exactly what teachers were told.
  - Read-only. A correction is "contact the school", as with the discipline
    notices.
  - The student's own portal shows nothing.
- **CP3-D4. `blood_group` and `medical_notes` move into the profile.**
  - A data migration creates a profile for every student with either field,
    copying blood group as it is and medical notes into "conditions".
  - The two columns leave the student form, the student DTOs and the CSV
    import (blood group is imported into the profile instead). The columns are
    dropped in the same migration, after the copy.
- **CP3-D5. The sickbay log.**
  - A visit records: when, the complaint, the action taken, whether the child
    was sent home, "share details with the parent", and who recorded it.
  - Medicine given is its own list on the visit: name, dose, the time given
    and who gave it.
  - Corrected by withdrawing, never deleted, as behaviour records are.
- **CP3-D6. Parents are told of a visit.**
  - Push, under the school's name: "The school has sent you an update. Open
    the app to read it." It names no child and no complaint.
  - **SMS only when the child was sent home** (my recommendation): "{School}:
    {first name} visited the sickbay at 10:40 and is being sent home. Please
    contact the school." An ordinary visit is not worth an SMS, and N4 is kept
    for everything else. This is a second N4 exception; overrule if you want
    SMS for every visit, or none.
  - Once per guardian per visit, enforced by a unique row, as in CP2.3.
- **CP3-D7. F1, private file uploads, is built here, not in CP4.** CP3 comes
  first, and a vaccination record's proof (a card photo or a PDF) needs it.
  - A `health-document` storage key; images and PDF up to 10 MB; uploaded
    from the website and the app; read through a short-lived signed URL, as
    receipts are.
  - Only the people who may read the record may fetch the file. CP4, CP6 and
    CP7 reuse the same piece.
- **CP3-D8. Audit and AI.**
  - Every read of a profile, a vaccination list, a document or the sickbay
    log is audited, including the teacher's read of the "For teachers" note
    and the parent's reads. The free text never goes into audit metadata.
  - No AI anywhere in CP3.

### 10.3 What gets built

| Slice | What | Where |
|---|---|---|
| **CP3.1** | The Health officer role, the profile, the move of the two old fields, the "For teachers" note, the parent's read | API, website (a Health tab on the student page, and the note on the teacher's class and student pages), staff app, parent website and app |
| **CP3.2** | F1 uploads, and vaccinations with an optional document | API, website, staff app, parent website and app |
| **CP3.3** | The sickbay log, medicine given, and the parent notice | API, website (a Sickbay page for the health officer and admins), staff app, parent website and app |

Each slice is one PR, merged before the next starts.

### 10.4 Data

- **CP3.1:**
  - `health_profiles` (one per student): allergies, conditions, medication,
    GP or clinic, emergency notes, blood group, the "For teachers" note, who
    last changed it and when.
  - The data migration from `students`, then the two columns dropped.
  - The `health_officer` system role and the three permissions, appended in
    the migration as earlier permissions were.
- **CP3.2:** `health_vaccinations` (student, name, date given as `DATE`,
  optional document key, recorded by, withdrawn).
- **CP3.3:**
  - `sickbay_visits` (student, visited at, complaint, action taken, sent
    home, share with the parent, recorded by, withdrawn);
  - `sickbay_medications` (visit, name, dose, given at, given by);
  - `sickbay_notices` (visit, guardian, channel), unique on visit and
    guardian.
- Every table is tenant-scoped with RLS forced. No SECURITY DEFINER function:
  every read happens after the tenant is known.

### 10.5 Tests (the rules first)

- **Who reads what, pinned per role:**
  - owner, admin and health officer read and write;
  - a teacher of the child reads the "For teachers" note only, and a teacher
    who does not teach them reads nothing;
  - a bursar reads nothing;
  - a linked parent reads the profile, vaccinations and visits; an unlinked
    parent, and another school's parent, get nothing (RLS);
  - the student's own portal has no route.
- The data migration copies both old fields and leaves no student's data
  behind.
- A visit without "share details" shows the parent the time only.
- The push text names no child and no complaint; the SMS goes only when the
  child was sent home, carries no complaint or medicine, and is sent once per
  guardian.
- Every read is audited, and the audit log holds no health text.
- A document is fetchable only by those who may read the record.
- **e2e:**
  - CP3.1: the health officer writes a profile and a teacher note; the
    teacher sees only the note; the parent sees the profile.
  - CP3.2: a vaccination with a document.
  - CP3.3: a visit with "sent home", and the parent's card.
- **Phone-fit:** every new page and app screen at 320px and 390px.

### 10.6 Left out on purpose

- A medicine stock list, prescriptions and consent forms for giving medicine.
- Emergency contacts: they are already the child's guardians.
- Parents editing the record. A correction goes through the school.
- Linking a sickbay visit to the attendance register.

### 10.7 As built — CP3.1, health profiles and the Health officer (2026-10-15)

- **Data:** migration `20261022120000_health_profiles` adds:
  - `health_profiles`, one per student (allergies, conditions, medication,
    GP or clinic, emergency notes, blood group, the "For teachers" note, who
    last changed it), with RLS forced and a length `CHECK` on every field;
  - the data move: every student with a non-blank blood group or medical
    notes gets a profile, blood group copied and medical notes into
    "conditions". Then `students.blood_group` and `students.medical_notes`
    are dropped. The copy was checked against test rows in a rolled-back
    transaction: both fields move, blanks become empty, and a student with
    only blanks gets no profile;
  - the `health_officer` system role, holding `health.read`,
    `health.manage` and `sickbay.manage` and nothing else;
  - admin gains all three plus `health.note.read`; teacher gains
    `health.note.read` only.

  No SECURITY DEFINER function; the count stays 23.
- **The old fields leave the student record:** the student form, the
  student DTOs and the bio tab no longer carry them. CSV import keeps its
  blood group column and writes it into the profile. The log redaction list
  gains the profile's field names.
- **API**, a new `HealthController` at `/health`:
  - `GET /health/students?q=&armId=` (`health.read`): the Health page's list,
    names, class and two flags (recorded, note for teachers), no health text,
    at most 100.
  - `GET /health/students/:id` (`health.read`), audited.
  - `PUT /health/students/:id` (`health.manage`): creates or changes the
    profile; an emptied field is cleared. The audit holds the changed field
    names, never the text.
  - `GET /health/teacher-notes?armId=` and
    `GET /health/teacher-notes/students/:id` (`health.note.read`): the "For
    teachers" note only, for a teacher of that class or child (or an owner or
    admin), audited.
  - The service checks the owner, admin or health_officer role as well.
- **Parents:** `GET /portal/students/:id/health` (`withTenant` +
  `withGuardian`), the whole profile read-only, audited with the guardian as
  the reader. The student's own portal has nothing.
- **Invitations:** an owner or admin can invite a Health officer (the
  invite form, the API's role list, and the staff list's role names).
- **Website:**
  - A **Health** menu item (`health.read`), and the Health officer's home
    page: search by name or admission number, filter by class, open a child.
  - The child's health record page, and a **Health** tab on the admin
    student page, both from one panel. The "For teachers" note is edited in
    its own tinted box that says it is the only part teachers see.
  - Teachers see a tinted **Health note** on the child's page and a **Health
    notes** list on the class page, only when a note exists.
- **Parent website and app:** a **Health record** card on the child's page,
  read-only, with "Something wrong or missing? Please contact the school."
  The app never writes it to the phone's storage.
- **Staff app:**
  - A **Health** home tile for an owner, admin or Health officer, opening a
    searchable list and each child's record, editable with `health.manage`.
  - The teacher's class screen and child behaviour screen show the note.
  - New staff-prefixed keys `staffHealthList`, `staffHealthProfile`,
    `staffHealthNote` and `staffClassHealthNotes`; the parent key
    `healthRecord`, never persisted.
- **Tests:**
  - 10 new service tests against real Postgres:
    - the Health officer writes and reads, and an emptied field clears;
    - owner and admin read; the list carries flags, not health text;
    - a teacher and a bursar cannot read or write the record;
    - a teacher of the child gets the note in exactly two fields, and a
      teacher who does not teach the child gets nothing;
    - a linked guardian reads the whole profile; an unlinked guardian and
      another school's guardian get nothing (RLS);
    - every read is audited, and the audit log holds no health text.
  - Permission coverage for the five routes and the three role grants, and
    the app's menu and query-key specs.
  - e2e `health-profile.spec.ts`: the Health officer records a profile and a
    note, the teacher sees only the note on the class and child pages, and the
    parent sees the record in the portal. `/health` joins the phone-fit check.

### 10.8 As built — CP3.2, private uploads (F1) and vaccinations (2026-10-15)

- **F1, private file uploads** (`apps/api/src/common/storage/private-file.ts`),
  built here rather than in CP4 (CP3-D7):
  - images (JPEG, PNG, WebP) or PDF, at most 10 MB;
  - the type is read from the file's own first bytes, never from its name or
    the browser's declared type, so a renamed file is refused and every object
    is stored and served with the type it really has;
  - stored privately and read only through a five-minute signed URL, issued
    after the reader's access to the owning record is checked;
  - a new `health-document` storage key, `schools/<school>/health/<id>.<ext>`.
    CP4, CP6 and CP7 add their own keys and reuse the same check.
- **Data:** migration `20261023120000_health_vaccinations` adds
  `health_vaccinations` (student, vaccine name, the day given as `DATE`, the
  document's type and size, who recorded it, withdrawn). RLS forced; a
  `CHECK` keeps the document's type to the four allowed and its size within
  10 MB. No new permission and no SECURITY DEFINER function; the count stays
  23.
- **API**, on `/health`:
  - `POST /health/students/:id/vaccinations` and
    `POST /health/vaccinations/:id/withdraw` (`health.manage`);
  - `POST /health/vaccinations/:id/document` (`health.manage`, multipart):
    attach or replace; a replacement of another type deletes the old object;
  - `GET /health/vaccinations/:id/document` (`health.read`): the five-minute
    link, audited;
  - the profile now carries its vaccinations, newest first, withdrawn ones
    marked.
- **Parents:** the portal profile lists live vaccinations (withdrawn ones are
  left out), and `GET /portal/students/:id/vaccinations/:vaccinationId/document`
  gives a guardian of that child the link, audited with the guardian as the
  reader. Another child's vaccination reads as not found.
- **Audit:** create, withdraw, upload (type and size), and every document
  read. The vaccine's name stays out of the audit log, as all health text
  does.
- **Website:** a **Vaccinations** section under the health record: add (name
  and date), **Add document** / **Replace document**, **View PDF** or **View
  photo** (the tab opens first, so a popup blocker allows it), and Withdraw.
- **Parent website and app:** the Health record card lists the vaccinations
  with **View PDF** / **View photo**.
- **Staff app:** a **Vaccinations** card on the child's health record: add,
  attach a photo from the library or a PDF (sent by the native uploader), view
  and withdraw.
- **Tests:**
  - 3 tests for F1: each allowed type recognised by its bytes; other files,
    empty files and files over 10 MB refused; the storage path.
  - 6 new health service tests: record and attach, typed by bytes; a
    disguised file refused; a replacement of another type; teacher and bursar
    refused; a linked guardian opens it while an unlinked one and another
    school's guardian get nothing; withdrawn means kept for staff, gone for
    the parent, and refused twice.
  - Permission coverage for the four new staff routes.
  - e2e `health-vaccinations.spec.ts`: the Health officer adds a vaccination,
    a disguised file is refused, a PDF is attached, and the parent sees it and
    gets its link.
  - Every new section was checked at 320px and 390px on the website, the
    parent website and the app.

### 10.9 As built — CP3.3, the sickbay log and the parent notice (2026-10-15)

CP3 is complete with this slice.

- **Data:** migration `20261024120000_sickbay` adds three tables, all with
  RLS forced:
  - `sickbay_visits`: the student, when (`TIMESTAMP`), the complaint, the
    action taken, sent home, shared with the parent, who recorded it, and
    withdrawn. `CHECK`s keep the text lengths and require the two withdrawn
    columns to be set together.
  - `sickbay_medications`: the visit, the medicine, the dose, the time given
    and who gave it.
  - `sickbay_notices`: the visit, the guardian and the channel (`PUSH`, `SMS`
    or `NONE`), unique on visit and guardian.

  No new permission (`sickbay.manage` came with CP3.1) and no SECURITY
  DEFINER function; the count stays 23.
- **Time:** a visit is a moment, shown in the school's time (Lagos, UTC+1 all
  year) on every screen. `formatSickbayTime`, `formatSickbayDay`,
  `sickbayDayOf` and `sickbayMomentFrom` are in `@school-kit/types`, so the
  API's SMS and every screen agree. A visit may not be in the future (five
  minutes of clock slack) or more than 30 days old. A medicine may not be
  given before the visit or in the future.
- **API**, `SickbayController` at `/health/sickbay`, every route
  `sickbay.manage`, with the role checked in the service too:
  - `GET /health/sickbay/visits?date=` lists one Lagos day, today by default.
    `?studentId=` lists one child instead. Both are audited.
  - `POST /health/sickbay/visits` records a visit, with up to 10 medicines.
  - `POST /health/sickbay/visits/:id/medications` adds a medicine given later.
  - `POST /health/sickbay/visits/:id/withdraw`: kept and marked withdrawn.
  - There is no teacher route.
- **Parents** (`GET /portal/students/:id/sickbay-visits`, behind
  `withGuardian`, audited):
  - Each live visit shows its time and whether the child was sent home.
  - The complaint, action and medicine appear only when the visit was shared
    with the parent. The response's `details` is `null` otherwise, so the text
    never leaves the API.
  - A withdrawn visit is not listed.
- **The notice (CP3-D6):** sent after the visit is committed, once per
  guardian (claimed by the unique row first).
  - Push, under the school's name: "The school has sent you an update. Open
    the app to read it." It names no child and no complaint.
  - An SMS goes only when the child was sent home and the guardian has no
    live app: "{School}: {first name} visited the sickbay at 10:40 and is
    being sent home. Please contact the school." It names no complaint and no
    medicine. An ordinary visit to a parent without the app records `NONE`.
  - Withdrawing a visit sends nothing. The first message named nothing to
    take back.
  - The staff view shows how each guardian was told.
- **Audit:** create, add medicine, withdraw, both reads and the notice
  counts. Flags and counts only: no complaint, action, medicine or dose.
- **Website:**
  - A **Sickbay** page (`/sickbay`, its own menu item gated on
    `sickbay.manage`, and in the middleware list). It shows one day's visits;
    **Record a visit** finds the child, then takes the day, time, complaint,
    action, medicines, **Sent home** and **Share details with the parent**.
    Each visit can **Add medicine** and **Withdraw visit**.
  - The child's health record gains a **Sickbay visits** section, shown only
    with `sickbay.manage`.
- **Staff app:** a **Sickbay visits** card on the child's health record. It
  lists visits, records a visit for today (time, complaint, action, one
  medicine, sent home, share) and withdraws. An earlier day, and medicine
  given later, are on the website.
- **Parent website and app:** the Health record card lists the visits, with
  the details when shared. The app keeps them off the phone's storage
  (`persist: false`).
- **Tests:**
  - 13 sickbay service tests against real Postgres:
    - record with medicine;
    - future, backdated and before-the-visit times refused;
    - medicine added later;
    - withdrawn means kept and closed;
    - a teacher and a bursar are refused, and another school sees nothing;
    - an ordinary visit: push only, no SMS;
    - sent home: one SMS, with the exact text and no complaint or medicine;
    - once per guardian;
    - the fixed SMS text;
    - unshared visits show the parent the time only, shared ones the details;
    - a withdrawn visit is gone for the parent;
    - an unlinked guardian and another school's guardian get nothing;
    - the audit log holds no health text.
  - Permission coverage for the four new routes.
  - e2e `health-sickbay.spec.ts`: the Health officer records a sent-home
    visit that is not shared and a shared visit with medicine. The parent
    sees both, "Sent home" on one, and only the shared one's details.
  - `/sickbay` was added to `phone-fit.spec.ts`. The page, the form, the
    child's section, the parent website and both app cards were checked at
    320px and 390px.

## 11. CP4 plan-first — Assignments: submissions and marking

Written 2026-10-16. **Owner, 2026-10-16: approved as written**, with my
recommendations taken for Q8 (CP4-D5), for no push on returned work or
released marks (CP4-D10), and for exact fill-in matching (CP4-D6).

### 11.1 What exists today (read from the code)

- **Homework** (`the-school-day.md` Part B) is the `Assignment` model
  (`assignments`): class arm, subject, title, instructions, `due_date` as a
  `DATE`, posted, withdrawn. B7 says it is information, not workflow, and its
  schema comment says submissions, if built, get **their own plan and their
  own table**. The model must not grow a `submittedAt`.
  - Routes: staff `POST/GET /homework` and `POST /homework/:id/withdraw`
    (`homework.create` / `homework.read`), guardian
    `GET /portal/students/:id/homework`, student
    `GET /student-portal/me/homework`.
  - Who may read: owner, admin and teacher (`homework.read`/`create`), and the
    bursar (`homework.read`, for the counter lookup).
  - Where it shows: teacher and admin web, staff app, student app (`me/homework`),
    parent app. **The parent website has no homework view at all.**
- **Question bank:** types are `MULTIPLE_CHOICE`, `SHORT_ANSWER` and `THEORY`.
  **There is no fill-in-the-blank type.** Online exams mark multiple choice
  only, by exact option id (`cbt-marking.ts`); no text-answer marking or
  normalisation exists anywhere.
- **Gradebook:** online exams push results through
  `POST /assessment-scores/preview`, then `POST /assessment-scores/bulk`, with
  raw marks scaled by D60 (`scaleRawMark`, round half up). Teacher scope,
  enrolment and sign-off rules apply there already.
- **Students upload nothing today.** F1 (CP3.2) gives a checked, private
  upload: images and PDF, at most 10 MB, typed by the file's own bytes, read
  through five-minute links.
- **No text-similarity code exists** (only an eval-only Levenshtein in
  `packages/ai/evals`).

### 11.2 Decisions taken here (owner may overrule any)

- **CP4-D1. "Collect work" is a separate record, not new homework columns.**
  - A teacher switches it on for one homework item; that creates an
    `assignment_collections` row for it (one per homework item) holding: the
    total marks, which kinds of answer are accepted (typed text, files,
    questions), and whether work is still being accepted.
  - Homework without it behaves exactly as today. B7's rule holds: the
    `assignments` table gains nothing.
- **CP4-D2. Who may read and mark.**
  - Two new permissions in their own constant: `assignment.read` (see
    submissions) and `assignment.mark` (mark, return, release, push to the
    gradebook). Owner, admin and teacher hold both; **the bursar holds
    neither**, although the bursar keeps reading the homework list. Children's
    work is not a counter matter.
  - A teacher is held to their own class and subject pairs, as homework and
    the gradebook already are.
  - A student sees only their own submissions. A guardian sees only their
    linked children's.
- **CP4-D3. Submitting.**
  - One submission per student per attempt. A submitted attempt is final:
    the student cannot change it unless the teacher **returns** it for
    resubmission, which opens a new attempt. Earlier attempts are kept, never
    overwritten.
  - Work is accepted before and after the due date until the teacher clicks
    **Stop accepting work**. Work submitted after the due date's school day
    (Lagos) is marked **late**, worked out by the server.
  - Withdrawing the homework item hides the assignment from students and
    parents; its submissions are kept.
  - Students get no AI help of any kind (owner, 2026-10-14).
- **CP4-D4. Typed answers and the paste indicator (Q7).**
  - The answer box counts characters typed and characters pasted, and sends
    both with the text. The server clamps them to the text's length.
  - The teacher sees "about 80% pasted" beside the answer, with the note "a
    fact about how the text arrived, not a judgement". Pasting is allowed.
    The student and parent never see it, and it never changes a mark.
  - It is reported by the student's own device, so it can be wrong; the
    screen says so.
- **CP4-D5. File answers (Q8, owner 2026-10-16: as recommended).**
  - From the **app only**: photos or PDFs, at most **3 files per attempt**,
    10 MB each, checked by F1 and stored privately under a new
    `submission-file` key.
  - Readable by the teacher, owner and admin, the student, and that
    student's linked guardians, each through a five-minute link, audited.
- **CP4-D6. Questions and automatic marking.**
  - An assignment can carry a short list of questions: **multiple choice**
    (2–5 options, one correct, the question bank's shape) and **fill in the
    blank** (the teacher lists every accepted answer).
  - Multiple choice is marked by option. A fill-in answer is right when it
    equals an accepted answer after ignoring case, spaces at either end and
    repeated spaces inside. Nothing fuzzier: no "close enough" spelling.
  - The automatic mark is shown to the teacher, who can change it before
    release. A written answer is always marked by hand.
  - Multiple-choice questions can be copied in from the question bank. The
    question bank itself does not change (no fill-in type is added to it).
- **CP4-D7. Manual marking, feedback and release.**
  - The teacher gives a mark out of the total and written feedback per
    submission, or returns it for resubmission with a note.
  - Marks and feedback stay hidden from the student and the parents until the
    teacher clicks **Release marks** for the assignment. Release can be
    repeated as more work is marked; a mark changed after release shows the
    new value.
- **CP4-D8. The gradebook.** The teacher picks a grading component; the
  marked submissions go through the existing preview and save
  (`/assessment-scores/preview`, then `/bulk`) as raw marks scaled by D60. No
  new gradebook code, and the existing scope, enrolment and sign-off rules
  apply unchanged.
- **CP4-D9. The similarity check (Q7).**
  - On request, for one assignment: every pair of typed answers is compared
    on overlapping runs of five words (shingles), after removing the words of
    the assignment's own instructions and questions, so quoting the question
    is not counted.
  - Pairs above a set overlap (0.5) are listed for the teacher as "these two
    answers share a lot of wording: worth a look", with the shared passages
    highlighted. Answers under 50 words are skipped.
  - Never called plagiarism, never shown to students or parents, never
    stored as a finding against a child, never used in a mark. Each run is
    audited.
  - Files are not compared (a photo of handwriting has no text to compare).
- **CP4-D10. Notifications.** None in CP4, as B9 decided for homework. The
  student's Today band shows "work returned to you" and "marks released"; the
  parent's child card shows what is due and what was handed in. A push for
  these is left out on purpose (§11.6).
- **CP4-D11. Audit.** Every mark, return, release, gradebook push,
  similarity run and file read is audited. The answer text and feedback never
  go into audit metadata: ids, counts and flags only.

### 11.3 What gets built

| Slice | What | Where |
|---|---|---|
| **CP4.1** | Collect work, typed answers with the paste indicator, manual marking, feedback, return, release; the student's and parents' views | API; teacher web and staff app; student app; parent app and parent website (which also gains the homework list it has never had) |
| **CP4.2** | File answers (Q8) under the `submission-file` key | API; student app; teacher web and app; parent app and website (view only) |
| **CP4.3** | Questions and automatic marking, with copying multiple choice in from the question bank | API; teacher web and app; student app |
| **CP4.4** | The similarity check and the gradebook push | API; teacher web and app |

Each slice is one PR, merged before the next starts.

### 11.4 Data

- **CP4.1:**
  - `assignment_collections`: the homework item (unique), total marks,
    accepts typed text, accepts files, accepts questions, accepting work,
    marks released at.
  - `assignment_submissions`: the assignment, the student, the attempt
    number (unique together), the text, typed and pasted character counts,
    submitted at, late, the mark, feedback, marked by and when, returned by,
    when and why.
- **CP4.2:** `assignment_submission_files`: the submission, its order (1–3),
  type and size (a `CHECK` keeps both within F1's limits).
- **CP4.3:** `assignment_questions`: the assignment, order, type
  (`MULTIPLE_CHOICE` or `FILL_IN`), text, marks, options (multiple choice),
  accepted answers (fill-in). The student's answers are kept on the
  submission, keyed by question.
- Every table is tenant-scoped with RLS forced. No SECURITY DEFINER function:
  every read happens after the tenant is known.

### 11.5 Tests (the rules first)

- **Who reads what, pinned per role:**
  - a teacher sees and marks only their own classes' submissions; owner and
    admin see all; the bursar sees none;
  - a student sees only their own submissions, and their mark only after
    release;
  - a linked guardian sees their child's; an unlinked guardian, and another
    school's, get nothing (RLS).
- A submitted attempt cannot be changed; a return opens a new attempt and
  keeps the old one.
- Late is worked out on the Lagos date, including just after midnight.
- The paste counts never reach a student or a parent response.
- Automatic marking: case, spacing, an empty answer, an answer that matches
  none of the list.
- Release hides and then shows marks to the student and parents.
- The gradebook push goes through the existing preview and save, scaled by
  D60.
- The similarity check: identical answers, answers sharing only the quoted
  question, short answers skipped, and a teacher of another class refused.
- Files: three per attempt, disguised files refused, links only for those
  who may read.
- **e2e:** a teacher collects work; a student submits a typed answer; the
  teacher marks it and releases; the parent sees the mark. One per later
  slice.
- **Phone-fit:** every new page and app screen at 320px and 390px.

### 11.6 Left out on purpose

- Any AI-written-work detector (Q7: no).
- AI help for students of any kind (Q6), and AI marking (that is CP4b, its
  own plan and PR).
- Push or SMS for returned work or released marks (CP4-D10; B9's reasoning).
- Comparing files or handwriting for similarity.
- Peer review, group submissions, rubrics with several criteria.
- A fill-in type in the question bank itself.
- A student web account; students use the app.

### 11.7 As built — CP4.1, collecting work, typed answers and marking (2026-10-16)

- **Data:** migration `20261025120000_assignment_submissions` adds two
  tables, both with RLS forced:
  - `assignment_collections`: one per homework item (unique), the total
    marks (1–1000) and whether work is still accepted.
  - `assignment_submissions`: one row per student per attempt (unique on
    collection, student and attempt), the answer (up to 20,000 characters),
    the typed and pasted counts, submitted at, late, mark, feedback, who
    marked it and when, released at, and who returned it, when and why.
    `CHECK`s keep a mark together with its marker and time, allow release
    only of a marked attempt, and never let a returned attempt carry a mark.
  - The `assignments` (homework) table gains nothing: only a Prisma relation
    field. The homework list's DTO gains `collectsWork`.
  - The two permissions, `assignment.read` and `assignment.mark`, go to admin
    and teacher in the same migration. Owner holds them by wildcard; the
    bursar holds neither. No SECURITY DEFINER function; the count stays 23.
- **API**, `AssignmentsController` at `/assignments` (the homework item's id):
  - `PUT /assignments/:id/collection` (`assignment.mark`): switch on
    "collect work", change the total, stop or restart accepting work. The
    total can't go below a mark already given.
  - `GET /assignments/:id/submissions` (`assignment.read`): the marking page,
    with everyone in the class now, plus anyone who handed in and has since
    moved.
  - `GET /assignments/:id/students/:studentId` (`assignment.read`): one
    student's attempts, newest first, with "about N% pasted".
  - `POST /assignments/submissions/:id/mark` and `/return`
    (`assignment.mark`): only the student's latest attempt. A returned
    attempt can't be marked; a marked one can't be returned.
  - `POST /assignments/:id/release` (`assignment.mark`): releases every
    marked attempt not yet released. A mark changed later shows its new
    value.
  - A teacher is held to the class and subject pairs in their own teacher
    scope, as homework is.
- **Students** (`/student-portal/me/assignments`, `/:id`, `/:id/submit`):
  - Work is handed in once. Returned work may always come back; new work
    only while the teacher accepts it.
  - Late is worked out by the server on the Lagos day.
  - The paste counts are clamped to the answer's length. The student's
    shape has no field for them, and shows a mark only once released.
- **Parents** (`GET /portal/students/:id/assignments`, behind
  `withGuardian`): status, late, and the mark and feedback once released.
  No answer text and no paste counts.
- **The paste counter** (`apps/mobile/src/lib/family/paste-counter.ts`): a
  phone's text box has no paste event, so one change that adds 15 or more
  characters counts as pasted and smaller ones as typed. Predictive text
  stays under the threshold. The student is told it is counted.
- **Audit:** collect, submit (as the student), mark (the number, never the
  feedback text), return, release.
- **Website:**
  - Teacher homework page: **Collect work** on each item (asks for the
    total), then **Handed-in work**, which opens `/teacher/homework/[id]`.
  - The admin homework lookup links to `/homework/[id]` for anyone holding
    `assignment.read`; the bursar sees the homework but not the link.
  - The marking page: the counts, the total, **Stop accepting work**,
    **Release N marks**, and a row per student that opens their attempts
    with a mark and feedback form, or **Return to student** with a note.
- **Staff app:** the same on the homework screen (**Collect work**,
  **Handed-in work**) and a marking screen, `app/staff/homework/[id]`.
- **Student app:** collected items on My homework get **Hand in work** /
  **View my work**, opening `app/me/assignments/[id]`. Earlier work with
  marks is listed below the homework. Kept off the phone's storage.
- **Parent app and website:** the child's homework shows each collected
  item's status and the released mark and feedback, plus earlier work. The
  parent website gains a **Homework** card it never had.
- **Tests:**
  - 11 service tests against real Postgres covering:
    - who may collect and read (another class's teacher and the bursar are
      refused);
    - handing in once, with the paste counts reaching staff only;
    - late on the Lagos day, and stopping acceptance;
    - another class's child refused;
    - marks hidden until release, and a changed mark shown after it;
    - the total not going below a given mark;
    - return opening a new attempt that keeps the old one;
    - an unlinked or another school's guardian refused;
    - withdrawn homework leaving the family's list;
    - the pure rules (status, late just after midnight, clamping);
    - no answer or feedback text in the audit log.
  - 3 tests for the paste counter. Permission coverage for the six staff
    routes, and the bursar holding neither permission.
  - e2e `assignment-marking.spec.ts`: the teacher sets homework and collects
    work, an answer arrives, the teacher marks and releases, and the parent
    sees the mark and feedback but never the answer or the paste figure.
  - Every new screen was checked at 320px and 390px on the website, the
    parent website and the app.

### 11.8 As built — CP4.2, file answers (2026-10-16)

- **Data:** migration `20261026120000_assignment_submission_files`:
  - Adds `assignment_submission_files` (the collected homework, the student,
    the attempt once handed in, the file's type and size), with RLS forced.
    `CHECK`s keep the type to the four F1 allows and the size within 10 MB.
  - Makes an attempt's text optional, so an attempt may be files alone. It
    still needs text or at least one file.
  - No new permission and no SECURITY DEFINER function; the count stays 23.
- **How a file travels:** a new `submission-file` storage key,
  `schools/<school>/submissions/<id>.<ext>`.
  - The student attaches up to three photos or PDFs one at a time. On a weak
    signal a failed photo is retried alone, not the whole batch.
  - Each file is typed by its own bytes (F1) and **staged**: it belongs to the
    student and the homework, with no attempt yet. The student can remove a
    staged file.
  - **Hand it in** sends the text (if any) and attaches every staged file to
    the new attempt, as final as its text. A handed-in file can't be removed.
  - Nobody but the student sees a staged file.
- **API:**
  - Student: `POST /student-portal/me/assignments/:id/files` (multipart)
    stages a file. `DELETE …/files/:fileId` removes a staged one.
    `GET /student-portal/me/assignments/files/:fileId` gives the student's own
    five-minute link.
  - `GET /assignments/files/:fileId` (`assignment.read`): staff open a
    handed-in file, held to the teacher's own class and subject pairs.
  - `GET /portal/students/:id/assignment-files/:fileId`: a linked guardian
    opens a handed-in file. A staged file reads as not found.
  - The DTOs carry each attempt's files, the student's staged files, the
    roster's file count, and the family's latest handed-in files.
  - Every read is audited, with the reader's kind (staff, student, guardian).
    So are staging and removing.
- **Screens:**
  - Student app: the hand-in screen gains **Take a photo**, **Choose a photo**
    and **Choose a PDF**, the staged list with **View** and **Remove**, and
    the files on each attempt. Handing in is possible with files alone.
  - Staff app and teacher website: each attempt shows **View photo** /
    **View PDF**, and the roster shows the file count.
  - Parent app and website: the handed-in files under each item's status.
- **App permission wording** (`app.json`) now names schoolwork as well as
  receipts. The new wording shows after the app is next built.
- **Tests:**
  - 3 new service tests:
    - staging up to three, a disguised file refused, a staged file removed;
    - handing in with files alone, after which a file can't be removed or
      added;
    - the teacher can't open a staged file, and another class's teacher is
      refused;
    - the student and a linked guardian open handed-in files, and an
      unlinked guardian is refused;
    - an attempt needs text or a file;
    - a guardian never reaches a staged file.
  - The storage path for `submission-file`, and permission coverage for the
    staff file route.
  - e2e `assignment-files.spec.ts`: the teacher and the parent each open a
    handed-in PDF through its link, and a staged photo is not on the
    parent's page.
  - The student's attach screen, the staff app's and website's marking
    views with files were checked at 320px and 390px.

### 11.9 As built — CP4.3, questions and automatic marking (2026-10-16)

- **Data:** migration `20261027120000_assignment_questions`:
  - Adds `assignment_questions` (the collected homework, the order, the type
    `MULTIPLE_CHOICE` or `FILL_IN`, the text, the marks, and either the
    options with the right one's index or the accepted answers), with RLS
    forced. A `CHECK` holds each type to its shape: multiple choice has 2–5
    options and a right index inside them; fill-in has 1–10 accepted answers.
    `source_question_id` records a copy from the question bank (a plain
    column; the copy stands on its own).
  - Adds `answers` (keyed by question id: the option's index or the text) and
    `auto_mark` to `assignment_submissions`.
  - No new permission and no SECURITY DEFINER function; the count stays 23.
- **Rules:**
  - The teacher edits the questions as one list and saves them together. The
    questions add up to no more than the total, and the total can't then drop
    below them.
  - **The questions are fixed once anyone has handed in**, so an automatic mark
    never has to be worked out again against different questions.
  - The server works out the automatic mark when the student hands in, never
    the phone. A fill-in answer is right when it equals an accepted answer
    after ignoring case, spaces at either end and repeated spaces inside
    (`normaliseFillIn` in `@school-kit/types`). Blank answers are wrong.
  - An answer to a question that isn't on the work, or the wrong kind of
    answer, is refused. An attempt needs an answer, text or a file.
  - The automatic mark is the teacher's starting point. The mark box opens
    with it, and the teacher saves it or changes it. **Use automatic marks**
    sets the mark from it in one go, but only for work that is answers alone:
    work with written text or a file still needs a person to read it. Nothing
    reaches the family until **Release marks**, as before.
  - The student never receives a right answer. They see which of theirs were
    right only with the released mark. Parents see no answers at all.
- **API** (owner, admin, the class's teachers; `assignment.mark`):
  - `PUT /assignments/:id/questions` replaces the questions.
  - `GET /assignments/:id/bank-questions` lists approved multiple-choice
    bank questions for the homework's class level and subject: the pair the
    teacher is already held to. Only ones that fit (2–5 options, one right)
    are listed, and a copy must name one of them.
  - `POST /assignments/:id/auto-marks` uses the automatic marks.
  - Audited as `assignment.questions.set` (counts and marks only) and
    `assignment.automarks.use` (how many). No question or answer text goes
    into the audit log.
- **Screens:**
  - Teacher website (marking page): a **Questions** section to add multiple
    choice and fill-in questions, or copy multiple choice from the question
    bank, with a running total against the work's total. Each attempt shows
    its answers marked **Right** or **Wrong**, in words as well as by tint,
    and the roster shows the automatic mark. **Use automatic marks** sits
    beside **Release marks**.
  - Staff app: the questions with their right answers, each attempt's
    answers, the automatic mark in the mark box, and **Use automatic marks**.
    Questions are added and changed on the website. The app says so; a list
    editor on a phone was left out of this slice.
  - Student app: the questions above the written answer, with tappable
    options and a box for each fill-in. Handing in with blanks asks first. After
    release, each answer shows right or wrong.
- **Housekeeping:** removes `e2e/tests/zz-fit-tmp.spec.ts`, a temporary
  phone-fit check committed by mistake with CP4.1.
- **Tests:**
  - 4 new service tests:
    - setting questions: over the total refused, another class's teacher
      refused, no right answer reaching the student;
    - wrong kinds of answer refused, blanks wrong, the automatic mark worked
      out, the questions fixed after the first hand-in, the total held above
      them, right or wrong shown to the student only after release, nothing
      reaching the family;
    - automatic marks used only for answers-only work, not for another
      class's teacher;
    - copying from the bank: only approved multiple choice for this level and
      subject;
    - fill-in matching: case and spacing ignored, a misspelling or a missing
      space not.
  - Permission coverage for the three new routes.
  - e2e `assignment-questions.spec.ts`: a teacher adds both kinds of question
    on the website, sees a child's answers marked right, uses the automatic
    mark and releases it.
  - The website's question editor and marking view, the staff app's marking
    screen and the student's answering screen were checked at 320px and
    390px.

### 11.10 As built — CP4.4, the similarity check and the gradebook push (2026-10-16)

- **Data:** none. No migration, no new permission, no SECURITY DEFINER
  function; the count stays 23. Nothing the similarity check finds is stored.
- **The similarity check (CP4-D9):** `POST /assignments/:id/similarity`
  (`assignment.read`: owner, admin and the class's teachers, held to the
  teacher's own class and subject pairs).
  - Each student's latest typed answer is cut into overlapping runs of five
    words (case and punctuation ignored). Runs that also appear in the
    homework's title, instructions or questions are dropped, so quoting the
    question is not counted. Answers under 50 words are skipped.
  - A pair is listed when at least half of the **shorter** answer's runs are
    in the other one. That is containment, not Jaccard, so an answer copied
    whole into a longer one still shows. Most alike first, at most 50 pairs.
  - The screens say "share a lot of wording (about N%): worth a look", and
    "Show the answers" highlights the shared wording in both, in words and by
    tint. Never "plagiarism".
  - Never shown to a student or parent, never stored, never part of a mark.
    Each run is audited as `assignment.similarity.run`, with counts only and
    no names or wording.
  - The code is `apps/api/src/modules/assignments/similarity.ts`: pure
    functions with their own spec.
- **The gradebook push (CP4-D8):** no new gradebook code. The marking DTO
  gains `subjectId` and the current `termId`. The screen sends each marked
  student's mark as a raw mark out of the work's total through the
  gradebook's own `POST /assessment-scores/preview`, then `/bulk`. The
  server scales it (D60), applies its own scope, enrolment and sign-off
  rules, and audits the save as it does any gradebook save. Work still to
  mark is not sent.
  - The column list comes from `GET /grading-scheme`, which teachers may
    read. `GET /grading-scheme/components` needs `grading-component.read`,
    which teachers don't hold. (The online-exams results page uses the
    latter, so a teacher's column list there is empty until the exam names
    a column; recorded here, not changed in this slice.)
- **Screens:**
  - Teacher website (marking page, below the students): **Send to the
    gradebook** (column, **Preview gradebook marks**, the preview, **Save to
    gradebook**) and **Similar wording** (**Check for similar wording**, the
    pairs, **Show the answers**).
  - Staff app: the same two, as cards below the students. Columns are chips.
- **Tests:**
  - `similarity.spec.ts`:
    - identical answers, with every character returned in order;
    - wording quoted from the question not counted;
    - an answer copied into a longer one found;
    - short answers skipped, and under half not listed;
    - case and punctuation ignored.
  - 2 new service tests:
    - the pair listed for the class's teacher, another class's teacher and
      the bursar refused, nothing reaching the student, the audit holding
      counts alone;
    - the marking DTO carrying the subject and current term.
  - Permission coverage for the new route.
  - e2e `assignment-gradebook.spec.ts`: two marked answers sharing their
    wording are listed with the shared passage highlighted, and both marks
    are previewed, scaled and saved to a gradebook column.
  - The website's two sections and the staff app's two cards were checked at
    320px and 390px.

CP4 is complete with this slice. CP4b (AI-drafted feedback) has its own plan,
and its own row in CLAUDE.md's allowlist if it ever needs one.

## 12. CP4b plan-first — AI-drafted marking feedback (optional)

Written 2026-10-16. **Owner, 2026-10-16: approved, with all four
recommendations in §12.6** (school switch off by default; typed answers only;
no label for families; the `assignment-feedback` allowlist row, this approval
being its sign-off). Owner, 2026-10-16:
"make it optional so teachers can do it without AI". Q6 (owner, 2026-10-14)
already approved the principle: the model may draft marking feedback, with the
name removed, and a teacher approves it.

### 12.1 What exists today (read from the code)

- **Marking (CP4.1–CP4.4):** a teacher types a mark and feedback per attempt
  and saves it; nothing reaches the student or parents until **Release
  marks**. Questions are marked automatically; written text and files are
  marked by hand.
- **AI plumbing:**
  - `AiGenerationService.generate` refuses when the school's `ai_enabled` is
    off (the platform's per-school kill switch). It reserves the tokens
    against the school's monthly budget **before** the call, logs every call
    to `ai_generations`, and settles afterwards.
  - Prompts live in `packages/ai/src/prompts` with a name, version and model,
    and are covered by `pnpm ai:eval`.
- **The nearest pattern** is report-card comment drafts (`report-comments`):
  - Drafts are queued (BullMQ), one call per student, and never written into
    the student's record. Only an explicit **accept** does that.
  - No model call happens inside a database transaction (read, then call,
    then write).
  - Under `PLAN_ENFORCEMENT=enforce`, the `aiReportComments` plan feature
    keeps them off the Free plan.
- **The PII allowlist** in CLAUDE.md has one row (`student-list-extraction`),
  pinned by `packages/ai/evals/cases/pii-safety.ts`, which fails CI if the
  list changes without the spec changing too.

### 12.2 Decisions (owner may overrule any)

- **CP4b-D1. Optional at every level; marking by hand is unchanged.**
  - Nothing about marking changes for a teacher who never presses the new
    button. The mark box, the feedback box, **Save mark**, **Return to
    student** and **Release marks** work exactly as they do now.
  - Three switches, all of which must be on for the button to show:
    1. **The platform's** `ai_enabled` for the school (exists).
    2. **The school's own** new setting, **AI drafts of marking feedback**.
       It is **off by default**, and owner or admin turns it on in school
       settings. A school that wants no AI near children's work leaves it off.
    3. **The teacher's choice each time:** a **Draft with AI** button per
       piece of work, and **Draft feedback for all** per assignment. Nothing
       is ever drafted on its own.
  - Under `enforce`, a new plan feature, `aiMarkingFeedback`, keeps it off
    the Free plan, like report comment drafts.
- **CP4b-D2. What the model sees (Q6).**
  - The question as the teacher set it: the title, instructions and total
    marks.
  - The teacher's **marking guide**, if one was written. This is a new
    optional, staff-only field on the collected work ("what a good answer
    includes").
  - **The typed answer, with names removed.** Before sending, the server
    replaces the student's own first name, last name and admission number,
    and the first and last name of every student in the class, with
    `[name]`. The class level ("a JSS 2 student") is the only thing said
    about who wrote it.
  - Never sent: photos, PDFs, the student's id, the paste figure, earlier
    attempts, other students' work, or any record (health, behaviour,
    attendance).
  - Answers to the automatic questions are not sent; they are already
    marked.
- **CP4b-D3. What comes back: a draft, never a mark.**
  - A suggested mark (a whole number from 0 to the total), feedback written
    to the student (at most 2,000 characters), and one line for the teacher
    on why the mark was suggested. The teacher sees that line; the student
    never does.
  - Drafts are kept in their own staff-only table, `assignment_feedback_drafts`,
    and never written into the mark or feedback.
  - **Use draft** copies the mark and feedback into the teacher's own boxes.
    The teacher edits them and saves with **Save mark**, as now. Only that
    save writes a mark. Release stays a separate step.
  - **Discard** drops a draft. A new attempt starts with no draft.
- **CP4b-D4. The record says whether AI helped.**
  - A saved mark records whether it started from an AI draft
    (`feedback_ai_drafted`), so the school can always answer "was this
    AI-drafted?". The audit log records the draft request and its use, with
    counts and ids only and never the text.
  - Families are **not** shown a label. Feedback a teacher has read, edited
    and saved is the teacher's feedback. (Owner may overrule: a small "drafted
    with AI help" note for families is easy to add.)
- **CP4b-D5. The allowlist row, as Q6 requires.** CP4b's PR adds a second
  row, `assignment-feedback`, to CLAUDE.md's PII allowlist, and updates the
  eval spec that pins it.
  - The reason: the answer is the payload, and a child's own writing can
    name people even after the class roster's names are removed.
  - The row carries the same two binding rules as the first:
    1. The text is not kept by the model path beyond the request: no
       queue payload, no cache. The queue job carries ids only and reads the
       answer from the database when it runs.
    2. Nothing is written to a student's record without a teacher's
       explicit save.
- **CP4b-D6. Model and cost.** Haiku 4.5, as report comments use: short,
  structured output, one call per piece of work.
  - A class of 40 with 300-word answers costs a few naira. The output cap
    (about 600 tokens) keeps the budget reservation honest.
  - If the evals show Haiku marks unfairly, the next step is Sonnet for this
    one prompt, not a bigger output.
- **CP4b-D7. Queued, like report comments.**
  - **Draft with AI** and **Draft feedback for all** both enqueue jobs and
    return at once. The screen shows "Drafting…" and picks up drafts as they
    arrive.
  - **Draft feedback for all** covers unmarked, typed attempts that have no
    draft yet, up to the class size.
  - Each job is checked against the budget before its call. When the budget
    runs out, the remaining jobs stop with "The school's AI allowance for
    this month is used up", and marking by hand carries on.
- **CP4b-D8. Who.** Owner, admin and the class's teachers, using the
  existing `assignment.mark` (the bursar has none of it). Students and
  parents never see a draft, the teacher's line or the flag.

### 12.3 What gets built (one slice, one PR, web and app together)

| Part | What |
|---|---|
| Data | `assignment_feedback_drafts` (RLS forced); `assignment_collections.marking_guide`; `assignment_submissions.feedback_ai_drafted`; `schools.assignment_feedback_ai_enabled` |
| Prompt | `assignment-feedback` v1 in the registry, with its JSON schema and evals; the CLAUDE.md allowlist row and the pinning spec |
| API | the school setting; the marking guide on the collection; draft one, draft all, list drafts, discard; `Save mark` gains "started from an AI draft" |
| Website | school settings switch; marking guide box; **Draft with AI**, **Draft feedback for all**, the draft beside the mark box with **Use draft** and **Discard** |
| Staff app | the same buttons and draft card on the marking screen |

### 12.4 Tests (the rules first)

- **Optional:** with any of the three switches off, there is no draft route
  that works and no button. With all on, manual marking still behaves
  exactly as before (the CP4.1 tests stay as they are).
- **Name removal:** the rendered prompt has none of the student's names, the
  admission number, or any classmate's name, including inside words and
  with different capitals. It has no ids.
- **Never final:** a draft never changes the mark, the feedback or what the
  student or parents see. Only **Save mark** does, and release still gates
  the family.
- **Budget:** refused when it is used up; refused when `ai_enabled` is off;
  every call logged to `ai_generations`.
- **The queue payload** holds ids only, no answer text.
- **Evals** (`pnpm ai:eval`, real output where a key is set):
  - fairness: the same answer gets the same suggested mark within 1 across
    runs, and an answer with the student's name swapped gets the same mark;
  - no invented errors (a correct answer gets no "mistakes" listed);
  - the suggested mark stays within 0 to the total;
  - no names or gendered pronouns in the feedback.
- **Who:** another class's teacher and the bursar are refused; a student and
  a guardian never see a draft.
- **e2e:** the owner turns the setting on; a teacher drafts feedback (the AI
  client faked in e2e, as report comments are), uses it, edits it, saves and
  releases; the parent sees the teacher's saved text.
- **Phone fit:** the new controls at 320px and 390px.

### 12.5 Left out on purpose

- Drafting from photos or PDFs of handwriting (more of the child's page goes
  to the model, and names on paper can't be removed reliably).
- Any AI help for students (Q6).
- Drafting without a teacher pressing the button, or saving a draft as a mark
  without a teacher's save.
- A family-facing "AI-assisted" label (CP4b-D4, unless the owner wants it).

### 12.6 Questions for the owner

1. **School switch off by default** (CP4b-D1)? Recommended: yes.
2. **Typed answers only** (CP4b-D2, §12.5)? Recommended: yes.
3. **No label for families** (CP4b-D4)? Recommended: no label, but the school
   keeps the record internally.
4. **The `assignment-feedback` allowlist row** (CP4b-D5), as Q6 anticipated.
   Your approval of this plan is the sign-off the CLAUDE.md rule asks for.

### 12.7 As built — CP4b, AI-drafted marking feedback (2026-10-16)

- **Data:** migration `20261028120000_assignment_feedback_drafts`.
  - `assignment_feedback_drafts`: one per attempt, `PENDING`, `READY` or
    `FAILED`, with the suggested mark, feedback, the teacher's line and a
    readable failure. RLS is forced. `CHECK`s cap the lengths, and a `READY`
    draft must have a mark and feedback.
  - `schools.assignment_feedback_ai_enabled` (default false),
    `assignment_collections.marking_guide` (staff only, at most 4,000
    characters) and `assignment_submissions.feedback_ai_drafted`.
  - No new permission and no SECURITY DEFINER function; the count stays 23.
- **Optional at every level.** The buttons show only when all of these hold:
  the platform's `ai_enabled`, the school's own switch, the plan
  (`aiMarkingFeedback`, new, Starter and up under `enforce`), and AI being
  configured on the deployment. The job re-checks all of them when it runs.
  Marking by hand is untouched.
- **Prompt `assignment-feedback` v1** (Haiku 4.5, 600 output tokens), in the
  registry.
  - The renderer itself removes names (`removeNames`), so no caller can skip
    it. It takes whole words in any capitals, including before a possessive,
    never part of another word, and skips one-letter names.
  - The job passes the student's first, middle and last names and admission
    number, and every enrolled classmate's names (each part of a double
    name too). Names are removed again from the model's feedback before a
    teacher sees it.
  - The model returns `{ mark, feedback, reason }` as structured output. A
    mark that is not a whole number within the total is a failed draft,
    never clamped.
- **CLAUDE.md:** the allowlist has its second row, `assignment-feedback`, and
  `pii-safety.ts` pins the list at two.
- **API:**
  - `GET/PUT /assignments/ai-drafts/settings` (`school.update`; owner and
    admin), audited `assignment.ai-drafts.enabled` / `.disabled`.
  - `POST /assignments/submissions/:id/ai-draft` (one) and
    `POST /assignments/:id/ai-drafts` (every unmarked typed answer with no
    draft), both `assignment.mark`, both audited
    `assignment.ai-draft.request` with a count.
  - `DELETE /assignments/submissions/:id/ai-draft`, audited
    `assignment.ai-draft.discard`.
  - `PUT /assignments/:id/collection` takes `markingGuide`; the audit records
    only whether there is one.
  - `POST /assignments/submissions/:id/mark` takes `fromAiDraft`, stored as
    `feedback_ai_drafted` and audited as a flag.
  - The marking response gains `aiDrafting`, each roster row `draftStatus`,
    and each staff attempt `draft` and `feedbackAiDrafted`. The student's and
    family's shapes gain nothing.
- **Queue:** a fourth job name, `assignment-feedback`, on the AI queue.
  - The job holds `{ schoolId, userId, submissionId }` only (allowlist rule 1)
    and makes one attempt: a failure is shown to the teacher, who can press
    again, rather than paid for twice.
  - The work is read, then the model is called, then the draft is written,
    with no model call inside a transaction.
  - The single `@Processor` on that queue dispatches it. Its own note says
    moving the dispatcher into `common/ai` is due at a fourth feature; that
    is logged in `docs/deferred.md`, not done here.
- **Screens:**
  - Website **Settings → AI marking drafts**: what is sent to the AI, and the
    switch, with a note when the platform, the plan or the deployment keeps
    it off.
  - Marking page, when offered:
    - an **AI drafts (optional)** box with the **Marking guide** and **Draft
      feedback for all**;
    - per typed attempt, **Draft with AI**, then "Drafting…", then the draft
      in a tinted box. It shows the suggested mark, the feedback and "For
      you, not the student: …", with **Use draft** (fills the teacher's own
      boxes) and **Discard**. A failed draft says why, with **Try again**;
    - the roster shows "Drafting…" or "AI draft ready";
    - the page and the student's panel look again every few seconds while
      a draft is being made.
  - Staff app: the same box, panel and roster words on the marking screen.
- **Tests:**
  - `assignment-feedback.service.spec.ts`, 6 tests, real Postgres and the real
    `AiGenerationService`, with only the model faked:
    - off by default, a teacher can't switch it on, the platform switch
      still wins, and marking by hand is unchanged;
    - names (the student's, the admission number, a classmate's) never
      reach the model, and the job holds ids only;
    - the draft is never a mark and never reaches the student;
    - **Use draft** then **Save mark** records the flag, and release still
      gates the family;
    - **Draft feedback for all** covers unmarked typed answers only; another
      class's teacher is refused; files-only work is refused; discard works;
    - readable failures: an out-of-range mark, a used-up budget, and the
      switch turned off before the job ran (the model is never called);
    - the audit holds counts only.
  - Evals: the PII suite checks name removal (capitals, a possessive, a
    word that contains a name, one-letter names) and the two-row allowlist;
    prompt-quality and schema checks; and a live fairness suite (same mark
    within 1, name-swap, a complete answer not told it has errors, no
    pronouns), skipped without an API key.
  - Permission coverage for the five new routes; the plan-feature list.
  - e2e `assignment-ai-drafts.spec.ts`: the owner finds the switch off and
    turns it on. With the platform's AI off, the teacher sees no AI controls
    and marks by hand, and the mark is not flagged as AI-drafted. CI has no
    AI key, so the drafting path is covered by the integration tests.
  - The settings page, the marking page with a draft, and the staff app's
    marking screen with a draft were checked at 320px and 390px. **Use
    draft** filling the boxes and the saved flag were checked through the
    real UI with a seeded draft.


## 13. CP5 plan-first — Student charges (F2), then Transport

Written 2026-10-16 for the owner's approval. **Owner, 2026-10-16: approved
as written, with all four recommendations in §13.7** (supplementary invoices
yes; no discounts on charges; the primary guardian's phone on the driver's
list; no pro-rating). It answers Q4's open half (supplementary invoices) with a
recommendation; the owner's approval of this plan is that answer.

### 13.1 What exists today (read from the code)

- **Invoices are one per student per term.** `invoices` carries
  `UNIQUE(school_id, student_id, term_id)`. The generation run
  (`InvoiceGenerationService.generateForArm`) skips a student who already has
  one, and a CANCELLED invoice still blocks a second one, deliberately.
- **An invoice is a frozen snapshot.** `items` is a JSON copy of each fee
  item and its discounts at issue time (`buildSnapshot`, a pure function). No
  code adds or changes a line after issue, and nothing should.
- **Everything after issue works per invoice:** payments, Paystack payment
  links, payment plans, refunds, receipts, overdue marking, the debtor list,
  the dashboards' totals (`finance-totals.ts`), and the parent's fees page on
  the portal and app.
- **Two places assume one invoice per term:**
  - fee reminders (`FinanceService.sendReminders` reads "the" invoice with
    `findFirst`);
  - the class-change check in `enrollments.service.ts`, which also uses
    `findFirst`.
  Nothing else does. Report cards and the result checker do not read
  invoices.
- **A line item's `feeItemId` is only used as a list key** on the web,
  portal and app, so a line that does not come from a fee item is safe.
- **Transport does not exist.** `docs/ARCHITECTURE.md` §6.12 lists routes and
  pickup points, vehicles and drivers, student assignment, and transport fees
  tied to the fee structure. GPS is post-MVP.

### 13.2 Decisions on student charges (owner may overrule any)

- **CP5-D1. A charge is a single amount owed by one student for one term.**
  - It has:
    - a kind (TRANSPORT, LIBRARY_FINE, HOSTEL, OTHER);
    - a description ("Transport — Route A, Lekki");
    - the amount in kobo;
    - the source (module and record id; none for a charge added by hand);
    - a status (OPEN, BILLED, VOID), and the invoice once billed.
  - Charges are written in one place only, a new `StudentChargeService` in
    the finance module. Transport (and later library and hostel) call it
    inside their own transaction; they never write the table themselves. A
    spec scans the API for any other write to `student_charges` and fails, as
    the accent-border spec does for styles.
  - Every raise, re-price, bill and void writes to `audit_logs`, with
    amounts and ids, never a name.
- **CP5-D2. How invoices pick charges up.**
  - When the term's invoices are generated, each student's OPEN charges for
    that term become lines on the invoice, after the fee items. They are
    marked BILLED with the invoice's id in the same transaction, so a charge
    can never be on two invoices.
  - A charge line reads like a fee line: the category is the kind's name
    ("Transport"), the fee name is the description. It carries `chargeId` in
    place of `feeItemId`.
  - **Discounts do not apply to charges.** Discount rules point at fee items
    and fee categories; a charge is neither. To excuse a child a charge, the
    bursar voids it.
  - The **preview** shows the charges too, so the bursar sees what will be
    billed before issuing.
- **CP5-D3. Supplementary invoices: recommended yes (answers Q4).**
  - Without them, a charge raised after the term's invoice went out (a child
    joins a bus route in week 3) waits for next term's invoice. The parent
    then pays this term's bus fare on next term's bill, which reads like a
    mistake, and the school waits months for the money.
  - The design:
    - An invoice gains a `kind`: TERM (every invoice today) or SUPPLEMENTARY.
    - The unique rule becomes one **term** invoice per student per term, as
      a partial unique index (`WHERE kind = 'TERM'`). Supplementary invoices
      are not limited.
    - The bursar presses **Bill waiting charges** for a term. For every
      student who **already has that term's invoice** and holds OPEN charges
      for the term, it issues one supplementary invoice holding all of those
      charges, with a due date the bursar sets. A student with no term
      invoice yet is left alone; the charges ride on their term invoice when
      it is generated.
    - The screen first shows what will be issued (students, charges, total),
      like the invoice preview.
    - Nothing is issued on its own when a charge is raised. Tiny invoices
      sent one by one would flood parents with payment links.
  - A supplementary invoice is an ordinary invoice afterwards: payment,
    Paystack, payment plans, refunds, receipts, overdue marking and the
    totals all work unchanged. It is labelled "Supplementary" on the invoice
    page, the debtor list, and the parent's fees page.
  - The two `findFirst` readers are fixed:
    - reminders sum every outstanding invoice the student has for the term
      and quote that balance;
    - the class-change check looks for the term invoice only.
- **CP5-D4. Voiding, and what can never change.**
  - An OPEN charge can be voided, with a reason, by the bursar, owner or
    admin.
  - A BILLED charge cannot be voided, because it is on an invoice the parent
    has already received. If the invoice is unpaid, cancelling it (which
    exists) returns its charges to OPEN, where they can be voided or billed
    again. If money has been paid, the existing refund path is the remedy.
  - A charge's amount can change only while it is OPEN, and only through its
    source (a route's new fee, D7). A billed amount never changes.
- **CP5-D5. Adding a charge by hand.** The bursar, owner or admin can add an
  OTHER charge on a student's finance tab ("Excursion to Badagry", ₦5,000).
  This makes F2 useful, and testable, before transport exists, and covers
  the one-off costs schools ask about.
- **CP5-D6. Who.**
  - New permissions:
    - `charge.read` for owner, admin and bursar;
    - `charge.raise` and `charge.void` for owner, admin and bursar.
  - Billing waiting charges uses the existing `invoice.issue`.
  - Teachers, students and parents never see charges as such. Parents see
    them only as lines on an invoice, like every fee.

### 13.3 Decisions on transport (owner may overrule any)

- **CP5-D7. Records.**
  - **Vehicles:** plate number (unique in the school), a description
    ("Toyota Coaster, white") and the number of seats.
  - **Drivers:** name, phone, licence number and licence expiry (a calendar
    date). The list warns 30 days before a licence expires, and shows "expired"
    after. Drivers are records, not accounts; they never sign in.
  - **Routes:** a name, the vehicle, the driver, and the **fee per term**.
    The fee is set on the route's own page (owner, 2026-10-14). Changing it
    re-prices the route's OPEN charges for the current and later terms, with
    audit; billed charges keep their amount.
  - **Stops:** each route has stops in order, with a name and an optional
    pickup time (minutes since midnight, the project's time-of-day rule).
- **CP5-D8. Putting a child on a route.**
  - A student is put on one route and one stop for a term. Putting them on
    a route raises one TRANSPORT charge for that term at the route's fee.
    Nobody types a transport amount for a child.
  - **Capacity:** a route takes no more children in a term than its vehicle
    has seats. A route with no vehicle takes none. The check runs inside the
    same transaction as the insert, with the route row locked, so two staff
    adding the last seat at once cannot both succeed.
  - **Moving** a child to another route in the same term keeps the single
    transport charge. If the charge is still OPEN, it takes the new route's
    fee; if it is billed, it stays as it is.
  - **Removing** a child voids an OPEN charge. A billed one stays, and the
    school decides on any refund, as today.
  - **Next term:** **Copy to next term** puts the same children on the same
    stops for the next term, checks capacity, and raises next term's charges.
    Those charges wait, OPEN, for next term's invoice run.
  - A withdrawn student's assignment for later terms is removed and its OPEN
    charges voided, through the same path.
- **CP5-D9. The daily route list.**
  - For a route and a date, the list shows the stops in order with their
    pickup times, and the children at each stop with their class.
  - It shows only children enrolled on that date.
  - It is available as a printable PDF (the existing renderer, F3) and on
    the staff app.
  - It includes the primary guardian's phone number, so a driver waiting at
    a stop can call. This is a question for the owner (§13.7); without it,
    the list has names and classes only.
- **CP5-D10. Parents.** The portal and parent app show each child's route,
  stop, pickup time, the driver's name and phone, and the vehicle's plate,
  for the current term. The fee appears on the invoice like any other line.
- **CP5-D11. Who manages transport.**
  - New permissions, held by owner and admin:
    - `transport.read`;
    - `transport.manage` (vehicles, drivers, routes, stops, assignments).
  - Setting a route's **fee** also needs `charge.raise`, so the bursar can
    set fees, and an admin without finance access cannot.
  - The bursar gets `transport.read`. Teachers get nothing.
  - No new role in this checkpoint. A "transport officer" role, like the
    health officer, can be added later if schools ask for one.
- **CP5-D12. Plans.** Transport and charges are not a paid extra. Billing is
  core finance, and gating it would make a Free school's invoices wrong.

### 13.4 What gets built

| Slice | PR | What |
|---|---|---|
| **CP5.1** | its own, reviewed first | **F2.** `student_charges` (RLS forced); `invoices.kind` and the partial unique index; `StudentChargeService` (raise, re-price, void, list); generation and preview pick up charges; **Bill waiting charges** with its preview; cancelling an invoice returns its charges to OPEN; the reminder and class-change fixes; the "Supplementary" label on web, portal and app; the student finance tab's charges list with **Add a charge** and **Void**; the write-only-here spec. |
| **CP5.2** | second | **Transport records and assignments.** Vehicles, drivers, routes with stops and fee, assignments with capacity, moving, removing, copy to next term, charges through CP5.1's service. Web pages under Transport, and the student's transport line on the student page. |
| **CP5.3** | third | **The daily list and families.** The route list (PDF and staff app); the transport card on the portal and parent app; licence expiry warnings. |

### 13.5 Tests (the money first, written before the code)

- **Charges (CP5.1), test-first:**
  - A generated invoice includes the student's OPEN charges for that term,
    and none from another term or another student. Its totals are
    fee items + charges − discounts, and discounts never touch a charge
    line.
  - Billing marks each charge BILLED with the invoice id in the same
    transaction. Generating twice, or two runs at once, never bills a charge
    twice.
  - **Bill waiting charges** issues one supplementary invoice per student
    who has a term invoice, holding exactly their OPEN charges. It skips
    students with no term invoice, and skips everyone once nothing is OPEN.
    The preview's figures equal what is issued.
  - The partial unique index: a second TERM invoice is refused; any number
    of SUPPLEMENTARY invoices are allowed. A cancelled term invoice still
    blocks regeneration, as now.
  - Void works on OPEN only, needs a reason, and is audited. Cancelling an
    unpaid invoice returns its charges to OPEN. A billed amount is never
    changed by any path.
  - Payments, Paystack, payment plans, refunds and overdue marking work on a
    supplementary invoice unchanged: the existing specs re-run against one.
  - Totals: `finance-totals.spec.ts` gains a student with a term invoice and
    a supplementary one, and the dashboard and finance figures still agree.
  - Reminders quote the sum of the student's outstanding invoices for the
    term.
  - Who: a teacher, a parent and a student are refused on every charge
    route. Another school's charge is invisible (RLS).
  - The write-only-here spec fails if any other file writes the table.
- **Transport (CP5.2, CP5.3):**
  - Capacity: the last seat goes to exactly one of two concurrent requests;
    a route with no vehicle refuses.
  - Assigning raises one charge at the route fee. A fee change re-prices
    OPEN charges only. A move keeps one charge, and removal voids an OPEN
    charge but leaves a billed one alone.
  - Copy to next term honours capacity and raises next term's charges.
  - The daily list holds only children enrolled on the date, in stop order.
  - A parent sees their own child's route and the driver's phone, never
    another child's.
- **e2e:**
  - The bursar adds a charge and generates invoices; the charge is a line.
    A charge raised after issue is billed as a supplementary invoice, and
    the parent sees and can pay it.
  - The admin creates a vehicle, driver and route with stops and a fee,
    puts a child on it, and the charge appears; the parent sees the route
    card.
- **Phone fit:** every new screen at 320px and 390px.

### 13.6 Left out on purpose

- GPS and live bus tracking (post-MVP, needs hardware).
- Boarding check-in on the bus, and SMS to parents on pickup.
- Pro-rating a fee for a child who joins mid-term. The full term's fee is
  charged; the bursar can void it and add a smaller OTHER charge by hand.
- Discounts on charges (D2).
- Driver accounts or a driver app.
- Library and hostel; they reuse F2 in CP6 and CP6b.

### 13.7 Questions for the owner

1. **Supplementary invoices** (CP5-D3, Q4)? Recommended: **yes**, issued only
   when the bursar presses **Bill waiting charges**, never on their own.
2. **No discounts on charges** (CP5-D2)? Recommended: yes; voiding covers
   the exceptions.
3. **The guardian's phone on the driver's printed list** (CP5-D9)?
   Recommended: yes, the primary guardian's number only. The sheet carries
   "Confidential: for the driver's use on this route".
4. **No pro-rating** (§13.6)? Recommended: yes, keep it simple; the bursar
   adjusts by hand.

### 13.8 As built — CP5.1, student charges and supplementary invoices (2026-10-16)

- **Data** (migration `20261029120000_student_charges`):
  - `student_charges`, RLS forced. CHECKs on the database itself:
    - amount from 1 kobo to ₦10m;
    - description 1–200 characters;
    - BILLED exactly when an invoice is set;
    - VOID exactly when a reason and time are set;
    - source module and id both set or both null.
  - A partial unique index allows one live (not VOID) charge per source, so a
    transport assignment can never raise two.
  - `invoices.sequence`: 0 is the term invoice, 1, 2, … are supplementary.
  - **One deviation from the plan's wording:** the plan named an `invoices.kind`
    column and a partial unique index. As built, the unique key simply widens
    to `(school, student, term, sequence)`, and the API derives `kind`
    (`TERM`/`SUPPLEMENTARY`) from the sequence. It is the same rule (one term
    invoice per student per term, any number of supplementary ones), but Prisma
    knows the key exactly, so `findUnique` still works and there is no index
    the client cannot see.
  - Permissions `charge.read`, `charge.raise` and `charge.void`, for owner (via
    `*`), admin and bursar. No new SECURITY DEFINER function; the count stays
    23.
- **One writer.** `StudentChargeService` (finance module) is the only code that
  writes the table. `student-charge-writes.spec.ts` scans the API source and
  fails on any other Prisma or SQL write. Its in-transaction methods are what
  transport will call in CP5.2:
  - `raise`;
  - `reprice` (OPEN only, returning `repriced`/`billed`/`none`);
  - `voidBySource`;
  - `openForBilling`;
  - `markBilled`, which is conditional on each charge still being OPEN and
    throws otherwise, rolling the invoice back with it;
  - `releaseFromInvoice`.

  Every write is audited (`charge.raise`, `.reprice`, `.void`, `.bill`,
  `.release`) with amounts and ids, never the description.
- **Invoices:**
  - Generation adds each student's OPEN charges for the term after the fee
    items, as lines with `chargeId` and no discount (`buildSnapshot` takes
    them as a third argument). It bills them in the same transaction.
  - The preview counts and totals them.
  - **Bill waiting charges** (`GET /invoices/waiting-charges`,
    `POST /invoices/waiting-charges/bill`) issues one supplementary invoice per
    student who has the term invoice, in any status, at the next sequence.
    Students without one are only counted, as "waiting for their term invoice".
  - Cancelling an invoice returns its charges to OPEN.
- **Fixed for more than one invoice per term:**
  - reminders quote the balance across all the student's outstanding invoices
    for the term, with the earliest due date;
  - the debt figures count distinct **students**, in both
    `FinanceService.getDashboard` (a `groupBy`) and `finance-totals.ts`.
    `finance-totals.spec.ts` now holds a student with two outstanding
    invoices;
  - the class-change check looks for the term invoice only;
  - debtor rows carry `supplementary`, added deliberately to the staff app's
    pinned key set; the portal invoice carries `supplementary`.
- **Screens:**
  - **Website:** a new **Finance → Charges** page. Year, term and class
    pickers, where the term is never chosen for the bursar, as on Invoices.
    The page has:
    - the **Waiting charges** panel, with its preview, an optional due date
      and **Bill waiting charges**;
    - the class's students, each with their charges, status and a link to
      the invoice;
    - **Add a charge** (described in naira, converted with string arithmetic
      by `nairaInputToKobo`) and **Void** with a reason.

    It lives under Finance rather than the student page because the bursar
    has no `student.read`. The invoice page heads a supplementary invoice
    "Supplementary invoice"; the list, its export and the debtor list label
    one; the generation preview has a Charges column.
  - **Portal and parent app:** "Supplementary invoice" on the invoice card.
  - **Staff app:** the debtor row says "supplementary invoice".
- **Tests:**
  - `student-charge.service.spec.ts` (22 tests, real Postgres) covers every
    rule in §13.5, including two presses of **Bill waiting charges** at once
    billing each charge exactly once, and the database refusing a second
    term invoice and a malformed charge.
  - Also added: pure snapshot tests, the reminder and debtor test, and the
    totals parity case.
  - e2e `student-charges.spec.ts`: a charge rides on the term invoice; a later
    one is billed on a supplementary invoice; a void with reason; the
    bursar's invoice page; the parent sees it in the portal.
  - The Charges page was checked at 320px and 390px with no overflow. That
    check found the void form staying open after a void, which is fixed.

### 13.9 As built — CP5.2, transport records and places (2026-10-16)

- **Data** (migration `20261030120000_transport`). Five tables, each with RLS
  forced and the `tenant_isolation` policy:
  - `transport_vehicles`: plate (upper case, unique per school), description
    and seats (1–200);
  - `transport_drivers`: name, phone, licence number, licence expiry (a
    `DATE`);
  - `transport_routes`: name (unique per school), vehicle and driver (set to
    null if either is deleted), and the fee per term in kobo (₦0 to ₦10m;
    0 means free);
  - `transport_stops`: in order, with an optional pickup time in minutes since
    midnight;
  - `transport_assignments` ("places"): one per student per term, with a
    route and stop.

  Permissions:
  - `transport.read`: owner, admin and bursar;
  - `transport.manage`: owner and admin;
  - the route's fee is set under `charge.raise`, so the bursar can set it
    (CP5-D11).

  No SECURITY DEFINER function; the count stays 23.
- **Money**, all through `StudentChargeService` (source `transport` plus the
  place's id). `TransportService` never writes `student_charges` itself, and
  the CP5.1 write-scan spec proves it.
  - A place on a paid route raises one TRANSPORT charge,
    "Transport — <route>", at the fee.
  - A move to another route re-prices a waiting charge to the new fee. A move
    to a free route voids it. A billed charge is left alone.
  - Removing a child voids a waiting charge.
  - Changing the fee affects terms that have not ended. Waiting charges are
    re-priced, a fee of 0 voids them, and moving from free to paid raises
    them. The result counts each outcome, and the page says them in words.
- **Capacity.** The route row is locked (`SELECT … FOR UPDATE`) and the
  term's places are counted against the vehicle's seats. A route without a
  vehicle takes nobody. Two moves lock their routes in id order, so they
  cannot deadlock. A vehicle cannot shrink, nor a route change to a smaller
  vehicle, below the most children it has in any term not yet ended.
- **Stops** are saved as one ordered list. A stop with an id is kept and its
  id preserved. A stop that a child is picked up at cannot be removed. A route
  with places cannot be deleted.
- **Copy to next term** (`POST /transport/places/copy`) copies each place to
  the same stop, oldest first, within seats. It skips children who have left
  the school and those already placed, and reports how many were copied,
  already placed, left out because the route was full, and gone from the
  school. It can copy to any term of any year.
- **Withdrawal.** `StudentsService.withdraw` calls
  `removeTransportAfterWithdrawal` in its own transaction. It removes places
  in terms that start after the withdrawal and voids their waiting charges;
  the current term's place stays. The audit metadata records the count.
- **Website** (sidebar **Transport**, gated on `transport.read`, and added to
  the middleware matcher):
  - `/transport`: the routes with how full each is in a term, **New route**,
    and **Copy to next term**.
  - `/transport/vehicles`: vehicles and drivers, add, edit and delete. A
    driver's licence state is the server's. An expired or expiring licence
    has a tinted row and says so in words.
  - `/transport/routes/[id]`: vehicle and driver; the fee (in naira,
    converted with `nairaInputToKobo`); the stops editor; the children on the
    route for a term, with their stop, class and whether the fee is waiting or
    billed; **Move** and **Remove**; **Add a child** (search, then a stop,
    with the charge it will raise stated).
  - The student page's Bio tab shows "Transport this term".
  - As on the finance pages, the term is never chosen for the user.
- **Not in this slice:** the daily route list, the staff app, and the parent
  view. Those are CP5.3.
- **Tests:**
  - `transport.service.spec.ts` (17 tests, real Postgres) covers every rule
    in §13.5 for this slice, including the last seat going to exactly one of
    two concurrent requests, and withdrawal through `StudentsService`.
  - e2e `transport-routes.spec.ts`: a vehicle and a driver (expired licence in
    words), a route with stops, vehicle, driver and fee, a child at the second
    stop, the student page line, and the charge on Finance → Charges.
  - The three pages were checked at 320px and 390px, with no overflow.

### 13.10 As built — CP5.3, the daily route list and parents (2026-10-17)

- **The daily list** (`GET /transport/routes/:id/daily?date=`, `transport.read`):
  - It shows the route's stops in order with pickup times. At each stop are the
    children placed on the route in the term that the date falls in, with
    their class and their **primary guardian's phone** (owner, 2026-10-16).
  - "Enrolled on the date" uses the current record: the child's enrollment
    for that term is ENROLLED, and the child is not WITHDRAWN or GRADUATED.
  - A date outside every term lists nobody and says so.
  - Every read is audited (`transport.daily_list.read`, with the route id, the
    date and a count), because the list carries phone numbers.
- **Printing.** On the website the list is at `/transport/routes/[id]/daily`
  (linked as **Today's list** from the route page). It is printed through the
  browser, or exported as PDF and Excel through the existing audited list
  export (F3). The page and every copy carry "Confidential: for the driver's
  use on this route."
- **Staff app.** **Bus routes** in the School menu (`transport.read`: owner,
  admin and bursar; never a teacher) opens the routes list, then each route's
  day. The day screen has **Day before** and **Day after**, a call button for
  each parent, and the same confidential line. The query keys are
  staff-prefixed, so nothing is kept on the phone. Type-checked and covered by
  the menu and query-key specs; these screens were not driven in a simulator.
- **Parents.** `GET /portal/students/:id/transport` (behind `withGuardian`)
  returns the child's route, stop, pickup time, driver's name and phone, and
  the plate for the current term. It returns null when the child has no place.
  The portal and the parent app show a **School bus** card, absent when there
  is nothing to show. The fee is on the invoice, as before.
- **Licence warnings** shipped in CP5.2 (the driver list: valid, expiring
  within 30 days, or expired, in words and with a tint).
- **Tests:**
  - `transport.service.spec.ts` gains 4: the list's stop order, phones and
    audit; leavers left out; an out-of-term date and who may read; the parent
    read, including another child and another school.
  - e2e `transport-daily.spec.ts`: the website list with the parent's phone
    and the confidential line, an out-of-term date, and the parent's
    **School bus** card in the portal.
  - The list and the portal card were checked at 320px and 390px, with no
    overflow.

## 14. CP6 plan-first — Library

Written 2026-10-17 for the owner's approval. **Owner, 2026-10-17: approved
as written, with all six recommendations in §14.7.** It uses F1 (private files, for digital resources) and F2 (student
charges, for fines and lost books), both shipped.

### 14.1 What exists today (read from the code)

- **No library tables or routes exist.** `docs/ARCHITECTURE.md` §6.11 lists a
  catalogue, issue and return, overdue with fines, and digital resources
  linked to subjects.
- **F2 is ready for fines.** `StudentChargeService` already has the
  `LIBRARY_FINE` kind (labelled "Library" on invoices). Its `raise`,
  `voidBySource` and the partial unique index (one live charge per source)
  are the whole interface a library needs. **Bill waiting charges** already
  bills a fine raised after the term invoice went out.
- **F1 is ready for files.** Private uploads take PDF, JPG, PNG and WebP up
  to 10 MB, served by a 5-minute signed URL after an access check. A
  `library-resource` storage key would join `health-document` and
  `submission-file`.
- **Roles.** `health_officer` (CP3) is the model for a narrow staff role: a
  system role with only its own module's permissions, plus the read-only
  context (years, terms, class arms, the student roster) its screens need.
- **Teaching scope.** `getTeacherScope` (attendance, assessment, question
  bank) already answers "which subjects and arms does this teacher teach".
- **Students** use the app (`apps/mobile/app/me/*`, `StudentAuthGuard`
  routes under `/student-portal`). **Parents** use the portal and the app.

### 14.2 Decisions (owner may overrule any)

- **CP6-D1. The catalogue: a book, and its copies.**
  - A **book** has a title, author(s), ISBN (optional; schools hold many
    local titles without one), publisher, year, subject (optional), class
    level(s) it suits (optional), shelf location, a **replacement price** in
    kobo (optional), and a "reference only" switch.
  - Each physical **copy** has an **accession number**, unique in the
    school, and a status: AVAILABLE, ON_LOAN, LOST or WITHDRAWN (worn out or
    discarded). The librarian types the accession number or scans its
    barcode; a USB scanner types into the field, so no scanner support is
    needed.
  - Adding a book can add several copies at once, numbered from the school's
    next accession number.
  - The catalogue search covers title, author, ISBN and accession number.
  - Not a book? Magazines, atlases and kits are books with "reference only"
    on, or ordinary books; no separate item types.
- **CP6-D2. Lending.**
  - A copy is issued to a **student** or to a **member of staff**. A
    reference-only book, or a copy that is not AVAILABLE, cannot be issued.
  - The due date is today plus the school's **loan period** (default 14
    days); the librarian may change it on the spot.
  - **Limits**, set by the school: the most books a student may hold at once
    (default 2) and a member of staff (default 5), and the most renewals of
    one loan (default 2). A renewal moves the due date on by one loan period
    and is allowed only before the book is overdue; an overdue book is
    returned first.
  - **One open loan per copy**, as a partial unique index, and the copy row
    is locked while issuing, so two librarians cannot lend the same copy.
  - A student who has left (withdrawn or graduated) keeps their open loans on
    the overdue list, labelled "Left the school". Withdrawal is not blocked
    by an unreturned book; the school chases it.
- **CP6-D3. Fines: off by default, students only.**
  - The school turns fines on and sets a **daily rate**, **grace days**
    (default 0) and an optional **cap** per loan. All in kobo.
  - The fine is worked out **on the server, at return**:
    rate × (late days − grace), never below 0, never above the cap.
  - **Late days** are calendar days after the due date, counting only days
    inside a term (start to end date). A book kept over the long holiday is
    not fined for the holiday. Mid-term breaks and public holidays count, as
    the calendar does not mark them as closures today.
  - At return the librarian sees the fine before confirming, and may
    **waive** it with a reason; the waiver is audited with the amount.
  - A fine above ₦0 is raised as a `LIBRARY_FINE` charge through
    `StudentChargeService` (source `library` + the loan id), described
    "Library fine — <title>, <n> days late". It goes on the term invoice, or
    on a supplementary one when the bursar bills waiting charges. The term is
    the one containing the return date, or the next term to start if the
    book comes back in a holiday.
  - **No fines for staff.** Their overdue books appear on the list; the
    school deals with it.
  - The overdue list shows the fine **so far** for each student loan, worked
    out by the same function, marked "estimate".
- **CP6-D4. Lost books.**
  - The librarian marks an open loan **lost**. The copy becomes LOST. For a
    student, a `LIBRARY_FINE` charge is raised at the book's **replacement
    price** ("Lost book — <title>"), in place of any overdue fine, not on top
    of it. One charge per loan, as the index already requires.
  - A book with no replacement price raises no charge; the librarian is told
    so before confirming.
  - The librarian may waive the charge, with a reason, as for fines.
  - **Found again:** if the charge is still OPEN it is voided and the copy
    returns to AVAILABLE. If it is already billed it stays, and any refund is
    the school's decision, as for every billed charge.
  - A staff member's lost book raises no charge (D3).
- **CP6-D5. The overdue list.**
  - Every open loan past its due date, oldest first: borrower, class (or
    "Staff"), title, accession number, days late and the fine so far.
  - Filterable by class and by students or staff; exportable (F3,
    `ListExportMenu`).
  - **No automatic messages.** The list is the tool; reminders to families
    can come later if schools ask (§14.6).
- **CP6-D6. Families.**
  - The **portal** and the **parent app** show, on each child's page, the
    books the child has out with their due dates, and "Overdue" in words on a
    tinted row for a late one.
  - The **student app** gets a **Library** screen: my books and due dates,
    and the digital resources for my class (D7).
  - Fines reach parents as invoice lines, like every charge. No separate
    fines screen.
- **CP6-D7. Digital resources.**
  - A resource is a **PDF** (F1, up to 10 MB, new key `library-resource`) or
    an **https link**, with a title, an optional description, a **subject**
    and one or more **class levels**.
  - **Students** enrolled this term in an arm of one of those levels see it
    in the app's Library screen. A PDF opens through a 5-minute signed URL,
    after the same check on the server; a link opens in the browser.
  - **Who adds them:** the librarian, owner and admin for any subject and
    level; a **teacher** for the subjects they teach, at the levels they
    teach them (`getTeacherScope`), and may edit or remove only their own.
  - Staff with library access see every resource; parents do not (they are
    the student's reading, not a report).
  - Adding and removing a resource are audited. Opening one is not: it is
    teaching material, not a record about a child.
- **CP6-D8. The librarian role, and who else.**
  - New permissions:
    - `library.read`: the catalogue, loans and the overdue list;
    - `library.manage`: books and copies;
    - `library.lend`: issue, return, renew, mark lost or found, waive;
    - `library.settings`: loan period, limits, and the fine rules;
    - `library.resource.manage`: any digital resource;
    - `library.resource.own`: resources in one's own teaching scope.
  - **Librarian** (new system role): every library permission except
    `library.settings`, plus read-only years, terms, class arms and the
    student and staff lists its screens search. No finance, academic,
    health or settings access.
  - **Owner and admin:** every library permission. **Fine rules are theirs
    alone** (`library.settings`): a fine is money owed by a family, and the
    librarian lends rather than sets policy. Same idea as the route fee in
    CP5.
  - **Teacher:** `library.resource.own` only.
  - **Bursar:** nothing new; fines are already visible to them as charges.
  - Two-gate checks on every route, as everywhere: `@Permissions` and
    `assertUserActiveAndHasOneOf` in the service.
- **CP6-D9. Plans.** The library is not a paid extra.

### 14.3 What gets built

| Slice | PR | What |
|---|---|---|
| **CP6.1** | its own, reviewed first | **Catalogue and lending.** Tables, RLS, the librarian role and permissions; books and copies; issue, return, renew with limits and the copy lock; the school's library settings (without fines yet); web pages under **Library** (catalogue, a book's page with its copies, the lending desk, loans), a student's and a staff member's "Books out" line. |
| **CP6.2** | second | **Fines, lost books and the overdue list.** The fine function (term days, grace, cap), fines and lost-book charges through F2, waivers, found-again; the overdue list with export; the lending desk and overdue list on the staff app; the child's books on the portal and parent app; the student app's Library screen (books only). |
| **CP6.3** | third | **Digital resources.** The `library-resource` key, resources with subject and levels, the teacher scope check; web pages for staff; the student app's resources list. |

### 14.4 Data

- `library_settings` (one row per school): loan period days, student and
  staff loan limits, renewal limit, fines on/off, daily rate, grace days,
  cap (kobo, nullable).
- `library_books`: title, authors, ISBN, publisher, year, subject id, shelf
  location, replacement price (kobo, nullable), reference only, and
  `library_book_levels` for its class levels.
- `library_copies`: book id, accession number (`UNIQUE(school_id,
  accession_number)`), status, acquired on (date), note.
- `library_loans`: copy id, borrower (student id **or** user id, with a
  `CHECK` that exactly one is set), issued at, due on (date), renewals,
  returned at, lost at, found at, fine amount, waived (with reason and by
  whom), issued by, returned by. Partial unique index: one loan per copy
  `WHERE returned_at IS NULL AND lost_at IS NULL`.
- `library_resources`: title, description, subject id, kind (FILE or LINK),
  URL or file id, added by, and `library_resource_levels`.
- Every table: `school_id`, RLS enabled and forced, `tenant_isolation`
  policy, explicit grants to `app_user`. No SECURITY DEFINER function; the
  count stays 23.
- Money in `Int` kobo; due dates `@db.Date`; moments `DateTime`.

### 14.5 Tests (the rules first)

- **The fine function** (pure, written first): zero within the due date and
  the grace days; rate × days after; the cap holds; holiday days between
  terms do not count; a due date inside a holiday; a return the day after
  the due date with grace 0.
- **Lending:** a reference-only book and a non-available copy are refused;
  limits per student and per staff member; renewals only before overdue and
  up to the limit; two concurrent issues of one copy, exactly one succeeds.
- **Fines and lost books (F2):** a late return raises one `LIBRARY_FINE`
  charge for the right student and term; fines off or a waiver raise
  nothing and the waiver is audited; staff are never charged; lost raises
  the replacement price and no overdue fine; found voids an OPEN charge and
  leaves a billed one; the charge reaches the term or supplementary invoice.
  `student-charge-writes.spec.ts` still passes (the library never writes
  the table itself).
- **The overdue list** holds exactly the open late loans; its estimate
  equals the fine raised at return on the same day.
- **Resources:** a student in a listed level sees it and gets a signed URL;
  a student in another level, a parent and another school get nothing; a
  teacher may add only within their scope and change only their own.
- **Who:** the librarian is refused on fine settings and on every finance
  route; a teacher is refused on lending; a parent sees only their own
  child's books. RLS: another school's books, loans and resources are
  invisible. `permissions-coverage.spec.ts` pins the new role.
- **e2e:** the librarian adds a book with two copies, issues one to a
  student, the parent sees it with its due date; with fines on, a late
  return raises a charge that appears on Finance → Charges. CP6.3: a
  teacher uploads a PDF for their subject and the student opens it.
- **Phone fit:** every new screen at 320px and 390px.

### 14.6 Left out on purpose

- Reservations (holds) and a waiting list.
- Automatic overdue reminders by SMS or email.
- ISBN look-up from an online catalogue, and cover images.
- Printing barcode labels (a scanner reading an existing label works).
- Fines for staff, and fines on anything but a late or lost book.
- Inter-branch or inter-school lending.
- An e-book reader in the app; a PDF opens in the device's viewer.

### 14.7 Questions for the owner

1. **Fines off by default** (CP6-D3), set by the owner or admin only?
   Recommended: yes.
2. **Holidays between terms do not count** towards a fine (CP6-D3)?
   Recommended: yes; mid-term breaks still count.
3. **A lost book charges its replacement price, in place of the fine**
   (CP6-D4)? Recommended: yes.
4. **No fines or charges for staff** (CP6-D3, D4)? Recommended: yes.
5. **Teachers may add resources for the subjects and levels they teach**
   (CP6-D7)? Recommended: yes.
6. **Parents see the child's books and due dates** (CP6-D6), but not the
   digital resources? Recommended: yes.

### 14.8 As built — CP6.1, the catalogue and lending (2026-10-17)

- **Data** (migration `20261031120000_library`): `library_settings` (one row
  per school, created on first save; until then the defaults apply),
  `library_books`, `library_book_levels`, `library_copies` and
  `library_loans`, every one carrying `school_id` with RLS enabled and forced
  and the `tenant_isolation` policy. A loan names a student **or** a member of
  staff (a `CHECK` that exactly one is set). One open loan per copy is the
  partial unique index `library_loans_open_copy_key`. Accession numbers and
  ISBNs are checked in SQL too (upper case; 10 or 13 digits). No SECURITY
  DEFINER function; the count stays 23. School deletion needs no change: its
  child-before-parent order is read from the catalog.
- **The librarian role** is inserted by the migration and seeded in
  `system-roles.ts`, holding `library.read`, `library.manage` and
  `library.lend`. Admin gains those three and `library.settings`. The role is
  on the staff invite form, lands on `/library` after sign-in, and is pinned
  in `permissions-coverage.spec.ts` and the two-gate conformance spec.
- **No roster permission for the librarian.** `GET /library/context` returns
  the subjects and class levels the book form needs, and
  `GET /library/borrowers` returns only a name, the admission number and
  class (or "Staff") and the books out, as the health page does for the
  Health officer.
- **API** (`apps/api/src/modules/library/`):
  - catalogue: `GET/POST /library/books`, `GET/PATCH/DELETE /library/books/:id`,
    `POST /library/books/:id/copies`, `PATCH /library/copies/:id`
    (withdraw or put back), `GET /library/copies/lookup`;
  - lending: `POST /library/loans/issue`, `POST /library/loans/return` (both
    by accession number), `POST /library/loans/:id/renew`,
    `GET /library/loans?state=OPEN|OVERDUE|RETURNED`;
  - per borrower: `GET /library/students/:id/loans`,
    `GET /library/staff/:id/loans`;
  - rules: `PUT /library/settings` (owner, admin).
- **How the rules came out:**
  - Issuing locks the copy row and the borrower's row (`FOR UPDATE`), so the
    one-loan-per-copy rule and the borrower's limit both hold when two
    librarians work at once; the unique index is the backstop.
  - A student who has left, or a staff account that is switched off, cannot
    borrow (`BORROWER_NOT_ACTIVE`).
  - A renewal runs one loan period **from the day it is renewed**, never
    earlier than the current due date; a second renewal on the same day
    therefore keeps the date. It is refused once the book is overdue.
  - "Number them for me" hands out the school's next number, skipping any
    number already typed by hand, with the settings row locked.
  - A book that has ever been lent cannot be deleted; its copies are
    withdrawn instead. A copy on loan cannot be withdrawn.
  - Every change is audited (`library.book`, `library.copy`,
    `library.loan.issue|return|renew`, `library.settings`) with ids, dates
    and counts, never a name.
- **Web** (`apps/web/src/app/(admin)/library/`): the catalogue with search
  and **Add a book**; a book's page with its details, copies, who has each
  one and the due date, **Add copies**, **Withdraw** and **Delete book**; the
  **Lending desk** (type or scan a number, then lend, return or renew);
  **Loans** (out now, overdue, returned, with the export menu); and **Rules**
  for the owner and admin. "Library books out" appears on the student page
  and the staff page for those who hold `library.read`. An overdue loan is
  tinted and says "Overdue by n days" in words. Nav item "Library".
- **Tests:** `library.service.spec.ts` (16, against real Postgres: the
  concurrent issue, limits per kind, renewals, reference and withdrawn
  copies, numbering, deleting, the borrower search, who may do what, RLS and
  the audit trail); RBAC coverage pins; e2e `library-lending.spec.ts` (the
  Librarian catalogues, lends at the desk, sees the loan, takes it back; the
  admin sees the book on the student page and saves the rules). Every page
  checked at 320 and 390 px.
- **Left for CP6.2 as planned:** fines and lost books, the overdue list's
  fine estimate, the staff app, and the parent and student views.

### 14.9 As built — CP6.2, fines, lost books and families (2026-10-17)

- **Data** (migration `20261101120000_library_fines`):
  - `library_settings` gains `fines_enabled` (off by default),
    `fine_per_day`, `fine_grace_days` and `fine_cap` (kobo, `CHECK`ed).
  - `library_loans` gains `lost_at`, `found_at`, `fine_amount` (the fine at
    return, or the replacement price at a loss), `fine_waived_reason` and
    `fine_waived_by`. `CHECK`s: a loan is returned or lost, never both; only a
    lost loan can be found.
  - A lost loan is **closed**: `library_loans_open_copy_key` is recreated
    `WHERE returned_at IS NULL AND lost_at IS NULL`, and every "books out"
    count, limit and list leaves lost loans out.
  - No SECURITY DEFINER function; the count stays 23.
- **The fine** (`apps/api/src/modules/library/library-fines.ts`, pure,
  tested on its own):
  - Late days are calendar days after the due date, up to the return, that
    fall inside a term. Each day counts **once** even where two terms overlap.
    The e2e run found a school whose onboarding term overlapped a later one;
    counting per term had doubled the fine.
  - fine = rate × (late days − grace), floored at 0, capped.
  - The charge's term is the term the day falls in (the **current** term where
    two do), otherwise the next term to start, otherwise the last to end.
  - The overdue list's "fine so far" and the fine raised at return use the
    same function on the same day, so they agree.
- **Money goes through F2 only.** A late student return or a student's lost
  book raises one `LIBRARY_FINE` charge through `StudentChargeService.raise`
  (source `library`, the loan's id), described "Library fine — title, n days
  late" or "Lost book — title". A lost book charges the replacement price
  **instead of** the fine. Staff, fines off, an on-time return or a book with
  no price raise nothing. A waiver needs a reason, is kept on the loan and is
  audited (`fine`, `waived`, `charged` in the metadata). Found again
  (`POST /library/loans/:id/found`): a waiting charge is voided through
  `voidBySource`, a billed one stays, and the screen says which.
  `student-charge-writes.spec.ts` still passes.
- **Routes:**
  - `POST /library/loans/return` takes an optional `waiveReason` and returns
    `{ loan, charged }`;
  - `POST /library/loans/:id/lost` and `/found` need `library.lend`;
  - `GET /library/loans?state=LOST`;
  - `GET /portal/students/:id/library` (behind `withGuardian`) and
    `GET /student-portal/me/library` return titles, authors and due dates
    only: nothing about the staff who lent them.
- **Web:**
  - The lending desk shows "Fine if returned today: ₦…" before the book is
    taken back, with **Waive the fine** and a reason field.
  - **Book lost** says what will be charged (the replacement price, or that
    nothing is) before **Mark lost**.
  - Loans gains a **Lost** tab with **Found it**, the fine so far on overdue
    rows, the figure (or waiver) on closed ones, and a Fine column in exports.
  - Rules gains **Fine students for late books**, the daily fine, days of
    grace and the most per book.
- **Apps and portal:**
  - Staff app: **Library** (owner, admin, Librarian), with the overdue and
    out-now lists including the fine so far, and a **Lending desk** screen:
    lend, return with the fine shown and waivable, renew, mark lost.
  - Parent app and portal: a **Library books** card on the child's page.
  - Student app: **My library books**.
  - An overdue book is tinted and says "Overdue by n days" in words.
- **Tests:**
  - `library-fines.spec.ts`: 16 pure tests, including overlapping terms and
    the current-term rule.
  - `library.service.spec.ts`: 7 more integration tests, through real invoice
    generation: the fine reaches the term invoice; staff, fines off and
    waivers raise nothing; lost replaces the fine and closes the loan; found
    voids a waiting charge and leaves a billed one; parents and children see
    only their own; only the desk marks lost or found.
  - RBAC pins for lost and found; mobile destination and staff-key tests.
  - e2e `library-fines.spec.ts`: the admin turns fines on, the parent sees the
    book overdue, the desk shows ₦150 for three days and takes it back, and
    the fine is a waiting library charge on Finance → Charges.
  - Phone fit at 320 and 390 px: the desk with fine and loss, the Lost tab,
    the rules and the portal card.

### 14.10 As built — CP6.3, digital resources (2026-10-17)

- **Data** (migration `20261102120000_library_resources`):
  - `library_resources`: title, description, subject (required), `kind`
    FILE or LINK, the https address (LINK) or the file's size (FILE, PDF
    only), and who added it.
  - `library_resource_levels`: the class levels it is for.
  - A `CHECK` holds the shape: a link has an https address and no file; a
    file is a PDF of 1 byte to 10 MB with no address.
  - RLS forced on both tables. No SECURITY DEFINER function; the count stays
    23.
- **Storage:** the F1 key `library-resource` stores the file at
  `schools/<id>/library/<resourceId>.pdf`. It is typed by its own bytes
  (`assertPrivateFile`, then PDF only), read through a five-minute signed
  link, and deleted with the resource. If the database row fails to land,
  the stored file is removed again.
- **Permissions, a change from §14.2 D8:** two permissions,
  `library.resource.read` and `library.resource.write`, held by owner (`*`),
  admin, the Librarian and teacher. This replaces the planned `.manage` /
  `.own` pair, because `@Permissions` requires all the listed permissions,
  so one route cannot take either. The guard authorises the role and the
  service scopes the row, the question bank's pattern:
  - owner, admin and the Librarian add and remove anything;
  - a teacher adds only for a subject they teach at **every** class level
    chosen (`getTeacherScope`'s level-and-subject pairs), and removes only
    their own;
  - teachers see every resource.

  The migration appends both permissions to admin, librarian and teacher;
  the seeds and `permissions-coverage.spec.ts` match.
- **Routes:**
  - `GET /library/resources` returns the list with `canRemove` on each and
    the reader's `scope`, so the form offers a teacher only their subjects
    and classes;
  - `POST /library/resources/links`;
  - `POST /library/resources/files` (multipart: `file`, plus `data` as JSON);
  - `DELETE /library/resources/:id`;
  - `GET /library/resources/:id/file`;
  - for students, `GET /student-portal/me/library/resources` and
    `.../:id/file`. A student sees a resource when enrolled this term in an
    arm of one of its levels, and the file link is signed only after that
    check runs again.
  - Parents do not see resources.
  - Adding and removing are audited (`library.resource.create` / `.remove`);
    opening is not.
- **Not built:** changing a resource after adding it. Removing it and adding
  it again does the same job, and nobody has asked for more yet.
- **Web:**
  - **Resources** in the library's tabs, for owner, admin and the Librarian.
  - **Library resources** in the teacher's menu.
  - Both pages share one panel: add a PDF or a link (subject, then the
    classes), the list with **Open PDF** / **Open link**, and **Remove**
    where allowed.
- **Student app:** the Library screen becomes **My library**: books out,
  then **Reading for your class**. A PDF opens through the signed link, a
  link in the browser.
- **Tests:**
  - `library-resources.service.spec.ts` (5, against real Postgres and the
    filesystem driver): the teacher's scope at every level; PDF-only by
    bytes; https-only; another school's subject or level refused; the list
    with `canRemove` and scope; a student sees only their levels, and the
    signed link refuses another class, a link and another school; a teacher
    removes only their own; the stored PDF is deleted; audit rows.
  - RBAC pins for the five routes and the role grants.
  - e2e `library-resources.spec.ts`: a teacher adds a PDF for their one
    subject and class and opens it through its signed link; the admin sees
    it and adds a link; the teacher cannot remove the admin's link.
  - Phone fit at 320 and 390 px.

## 15. CP6b plan-first — Hostel and boarding

Written 2026-10-17 for the owner's approval. Nothing is built until it is
approved. It uses F2 (student charges, for hostel fees) and CP3 (the sickbay),
both shipped, and copies the shape transport proved in CP5.

### 15.1 What exists today (read from the code)

- **No hostel tables or routes exist.** `docs/ARCHITECTURE.md` §6.13 lists:
  - a hostel and room registry;
  - bed allocation per term;
  - house masters;
  - a visitor log and leave-out tracking;
  - a link to the sickbay.
- **F2 is ready.** `StudentChargeService` already has the `HOSTEL` kind
  (labelled "Hostel" on invoices), and `raise`, `reprice` and `voidBySource`
  are what a per-term fee needs. Transport (CP5.2) is the working pattern:
  - one charge per place;
  - re-priced while it is still waiting;
  - voided on removal;
  - copied to next term;
  - dropped for later terms on withdrawal.
- **Capacity under concurrency** is solved in transport with a row lock
  (`SELECT … FOR UPDATE`) plus a unique index.
- **The sickbay** (CP3.3) records visits with a complaint, action taken, "sent
  home", and a parent notice. Teachers see only the "For teachers" health
  note, never the record.
- **Students have a `gender`** (MALE, FEMALE, OTHER).
- **Notifications:** `NotificationDispatchService` already sends to parents'
  phones and email (the sickbay notice uses it).

### 15.2 Decisions (owner may overrule any)

- **CP6b-D1. Hostels, rooms and beds.**
  - A **hostel** has:
    - a name;
    - who it is for: boys, girls, or mixed;
    - its **house masters** (one or more members of staff);
    - a **fee per term** in kobo (0 for none).
  - A **room** belongs to a hostel and has a name ("Room 4", "Dorm B") and a
    number of beds (1 to 60).
  - Beds are numbered 1 to that count within the room. A school that labels
    its beds differently still has one number per bed.
  - A room with boarders in it this term cannot have its beds reduced below
    them, and cannot be deleted. A hostel likewise.
- **CP6b-D2. Putting a child in a bed.**
  - A student gets **one bed for a term**: hostel, room, bed number. Having a
    bed is what makes a child a boarder that term; there is no separate
    "boarder" flag to fall out of step.
  - **No double booking**, by two unique indexes:
    - one bed per student per term;
    - one student per bed per term.

    The room row is locked while placing, as transport locks the route, so
    two staff choosing the last bed at once cannot both succeed.
  - **Who the hostel is for:** a boys' hostel takes MALE students and a girls'
    hostel FEMALE ones; a mixed hostel takes anyone. A student recorded as
    OTHER goes in a mixed hostel, or the admin changes the hostel's setting.
    This is a question for the owner (§15.7).
  - The screen offers the first free bed; the admin may choose another.
- **CP6b-D3. Fees through F2, exactly as transport.**
  - Placing a child in a hostel that charges a fee raises one `HOSTEL` charge
    for that term at the hostel's fee. Nobody types an amount per child.
  - **Moving within the term** keeps the one charge:
    - still waiting, it takes the new hostel's fee;
    - already billed, it stays as it is.
  - **Removing** the child voids a waiting charge; a billed one stays.
  - Changing a hostel's fee re-prices the waiting charges of this and later
    terms.
  - **Copy to next term** keeps every boarder in the same bed where it is
    free, and raises next term's charges.
  - **Withdrawal** removes the child's later-term beds and voids their
    waiting charges, through the path transport already uses.
  - **No pro-rating**, as for transport (owner, 2026-10-16): the full term's
    fee, adjustable by voiding and adding a smaller charge by hand.
  - Setting a fee needs `charge.raise`, so the bursar can set it.
- **CP6b-D4. House masters.**
  - A house master is a **member of staff assigned to a hostel**, usually a
    teacher. It is an assignment, **not a new role** (question for the owner,
    §15.7).
  - House masters see their own hostel's boarders: name, class, room and
    bed. They keep its visitor log and decide its exeats. They do not see
    other hostels.
  - Owner and admin see and do everything for every hostel.
- **CP6b-D5. The visitor log.**
  - **What the house master logs:**
    - the boarder visited;
    - the visitor's name and relationship;
    - a phone number (optional);
    - the time they arrived and the time they left.
  - **Who sees it:** the house master and admin see the whole hostel's log.
  - **Parents** see their own child's visits: who, when, and for how long.
    For a boarding child this is a safeguard as much as a courtesy (question
    for the owner, §15.7).
- **CP6b-D6. Exeats (leave-out).**
  - **Requesting:** a **parent** asks in the portal or parent app, giving:
    - the day and time out and the day and time back;
    - the reason;
    - **who will collect** the child (name, relationship, phone).

    Any guardian linked to the child with portal access may ask. The school
    may also enter a request taken by phone.
  - **Deciding:** the **house master approves or refuses**, with a note when
    refusing. The parent is told in the app, and by SMS or email per the
    existing notification preferences.
  - **Logging movements:** on the day, the house master logs **left at**
    (and who actually collected the child, if not the person named), then
    **back at**.
  - **Late return:** a child not back by the time agreed shows as **late** on
    the house master's list, in words and tinted. No automatic message is
    sent.
  - **Cancelling:** the parent may cancel while the request waits or before
    the child leaves.
  - **Statuses:** REQUESTED → APPROVED or REFUSED → OUT → BACK, or CANCELLED.
- **CP6b-D7. The sickbay link (CP3).**
  - The house master's boarder list shows **"Seen at the sickbay today"**,
    and **"Sent home"** when that was the outcome. It does **not** show the
    complaint, the action or any medicine: those stay with the health
    officer, owner and admin, as CP3 decided for teachers (question for the
    owner, §15.7).
  - On the sickbay page, a boarder is labelled "Boarder: hostel, room", so
    the health officer knows whom to tell.
- **CP6b-D8. Families.** The portal and parent app show the child's hostel,
  room and bed this term, and the house masters' names. They do not show the
  house masters' phone numbers; the school's contact details are already on
  every page. They also show:
  - the child's visits (D5);
  - the exeat requests and their status (D6).
- **CP6b-D9. Who.** New permissions:
  - `hostel.read`: owner, admin and bursar.
  - `hostel.manage` (hostels, rooms, house masters, beds): owner and admin.
  - `hostel.house` (the boarder list, visitor log and exeats of hostels the
    person is house master of): teacher, owner and admin. The service checks
    the assignment, as the question bank checks a teacher's subjects.
  - A hostel's **fee** needs `charge.raise` (owner, admin, bursar), as a
    route's fee does.
  - Parents act only through `withGuardian` on their own children.
- **CP6b-D10. Plans.** Boarding is not a paid extra.

### 15.3 What gets built

| Slice | PR | What |
|---|---|---|
| **CP6b.1** | its own, reviewed first | **Hostels, rooms and beds.** Tables, RLS, permissions; hostels with house masters and fees, rooms with beds; placing, moving and removing a child with the gender rule and the room lock; fees through F2; copy to next term; withdrawal. Web pages under **Hostels**, and the student page's "Hostel this term" line. |
| **CP6b.2** | second | **House masters and families.** The house master's boarder list with the sickbay flag (web and staff app); the visitor log; the sickbay page's boarder label; the hostel card and visits on the portal and parent app. |
| **CP6b.3** | third | **Exeats.** Requests from the portal and parent app, and by the school; approval and refusal with the parent told; left and back logging; the late list; cancelling. |

### 15.4 Data

- `hostels`: name, `for_gender` (BOYS, GIRLS, MIXED), fee per term (kobo),
  plus `hostel_house_masters` (hostel, user).
- `hostel_rooms`: hostel, name, beds (1 to 60).
- `hostel_beds`: student, term, hostel, room and bed number.
  - `UNIQUE(student_id, term_id)`;
  - `UNIQUE(room_id, bed_number, term_id)`;
  - a `CHECK` that the bed number is at least 1 (the upper bound is checked
    against the room, with the room locked).
- `hostel_visits`: boarder, hostel, visitor name, relationship, phone,
  arrived at, left at, logged by.
- `hostel_exeats`: boarder, hostel, out and back times, reason, collector
  (name, relationship, phone), status, who requested it (guardian or staff),
  who decided, the decision note, left at, back at, collected by.
- Every table: `school_id`, RLS enabled and forced, `tenant_isolation`,
  explicit grants. No SECURITY DEFINER function; the count stays 23.
- Money in `Int` kobo. Moments as `DateTime`; the term is the term row.

### 15.5 Tests (the rules first)

- **Beds:**
  - two staff placing the last bed at once, exactly one succeeds;
  - the same bed twice in a term is refused;
  - a student twice in a term is refused;
  - the gender rule holds for boys', girls' and mixed hostels;
  - beds cannot be reduced below the boarders in a room;
  - a room or hostel with boarders cannot be deleted.
- **Money (F2), as transport:**
  - placing raises one HOSTEL charge at the fee;
  - a move keeps one charge and re-prices it only while it is waiting;
  - removal voids a waiting charge and leaves a billed one;
  - a fee change re-prices waiting charges only;
  - copy to next term honours free beds and raises next term's charges;
  - withdrawal clears later terms;
  - `student-charge-writes.spec.ts` still passes.
- **House masters:**
  - they see only their hostels' boarders, visits and exeats;
  - another hostel's boarder is not found;
  - a teacher who is not a house master is refused.
- **Sickbay link:** the house master sees "seen today" and "sent home" and
  never the complaint, action or medicine.
- **Exeats:**
  - statuses move only forward;
  - only the boarder's own guardian can request or cancel;
  - a refusal needs a note;
  - the parent is notified of the decision;
  - a child past the agreed time shows as late;
  - cancelling is refused after the child has left.
- **Families and tenancy:**
  - a parent sees only their own child's hostel, visits and exeats;
  - RLS hides another school's hostels.
- **e2e:**
  - the admin builds a hostel with rooms and a fee, places a child, and the
    charge appears;
  - the parent sees the hostel card;
  - (CP6b.3) the parent requests an exeat, the house master approves it and
    logs the child out and back, and the parent sees each step.
- **Phone fit:** every new screen at 320 and 390 px.

### 15.6 Left out on purpose

- Night roll call and attendance in the hostel.
- Meals, laundry and inventory (mattresses, lockers).
- Different fees per room or bed; pro-rating.
- Parents choosing or swapping rooms.
- Gate passes with QR codes, and SMS on departure and return. The exeat
  status in the app is the record.
- A separate "hostel officer" role (see question 1).

### 15.7 Questions for the owner

1. **House masters as an assignment of existing staff, not a new role**
   (CP6b-D4, D9)? Recommended: yes. A teacher or any member of staff can be
   made house master of a hostel; a "hostel officer" role can come later if
   a school's boarding staff are not otherwise staff.
2. **Boys', girls' and mixed hostels, enforced when placing a child**
   (CP6b-D2)? Recommended: yes. A student recorded as "other" goes in a
   mixed hostel.
3. **Parents see their child's visitor log** (CP6b-D5)? Recommended: yes.
4. **The house master sees only that a boarder was at the sickbay, and
   whether they were sent home, not why** (CP6b-D7)? Recommended: yes, as
   CP3 decided for teachers.
5. **Any linked guardian may request an exeat, naming who will collect**
   (CP6b-D6)? Recommended: yes.
6. **One fee per hostel per term, no pro-rating** (CP6b-D3)? Recommended:
   yes, as transport.

### 15.8 Owner's answers (2026-10-17) and what they change

1. **House masters.** "If it is worth a role on the platform, then it's left
   to admin to assign, so it's optional."
   - A house master can do only these things, for their own hostels:
     - see its boarders (name, class, room, bed);
     - keep its visitor log;
     - decide its exeats and log the child out and back;
     - see "Sent home by the sickbay today".
   - They see no fees, no health records and no other hostel.
   - **Two ways to be one, both optional for the admin.** Today a member of
     staff holds one role, set at invitation, and no screen adds a second.
     - A new **House master** system role, invited like the Health officer,
       for boarding staff who are not teachers. It holds `hostel.house` only.
     - A **teacher** may be assigned as a hostel's house master without
       changing their role (teachers hold `hostel.house`).
   - On the hostel's page the admin picks its house masters from staff who
     hold `hostel.house`. A house master sees only the hostels they are
     assigned to.
   - This replaces "not a new role" in D4 and D9.
2. **Separate hostels.** "Hostels are mainly separately, boys separate from
   girls."
   - Every hostel is **Boys** or **Girls**. MIXED is dropped from D1, D2 and
     the data.
   - Placing a child is checked against the student's recorded gender.
   - A student recorded as OTHER cannot be placed until the record is set;
     the screen says so.
3. **Visitor log.** Parents do **not** see it: house master and admin only.
   D5 and D8 change accordingly; the parent sees the hostel, room, bed, house
   masters' names and the exeats.
4. **Sickbay.** "The less info the better."
   - The house master sees only **"Sent home by the sickbay today"**, because
     that changes where the child is.
   - A visit where the child stayed in school shows nothing to the house
     master.
   - Never the complaint, action or medicine. D7 changes accordingly.
5. **Exeats.** Any linked guardian may request one, naming who will collect.
   As D6.
6. **Fees.** "Unless it is changed, it remains same fee for next term or
   session."
   - The fee belongs to the hostel and applies to every term, in this
     session and the next, until someone changes it.
   - **Copy to next term**, including into a new session, charges the
     hostel's fee as it stands.
   - Changing it re-prices only waiting charges, as D3. No pro-rating.

### 15.9 As built — CP6b.1, hostels, rooms, beds and fees (2026-10-17)

- **Data** (migration `20261103120000_hostels`):
  - `hostels`: name unique per school, `for_gender` (enum `HostelGender`:
    `BOYS`, `GIRLS`), `fee` in kobo (0 to ₦10m, a `CHECK`);
  - `hostel_house_masters`: the hostel and the member of staff, keyed on the
    pair;
  - `hostel_rooms`: 1 to 60 beds, name unique per hostel;
  - `hostel_beds`: one row per child per term. `UNIQUE(student_id, term_id)`
    makes "one bed per child per term" hold in SQL, and
    `UNIQUE(room_id, term_id, bed_number)` does the same for "one child per
    bed". The hostel and room FKs are `RESTRICT`; the student FK cascades.
  - Every table carries `school_id` with RLS enabled and forced and the
    `tenant_isolation` policy. No SECURITY DEFINER function; the count stays
    23.
- **Roles and permissions:**
  - `hostel.read`: owner, admin, bursar;
  - `hostel.manage`: owner, admin;
  - `hostel.house`: admin, teacher and the new optional **House master**
    role, which holds nothing else. The migration inserts the role and the
    seed carries it. It is pinned in `permissions-coverage.spec.ts` and the
    two-gate conformance spec.
  - The API accepts `house_master` on a staff invitation already.
  - **The web invite option, the House master's landing page and every house
    master screen come in CP6b.2.** Until then a house master can be chosen
    on a hostel's page, but has nothing to open.
- **API** (`apps/api/src/modules/hostels/`):
  - hostels: `GET/POST /hostels`, `GET/PATCH/DELETE /hostels/:id`,
    `PUT /hostels/:id/fee` (needs `charge.raise`, so the bursar can set it);
  - house masters: `GET /hostels/house-master-candidates`,
    `PUT /hostels/:id/house-masters`;
  - rooms: `POST /hostels/:id/rooms`, `PATCH/DELETE /hostels/rooms/:roomId`;
  - beds: `GET /hostels/:id/beds?termId=`, `POST /hostels/beds`,
    `PATCH/DELETE /hostels/beds/:id`, `POST /hostels/beds/copy`;
  - the student page: `GET /hostels/students/:id`.
- **How the rules came out:**
  - Placing a child locks the room (`FOR UPDATE`) and checks, in order:
    - the child has not left (`STUDENT_LEFT`);
    - the child's gender is set (`GENDER_NOT_SET`, which covers OTHER);
    - it matches the hostel (`WRONG_HOSTEL`);
    - the bed exists (`NO_SUCH_BED`) and is free (`BED_TAKEN`);
    - the room is not full (`ROOM_FULL`);
    - the child has no bed this term (`ALREADY_PLACED`).
    With no bed number given, the child gets the lowest free bed.
  - Moving a child locks both rooms in id order, so two moves crossing each
    other cannot deadlock. A move to another hostel re-prices the waiting
    charge to that hostel's fee.
  - A room cannot shrink below a bed in use in the current or a later term
    (`ROOM_TOO_SMALL`), and a room or hostel ever used cannot be deleted
    (`ROOM_IN_USE`, `HOSTEL_IN_USE`). Bed history stays.
  - A hostel's gender cannot change while it has boarders in the current or a
    later term (`HOSTEL_HAS_BOARDERS`).
  - **The fee goes through F2.** A bed raises a `HOSTEL` charge with source
    `hostel` and the bed's id, described as "Hostel — <name>". Changing the
    fee re-prices the waiting charges for the current and later terms, raises
    one where the fee was zero, voids one where it becomes zero, and leaves an
    invoiced charge alone. The answer says how many of each.
  - **Copy to next term** puts each boarder in the same bed where it is free,
    charged at the hostel's fee as it stands. It reports how many were
    copied, already placed, found their bed taken, or have left.
  - Withdrawing a student removes their beds for terms that start after the
    withdrawal date (as transport does), voids any waiting charge on them, and
    records the count on the withdrawal's audit row. The bed in the term they
    leave stays, with its charge.
  - Every write is audited under entity type `hostel`.
- **Web:**
  - `/hostels` lists hostels with "x of y beds taken" for the chosen term,
    creates a hostel and copies beds to the next term.
  - `/hostels/[id]` holds the details, house masters, fee, rooms and the
    term's boarders, with move, remove and add.
  - The student page's Bio tab shows "Hostel this term" to anyone with
    `hostel.read`.
  - The nav item is "Hostels".
  - Checked at 320 and 390 px with no sideways scroll.
- **Tests:**
  - `hostel.service.spec.ts`: 14 tests against the real database.
  - `e2e/tests/hostel-beds.spec.ts`: a girls' hostel, a room and a fee, a
    girl given a bed, the student page line, and the hostel line on Finance →
    Charges.

### 15.10 As built — CP6b.2, house masters, the visitor log and families (2026-10-17)

- **Data** (migration `20261104120000_hostel_visits`): `hostel_visits`, with:
  - the hostel and the boarder;
  - the visitor's name (1–80 characters) and relationship (1–40);
  - a phone number, optional (7–20 characters);
  - arrived at, and left at (null while they are still there; a `CHECK` that
    it is not before the arrival);
  - who logged it.

  RLS enabled and forced, with `tenant_isolation`. No SECURITY DEFINER
  function; the count stays 23. No new permission: `hostel.house` came in
  CP6b.1.
- **Who keeps which hostel.** `HostelHouseService` re-reads the caller's
  roles on every call:
  - owner and admin keep every hostel;
  - a teacher or House master keeps only the hostels they are assigned to on
    the hostel's page;
  - anyone else is refused (403).

  Another hostel answers 404 ("Hostel not found"), not 403, as the question
  bank answers for a subject the teacher does not teach. A teacher's
  `GET /teacher-scope/me` now carries `housesHostels`, so the teacher portal
  and staff app show Boarding only to a teacher who keeps a hostel.
- **API** (`apps/api/src/modules/hostels/`, all `hostel.house`):
  - `GET /boarding/hostels`: the hostels kept, with this term's boarder count;
  - `GET /boarding/hostels/:id/boarders`: this term's boarders by room and
    bed;
  - `GET /boarding/hostels/:id/visits?day=`: one Lagos day of the log, today
    by default;
  - `POST /boarding/hostels/:id/visits`: log a visitor, arriving now unless a
    time is given;
  - `PATCH /boarding/visits/:id/left`: once only (`VISIT_ALREADY_LEFT`);
  - `DELETE /boarding/visits/:id`: an entry made by mistake, audited.

  The routes sit under `/boarding`, not `/hostels`, because `GET /hostels/:id`
  would otherwise catch `/hostels/house`.
- **The sickbay (owner's answer 4).**
  - A boarder carries one fact from the sickbay: `sentHomeToday`. It is true
    only for a visit today (Lagos day) marked "sent home" and not withdrawn.
  - A visit where the child stayed in school shows nothing.
  - The complaint, the action and any medicine are never read into the
    house master's answer; a test checks that the JSON carries none of them.
  - The sickbay page labels a boarder "Boarder: hostel, room"
    (`SickbayVisitDto.boarder`), so the health officer knows whom to tell.
- **Visitors (owner's answer 3).** House master and admin only. The audit
  row records who logged what, without the visitor's name or phone.
  Logging needs the child to have a bed in that hostel this term. A time in
  the future is refused, with five minutes allowed for a fast clock.
- **Families.**
  - `GET /portal/students/:id/hostel` (behind `withGuardian`) returns the
    hostel, room and bed this term and the names of the house masters whose
    accounts are active. It returns nothing for a day pupil.
  - No phone numbers and no visits.
  - The card is on the portal's child page and the parent app's child screen,
    beside the school bus card.
- **Web:**
  - `/boarding` in the admin shell, for admin and the House master, whose
    home page it is;
  - `/teacher/boarding`, in the teacher sidebar only for a teacher who keeps
    a hostel;
  - one shared panel: a hostel picker when there is more than one, then the
    boarders, then the visitor log with a day picker, "Has left", "Remove"
    and a "Log a visitor" form;
  - a boarder sent home today is tinted amber and labelled "Sent home by the
    sickbay today" in words;
  - the staff invite form offers **House master**, and the staff list names
    the role.
- **Staff app:** Boarding (a bed icon) in the School group, for admin, the
  House master and a teacher who keeps a hostel. It has the hostel list,
  then per hostel:
  - today's visitors, with "Has left";
  - the boarders, each with the sent-home notice where it applies; tapping
    one logs a visitor arriving now.

  The query keys are staff-prefixed, so nothing is kept on the phone.
- **Tests:**
  - `hostel-house.service.spec.ts` (9 tests, real database):
    - who keeps which hostel;
    - the teacher-scope flag;
    - another school;
    - the sent-home flag: today, stayed in school, withdrawn, two days ago;
    - the sickbay label;
    - the visitor log's rules and audit;
    - the parent's card and what it leaves out.
  - Permission coverage for every `/boarding` route.
  - The staff app's menu spec.
  - e2e `hostel-boarding.spec.ts`: the boarder flagged without the complaint,
    a visitor logged and gone, the sickbay label, and the parent's card
    without the visitor.
  - `/boarding` and the portal card were checked at 320 and 390 px with no
    sideways scroll.

### 15.11 As built — CP6b.3, exeats (2026-10-17)

- **Data** (migration `20261105120000_hostel_exeats`): `hostel_exeats`, with:
  - the hostel and the boarder;
  - out at and back by (a `CHECK` that back is after out);
  - the reason (1–300 characters);
  - who will collect: name, relationship and phone;
  - the status (enum `HostelExeatStatus`);
  - who asked: a guardian **or** a member of staff, exactly one (a `CHECK`);
  - who decided, when, and the decision note (a `CHECK` that a refusal has
    one);
  - left at, and who actually collected the child; back at; cancelled at.

  RLS enabled and forced, with `tenant_isolation`. No SECURITY DEFINER
  function; the count stays 23. No new permission: the house master's side
  is `hostel.house`, scoped to the hostels kept as in CP6b.2, and the
  parent's side is `withGuardian`.
- **Statuses only move forward:** REQUESTED → APPROVED or REFUSED → OUT →
  BACK, or CANCELLED before the child leaves. Each move is a conditional
  update on the status it expects, so two people acting at once cannot both
  succeed. The loser is told where the leave out now stands ("The child has
  already left.").
  - An approval can be withdrawn, with a note, before the child leaves.
  - "Has left" before an approval answers "Approve the leave out before the
    child leaves."
- **Asking.**
  - Any linked guardian may ask (owner's answer 5), but only for a child who
    holds a bed this term and is still at the school.
  - The school can enter a request taken by phone, for a boarder of a hostel
    it keeps.
  - Checks on the times:
    - back must be after out, and not already past;
    - at most 30 days out;
    - at most 90 days ahead;
    - not overlapping another open leave out for the same child
      (`EXEAT_OVERLAPS`). A cancelled one frees its time.
- **Telling the parents.**
  - On approval or refusal every linked guardian is told: push when the app
    reaches them, else SMS where the school sends SMS (the sickbay's rule,
    without its "only when sent home" limit).
  - The message is "Adaeze's leave out on 18 Oct 2026 was approved." or "…
    was not approved. Open the app to see why."
  - The refusal note is read in the app, never put in an SMS.
  - Counts per channel are audited. Nothing is sent for out, back or late.
- **Late.**
  - A child OUT past the time agreed is `late` on the house master's list
    (tinted red, "Late: was due back …") and to the parent ("Late back"). No
    message is sent.
  - A child back after the time agreed is marked "Came back late".
- **API:**
  - house master (`hostel.house`):
    - `GET /boarding/hostels/:id/exeats?view=open|past`;
    - `POST /boarding/hostels/:id/exeats`: a request taken by phone;
    - `POST /boarding/exeats/:id/approve|refuse|left|back|cancel`.
  - parent:
    - `GET` and `POST /portal/students/:id/exeats`;
    - `POST /portal/students/:id/exeats/:exeatId/cancel`.

    The parent's view names no member of staff.
- **Web:**
  - a **Leave out** section on the Boarding page, between the boarders and
    the visitor log, with Open and Past views;
  - a waiting request is tinted amber and says "Waiting for the house
    master"; an out one is tinted blue; a late one is tinted red, in words;
  - actions: Approve; Refuse with a note the parent reads; Has left, with an
    optional "Collected by, if not …"; Is back; Cancel it;
  - an "Enter a request taken by phone" form.
- **Portal and parent app.**
  - Under the hostel card, the child's leave outs: each status in words, the
    school's note on a refusal, "Late back", and "Cancel this leave out"
    while it can be.
  - "Ask for leave out" opens a form with days, times, reason and collector.
    The parent app uses its own screen, with days as number boxes.
  - Times are Lagos wall-clock.
- **Staff app.** The hostel screen gains **Leave out**, the open list, with:
  - Approve;
  - Refuse or Withdraw approval, with a note;
  - Has left (the named collector);
  - Is back.
- **Tests:**
  - `hostel-exeat.service.spec.ts` (8 tests, real database):
    - the whole path, forward only, every step audited;
    - who is told, and by which channel;
    - a refusal's note: in the app, not in the message, with no staff names
      for the parent;
    - late and came back late;
    - cancelling and overlaps;
    - times checked;
    - only the child's own guardian, and only for a boarder;
    - phone requests and who may decide;
    - the message wording.
  - Permission coverage for the new routes.
  - e2e `hostel-exeats.spec.ts`: the parent asks in the portal; the house
    master approves, logs the child out with someone else collecting, then
    back; the parent sees each step.
  - The Boarding page and the portal panel, with the forms open, were
    checked at 320 and 390 px with no sideways scroll.
- **Left out:** a scheduled reminder or SMS when a child is late, gate
  passes, and cancelling open leave outs automatically on withdrawal (a
  withdrawn child's open request stays until the school cancels it).

## 16. CP7 plan-first — Online admission applications

Written 2026-10-17 for the owner's approval. Nothing is built until it is
approved. It uses F1 (private files, shipped in CP3/CP4) and answers Q9
(§3: yes, behind a per-school switch, with rate limits, a honeypot, NDPR
consent and a 90-day purge; accepting creates the student through the
existing create path).

### 16.1 What exists today (read from the code)

- **No admissions table, page or route exists.** The spec is §5 CP7 above.
- **Creating a student.** `StudentsService.create`
  (`apps/api/src/modules/students/students.service.ts`) is owner/admin only.
  It enforces:
  - the plan's student cap (`assertRoomForStudents`, which blocks only under
    `PLAN_ENFORCEMENT=enforce`);
  - the school's admission-number rule (typed, or AUTO from
    `admission-numbers.ts`; with the CLASS order it needs the class, so an
    enrollment);
  - the unique admission number per school.

  It can enroll the child in the same transaction. It does **not** link a
  guardian, and **nothing anywhere checks for a duplicate child by name and
  date of birth**.
- **Creating a guardian.** `GuardiansService.createAndLink` and
  `linkExisting`, owner/admin. A guardian's email is unique per school; the
  phone is deliberately shareable.
- **Public pages and endpoints.**
  - The result checker is the model: a public page in the **portal**
    (`/result-checker/[slug]`), calling the API directly from the browser.
  - The API resolves the school by slug with `basePrisma` (`schools` has no
    RLS) and works under `withTenant` from there.
  - Rate limits are the global Redis-backed throttler, keyed by the verified
    client address, with per-route `@Throttle` limits (5 a minute on the
    checker).
  - The portal's middleware guards only its own list of routes, so
    `/apply/...` is public by default.
- **Files (F1).** `assertPrivateFile` checks the type by the bytes (JPG, PNG,
  WebP, PDF) and caps a file at 10 MB, and files are read through 5-minute
  signed links. The storage key kinds have no `admission-document` yet; F1's
  own header names it as the next user.
- **Email.** `EmailService.send` sends to any address, from "<school> via
  SchoolKit".
- **Jobs.** Nightly clean-ups use `@nestjs/schedule` `@Cron`; the report
  export sweeper is the model.
- **Switches.** School-owned switches are boolean columns on `School`,
  toggled through `PATCH /schools/me` from a Settings page.
- **No honeypot or captcha exists** anywhere.

### 16.2 Decisions (owner may overrule any)

- **CP7-D1. The school's switch and its admissions settings.** Settings →
  Admissions (owner and admin) holds:
  - **Take applications online**, off by default;
  - a short introduction shown at the top of the form ("Admission into JSS1
    for the 2027/2028 session…");
  - **the classes open for application**, chosen from the school's class
    levels. The form offers only those.
  - **which documents to ask for**: the passport photo and the birth
    certificate, each set to required, optional or not asked;
  - the email address that receives a copy of each new application
    (optional).

  With the switch off, the public page says "This school is not taking
  applications online. Please contact the school." and the API refuses
  submissions.
- **CP7-D2. The public form**, at `portal.schoolkit.ng/apply/<school-slug>`,
  with the school's name and logo:
  - **the child:** first, middle and last name; date of birth; gender; the
    class applied for; previous school (optional);
  - **the parent or guardian:** first and last name, relationship, phone,
    **email (required**, because status emails are how the family hears
    back); home address (optional);
  - **documents** as the school set them, one file each, checked by
    `assertPrivateFile`;
  - **consent:** a required tickbox, "I agree that <school> may use these
    details and documents to consider this application. They will be deleted
    if the application does not lead to admission." The time of consent and
    the wording's version are stored with the application.

  **One request, no staging.** Fields and files go in a single multipart
  submission, so a stranger never leaves orphaned uploads behind. The total
  is capped at 2 files × 10 MB.

  On success the family sees a **reference** (`APP-2027-0042`, numbered per
  school per year) and gets a confirmation email.
- **CP7-D3. Protections.**
  - Per-address rate limits on the submission (5 an hour) and on the form
    read (30 a minute), with the existing throttler.
  - A **honeypot**: a field hidden from people and screen readers. A filled
    one is answered exactly like success (with a reference that matches no
    application) and nothing is stored, so a bot learns nothing.
  - At most **3 open applications per guardian email per school**, so one
    address cannot flood a school.
  - The type check on files, as F1.
  - Nothing the applicant typed is logged. Audit rows carry the application's
    id and status only.
- **CP7-D4. Statuses.**
  - SUBMITTED → UNDER REVIEW → OFFERED → ADMITTED, or REJECTED or WITHDRAWN
    from any open state.
  - Each move is conditional on the expected status, as with exeats.
  - An **entrance exam** is optional: a date, time and venue note set on the
    application while it is under review, emailed to the family. Setting it
    again sends the change.
  - The family is emailed at each step:
    - received;
    - exam booked;
    - offered;
    - not successful;
    - admitted, with the admission number;
    - withdrawn.

    Each email names the child by first name and the school, and gives the
    reference. A refusal gives no reason unless the school types one.
  - **WITHDRAWN** is set by the school when the family asks. There is no
    public tracking page and no applicant login (question 3).
- **CP7-D5. Admitting** creates the child and links the family, in one
  transaction, through the same internals the existing create paths use:
  - **The student**, using the existing create internals: the cap, the
    admission-number rule and the unique number. The admitting admin chooses
    the **class arm and term** to enroll into (the class level is preset from
    the application). A typed admission number is offered where the school
    numbers by hand.
  - **The guardian**: if a guardian with that email already exists at the
    school (a sibling's parent), the admin is shown them and **links the
    existing guardian** by default; otherwise a new guardian is created and
    linked as primary.
  - **A possible-duplicate warning**, new: a student at the school with the
    same first name, last name and date of birth is shown before admitting.
    It never blocks.
  - **The application stays**, linked to the new student. Its documents
    become the child's **admission documents**, readable from the student
    page by owner and admin only.
  - The family's portal invitation stays a separate, deliberate step on the
    guardian's page, as today.
- **CP7-D6. Who.**
  - New permissions `admission.read` and `admission.manage`: owner and
    admin.
  - No new role (question 1).
  - The service re-checks the role on every call.
- **CP7-D7. Keeping and deleting** (NDPR).
  - A REJECTED or WITHDRAWN application, with its files, is **deleted 90
    days after it closed**, by a nightly job (files first, then the row).
  - An application still open after **12 months** is closed as WITHDRAWN
    (the family is told) and then follows the same 90 days.
  - ADMITTED applications are kept as part of the student's record.
- **CP7-D8. Telling the school.** New applications show on the dashboard's
  "Needs you today" ("3 new admission applications"), and in the optional
  copy-to email from D1. No push or SMS.
- **CP7-D9. Plans.** Admissions is on **every plan**: it brings students
  in. A school at its student cap can still receive applications, but under
  `enforce` cannot admit past the cap (`PLAN_STUDENT_LIMIT`, said in words
  on the Admit button's page).
- **CP7-D10. Not on the apps.** Admissions is office work on the website.
  The staff app is unchanged. The public form is a portal page, so it works
  on any phone browser.

### 16.3 What gets built

| Slice | PR | What |
|---|---|---|
| **CP7.1** | its own, reviewed first | **Settings, the public form and the list.** Tables, RLS, permissions; Settings → Admissions; the public page and its one-request submission with honeypot, rate limits, consent and the `admission-document` key; the confirmation email and the school's copy; the staff **Admissions** page (list by status, an application's page with its documents); the dashboard line; the nightly purge. |
| **CP7.2** | second | **Review and admitting.** Under review, the entrance exam, offer, reject, withdraw, with the status emails; **Admit**, which creates and enrolls the student and creates or links the guardian, with the duplicate warning; the student page's admission documents; the 12-month close. |

### 16.4 Data

- `schools` gains:
  - `admissions_enabled` (boolean, default false);
  - `admissions_intro` (text, nullable);
  - `admissions_photo` and `admissions_birth_cert` (`REQUIRED` / `OPTIONAL` /
    `OFF`);
  - `admissions_notify_email` (nullable).

  Plus `admission_class_levels` (school, class level), the classes open.
- `admission_applications`, with:
  - the school and a reference unique per school;
  - the child's names, date of birth (`DATE`), gender, class level applied
    for, previous school;
  - the guardian's names, relationship, phone, email, address;
  - consent: time and wording version;
  - the status, and when the status last changed;
  - the exam: time and note;
  - a decision note;
  - the student id (set on admission) and who admitted;
  - created and updated times.

  `CHECK`s cover lengths, the status/student pairing (ADMITTED has a student;
  nothing else does), and the reference format.
- `admission_documents`: the application, the kind (`PHOTO`,
  `BIRTH_CERTIFICATE`), the stored file's type and size.
- `admission_reference_counters`: per school and year, row-locked like the
  admission-number counter.
- Every table carries `school_id`, with RLS enabled and forced,
  `tenant_isolation` and explicit grants.
- **The public submission needs no SECURITY DEFINER function.** `schools` has
  no RLS, so the slug resolves with `basePrisma`, and every write then runs
  under `withTenant` for that school, as the result checker does. The count
  stays 23.

### 16.5 Tests (the rules first)

- **The form:**
  - refused when the switch is off;
  - only the open classes are accepted;
  - required documents are required, and "off" ones are refused;
  - wrong file types are refused by their bytes;
  - consent is required;
  - a filled honeypot stores nothing and answers like success;
  - the fourth open application from one email is refused;
  - the rate limit holds;
  - nothing the applicant typed reaches an audit row or a log line.
- **Statuses:** they move only forward; two people acting at once cannot both
  succeed; each step sends its one email, with the right words and no other
  family's details.
- **Admitting:**
  - creates exactly one student and one link, in one transaction (a failure
    leaves neither);
  - honours the admission-number rule, including CLASS order;
  - honours the cap under `enforce`;
  - links an existing guardian with the same email rather than failing on
    the unique email;
  - shows the possible duplicate;
  - the application becomes ADMITTED with the student's id.
- **Tenancy:** RLS hides another school's applications; a slug resolves only
  its own school; the documents' signed links are only for owner and admin
  of that school.
- **Purge:** rejected and withdrawn applications older than 90 days go, files
  first; admitted ones stay; the 12-month close.
- **e2e:** a family applies on the portal page with a photo; the admin sees it,
  books an exam, offers, admits into a class; the student exists with the
  guardian linked and the photo under admission documents.
- **Phone fit:** the public form and the Admissions pages at 320 and 390 px.

### 16.6 Left out on purpose

- Application fees and acceptance fees paid online (strangers paying a
  school needs its own review). The school records acceptance by hand.
- A public tracking page or applicant login (emails only).
- Interview scheduling beyond one exam date and note; exam scores.
- Waiting lists and class quotas.
- Captchas (third-party scripts and data sharing). The honeypot and rate
  limits come first.
- The staff app.

### 16.7 Questions for the owner

1. **Owner and admin decide on applications; no new "admissions officer"
   role** (CP7-D6)? Recommended: yes; a role can follow if a school asks.
2. **The school records that the family accepted the offer, and then
   presses Admit** (CP7-D4, D5), with any acceptance fee handled outside
   SchoolKit for now? Recommended: yes.
3. **Status emails only; no tracking page or applicant login, so a guardian
   email is required** (CP7-D2, D4)? Recommended: yes.
4. **Each school chooses whether the passport photo and birth certificate
   are required, optional or not asked** (CP7-D1)? Recommended: yes, both
   optional by default.
5. **Deleting:** rejected or withdrawn applications 90 days after closing;
   applications left open for 12 months closed and then deleted the same
   way; admitted applications kept with the student (CP7-D7)? Recommended:
   yes.
6. **On every plan** (CP7-D9)? Recommended: yes.

### 16.8 Owner's answers (2026-10-17) and what they change

The owner also set the direction: **applications are open by default**, it
must be "easy, fast and simple", the school is told of **every new
application by email, SMS and push**, applicants are **listed separately from
students until the school clears them** for a class (after an entrance exam,
an online assessment, or whatever the school uses), and **Settings gives each
school flexibility over its own requirements and form fields**. Each school
will soon have its own address (`virgofidelis.schoolkit.ng`), whose main page
shows "Apply" by default.

- **Open by default** (replaces "off by default" in D1).
  - `admissions_enabled` defaults to **true** for every school, existing and
    new, with **every class level open**.
  - The admin turns it off, or closes classes, in Settings → Admissions.
  - The form is built to take the school from the address, so today's
    `portal.schoolkit.ng/apply/<slug>` and tomorrow's
    `<slug>.schoolkit.ng` main page are the same page. The subdomain itself
    (DNS, certificates, routing) is not part of CP7.
- **The school's own form** (extends D1, D2). In Settings → Admissions the
  admin sets:
  - **Built-in fields**, each required, optional or not asked:
    - the child's middle name, previous school and previous class;
    - home address, religion, state of origin;
    - medical needs or allergies;
    - a second parent or guardian.

    The child's names, date of birth, gender and class applied for, and one
    parent's name, relationship, phone and email, are always asked.
  - **Documents**, each required, optional or not asked:
    - passport photo and birth certificate (optional by default, answer 4);
    - last school report or results (not asked by default);
    - up to **3 more documents the school names itself** ("Baptismal
      certificate").

    At most 6 files, 10 MB each, typed by their bytes as F1.
  - **Up to 5 questions of the school's own**: short answer, long answer,
    yes/no, or one of a list ("How did you hear about us?", "Boarding or
    day?").
  - The introduction, the classes open, and who is told (below).
- **Telling the school of each new application** (replaces D8). Every
  application that passes the honeypot and the limits tells **the admins and
  the admissions officers**:
  - by **push** on the staff app, through the event notifier staff push
    already uses (announcements);
  - by **email** to each of them, and to the optional school address;
  - by **SMS** to each of them, through the school's Termii sender. SMS costs
    money per message, so a school can switch SMS off in Settings, and
    alerts stop at **30 SMS a school a day**. Past that the email and push
    still go, and the next SMS says how many were not texted. A flood can
    therefore never run up a bill.

  The dashboard's "Needs you today" line stays.
- **Applicants are separate from students.**
  - Nobody appears in Students, attendance, fees, classes or counts until the
    school **admits** them.
  - The **Admissions** page is its own list, by status and class applied
    for.
- **Answer 1: the Admissions officer role** (replaces D6).
  - A new optional system role, `admission_officer`, holding `admission.read`
    and `admission.manage` and nothing else.
  - **Nobody holds it by default**; the owner and admins do the work. The
    admin can give it to any member of staff in Settings → Admissions →
    Admissions officers.
  - It is an **extra** role: a teacher or bursar keeps their own role and
    gains this one. Granting and removing are audited.
  - A teacher who is an officer reaches Admissions from the teacher portal,
    as Boarding is reached in CP6b.2.
  - The service re-checks the role on every call.
- **Answer 2: offers show the complete breakdown** (extends D4, D5).
  - **Offer** carries an **offer letter** the school writes: the fees, the
    items, the resumption date, and any deadline to accept.
  - A default is kept in Settings and can be edited for each offer.
  - The family receives it in full by email and on the tracking page.
  - Acceptance is recorded only **after the family has seen the complete
    breakdown**:
    - the family presses **Accept the offer** on the tracking page, which
      shows the letter in full above the button; or
    - the school records the acceptance (by phone or in person) with a
      tickbox "The family has seen the full offer letter".

    Either way the time, and who recorded it, are stored.
  - **Admit** is offered only once the offer is accepted.
  - The new status is OFFER_ACCEPTED:
    SUBMITTED → UNDER REVIEW → OFFERED → OFFER ACCEPTED → ADMITTED, with
    REJECTED or WITHDRAWN from any open state.
- **Answer 3: tracking** (replaces "emails only" in D4 and question 3).
  - Every email carries the family's **private tracking link**: a random
    token, stored hashed, as invitation links are. No login.
  - The page shows:
    - the status in words;
    - the **assessment** (entrance exam, interview or online assessment) with
      date, time and the school's note;
    - the offer letter.
  - The family can **accept the offer** or **withdraw** the application
    there.
  - The link stops working once the application is deleted.
  - It is rate-limited and reveals nothing beyond that one application.
  - Emails stay the main channel. The assessment is a step with a type
    (entrance exam, interview, online assessment, other) rather than "exam"
    only, because schools differ.
- **Answer 4:** documents optional by default; each school changes it. As
  above.
- **Answer 5:** deletion stands. A rejected or withdrawn application, with
  its files, goes **90 days after it closed**. An application left open for
  12 months is closed as withdrawn, with the family told, and then follows
  the same 90 days. Admitted applications stay with the student.
- **Answer 6:** every plan has equal access. A school at its cap still
  receives applications but cannot admit past the limit under `enforce`.

**What gets built, revised:**

| Slice | PR | What |
|---|---|---|
| **CP7.1** | its own, reviewed first | **Settings, the form, the alerts and the list.** Tables, RLS, permissions; the Admissions officer role and its grant; Settings → Admissions (switch on by default, classes, built-in fields, documents, the school's questions, who is told, SMS on or off, the default offer letter); the public form, with honeypot, rate limits, consent and the `admission-document` key; the confirmation email with the tracking link; the alerts by push, email and SMS with the daily SMS cap; the **Admissions** page (list, and an application's page with its answers and documents); the dashboard line; the nightly purge. |
| **CP7.2** | second | **Review, assessment, offer and admitting.** Under review; booking the assessment; offer with its letter; reject and withdraw; the status emails; the **tracking page** (status, assessment, offer letter, Accept the offer, Withdraw); recording an acceptance by the school; **Admit** (create and enrol the student, create or link the guardian, the possible-duplicate warning); the student page's admission documents; the 12-month close. |

### 16.9 As built — CP7.1, settings, the form, the alerts and the list (2026-10-17)

- **Data** (migration `20261106120000_admissions`):
  - `admission_settings`: one row per school, written on first save. Until
    then the defaults apply and applications are **open**.
  - `admission_applications`, with:
    - a reference unique per school, matching `APP-YYYY-NNNN`;
    - the core fields for the child and the parent;
    - `answers`, a JSON holding the optional fields and the school's own
      questions, with their labels copied in;
    - the status, and when it last changed;
    - consent: time and wording version;
    - the tracking token's sha256;
    - a student id, which only an ADMITTED application may carry (a
      `CHECK`).
  - `admission_documents`: a slot (one of six), extension and size, with
    `CHECK`s.
  - `admission_reference_counters` and `admission_sms_counters`, each taken
    by one atomic upsert.

  Every table has RLS enabled and forced. No SECURITY DEFINER function; the
  count stays 23.
- **Permissions and the role.**
  - `admission.read` and `admission.manage`: admin, and the new
    **Admissions officer** role (those two only). Nobody holds the role by
    default.
  - `admission.settings`: admin only. It guards the form, the switch and the
    officers, so an officer handles applications but never shapes the form.
    The two-gate conformance spec found the disagreement that made this a
    separate permission.
  - Officers are granted as an **extra** role, in Settings → Admissions, to
    active staff who are not owners or admins. Each grant and removal is
    audited.
- **Settings → Admissions** (owner, admin):
  - the switch and the form's address;
  - the introduction;
  - the classes open;
  - the eight built-in fields, each required, optional or not asked;
  - the three standard documents, plus up to three the school names;
  - up to five questions of its own (short answer, long answer, yes/no, one
    of a list);
  - SMS alerts on or off, and an extra email address;
  - the default offer letter (used in CP7.2);
  - the officers.

  Defaults: photo and birth certificate optional, last report not asked;
  middle name, previous school and class, address and medical needs
  optional; religion, state of origin and a second parent not asked.
- **The public form** at `portal.schoolkit.ng/apply/<slug>`.
  - It calls the API directly from the browser, as the result checker does,
    so the per-address limits key on each family: 30 a minute to read, 5 an
    hour to submit.
  - Answers and up to six files go in **one** multipart request.
  - The API checks every rule again:
    - a required field or document is required;
    - one not asked is dropped (fields) or refused (documents);
    - questions are checked by kind;
    - the class must be open;
    - the date of birth must be real and between 1 and 25 years ago;
    - files are typed by their bytes;
    - at most 3 open applications per email per school (case-insensitive).
  - Files are stored first, under fresh ids, and removed again if the row
    cannot be written.
  - A filled **honeypot** gets a plausible reference, and nothing is stored
    or sent.
  - A school switched off, or one suspended by the platform, says so.
- **The family.** On success they see the reference and get an email with a
  private tracking link, `/apply/<slug>/track/<token>`. The page shows the
  status in words, the class, the reference and the date. The assessment,
  offer letter, accepting and withdrawing come in CP7.2.
- **The school is told** of each application, after it is saved and never
  failing it:
  - push on the staff app to the owner, admins and officers, through
    `notifyOfEvent` (event `admission.applied`), with no child's name on the
    lock screen;
  - email to each of them and the copy-to address, with the applicant's text
    HTML-escaped;
  - SMS to each of them with a phone, unless switched off. At most **30 a
    school a Lagos day** (one conditional upsert); the 30th says the limit is
    reached.
- **Admissions page** (`/admissions`; `/teacher/admissions` for a teacher who
  is an officer).
  - One tab per status with counts, "New" first and oldest first.
  - An application's page shows the child, the parents, "More about the
    child" (the fields and questions as answered) and the documents, each
    opened through a 5-minute link that is audited.
  - Applicants are never students until admitted (CP7.2).
  - The dashboard's "Needs you today" gains "New admission applications".
- **The purge.** Every night at 02:35, rejected and withdrawn applications
  90 days past closing are deleted, files first. Open and admitted ones stay.
- **Settings link.** `NEXT_PUBLIC_PORTAL_URL` (apps/web, optional; defaults
  as `NEXT_PUBLIC_CBT_URL` does) prints the form's address.
- **Tests:**
  - `admissions.service.spec.ts` (13 tests, real database and storage):
    - defaults;
    - who may shape the form;
    - officers;
    - storing and acknowledging, with the tracking link;
    - who is told and how;
    - the SMS cap and switch;
    - the honeypot;
    - the school's own form, rule by rule;
    - switched off and unknown school;
    - the per-email limit;
    - the list, the detail and audited document links;
    - the purge;
    - tenancy.
  - Permission coverage for the routes and the role.
  - e2e `admissions-apply.spec.ts`: the admin requires the photo and adds a
    question; a family applies on the portal; the application waits on
    Admissions with the answer and the document.
  - All the pages were checked at 320 and 390 px (the form's document inputs
    were fixed to fit).

### 16.10 As built — CP7.2, review, assessment, offer and admitting (2026-10-18)

- **Data** (migration `20261107120000_admission_decisions`). No new table.
  `admission_applications` gains:
  - the **assessment**: its kind (entrance exam, interview, online
    assessment, other), time and note;
  - the **offer letter** as the family saw it, and when it was offered;
  - the **acceptance**: when, and the member of staff who recorded it
    (empty means the family accepted online);
  - the school's optional note when an application is not successful;
  - when it was admitted, and by whom.

  `CHECK`s make an offer impossible without its letter, and an accepted offer
  impossible without the time it was accepted. The SECURITY DEFINER count
  stays 23.
- **Who.** A new permission, `admission.admit`, for owner and admin.
  - An Admissions officer takes an application as far as an accepted offer:
    review, the assessment, the offer, not successful, withdrawn, and
    recording the family's acceptance.
  - **Admit** creates the student, so the admin clears the child into a class
    ("until cleared by admin", §16.8).
  - `admission.admit` also reads a student's admission documents. The two-gate
    conformance spec and the permission coverage pin both.
- **Statuses.**
  - Every move is one conditional update on the expected status, so two
    people acting at once cannot both succeed; the second is told the
    application's new status.
  - Moves go only forward: New → Under review → Offered → Offer accepted →
    Admitted, with Not successful or Withdrawn from any open state.
  - Booking the assessment moves a new application to Under review. It can be
    changed while the application is being decided, but not set in the past.
- **The family's emails** go after each change is saved and never fail it:
  - the assessment booked, or changed;
  - the offer, with the **letter in full**;
  - not successful, with the school's note only if it typed one;
  - admitted, with the admission number;
  - withdrawn: by the family, by the school, or closed after 12 months.

  Each names the child by first name and the school, gives the reference and
  carries the private tracking link.
- **The tracking link in every email.** CP7.1 kept only the link's sha256, so
  it could not be put in later emails. The token is now **derived**: an HMAC
  of the application's id under the server key `RESULT_PIN_HMAC_KEY` (which
  production refuses to start without), under a label of its own. The API can
  rebuild the link for each email, while a stolen database still holds no
  working link.
  - Rotating that key ends every tracking link, as it voids PINs. An email for
    an application whose link no longer rebuilds says to use the first email's
    link instead.
  - The applications sent before this change (CP7.1 only) are in the same
    position.
- **The tracking page** shows:
  - the status in words;
  - the assessment, while the application is open;
  - the offer letter in full;
  - the school's note when it is not successful.

  Under the letter, **Accept the offer** works only once "I have read the full
  offer letter above" is ticked. **Withdraw** asks to confirm. Both are limited
  to 10 an hour per address, and each is audited with no user, marked as the
  family's.
- **The application page's Decision panel** (web; the teacher portal for an
  officer):
  - **Start review**;
  - **Book an assessment** (kind, date, time, a note for the family);
  - **Offer a place**, prefilled with the school's default letter and editable;
  - **Record the family's acceptance**, with the tickbox "The family has seen
    the full offer letter";
  - **Not successful**, with an optional note;
  - **Withdraw**.

  It also shows the assessment, the letter, who recorded the acceptance, and,
  once admitted, the student with a link to them.
- **Admit** (owner, admin), offered only once the offer is accepted. In **one
  transaction**:
  - the application is claimed (Offer accepted → Admitted), so a second admin
    pressing Admit at the same moment is refused;
  - the student is created and placed through **`createStudentInTx`**, the
    body of `StudentsService.create` moved out unchanged. It applies the plan's
    cap (`PLAN_STUDENT_LIMIT` under `enforce`, shown in words), the school's
    numbering including per-class order, and the unique admission number. The
    admin chooses the class and the term, with the class applied for listed
    first, and may type a number.
  - The parent is linked as primary guardian through
    **`linkOrCreatePrimaryGuardianInTx`**. An existing guardian at the school
    with the same email (a sibling's parent), matched case-insensitively, is
    **linked, never duplicated**. Otherwise a new guardian is created. The audit
    rows are those of the guardian screens.
  - The student takes the middle name, home address, religion and state of
    origin from the application where they were asked.

  Any failure, for example a typed number already taken or the cap, leaves no
  student, no guardian and the offer still accepted. Before Admit, the panel
  shows a **possible duplicate** (a student with the same names, ignoring case,
  and date of birth), linked and never blocking, and says which guardian will
  be linked or added.
- **Admission documents on the student page** (Bio tab, owner and admin): the
  application's reference, when the child was admitted, and each document
  through a 5-minute link, audited. Nothing shows for a child not admitted
  online.
- **The 12-month close.** The nightly job first closes applications submitted
  more than 365 days ago and still undecided, as Withdrawn. Each family is
  emailed, and each move is audited as `by: "STALE"`. Then the 90-day deletion
  runs as before.
- **Left as they are.**
  - A second parent on the application stays on the application. Only the
    first is made a guardian. Adding the second is the guardian screens' job.
  - Medical needs stay on the application; the health record is the school
    nurse's.
  - The family's portal invitation stays the separate step on the guardian's
    page.
- **Tests:**
  - `admission-decisions.service.spec.ts` (22 tests, real database and
    storage):
    - the tracking link in every email;
    - review, then the assessment booked and changed;
    - a past date refused;
    - the offer letter in full by email and on the tracking page, and the
      family's acceptance;
    - the school's recorded acceptance and who recorded it;
    - two offers at once;
    - moving only forward;
    - not successful with and without a note;
    - withdrawing by the family and by the school;
    - a tracking link opens only its own school;
    - no applicant text in audit rows;
    - a plain teacher refused, and an officer unable to admit;
    - another school's application;
    - Admit end to end, including the admission documents;
    - Admit only once accepted;
    - linking a sibling's guardian;
    - the duplicate warning;
    - a failure leaving nothing;
    - per-class numbering;
    - the plan's cap;
    - the 12-month close.
  - Permission coverage for the new routes and `admission.admit`.
  - e2e `admissions-admit.spec.ts`:
    1. a family applies with a photo;
    2. the admin books an entrance exam and offers a place;
    3. the family reads the letter on the tracking page and accepts;
    4. the admin admits the child into a class;
    5. the student page shows the admission documents.

    `admissions-apply.spec.ts` still passes.
  - The tracking page with an offer, the application page with each panel and
    the Admit form, and the student page all fit at 320 and 390 px.

## 17. CP8 plan-first — Messaging and email broadcasts

Written 2026-10-18 for the owner's approval. Nothing is built until it is
approved. It answers Q1 (§3) in the recommended **D13 shape**, and it
deliberately reverses **D11 in part** (the-school-day.md): "no general
messaging" becomes "one school inbox for parents, nothing else". D11's reasons
(safeguarding, moderation, retention, support) are why the safety pieces below
are part of the first slice, not a later one.

### 17.1 What exists today (read from the code)

- **No messaging of any kind.** There is no thread, message or inbox model and
  no `messages.*` permission. Families have **Call the school** (D12) on every
  family surface.
- **Announcements** (`apps/api/src/modules/announcements`):
  - audience EVERYONE, PARENTS, STAFF or one CLASS arm;
  - no editing; a correction is a new announcement, and the old one is
    withdrawn;
  - delivery is **push only** through `EventNotifierService.announcementPosted`,
    with a generic lock-screen text. Announcements "can never reach SMS" (N4).
  - Read state stays in the app; no read receipts go back to the school (A5).
- **Notifications:**
  - `notifyOfEvent` claims one `notification_deliveries` row per person per
    event (channel `PUSH | SMS | EMAIL | NONE`), then pushes, held during quiet
    hours (21:00–06:00 Lagos) unless urgent.
  - `notifyGuardian` decides push, else SMS; the caller sends the SMS.
  - Channels are switched per school (`notification_preferences`: email on,
    SMS off, push off by default). **No per-guardian opt-out exists.**
- **Email** (`EmailService.send`, Resend, "<school> via SchoolKit"): HTML only,
  no custom headers, so no `List-Unsubscribe`. **No unsubscribe, suppression
  or bounce table, and no Resend webhook.**
- **Daily caps:** only admissions has one (`admission_sms_counters`, one atomic
  upsert). Its shape is the model for any new cap.
- **Guardians** carry `phone`, `email` (unique per school, optional) and
  `email_verified`, and their portal sessions resolve through
  `auth_resolve_guardian_session`.
- **Nothing** exists for safeguarding keywords or reporting a message.

### 17.2 Decisions (owner may overrule any)

- **CP8-D1. One inbox per school (Q1, D13 shape).**
  - A **guardian** starts a conversation, about one of their linked children
    or "general", with a subject and a message. Only from the portal and the
    parent app.
  - The **school** replies as the school. A guardian sees "<School name>",
    never a staff member's name. Inside the school every message records which
    member of staff wrote it, and owner and admin see it.
  - **Never:** student accounts, staff starting conversations with families,
    family-to-family messages, teacher-to-teacher messages, or attachments.
    The school starting a conversation stays the job of announcements (to many)
    and the phone (to one).
  - Text only, 2,000 characters a message.
- **CP8-D2. Who reads and replies.**
  - New permissions `messages.read` and `messages.reply`. Owner and admin hold
    both and see **every** conversation.
  - A new optional system role, **Inbox officer** (`messages.read`,
    `messages.reply` only), held by nobody until an admin grants it, as an
    extra role, exactly like the Admissions officer (§16.8 answer 1). A
    teacher made an officer reaches the inbox from the teacher portal.
  - Every conversation is visible to every holder; there is no private
    assignment in v1. A conversation can be **marked as handled by** one
    person so two people do not reply twice.
- **CP8-D3. Read state, for messages only.**
  - Each side has unread counts (the school's inbox; the parent's
    conversation list). Announcements keep A5.
  - The parent sees **"Seen by the school"** under their last message once any
    officer has opened it. (Question 2.)
- **CP8-D4. Closing and retention (NDPR).**
  - A conversation **closes** after **30 days** with no new message, or when
    the school closes it. A closed one is read-only; the parent starts a new
    one.
  - Closed conversations are **deleted 2 years after closing**, by the nightly
    job, unless flagged (below). The parent is told the period when they start
    one. (Question 3.)
  - Withdrawing a child or switching a parent's portal off does not delete
    the record; the school keeps it for the same period.
- **CP8-D5. Safety.**
  - **Report:** the parent can report a message from the school, and an
    officer can flag a parent's message. Either way owner and admins are told
    (push and email), the conversation is **kept** until an admin clears the
    flag, and the flag is audited.
  - **Safeguarding words:** a fixed list, maintained in the code, of words and
    phrases about harm, abuse and self-harm (English and Nigerian Pidgin). A
    match never blocks a message. It flags the conversation for owner and
    admins with a push and an email, saying only that a flagged conversation
    is waiting, never the text. (Question 4.)
  - Rate limits: 5 new conversations a day and 30 messages an hour per
    guardian.
  - Nothing a parent typed reaches a log line or an audit row; audit rows
    carry ids and kinds.
  - No AI touches messages (Q6 stands; translation stays unbuilt).
- **CP8-D6. Telling people.**
  - **The school:** a new conversation or a new parent message pushes "New
    message from a parent" to owner, admins and officers (no child's name on
    the lock screen), and puts "Messages waiting" on the dashboard's "Needs you
    today". No SMS to staff.
  - **The parent:** a reply goes by **push**; a parent without the app gets
    an **email** if they have an address. It is **SMS only if the school has
    SMS switched on**, and then capped at **50 a school a day** (one atomic
    upsert, like admissions). The email and SMS say only "<School> replied to
    your message. Open the parent portal to read it.", never the text.
- **CP8-D7. Email broadcasts for announcements.**
  - Composing an announcement to EVERYONE, PARENTS or a CLASS gains **"Also
    email families"** (off by default). It sends the **full announcement** to
    every guardian in that audience with an email address, once each.
    Withdrawing an announcement does not unsend an email; the outbox says so
    before sending.
  - Sent through the existing queue in batches, not inside the request.
  - **Unsubscribe:** every email has a one-click link (and a
    `List-Unsubscribe` header) that stops **announcement emails** from that
    school to that address. Messages and receipts are not affected. The
    guardian can switch it back on in the portal.
  - **Bounces and complaints:** a Resend webhook (signed, new
    `RESEND_WEBHOOK_SECRET`) records delivered, bounced and complained. A hard
    bounce or a complaint stops all non-essential email to that address.
  - **Cap:** **1,000 announcement emails a school a day** (Resend's own limits
    and cost); past it, the rest are not sent and the outbox says how many.
    (Question 5.)
  - **Delivery status** in the outbox per announcement: sent, delivered,
    bounced, unsubscribed, not sent (no address or capped). Counts only, plus
    the list of bounced guardians for the school to fix addresses.
  - Email is switched per school by the existing `notification_preferences`
    email switch.
- **CP8-D8. Plans.** Messaging and email broadcasts are on **every plan**; SMS
  follows the school's own SMS switch.
- **CP8-D9. Surfaces.**
  - **Parents:** portal (Messages page, start a conversation, reply, report)
    and the parent app (same screens).
  - **School:** the web inbox (`/messages`, and `/teacher/messages` for an
    officer) and the **staff app** inbox (reply, mark handled, flag), since
    replies are often written on a phone.
  - Students: nothing.

### 17.3 What gets built

| Slice | PR | What |
|---|---|---|
| **CP8.1** | its own, reviewed first | **The inbox.** Tables, RLS, permissions, the Inbox officer role and its grant; guardian start/reply/list (portal + parent app); school inbox list/read/reply/mark handled/close (web + teacher portal + staff app); read state and "Seen by the school"; staff push and the dashboard line; parent reply push → email → capped SMS; rate limits; the 30-day close. |
| **CP8.2** | second | **Safety and retention.** Report and flag, with admin alerts and clearing; the safeguarding word list and its alerts; the 2-year deletion that skips flagged conversations; the audit trail; tests that no text reaches logs or audits. |
| **CP8.3** | third | **Email broadcasts.** "Also email families"; the batched send job; unsubscribe links, the header and the portal switch; the Resend webhook, suppression of bounces and complaints; the daily cap; delivery status in the outbox (web and staff app). |

### 17.4 Data

- `message_threads`: school, guardian, the child (nullable, "general"),
  subject, status (OPEN, CLOSED), last message time, handled by (user,
  nullable), flagged at / by / reason kind (nullable), closed at, created at.
- `messages`: school, thread, author kind (GUARDIAN, STAFF), the guardian or
  the user, body (≤ 2,000), safeguarding match (boolean), created at.
- `message_reads`: thread, reader kind and id, last read time (one row per
  reader per thread).
- `message_sms_counters`: per school per Lagos day.
- `email_suppressions`: school, email (lower-cased), reason (UNSUBSCRIBED,
  BOUNCED, COMPLAINED), scope (ANNOUNCEMENTS, ALL), created at; unique per
  school and email and scope.
- `announcement_emails`: announcement, guardian, email, status (QUEUED, SENT,
  DELIVERED, BOUNCED, COMPLAINED, SUPPRESSED, CAPPED), provider id, times.
- `announcement_email_counters`: per school per Lagos day.
- Every table has `school_id`, RLS enabled and forced, `tenant_isolation`
  and explicit grants.
- **The webhook and the unsubscribe link need no SECURITY DEFINER function.**
  - The unsubscribe link carries the school's slug and an HMAC of
    (school, email) under the server key, so the school resolves through
    `schools` (no RLS) and the write runs under its GUC.
  - The webhook carries the Resend message id plus tags set when sending
    (school id), so it too writes under that school's GUC after the signature
    checks.
  - The count stays 23.

### 17.5 Tests (the rules first)

- **Tenancy and reach:** a guardian sees only their own conversations, about
  only their own children; another school's thread is not found; a student
  token and a teacher without the permission are refused.
- **Two-gate:** `messages.reply` holders all pass the service check; the
  Inbox officer holds those two and nothing else.
- **Replies:** the guardian sees the school's name only; owner and admin see
  who wrote it; a closed conversation refuses new messages; marking handled
  and closing are conditional updates.
- **Notifications:** one push per new message per person; the parent gets
  push, else email, else SMS only with the school's SMS on, and the 51st SMS
  of the day does not go; no message text in any push, email or SMS about a
  reply.
- **Safety:** a safeguarding word flags and alerts without blocking; a report
  keeps the conversation past its deletion date; clearing is admin-only and
  audited; nothing typed reaches an audit row or a log line.
- **Retention:** 30-day close; deletion 2 years after closing; flagged ones
  stay.
- **Email broadcasts:** each guardian in the audience with an address gets
  one email; suppressed and unsubscribed addresses get none; the cap holds;
  the unsubscribe link works without a login and only for its own school and
  address; a forged webhook is refused; a bounce suppresses the address.
- **e2e:** a parent writes from the portal about their child; the school
  replies from the web inbox; the parent reads it; an announcement sent with
  "Also email families" shows its delivery counts.
- **Phone fit** at 320 and 390 px for every new page.

### 17.6 Left out on purpose

- Staff starting a conversation with a family; group messages; teacher ↔
  parent threads assigned to a named teacher.
- Students in any form; family-to-family; teacher-to-teacher.
- Attachments, voice notes, images.
- WhatsApp (CP9) and translation (Q6).
- Read receipts for announcements (A5 stands).
- Editing or deleting a sent message (the record is the record).
- Scheduling announcement emails for later.

### 17.7 Questions for the owner

1. **The D13 shape** (CP8-D1, D2): parents write to **the school**, replies
   come from "the school", any admin or Inbox officer can answer, no named
   teacher threads, and staff cannot start conversations with families?
   Recommended: yes.
2. **"Seen by the school"** shown to the parent once the school opens their
   message (CP8-D3)? Recommended: yes; it stops "did you get it?" calls.
3. **Retention** (CP8-D4): close after 30 days quiet; delete 2 years after
   closing unless flagged? Recommended: yes.
4. **Safeguarding words** (CP8-D5): a fixed list in the code, flag and alert
   only, never block, never AI? Recommended: yes.
5. **Email broadcasts** (CP8-D7): off by default per announcement, full text
   in the email, one-click unsubscribe, bounce suppression, 1,000 a school a
   day? Recommended: yes.
6. **Reply alerts to parents** (CP8-D6): push, else email, else SMS only if
   the school's SMS switch is on, capped at 50 a day? Recommended: yes.

### 17.8 Owner's answers (2026-10-18) and what they change

The owner widened the inbox: **a parent chooses who they are writing to**, and
**only that person or group, and whoever handles it, sees the conversation**.
Images may be attached.

- **Who a parent can write to** (replaces "one inbox" in CP8-D1). Starting a
  conversation, the parent picks one child (or "general") and one recipient:
  - **The child's form teacher** (JSS and SSS) or **class teacher** (nursery
    and primary): the class arm's `class_teacher_id` for the current term,
    named by the class level's stage. Offered only when the arm has one.
  - **The bursar**: every holder of the bursar role.
  - **The principal or school admin**: the owner and admins (there is no
    separate principal role; the owner and admins are the school's head).
  - **The school office** ("general"): the Inbox officers, or the owner and
    admins when the school has appointed none.

  The conversation is addressed to that person or group **at the time it
  starts**; a new form teacher next term does not inherit it.
- **Who sees it** (replaces "admins see every thread" in CP8-D2).
  - Only the recipients above for that conversation. No other member of
    staff, including other admins and officers, unless:
    - it is **passed on**: any recipient can pass a conversation to another of
      the four (a fee question to the bursar), and the new recipients then see
      all of it; the person who passed it keeps it too ("whoever handled it");
    - it is **flagged** (CP8.2): a report, or a safeguarding word, opens it to
      the owner and admins, because a safeguarding concern cannot stay with one
      teacher. (Confirm below.)
  - The audit trail records each pass and each read by someone outside the
    original recipients.
- **Names** (replaces "replies come from the school"). A reply shows its
  recipient's label and the writer's name ("Mrs Okafor, Form teacher";
  "Bursar"; "Principal"); the school office replies as "<School name> office".
- **Answer 1: who starts.** Teachers, bursars and officers cannot start a
  conversation. **The school office can**: an admin or Inbox officer may start
  one with a guardian ("school messaging"), seen by the office recipients.
  Announcements remain the way to write to many. (Confirm below.)
- **Images** (replaces "text only").
  - Both sides may attach up to **3 images a message**, JPG, PNG or WebP,
    **up to 5 MB each**, typed by their bytes (F1). No PDFs or other files.
  - Stored privately (a new `message-image` key), opened through 5-minute
    links, readable only by those who can see the conversation, and deleted
    with it.
  - Cost: storage on R2 is a few naira a gigabyte a month with no download
    fees, so a school's images cost close to nothing. Images are shown smaller
    in the app to save the family's data.
- **Answer 2:** "Seen" is shown to the parent once a recipient has opened their
  message.
- **Answer 3:** close after 30 quiet days; delete 2 years after closing unless
  flagged.
- **Answer 4:** a fixed safeguarding word list that flags and alerts, never
  blocks. **No AI anywhere in messaging**, now or in this checkpoint's
  follow-ups.
- **Answer 5:** email broadcasts as CP8-D7.
- **Answer 6:** reply alerts to parents as CP8-D6. New messages to staff push
  only to that conversation's recipients.

**What gets built, revised:**

| Slice | PR | What |
|---|---|---|
| **CP8.1** | its own, reviewed first | **Conversations.** Tables, RLS, permissions, the Inbox officer role; the four recipients and who sees what; parents start, reply and list (portal + parent app); staff inbox for each recipient (web: admin, teacher portal; staff app), reply, pass on, mark handled, close; the office starting a conversation; "Seen"; pushes to recipients and the dashboard line; reply alerts to parents (push → email → capped SMS); rate limits; the 30-day close. |
| **CP8.2** | second | **Images, safety and retention.** Image attachments; report and flag, opening the conversation to owner and admins, with alerts and clearing; the safeguarding word list; the 2-year deletion that skips flagged conversations. |
| **CP8.3** | third | **Email broadcasts**, as planned. |

**Owner's follow-up (2026-10-18), and approval ("Start"):**

- **Principal and head teacher are appointed roles.** The admin appoints a
  **Principal** and/or a **Head teacher** (headmaster or headmistress), as
  extra roles like the Inbox officer. So a parent's recipients are:
  - the child's **form teacher** (JSS, SSS) or **class teacher** (nursery,
    primary);
  - the **bursar**;
  - the **principal** (offered for a JSS or SSS child) or the **head
    teacher** (nursery or primary child); for a general conversation, either
    one the school has appointed;
  - the **school admin** (owner and admins);
  - the **school office** (Inbox officers, or owner and admins if none).

  A recipient nobody holds is not offered.
- **Answer 1 (safeguarding): confirmed.** A reported or flagged conversation
  opens to the owner and admins (CP8.2).
- **Answer 2: messaging is private and separate from announcements.** A
  message goes to one parent, one member of staff or the school. The school
  office (admins and Inbox officers) may start a conversation with a
  particular parent; teachers, bursars, principals and head teachers reply but
  do not start.
