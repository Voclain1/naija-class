# School Kit — Architecture and Module Specification

A multi-tenant SaaS school management platform for Nigerian private schools, with AI-assisted learning built in from day one.

## 1. Vision and scope

Build a single platform that replaces the patchwork of Excel sheets, WhatsApp groups, separate fee-collection systems, and paper report cards that most Nigerian private schools currently use. Four user types:

- **School owner / admin** — runs the school, signs off on finances, sees the dashboards
- **Teacher** — delivers lessons, marks attendance, grades work, talks to parents
- **Student** — does the work, asks the AI tutor, sees their progress
- **Parent** — sees how their child is doing, pays fees, talks to teachers

The system is one product with role-aware UIs, not four separate apps.

## 2. Tech stack

Concrete choices, optimised for solo development with Claude Code, Nigerian market realities, and an AI-first roadmap.

| Layer | Choice | Why |
|---|---|---|
| Web frontend | Next.js 15 (App Router) + TypeScript + Tailwind | Single React framework Claude Code handles very well; SSR for marketing pages |
| Mobile | Expo (React Native) + TypeScript | Share types with web; one codebase for iOS and Android |
| UI components | shadcn/ui + Radix | Owned components, easy to customise per school's branding |
| Backend | NestJS (Node.js + TypeScript) | Modular structure maps cleanly to school modules; opinionated enough for Claude Code |
| Database | PostgreSQL 16 | Row-level security for multi-tenancy; mature; pgvector lives here |
| ORM | Prisma | Type-safe, generates clean migrations |
| Cache + queues | Redis + BullMQ | Background jobs (report-card generation, SMS sends, AI batches) |
| Object storage | Cloudflare R2 | S3-compatible, zero egress cost — important for serving photos to mobile users |
| Search + vector | pgvector + Postgres FTS | Same database, no extra infra |
| Auth | Better Auth or Lucia | Self-hosted, email + phone OTP support (Nigerian parents often don't have email) |
| Payments | Paystack | The default in Nigeria; supports cards, bank transfer, USSD |
| SMS + WhatsApp | Termii | Best Nigerian coverage; bulk SMS pricing works for school broadcasts |
| Email | Resend | Clean DX, generous free tier |
| Push notifications | Expo Push (mobile) + Web Push | Free, built in |
| AI | Claude API (Sonnet + Haiku) | Sonnet for tutoring and generation; Haiku for grading and summaries |
| Monitoring | Sentry + PostHog | Error tracking + product analytics |
| Hosting | Backend on Fly.io (Joburg region); frontend on Vercel; DB on Neon or Supabase | Latency to Nigerian users matters; Joburg is the practical nearest region |
| CI/CD | GitHub Actions | Standard |
| Monorepo | Turborepo with pnpm | Share types, UI, utilities between web/mobile/api |

## 3. Project structure

```
school-kit/
├── apps/
│   ├── web/                  # Next.js — admin and teacher portals
│   ├── mobile/               # Expo — parent and student app
│   ├── api/                  # NestJS — backend
│   └── docs/                 # Internal docs site
├── packages/
│   ├── db/                   # Prisma schema, migrations, seed scripts
│   ├── types/                # Shared TS types and zod schemas
│   ├── ui/                   # Shared UI components
│   ├── ai/                   # Claude prompts, RAG helpers, eval harness
│   └── config/               # Shared tsconfig, eslint, tailwind
├── infra/                    # Terraform or Pulumi for cloud setup
├── docs/
│   ├── ARCHITECTURE.md       # This doc
│   ├── DATA_MODEL.md
│   ├── API_DESIGN.md
│   └── modules/              # Per-module spec
│       ├── attendance.md
│       ├── grading.md
│       └── ...
├── CLAUDE.md                 # Project conventions for Claude Code
└── package.json
```

`CLAUDE.md` at the repo root is the single most important file for productivity — see section 10.

## 4. Multi-tenancy strategy

Every school is a tenant. Use **shared schema with row-level security (RLS)** in Postgres, not schema-per-tenant.

- Every domain table has a `school_id` column
- A Postgres RLS policy filters every query by `current_setting('app.current_school_id')`
- The API sets this session variable from the JWT on every request
- Cross-tenant leaks become structurally impossible — even a `SELECT *` forgets nothing

```sql
CREATE POLICY school_isolation ON students
  USING (school_id = current_setting('app.current_school_id')::uuid);
```

For schools with multiple campuses, add a `branch_id` column under `school_id` and a second policy. The `users` and `auth_sessions` tables are tenant-scoped too — a teacher at School A doesn't exist for School B.

## 5. Data model — core entities

The high-level entity map. Full schema lives in `packages/db/prisma/schema.prisma`.

**Tenancy and identity**
- `School` — root tenant; has settings, branding, subscription
- `Branch` — campus within a school
- `User` — login record; belongs to one school
- `Role` — admin, owner, teacher, student, parent, bursar, librarian, etc.
- `UserRole` — many-to-many; a person can be parent + teacher
- `Permission` — fine-grained, attached to roles

**Academic structure**
- `AcademicYear` — e.g. 2025/2026
- `Term` — first / second / third
- `ClassLevel` — Nursery 1 through SSS 3
- `ClassArm` — JSS1A, JSS1B (sections)
- `Subject` — Mathematics, English, Civic Education, etc.
- `ClassSubject` — which subjects each class takes
- `TeacherAssignment` — which teacher teaches which subject in which class

**Student information**
- `Student` — bio, photo, admission number
- `Guardian` — parent/uncle/caregiver record
- `StudentGuardian` — relationship link
- `Enrollment` — student-in-class for a term
- `Admission` — application form data, status, documents

**Operations**
- `AttendanceRecord` — date, student, status (present/absent/late/excused)
- `Assignment` — title, instructions, attachments, due date
- `Submission` — student's submission, files, status
- `Assessment` — CA1, CA2, exam scores per subject per term
- `ReportCard` — generated artefact per student per term
- `Behaviour` — incidents, merits, demerits
- `LibraryItem`, `Loan` — library tracking
- `TransportRoute`, `RouteAssignment` — bus management

**Finance**
- `FeeStructure` — per class/term, with line items
- `Invoice` — issued to a guardian for a student
- `Payment` — Paystack transaction record
- `PaymentPlan` — installments
- `PayrollItem` — staff salary records
- `Expense` — outgoing expenditure

**Communication**
- `Conversation` — between parent and teacher, or group
- `Message` — in-app message; may also fire SMS/email
- `Announcement` — broadcast to a class, grade, or whole school
- `Notification` — system event log per user

**AI**
- `CurriculumChunk` — text + embedding for a subject/topic
- `TutorSession` — student's AI tutor conversation history
- `AIGeneration` — log of every LLM call (cost, latency, prompt, output)

## 6. Module specifications

### 6.1 Identity and access

**Purpose** — multi-school auth, role-based permissions, magic-link login for low-tech parents.

**Key flows**
- School signup → owner creates school → invites admins/teachers via email/SMS
- Student account auto-created on enrollment, parent invited via SMS
- Login: email+password for staff, OTP-via-SMS for parents

**Permissions matrix** (lives in code, not DB, for performance):
```
owner.*           — all
admin.*           — all except the owner-only set (see permissions.ts)
teacher.class:*   — only for their assigned classes
teacher.subject:* — only for their assigned subjects
parent.student:*  — only for their linked students
student.self:*    — only their own records
bursar.finance:* — finance module only, minus refunds and BVN
```
Illustrative pseudocode, not literal permission strings — the actual grants are
per-resource (`fee-category.delete`, `payment.refund`, etc.), enumerated in
`packages/types/src/permissions.ts` and enforced by `PermissionsGuard`.

**`bursar`'s final grant list** (`PHASE_3_BURSAR_PERMISSIONS`, locked at Phase 3
/ Slice 15 close-out — explicit inclusion list, not "admin minus a few"):
```
fee-category.{read,create,update,delete}
fee-item.{read,create,update,delete}
discount-rule.{read,create,update,deactivate}
invoice.{read,issue,cancel}
payment.{read,record}                    — NOT payment.refund
payment-plan.{create,read,delete}
finance.debtors.{read,remind}
expense-category.{read,create,update,delete}
expense.{read,create,update,delete}
finance.dashboard.read
```
No academic, roster, staff, or school-settings access — and no `auth.2fa.*`
or `staff-bvn.*` (those are auth/HR-adjacent surfaces, not finance, and
`staff-bvn.reveal`/`payment.refund` are deliberately admin+owner-only as the
two highest-trust mutations in the finance surface). Verified exact-match
(no more, no less) by `permissions-coverage.spec.ts`'s "Phase 3 RBAC
close-out" block and exercised end-to-end by `bursar-scope.spec.ts`.

