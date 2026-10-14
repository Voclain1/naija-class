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
| Q2 | **Parent notice of serious incidents** (reverses C14 in part). | Yes, but narrowly. Only a **discipline action** (suspension and above) that an admin has approved sends the parent a factual notice: dates and the action, not the teacher's note. Ordinary records stay internal. | CP2 |
| Q3 | **Health records: who may read.** | Owner, admin and a new **school nurse** role (sickbay). Teachers see only an "allergies and conditions" line, for safety on trips and in class, and never the sickbay log. Every read audited. | CP3 |
| Q4 | **Transport, library and hostel fees.** Invoices are one per student per term and cannot have lines added after issue. | A new **student charge** primitive (§4, CP5). Charges are created through the finance service, then picked up by the next invoice run, or issued as a small "supplementary invoice" per charge if you approve one. **Owner, 2026-10-14 (transport):** the admin sets each route's fee on that route's own page; the fee is not typed per student. **Still to decide: supplementary invoices yes/no.** | CP5 |
| Q5 | **WhatsApp Business.** Needs a Meta-approved business number and a provider (Termii proxies it). That is your side, not code. | Build the channel behind a per-school switch with SMS fallback, but only once you have an approved number. Until then, keep the `wa.me` share links that already work. | CP9 |
| Q6 | **AI and children's text** (essay feedback, message translation). **Owner, 2026-10-14:** students get no AI writing help of any kind; they type or paste their own work. **Owner, 2026-10-14: approved** for teachers — AI may draft marking feedback, name removed, teacher approves (CP4b). The `assignment-feedback` allowlist row is added to `CLAUDE.md` in CP4b's own PR, as a visible edit. Translation stays unbuilt. Both send text that may name children. | **Essays:** strip the student's own name and send only the answer text, under a new prompt that **you** add to the allowlist table by name. Feedback is a draft the teacher approves. **Translation:** do not build until you have decided; it is the weaker case (a parent can use their phone's own translator), and it would be a second allowlist row. | CP4b, CP9 |
| Q7 | **Detecting AI-written student work** (spec §6.8). | **Do not build.** These detectors are unreliable, and a false "you cheated" against a child is a real harm. Offer the in-class similarity check (plagiarism between submissions) instead. **Owner, 2026-10-14:** no detector. Approved instead: the similarity check, and a **paste indicator** (the teacher sees how much of a typed answer was pasted rather than typed — a fact, never an accusation, and it never changes a mark). | CP4 |
| Q8 | **Students uploading files** (photos of handwritten work). The student account has no upload today. | Yes, from the app only, images and PDF up to 10 MB, three files per submission. They are stored privately and visible only to the teacher, admin, the student and that student's linked guardians. | CP4 |
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
