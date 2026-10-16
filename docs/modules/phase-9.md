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
| Q4 | **Transport, library and hostel fees.** Invoices are one per student per term and cannot have lines added after issue. | A new **student charge** primitive (§4, CP5). Charges are created through the finance service, then picked up by the next invoice run, or issued as a small "supplementary invoice" per charge if you approve one. **Owner, 2026-10-14 (transport):** the admin sets each route's fee on that route's own page; the fee is not typed per student. **Still to decide: supplementary invoices yes/no.** | CP5 |
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