Retired (Phase 3 / Slice 15 close-out): earlier drafts of this matrix named a
coarse `billing.delete` owner-only gate for "hard-delete of finance records."
By slice 15 every actual finance hard-delete (fee-category, fee-item,
expense-category, expense, payment-plan) already existed as its own granular,
admin-accessible permission — locked decisions from Phase 3 slices 4/9/13,
each explicitly tested as "no owner-only restriction." `billing.delete` was
never wired to an endpoint; slice 15 retired the placeholder rather than
adding an unused permission string or retrofitting owner-only onto three
already-shipped, already-tested deletes. See `docs/modules/phase-3.md` §15 and
the audit note in `packages/types/src/permissions.ts`.

### 6.2 School setup

**Purpose** — onboard a school in under 30 minutes.

Setup wizard: school profile → academic year/terms → class levels → subjects → import students (CSV) → import teachers → fee structure → done.

### 6.3 Student information system (SIS)

**Purpose** — single source of truth for every student.

- Admission applications with document upload (passport photo, birth cert)
- Student profile (bio, medical, guardians, history)
- Bulk admission via CSV import (essential — most schools migrate from Excel)
- Auto-generated admission numbers per school's format
- Promotion engine at end of session
- Withdrawal and graduation flows

**AI hooks** — duplicate detection on bulk import (same student in twice with name variations), OCR on uploaded birth certs.

### 6.4 Staff management

- Hiring and onboarding workflow
- Profile with qualifications, NUT number, BVN (for payroll transfers)
- Class teacher assignment
- Subject and class assignments
- Performance tracking (peer reviews, aggregated parent feedback)

### 6.5 Academic management

- Visual timetable builder with conflict detection (teacher double-booked, room collision)
- Scheme of work per subject per term (long-form curriculum plan)
- Weekly lesson plans with learning objectives
- Lesson notes (delivered content) — teachers attach files, link videos
- Topic library tied to WAEC/NECO syllabi out of the box

**AI hooks** — generate scheme of work from learning objectives; generate lesson plan from a topic; suggest activities and resources.

### 6.6 Attendance

- Mobile-first marking (teacher taps through class register)
- Present / absent / late / excused
- Subject-period attendance for senior classes
- Auto-SMS to parent on unexplained absence (configurable cutoff time)
- Reports per student / class / term

**AI hooks** — flag attendance patterns that correlate with falling grades.

### 6.7 Assessment and grading

The heart of the academic record. Nigerian schools follow a CA1 + CA2 + Exam pattern with cumulative scoring.

- Configurable grading scheme (most schools: CA1=20%, CA2=20%, Exam=60%)
- Grade boundaries per school (A1, B2 ... F9 WAEC-style)
- Subject-level recording by teachers
- Class position and subject position
- Cumulative position across terms
- Report card generation with templated comments
- Approval workflow: subject teacher → form teacher → principal → released to parents
- Bulk export for archiving

**AI hooks** — generate report-card comments tailored to a student's actual performance pattern; flag students at risk of failure.

### 6.8 Assignments and homework

- Teacher creates assignment with instructions, attachments, due date
- Students submit (typed, file upload, photo of handwritten work)
- Auto-grading for MCQ and fill-in-the-blank
- Manual grading for essays / written work
- AI-assisted grading: rubric + AI suggestion + teacher approval (never auto-final)
- Plagiarism flag (compare against class submissions)

**AI hooks** — generate quizzes from a topic and grade level; give substantive feedback on essays (specific, not generic); detect when a student submitted AI-generated work.

### 6.9 Communication

Replace the chaos of school WhatsApp groups.

- In-app messaging (parent ↔ teacher, teacher ↔ teacher)
- Group announcements (class, grade, whole school)
- SMS broadcasts via Termii (still the highest-reach channel for parents)
- Email broadcasts via Resend
- WhatsApp Business API integration (Termii proxies this)
- Push notifications to mobile app
- Read receipts and delivery status

**AI hooks** — translate teacher messages into Yoruba, Igbo, Hausa, or Nigerian Pidgin; summarise a long parent thread for the teacher.

### 6.10 Finance

The module that gets schools to pay for the platform.

- Fee structure per class per term with line items (tuition, uniform, bus, lunch, books)
- Invoice generation per student per term
- Discounts and scholarships
- Installment plans
- Online payment via Paystack (cards, bank transfer, USSD)
- POS/cash payment recording at the bursary
- Auto receipt generation
- Debtor list with auto-reminder schedule
- Refunds with audit trail
- Payroll: salary calc, PAYE estimate, payslip generation, bulk Paystack transfers
- Expense tracking
- Dashboard: collections vs target, debtors, expenses, P&L

**AI hooks** — predict which families are likely to default based on payment history; auto-draft polite reminder messages with tone-appropriate escalation.

### 6.11 Library

- Catalog (title, author, ISBN, copies, location)
- Issue and return
- Overdue tracking with fines
- Digital resources (PDFs, links) linked to subjects

### 6.12 Transport

- Route definition with pickup points
- Vehicle and driver records
- Student assignment to routes
- Transport fees tied to fee structure
- Real-time GPS tracking (post-MVP, needs hardware)

### 6.13 Hostel (boarding schools)

- Hostel and room registry
- Bed allocation per term
- House master assignment
- Visitor log, leave-out tracking
- Sickbay link to medical module

### 6.14 Health records

- Medical profile (allergies, blood group, conditions, GP)
- Sickbay visit log
- Medication administration records
- Vaccination tracking
- Auto-alert parents on sickbay visit

### 6.15 Behaviour and discipline

- Merit and demerit point system
- Incident logging with witnesses
- Discipline workflow (warning → suspension → expulsion)
- Parent notification on serious incidents

### 6.16 Events and calendar

- Term calendar with public holidays and breaks
- Events (sports day, parents' meeting, exams)
- RSVP from parents
- Push reminders

### 6.17 Reports and analytics

- Academic performance dashboards (class avg, subject heatmap, top/bottom students)
- Attendance trends
- Financial dashboards (collections, debtors, expenses)
- Enrollment trends
- Teacher performance views
- Exportable to PDF and Excel
- Custom report builder (post-MVP)

### 6.18 Parent portal

- Child dashboard (attendance, grades, recent assignments, upcoming events)
- Fee status and one-tap payment
- Direct message to teachers and form teacher
- AI-generated weekly progress summary in their preferred language
- Event RSVPs
- Multiple children supported

## 7. AI architecture

The AI layer is the differentiator, not a sprinkled-on feature. Design principles:

1. **Curriculum-grounded** — the AI tutor knows the WAEC/NECO syllabus and the student's class level. No generic ChatGPT answers.
2. **Teacher-in-the-loop** — AI suggests, teacher approves. Never auto-final on grades or report comments.
3. **Cheap by default** — Haiku for cheap, fast tasks; Sonnet only when needed.
4. **Logged for cost and quality** — every generation tracked in `AIGeneration` table.

### Components

**RAG over curriculum content**
- Ingest WAEC/NECO syllabi, recommended textbook contents, school-uploaded lesson notes
- Chunk by topic + learning objective
- Embed and store in `pgvector` with metadata: subject, class level, term, topic
- Retrieve top-k chunks at inference time

**Student tutor**
- Conversational interface in student app
- System prompt: "You are a tutor for a [class level] student studying [subject]. Use the Nigerian curriculum. Don't give direct answers to homework — explain the concept and walk them through."
- RAG fetches relevant curriculum chunks
- Conversation history stored in `TutorSession`
- Daily message cap per student to control cost
- Special mode: "exam practice" — generates past-question-style problems

**Lesson plan and quiz generator (teachers)**
- Input: topic, learning objectives, class level
- Output: structured lesson plan with intro, main content, activities, assessment, homework
- Quiz mode: generates MCQ + short-answer questions with mark scheme
- Teacher can edit, regenerate sections, or accept

**Report card comment generator**
- Input: student's term scores, attendance, behaviour
- Output: 2-3 sentence comment specific to that student's pattern
- Reviewed by teacher before locking

**Parent progress summary**
- Weekly cron job
- Input: child's last 7 days of attendance, grades, behaviour
- Output: friendly, plain-language summary
- Translation to Yoruba, Igbo, Hausa, or Nigerian Pidgin on request
- Sent via push, email, and SMS link

**Grading assistant**
- Essay grading: rubric-driven; produces score + feedback; teacher reviews
- Short-answer grading: semantic match against teacher's expected answer

**Insights for admins**
- "Which classes are underperforming this term?"
- "Which students are at risk of failing based on CA1 + attendance?"
- Pre-computed weekly, queryable on demand

### Prompt management

- All prompts in `packages/ai/prompts/` as TypeScript modules
- Versioned; each prompt has a name, version, template
- A/B testing framework: route a percentage of traffic to prompt v2 and compare quality
- Eval harness: a set of golden inputs + expected behaviour, run on every prompt change

### Cost control

- Per-school monthly token budget (configurable)
- Hard rate limits per student/teacher
- Model routing: try Haiku first; escalate to Sonnet if confidence is low
- Cache common queries (e.g. quiz generation for the same topic+level)

## 8. Integrations

| Service | Use |
|---|---|
| Paystack | Card, bank transfer, USSD payments; transfers for payroll |
| Termii | SMS, WhatsApp Business, voice OTP |
| Resend | Transactional and broadcast email |
| Expo Push | Mobile push notifications |
| Cloudflare R2 | File storage |
| Sentry | Error monitoring |
| PostHog | Product analytics |
| Anthropic Claude API | All AI features |
| Google Maps API | Geocoding for transport routes |
| Verifyme or Smile Identity | Optional BVN/NIN verification for high-value fee transactions |

## 9. Build phases

This is the order to ship in. Each phase ends with something a school can actually use.

**Phase 0 — foundations (2-3 weeks)**
Monorepo setup, auth, multi-tenancy, school onboarding wizard, role system, basic admin UI shell.

**Phase 1 — SIS and academic structure (3-4 weeks)**
Student, teacher, class, subject, enrollment, term. CSV import. One real school can put their data in.

**Phase 2 — attendance and grading (3-4 weeks)**
Daily attendance with SMS alerts. CA1/CA2/Exam recording. Report card generation. This is when the school stops using Excel.

**Phase 3 — finance (3-4 weeks)**
Fee structure, invoices, Paystack integration, debtors, basic payroll. This is when the school starts paying you.

**Phase 4 — communication and parent portal (3 weeks)**
Parent app MVP, in-app messaging, SMS broadcasts, announcement board.

**Phase 5 — AI layer (4 weeks)**
Curriculum ingestion, student tutor, lesson plan generator, report comment generator, parent summaries. This is your differentiator.

**Phase 6 — assignments and student portal (3 weeks)**
Assignment creation, submission, AI-assisted grading.

**Phase 7 — auxiliary modules (rolling)**
Library, transport, hostel, behaviour, health, full analytics. Ship as schools ask for them.

Estimated solo timeline with Claude Code: **3-4 months** to end of Phase 3 (first paying customer). **6 months** to end of Phase 5. The rest is iteration based on customer feedback.

## 10. Working with Claude Code

This stack is designed for AI-assisted development. The patterns that pay off:

**`CLAUDE.md` at repo root** — the project bible. Include:
- Tech stack and exact versions
- Folder conventions
- Naming conventions (file names, function names, route patterns)
- Never-do rules (e.g. "never query without a school_id filter")
- How to add a new module (step by step)
- How to run tests and migrations
- Pointer to the per-module specs in `docs/modules/`

**Per-module spec files** — each `docs/modules/<module>.md` contains:
- Purpose
- Entities and their relationships
- API endpoints with input/output shapes
- UI screens and their states
- AI prompts (if applicable)
- Test cases

When working on a module, prompt Claude Code: "Read `docs/modules/attendance.md` and `CLAUDE.md`, then implement the daily attendance endpoint."

**Test-driven where it matters** — fee calculations, grade computations, attendance percentages. Claude Code generates the tests well from a spec.

**One module = one PR** — keep changes scoped. Claude Code works best when context is bounded.

**Eval harness for AI features** — before merging any prompt change, run the eval suite to check it didn't regress on the golden set.

## 11. Open questions to resolve before building

1. **Subscription pricing model** — per-student/month vs flat per-school. Affects billing system design.
2. **Data residency** — Nigerian Data Protection Regulation (NDPR) implications. Joburg is the practical closest region; some schools may require NG-only.
3. **Curriculum source** — license textbook content, partner with publishers, or build from public syllabi only.
4. **Offline strategy depth** — full offline-first sync (CRDTs, complex) vs basic offline cache for reads only.
5. **WhatsApp vs SMS primacy** — WhatsApp Business has stricter rules but parents prefer it. Start with both via Termii.
6. **AI cost subsidy** — bake AI costs into per-student pricing or meter them separately. The student tutor can get expensive at scale.

---

*End of document. Update as decisions are made and modules ship.*
