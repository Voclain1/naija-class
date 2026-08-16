# Phase 5 — AI layer

The differentiator. Every other phase in this project builds something a
dozen Nigerian school-management products already have; this one builds the
reason a school picks School Kit over them. It is also the phase where the
failure modes stop being "a screen looks wrong" and start being "we sent a
child's data to a third party", "we spent money we didn't budget", or "a
parent read a sentence about their child that no human ever approved". The
hard rules in `CLAUDE.md`'s AI section exist for exactly those three, and
this document is where they become concrete.

---

## 0. Document provenance — READ THIS FIRST

**This file was reconstructed on 2026-08-13, after slices 1–4 had already
shipped.** The original `docs/modules/phase-5.md` was written plan-first (the
code cites it ~30 times, by decision number, from slice 1 onward) but was
never committed — it is absent from the working tree and from all of git
history. Rather than leave 30 dangling citations, the decisions below were
recovered from the artefacts that cite them.

Provenance is marked per decision, and the distinction is load-bearing:

| Marker | Meaning |
|---|---|
| **[recovered]** | The decision's reasoning survives verbatim in a code or migration header that names the D-number. The text below is a faithful restatement, not a re-derivation. Trust it as locked. |
| **[inferred]** | No header names this D-number. The decision is reconstructed from the shipped behaviour, which is unambiguous, but the *original reasoning* is lost and the numbering may not match what was originally written. Treat as locked-in-practice, re-open freely if it reads wrong. |
| **[gap]** | The D-number is cited in aggregate (`D1-D10`) but nothing names it individually and no distinct shipped behaviour maps to it. Content unknown. Do not invent one; renumber only if you are prepared to update every citing comment. |

Slices 1–4's sections are therefore **descriptive** (this is what shipped and
why), not prescriptive. Slice 5 onward is a real plan and is marked as draft
where it is not yet locked.

---

## Sequencing principle (de-risk early, same philosophy as Phase 3 §Sequencing)

Two rules drove the shipped order, and they should drive the rest:

**Infrastructure before the first call.** The cost ledger, the budget
counter, the prompt registry and the SDK ban all landed in slice 1, before
any feature could make a single LLM call. This is deliberate inversion of
the usual "build the feature, add telemetry later" instinct: `CLAUDE.md`
says every call must be logged and every call must be budget-checked
*before* it happens. Retrofitting that onto three shipped features would
mean three call sites to find, and "did we get them all?" is not a question
you can answer confidently. Retrofitting it onto zero call sites is free.

**Features in order of data dependency, ascending.** A school signing up
today has no assessment scores, no attendance history, no report cards. The
lesson plan generator needs none of that — a teacher can use it on their
first day. Report comments need a full term of scores behind them. The
tutor needs curriculum content the platform doesn't have yet. So the order
is not "most impressive first", it is "usable soonest first", which is also
the order that gets real output in front of real teachers earliest.

---

## 1. Estimated time

ARCHITECTURE §9 budgets **4 weeks** for the whole phase. That was written
before the phase was scoped and is optimistic for the full §7 component
list. Actuals and estimates:

| Slice | Estimate | Actual |
|---|---|---|
| 1 — AI core (ledger, budget, registry, seam) | 3 days | ~3 days (2026-08-10) |
| 2 — Lesson plan + quiz generator | 3 days | ~2 days (2026-08-10) |
| 3 — Report-card subject comments | 3 days | ~2 days (2026-08-11) |
| 4 — Report-card form-teacher comment | 2 days | ~1 day (2026-08-12) |
| 5 — Weekly parent progress summary | 4 days | ~1 day (2026-08-13) |
| 6 — Curriculum ingestion / RAG | 8 days | — |
| 7 — Student tutor | 8 days | — |
| 8 — Admin insights | 4-5 days | ~1 day (2026-08-13) |

Slices 1–4 came in at roughly the 4-week budget's first half. Slices 6–7
are the ones that will blow it: RAG is a content-sourcing problem wearing an
engineering problem's clothes, and the tutor needs a student-facing surface
that does not exist (`apps/mobile` is still the bare Expo scaffold from
Phase 0 — no screens). **Do not treat 4 weeks as the number for the full §7
list.** Either the phase runs long or slices 6–8 move to their own phase;
that call is due before slice 6 starts, not during it.

**Called 2026-08-14: slices 6 and 7 moved out** (slice 8 shipped inside
Phase 5). **Corrected 2026-08-15: they moved to Phase 7, not Phase 6.** See
"Moved out — now Phase 7" at the end of §2. The prediction above held
exactly — both moved for the two reasons named here, RAG's content/vendor
problem and the tutor's missing student-facing surface. The correction
separates those two reasons, which turn out to belong to different phases:
the missing student-facing surface is Phase 6 (unblocked, buildable now),
the content/vendor problem is Phase 7 (held pending a vendor decision).

---

## 2. Slice breakdown

### Shipped

**Slice 1 — AI core (CP1 + CP2).** `ai_generations` ledger,
`ai_budget_periods` counter, `schools.ai_enabled` /
`schools.ai_monthly_token_budget`, the `AnthropicPort` seam, the versioned
prompt registry, the ESLint ban on importing `@anthropic-ai/sdk` outside
`packages/ai/src/client.ts`, and `AiGenerationService` as the single path to
Claude. **Zero HTTP surface** — `PHASE_5_PERMISSIONS` landed
reference-only, granted to roles by the first slice that exposes an
endpoint. One throwaway prompt (`connectivity-check`) exists to exercise
reserve → call → settle → ledger end to end without waiting on a feature.

**Slice 2 — Lesson plan + quiz generator.** `lesson_plans` table, five
separately-editable content columns, optional quiz as a second generation.
`GET/POST/PATCH/DELETE /lesson-plans`, `POST /lesson-plans/:id/quiz`. Web UI
at `(teacher)/teacher/lesson-plans`. `pnpm ai:eval` became a real gate here
(it had been `echo 'eval placeholder'` since Phase 0).

**Slice 3 — Report-card subject comments.** One comment per (student,
subject, term). Batch generation over a whole arm via `AI_QUEUE` (concurrency
3), suggestions written to `ai_interaction_logs`, explicit accept copies
text into `Assessment.subjectComment`. Two permissions, not one.

**Slice 4 — Report-card form teacher's comment.** The form teacher's
whole-child comment, reusing slice 3's queue, suggestion-then-accept shape,
and guard structure. Adds `AI_JOB_FORM_COMMENT` as a branch in the existing
processor rather than a second `@Processor`.

**Slice 8 — Admin insights (AI-led).** An admin types a question in their own
words at `/insights`; the model ROUTES it to one of four fixed reports, SQL
computes the report, and the model NARRATES over the computed figures. See
D17 — the division of labour is the whole design.

**Slice 5 — Weekly parent progress summary.** `parent_summaries` table,
`schools.parent_summary_enabled` (default FALSE), a Monday-morning cron sweep
that fans out to `AI_QUEUE`, email delivery through the existing notification
preferences, a guardian-facing section in the portal, and an admin settings
screen at `/settings/parent-summaries` that doubles as the feature's only
control. The first AI output in the product with no teacher-approval gate —
see D16.

### Planned

### Moved out — now Phase 7 **[decided 2026-08-14, corrected 2026-08-15]**

**Phase 5 is scoped as slices 1–5 + 8. All are shipped. The phase is
complete.** Slices 6 and 7 were formally moved out. This is the call §1 said
was "due before slice 6 starts, not during it" — made, on schedule, rather
than allowed to lapse into the phase quietly running long.

**Correction (2026-08-15): they moved to Phase 7, not Phase 6.** The
2026-08-14 call bundled RAG + tutor together with the mobile app under a
single "Phase 6" label. That bundle was never one coherent initiative — it
was this phase's overflow bolted onto a placeholder, and it inherited the
placeholder's number. Two problems with it, both real:

1. **It was already a numbering collision.** `ARCHITECTURE.md` §9 has
   defined "Phase 6 — assignments and student portal (3 weeks)" since Phase
   0. Two different Phase 6s, overlapping on the student portal, is exactly
   how the `AIGeneration` / `AIInteractionLog` confusion started.
2. **It bundled unblocked work with blocked work.** The mobile shell has no
   exotic dependency and delivers standalone value. RAG/tutor is gated on a
   real vendor-and-cost decision (below). Bundling them means the mobile app
   is held hostage by a procurement negotiation — the precise failure mode
   §1 predicted for slice 6 and this phase then lived through.

The corrected split, which applies this phase's own "ship something real at
each step" sequencing discipline rather than abandoning it at the boundary:

- **Phase 6 = mobile shell + student portal + guardian mobile experience.**
  Real, standalone value; no exotic blockers. Absorbs and supersedes
  `ARCHITECTURE.md` §9's original Phase 6, closing the collision. See
  `docs/modules/phase-6.md`.
- **Phase 7 = curriculum RAG + student tutor.** Explicitly held, not
  started, pending Arinzechukwu's decision on the embeddings vendor and its
  cost model. "Held" means held: no schema, no migration, no ingestion
  spike until that decision is deliberately made.

**Slice 6 — Curriculum ingestion / RAG → Phase 7.** Not scoped. `pgvector`
is enabled in `schema.prisma` and used by nothing. This is where topic
identity stops being free text (D13) and therefore where
`MasteryRecord.topicRef`'s meaning finally gets defined — it carries a live
`@@unique` constraint, so that is a decision with teeth. Moved because its
real blocker is choosing an embeddings vendor, which is a procurement and
cost-model initiative of its own, not a slice of the AI layer. Confirmed
2026-08-15: Anthropic still ships no embeddings API, so this genuinely
requires a second AI vendor — a new API key, a new NDPR processor, and a
new cost line. That is the decision being waited on.

**Slice 7 — Student tutor → Phase 7.** Not scoped. Blocked on slice 6 and on
a student-facing surface existing at all. `apps/mobile` was the bare Expo
scaffold from Phase 0 — no screens — and no student principal existed
anywhere in the schema (`Student` has no `passwordHash`, no session
relation). Phase 6 builds both of those. The tutor stays in Phase 7 with
RAG, since it is useless without curriculum grounding.

Both remain real, planned work with their decisions intact — D13's topic
identity problem and the `MasteryRecord.topicRef` constraint do not go away
by being renumbered twice. What changed is which phase carries them, and
therefore what "Phase 5 is done" means: it now means what shipped, not what
was once listed.

---

## 3. Data model

### AI core (slice 1)

Two tables, deliberately separate, both carrying `school_id` directly (flat
RLS, no `EXISTS`-through-parent, no SECURITY DEFINER function — every access
path is inside `withTenant` with a known `schoolId`, so the SD inventory
count stays at 16).

**`ai_generations`** — append-only per-call cost/compliance ledger. One row
per settled call, success *or* failure. Holds model, prompt name + version,
input/output tokens, latency, cost estimate, success flag, redacted error.

Deliberately **not** stored: prompt text and completion text. Those live in
`ai_interaction_logs.payload`. A cost ledger holding conversation content
would bloat the aggregate query on the hot path and duplicate the exact PII
surface the AI hard rules exist to keep narrow. (`ARCHITECTURE.md` §5 still
describes this table as logging "prompt, output" — that line is stale and is
corrected by this phase.)

`ai_generations` vs `ai_interaction_logs` is **not** a naming drift to
reconcile — see `CLAUDE.md`'s AI hard-rules section, resolved 2026-07-26.
One tutor session is one `AIInteractionLog` group spanning many
`AIGeneration` rows, which is why `interactionLogId` is a nullable
many-to-one and not a 1:1.

**`ai_budget_periods`** — per-school monthly counter, unique on
`(school_id, period_start)`. `tokensReserved` is the enforcement column
(pessimistic: input estimate + `max_tokens`); `tokensActual` is the truth,
written at settle. The two converge as calls settle and `tokensReserved` is
always ≥ `tokensActual`.

### Lesson plans (slice 2)

`lesson_plans` — five content columns (`introduction`, `mainContent`,
`activities`, `assessment`, `homework`) mirroring ARCHITECTURE §7's specified
output shape, plus nullable `quiz`. Separate columns rather than one JSON
blob because the teacher edits and regenerates them **individually**, and a
blob makes a per-section update a read-modify-write race between two open
tabs. All content columns nullable: the row exists from the moment
generation is requested, so a failed generation leaves an inspectable record
rather than vanishing.

`LessonPlanStatus` is `DRAFT | ACCEPTED`, and `ACCEPTED` is explicitly **not**
an approval gate in the report-card sense — a lesson plan is the teacher's
own working document, not a student-facing record, so `CLAUDE.md`'s
teacher-approval hard rule (grades, report comments, behaviour) does not
apply. It is a "done editing" marker.

### Report comments (slices 3–4)

**No new table.** Suggestions live in the existing `ai_interaction_logs`,
grouped by a `sessionRef` whose shape this phase owns —
`subjectCommentSessionRef({ termId, classArmId, subjectId })`, stable for a
given triple so a re-run *replaces* the previous batch rather than
accumulating orphan rows nobody can attribute. Accept copies text into the
existing `Assessment.subjectComment` / report-card form-comment columns.

---

## 4. Architectural decisions

### D1 — Transaction shape: reserve → call → settle, never one transaction **[recovered]**

`withTenant` opens a Prisma interactive transaction with a 5000ms budget. An
LLM generation takes 10–30s. The obvious shape — check budget, call Claude,
write the ledger row, all inside one `withTenant` — is wrong for two
independent reasons, **measured on the real production machine on
2026-08-10, not assumed**:

- It holds a Neon connection open for the entire generation, on
  infrastructure where ~2s authenticated latency is already normal and
  pooled connections have died under ordinary CRUD load before.
- **It does not fail fast.** Prisma does not proactively abort at 5000ms; the
  transaction is silently already closed and the *next* statement inside it
  throws. Measured: a 12s body threw P2028 after 12374ms — the naive shape
  burns the full cost of the Anthropic call, discards the result, **and
  writes no ledger row**. That is a hard-rule violation (an unlogged,
  paid-for call), not merely a reliability problem.

So: two short transactions with the network call strictly between them. Do
not "simplify" this into one `withTenant` call. Batch workers must not use
`tenantWorker` either, which wraps the whole job in one transaction.

**Known, accepted failure mode:** a process crash between reserve and settle
leaks a reservation, understating the school's remaining budget until the
month rolls over. That is the correct direction to fail (closed, under-spend
rather than over-spend), it is bounded by the monthly reset, and
compensating-transaction machinery for six schools would be unjustified.

### D2 — `costMicroUsd` is micro-USD, an explicit carve-out from the Money rule **[recovered]**

`CLAUDE.md`'s Money hard rule says money is `Int` kobo. This column is
integer **micro-US-dollars**. The carve-out is deliberate and documented
rather than silent:

The Money rule exists so that naira a school **transacts** never suffers
float drift or display ambiguity — fees, invoices, payments, refunds,
payroll. `costMicroUsd` is vendor-cost telemetry: the school never sees it,
no invoice references it, no `FinanceService` path touches it, no audit row
depends on it. Converting USD→kobo at write time would need an FX-rate
source that does not exist in this repo plus a rounding policy, and would
make the stored value un-interpretable later — you cannot recover the USD
figure without also storing the rate, at which point you have stored USD
with extra steps *and* a permanent naira-devaluation artifact in the
historical series.

The rule's actual intent (integers, never `Float`) is fully preserved. `Int`
max is ~2.1e9 µUSD ≈ $2,147 per row, three orders of magnitude above any
single generation. If AI cost is ever billed back to schools, FX conversion
happens at **billing** time with the rate recorded then — the only correct
place for it.

### D3 — The budget is enforced in TOKENS, not cost **[recovered]**

`schools.ai_monthly_token_budget` is a token count. Tokens are ground truth,
read directly off the API response; cost is *derived* from a price table
that changes underneath us. Enforcing on a derived figure means a vendor
price change silently moves every school's effective cap.

Corollary: the price table's known inaccuracies don't affect enforcement.
`MODEL_PRICING` deliberately encodes Sonnet 5's **standard** $3/$15 rate
rather than the introductory $2/$10 running through 2026-08-31 —
over-estimating spend is the safe direction for a ledger, and it keeps the
table correct from 2026-09-01 without a dated branch. Real invoiced spend is
lower than the ledger says until then.

### D4 — A counter table, not `SUM()` over the ledger **[recovered]**

Three independent reasons, any one sufficient:

1. It is a growing-table aggregate on the hot path of **every** AI call, on a
   database where ~2s authenticated latency is already normal.
2. It couples the budget to retention: any future pruning of
   `ai_generations` would silently reset every school's spend to zero.
3. **It cannot express a reservation** — and a pre-call budget check is
   fundamentally a reservation. The hard rule says the budget is "enforced
   before the call, not after", but the true token count is only known
   after. This is the load-bearing reason.

### D5 — The budget check is atomic **[recovered]**

Concurrency cannot overshoot the cap. This is what makes the queue worker's
`concurrency: 3` a throughput decision rather than a correctness one — it
determines how fast a runaway batch burns the budget, not whether it can
exceed it.

### D6 — Platform-subsidised, conservative default cap, hard block on exhaustion **[recovered]**

There is no plan/tier/subscription concept anywhere in the product code, so
metered billing is not buildable yet, so AI cost is a platform cost.
Therefore: a conservative default (`DEFAULT_MONTHLY_TOKEN_BUDGET` = 2M
tokens/month) with a hard block, not a soft warning.

Sizing: worst case — every token billed at Haiku 4.5's *output* rate of
$5/MTok — is ~$10 per school per month, and realistic mixes are far cheaper
because input dominates and input is $1/MTok. Six live schools is a bounded,
known platform cost rather than an open tap.

`aiMonthlyTokenBudget` is nullable, meaning "use the platform default", so
the common case needs no per-school row edit and the default is re-tunable in
one place. Raise per-school when a school demonstrably needs more; raise the
constant when the *default* is wrong for everyone.

A school-level monthly budget alone still lets one teacher batch-generating
burn the whole school's month in an afternoon, so there is a second limit:
`DEFAULT_USER_DAILY_CALL_CAP` = 200 calls/user/day, satisfying ARCHITECTURE
§7's "hard rate limits per student/teacher". 200 is generous for real use (a
teacher generating comments for two classes of 40, three times over while
tuning, is 240 — so it will occasionally bite, which is the point) while
bounding a runaway loop to a small fraction of the monthly budget.

Three distinct exhaustion/disable codes, not one generic "AI unavailable", so
a UI can say something useful and the modes are distinguishable in logs and
Sentry: `AI_DISABLED_PLATFORM`, `AI_DISABLED_SCHOOL`, `AI_NOT_CONFIGURED`,
`AI_BUDGET_EXCEEDED`, `AI_USER_RATE_LIMITED`.

### D7 — Model routing: Haiku by default, Sonnet only for quality-sensitive low volume **[recovered]**

Haiku 4.5 for high-volume short structured output (report-card comments,
parent summaries). Sonnet 5 for low-volume quality-sensitive output (lesson
plans). The volume asymmetry is the whole argument: one JSS 2 arm of 40
students across 9 subjects is **360 comment calls a term**, against a handful
of lesson plans.

D7 also allows two mechanisms for output variety on the Haiku tier —
`temperature`, or prompt design. `AiCallRequest` carries no `temperature`
field today and widening a slice-1 infrastructure contract from inside a
feature slice is not a trade worth making, so slices 3–4 use prompt design
(ban the stock openers explicitly; key the comment to the student's actual
component spread rather than the grade band). If comments still read samey
against real output, plumbing `temperature` through is the next move — **not
a bigger model**.

### D8 — A typed prompt registry, not free strings at the call site **[recovered]**

Every prompt is declared in `packages/ai/src/prompts/registry.ts` with a
name, version, model and `maxTokens`. `PromptName` is a union derived from
that object, so a typo is a `tsc` failure — the same reason
`queue.constants.ts` centralises queue names so producers and consumers
cannot drift.

The DB columns stay plain `String`, **not** an enum and not an FK: an
`ai_generations` row is a historical record and must hold
`"report-card-subject-comment@3"` forever, including after v3 is deleted
from the registry. Enum-ing it would mean a migration per prompt version,
and prompt versions bump often during tuning. Referential integrity here is
actively wrong. Compile-time safety lives at the call site instead.

**Versioning rule:** bump `version` whenever the rendered text changes in a
way that could change output. That is what makes a regression traceable to a
specific prompt revision in the ledger — the whole point of storing it.

### D9 — **[gap]**

Cited only within slice 1's `D1-D10` aggregate. Content unknown. The
strongest candidates, from slice-1 behaviour that no other D-number claims,
are (a) the ESLint `no-restricted-imports` ban on `@anthropic-ai/sdk` outside
`packages/ai/src/client.ts` — enforcement-not-convention, mirroring the
`basePrisma` ban — or (b) the `AnthropicPort` interface seam that makes
budget/ledger behaviour testable without a live key. Both shipped; neither
is attributed. Not guessing which.

### D10 — **[gap]**

As D9. Remaining unattributed slice-1 behaviour includes the
`AI_ENABLED` platform-wide env kill switch alongside the per-school
`ai_enabled` flag, and the reference-only landing of `PHASE_5_PERMISSIONS`
with no HTTP surface.

### D11 — Fail-soft on missing API key **[recovered]**

`createAnthropicClient` returns `null` when no key is configured, rather than
throwing at import or boot time. A missing `ANTHROPIC_API_KEY` must make AI
features report themselves **disabled** (`AI_NOT_CONFIGURED`), **not**
crash-loop the API for all six live schools.

Context that makes this non-negotiable: there is no isolated staging
environment — every "staging" deploy hits the production database (see
`CLAUDE.md`'s environment section) — and a boot crash-loop from a missing env
var has already happened once in this project. Global boot-time env
validation is deliberately a separate change with its own manual gate.

Surfaces must also ensure the fail-soft contract doesn't leak as a confusing
error to the user on paths where AI is incidental.

### D12 — **[gap]**

Not cited individually anywhere. Sits between D11 (infrastructure/ops) and
D13 (feature data modelling). The likeliest subject, on position alone, is
the eval gate — `pnpm ai:eval` becoming a real CI gate at slice 2, and the
rule that feature prompts land with their own eval fixtures. Stated as a
guess, not a recovery.

### D13 — Topic is free text; no curriculum taxonomy in this phase **[recovered]**

No `Topic` table, no syllabus tree, no taxonomy. A teacher types
"Photosynthesis" the same way they type it into Word today.

Inventing a canonical Nigerian curriculum topic tree is a data-model problem
**plus** a content-sourcing problem **plus** an admin UI, and it would
retroactively define the meaning of `MasteryRecord.topicRef` — which carries
a live `@@unique` constraint. That work happens only when something needs
stable topic **identity**: RAG, mastery tracking, or a question bank. All
deferred, and all landing together in the RAG slice — which as of 2026-08-14
is no longer Phase 5's slice 6, and as of the 2026-08-15 correction sits in
**Phase 7**, not Phase 6. The dependency is unchanged; only the phase it
sits in moved (twice).

### D14 — Report-comment inputs are scores + attendance only **[recovered]**

ARCHITECTURE §7 also lists **behaviour** as an input to report comments.
There is no `Behaviour` model in this codebase (Phase 9 — renumbered from
Phase 7 on 2026-08-15). Stated as a
deliberate v1 omission rather than left for a reader to wonder about.

The PII constraint is the harder half. `CLAUDE.md`: never send student PII to
the LLM. The input carries no name, admission number, date of birth, contact
detail or gender — it is scores, a class level label, a subject name and an
attendance rate. Two consequences the system prompt must handle, because the
model cannot paper over them:

- It must never **invent a name**.
- It must never use a **gendered pronoun** — it does not know, and a report
  card that calls a girl "he" is worse than one with no pronoun at all.

Both asserted mechanically by the PII eval suite, not left as a convention.

### D15 — The approval gate is a separate endpoint and a separate permission **[recovered]**

`CLAUDE.md`: "Never auto-finalise AI output for grades, report card comments,
or behaviour records. There is always a teacher-approval gate."

So a generation **never** touches `Assessment.subjectComment`. It writes a
suggestion to `ai_interaction_logs`; only an explicit accept — separate
endpoint, separate permission — copies text into the student's record.

That split is also what keeps "was this comment AI-drafted or
teacher-written?" answerable later, to a school or a regulator. Writing
generations straight into the column would make that question permanently
unanswerable, **and it is not a question you can retrofit an answer to**.

---

## 5. API endpoints (per slice)

```
# Slice 1 — AI core
(none — zero HTTP surface by design)

# Slice 2 — lesson plans
GET    /lesson-plans                 lesson-plan.read
GET    /lesson-plans/:id             lesson-plan.read
POST   /lesson-plans                 lesson-plan.create      (generates)
POST   /lesson-plans/:id/quiz        lesson-plan.update      (second generation)
PATCH  /lesson-plans/:id             lesson-plan.update      (edit / regenerate section / accept)
DELETE /lesson-plans/:id             lesson-plan.delete

# Slice 3 — report-card subject comments
GET    /report-card-comments         report-card-comment.generate
POST   /report-card-comments/generate       report-card-comment.generate   (enqueues batch)
POST   /report-card-comments/accept         report-card-comment.write      (the gate)

# Slice 4 — form teacher's comment
GET    /report-card-comments/form            report-card-comment.generate
POST   /report-card-comments/form/generate   report-card-comment.generate
(accept reuses POST /report-card-comments/accept)

# AI usage (not a slice — closing slice 1's `ai-usage.read` gap)
GET    /ai-usage                             ai-usage.read

# Slice 8 — admin insights
POST   /insights/ask                         insight.read            (owner/admin only)

# Slice 5 — weekly parent summaries
GET    /parent-summaries                     parent-summary.read     (staff view of what was sent)
GET    /parent-summaries/settings            parent-summary.manage
PATCH  /parent-summaries/settings            parent-summary.manage   (the D16 opt-in)
POST   /parent-summaries/run                 parent-summary.manage   (manual re-run; refuses when opted out)
GET    /portal/students/:id/summaries        GuardianAuthGuard       (withTenant + withGuardian)
```

Note there is no accept endpoint in slice 5 and no `.write` permission — that
absence is D16, not an omission.

Note the read endpoints are gated on `.generate`, not a separate `.read` —
the list endpoint exists to poll for suggestions you asked for, so the person
who can generate is the person who can see them.

**Why a queue for slice 3+.** One arm is one call per student — 40 students
is 40 Haiku calls, 10–20 minutes of wall clock. That cannot be an HTTP
request. The batch endpoint enqueues and returns immediately; the UI polls
the list endpoint and watches suggestions appear.

---

## 6. UI screens — web (teacher)

| Screen | Route | States |
|---|---|---|
| Lesson plan list | `(teacher)/teacher/lesson-plans` | empty, list, generating |
| Lesson plan detail | `(teacher)/teacher/lesson-plans/[id]` | draft, per-section edit, per-section regenerate, quiz absent/present, accepted |
| Subject comments | in report-card board | not generated, batch running (polling), suggestions listed, per-row accept, accepted |
| Form comment | in report-card board | as above, one row |
| Weekly updates (admin) | `(admin)/settings/parent-summaries` | off, on, on-but-AI-disabled, on-but-AI-unconfigured, recent-notes list, run-now |
| Weekly updates (guardian) | portal `students/[id]` | absent when none exist; list of notes newest first |
| Insights | `(admin)/insights` | no term chosen, empty, thinking, unsupported question, answer + table, table-only (narration unavailable) |

Every AI surface needs an explicit **disabled** state that reads sensibly for
all five `AI_ERROR_CODES` — this is the visible half of D11 and D6, and it is
the state the app is in *right now* in production, since no
`ANTHROPIC_API_KEY` has ever been configured.

---

## 7. Hard rules — Phase 5 specifics

These restate `CLAUDE.md`'s AI section with this phase's mechanics attached.
Where `CLAUDE.md` and this file disagree, `CLAUDE.md` wins.

1. **`packages/ai/src/client.ts` is the only file permitted to import
   `@anthropic-ai/sdk`.** Enforced by `no-restricted-imports` in
   `packages/config/eslint/base.js`, mirroring the `basePrisma` ban. Bypassing
   `AiGenerationService` is a CI failure, not a code-review catch.
2. **No LLM call inside a `withTenant` transaction.** Ever. See D1.
3. **No student PII to the model.** No name, admission number, DOB, contact
   detail, gender. Opaque IDs and class-level context only. Asserted by the
   PII eval suite.
4. **No auto-finalise.** Generation writes a suggestion; a separate
   permissioned endpoint writes the record. See D15.
5. **Every call writes a ledger row** — success *or* failure. A failed call
   still cost money and still happened.
6. **Budget checked before the call, not after.** See D4.
7. **Redact before writing `errorMessage`** — no secrets, no PII, no raw
   prompt echo.

---

## 8. RBAC additions

`PHASE_5_PERMISSIONS`: `lesson-plan.read`, `lesson-plan.create`,
`lesson-plan.update`, `lesson-plan.delete`, `ai-usage.read`,
`report-card-comment.generate`, `report-card-comment.write`.

Two comment permissions rather than one because the actions have genuinely
different stakes: `.generate` spends the school's AI budget (a whole arm is
one call per student), while `.write` puts text into a student's permanent
termly record. A school that wants comments drafted centrally but accepted by
the subject teacher can express that with two permissions; a single
`report-card-comment.manage` could not.

`PHASE_5_TEACHER_PERMISSIONS` grants the teacher role all of the above except
`ai-usage.read`. Both comment permissions are teacher-facing: the subject
teacher is the person who knows whether a drafted comment is true of the
student in front of them, and granting `.generate` without `.write` would
leave a teacher able to spend budget on drafts they cannot then use.

Explicit inclusion list, mirroring `PHASE_2_TEACHER_PERMISSIONS` /
`PHASE_3_BURSAR_PERMISSIONS` — an inclusion list fails loudly when a future
Phase 5 permission is added without a teacher decision; an exclusion filter
would silently grant it.

Slice 5 adds `parent-summary.read` (admin, owner, teacher) and
`parent-summary.manage` (admin, owner only). The teacher grant is read-only
deliberately: a form teacher fielding "the school said my child was late twice"
needs to see the note the parent is holding, but deciding whether the school
sends unattended AI notes to parents at all is not theirs to flip.

`ai-usage.read` is admin/owner only. **Closed 2026-08-13**, having sat with no
endpoint behind it since slice 1: `GET /ai-usage` plus
`/settings/ai-usage`. Headroom is reported from `tokensReserved`, not
`tokensActual` — mid-flight reservations are real headroom a school cannot
use, and reporting actuals would show room the budget check will refuse. The
per-prompt breakdown counts failed generations, because a failed call was
still paid for.

---

## 9. Known gaps carried by this phase

**No content-quality evals.** `pnpm ai:eval` runs 42 checks and all 42 are
structural — PII safety and prompt quality inspect *inputs*; registry and
schema integrity inspect *definitions*. The `live-generation` suite is the
only one that would inspect model output, and **it has never executed once**,
because no `ANTHROPIC_API_KEY` has ever been configured. A model producing
fluent, well-structured nonsense passes all 42 checks. Full writeup and the
trigger condition in `docs/deferred.md`.

**Slice 5 makes the eval gap sharper, not just larger.** Slices 2–4 produce
drafts a teacher reads; if the model writes nonsense, a human catches it
before anyone outside the school sees it. Slice 5 has no such reader. The
prompt-level controls (no urgency, no over-reading one data point, no invented
name or pronoun) are asserted mechanically, but whether the resulting note is
*true of the child* is not checkable by any test in this repo. Practical rule
until that changes: do not switch a school on until `live-generation` has run
and someone has read a batch of real output. The settings screen's "write last
week's updates now" button exists for exactly that.

**Slice 8 is the first surface where the model DECIDES something** (which
report answers the question) rather than only phrasing. D17 bounds that
decision to a four-way enum with an explicit "unsupported" escape, and the
routed report is always shown so a misroute is visible — but it is a real
change in kind from slices 2-5, and worth watching once live output exists.

**Five shipped features have never produced a generation.** Slices 2–5 are
in production, live for six schools, and permanently in their
`AI_NOT_CONFIGURED` state. Configuring the key locally does not change that
— it needs `flyctl secrets set` on `school-kit-api` too, and this project has
a documented history of config that exists in the repo but was never set on
the platform (`PORTAL_BASE_URL`, the portal's `NEXT_PUBLIC_API_URL`). Verify
against the running app, not the repo.

**`AIGeneration`'s cost-unit question is closed (D2) but ARCHITECTURE §5 is
stale** — it still describes `ai_generations` as logging "prompt, output".
Correcting that line belongs to this phase.

**No `temperature` in `AiCallRequest`.** Deliberate (D7), but it is the
first thing to reach for if real output reads repetitive.

---

## 10. Deferred to later phases

- **Grading assistant** (essay + short-answer) — Phase 8, needs assignments.
- **Question bank / CBT** — see `docs/deferred.md`'s CBT capability
  assessment. Slice 2's `quiz` column is structured *text*, deliberately not
  a `Question` model with per-option rows.
- **Behaviour as a report-comment input** — Phase 9, no model exists (D14).
- **A/B testing framework for prompts** (ARCHITECTURE §7) — not built. The
  registry's versioning makes it possible; nothing routes traffic.
- **Response caching** for repeated topic+level generations (ARCHITECTURE §7
  "cache common queries") — not built.
- **Model routing by confidence** ("try Haiku, escalate to Sonnet if
  confidence is low", ARCHITECTURE §7) — not built. Routing is static per
  prompt (D7). Note this one needs a confidence signal that doesn't currently
  exist; it is not just plumbing.
- **Metered AI billing** — blocked on there being any plan/tier concept in
  the product at all (D6).

---

## 11. Slice 5 plan-first — weekly parent progress summary (decisions locked 2026-08-13)

Proposed as the next slice because it is the only remaining ARCHITECTURE §7
component that sits entirely on infrastructure that already exists: Phase 4
shipped the guardian portal, Termii SMS, Resend email and the notifications
module; `finance.service.ts` and `onboarding-nudge.service.ts` establish the
scheduled-job pattern; and the inputs are the data slices 3–4 already read,
so D14's PII-safe renderer discipline carries over directly.

**Shape.** Weekly cron → per-school, per-enrolled-student → one Haiku call
with the child's last 7 days of attendance and grades → a friendly
plain-language summary → delivered to guardians via the portal, with
push/email/SMS notification. `AIGeneration.userId` is null for these (D-note
in the model: system/cron calls have no acting user and are exempt from the
per-user daily cap — but **not** from the school budget).

### D16 — Unattended delivery, school-level opt-in, defaulting OFF **[locked 2026-08-13]**

No teacher-approval gate. The cron generates and delivers with no human in
the loop, but the feature is **off by default per school** and an admin
switches it on — a new `School` flag in the same flat per-school-toggle shape
as `aiEnabled` / `subjectAttendanceEnabled` / `paystackPaymentsEnabled`.

`CLAUDE.md`'s teacher-approval hard rule names grades, report card comments,
and behaviour records. A progress summary is none of those, and the rule is
not stretched to cover it. But this **is** the first AI output in the product
that reaches a parent with nobody in the loop, so the risk is carried by the
opt-in rather than by a gate: a school affirmatively turns it on, having seen
what it produces, instead of discovering it after a parent has already read
one.

The alternative considered and rejected was a weekly form-teacher approval
batch reusing slice 3/4's suggestion-then-accept machinery. It is the safest
option and the most consistent with every other AI surface here, but it buys
that safety with a weekly teacher chore that quietly goes undone — and an
unreleased batch means parents get **nothing**, which is a worse failure than
the one being defended against. Revisit if real output turns out to need
supervision.

Consequence for slice ordering: because nothing gates the output, the
content-quality eval gap in §9 bites harder here than on any shipped slice.
Turning this on for a school should not happen before `live-generation` has
actually run at least once.

**Amendment 2026-08-14 — `aiEnabled` now also defaults OFF, which does NOT
collapse this decision into a single rule.** When D16 was locked, defaulting
`parentSummaryEnabled` to false was notable precisely because it was the
opposite of `aiEnabled`'s default-true, and the schema carried a warning not
to "make it consistent". `aiEnabled` has since flipped to `@default(false)`
(migration `20260814120000`) for an unrelated reason: AI is rolled out one
school at a time from platform-admin, so a default-true column would have
enabled every school the instant the platform-wide `AI_ENABLED` env var was
flipped. That is a decision about **who authorises enablement**; D16 is a
decision about **who reads the output**. The warning still stands in its real
form — revisit either default on its own grounds, never "for consistency".

The practical consequence is worth stating because it is easy to get wrong:
turning `aiEnabled` on for a school does **not** start sending parent
summaries. That still requires this separate, school-made opt-in, and the
"don't enable before `live-generation` has run" condition above is unchanged.

### D17 — Insights: the model routes and narrates; SQL computes **[locked 2026-08-13]**

Slice 8 is AI-led — the admin asks in free text rather than picking a report
from a menu — but the model's output space is deliberately tiny:

1. **Route.** Free-text question → one label from a closed enum of four
   reports, plus an `unsupported` boolean. No parameters, no ids, no numbers.
   An earlier shape had it emit `{ intent, params }`; that was dropped because
   any id-shaped parameter is either invented (the model has never seen a
   class-arm id) or an injection surface.
2. **Compute.** Ordinary SQL in `InsightsService`, one method per intent.
3. **Narrate.** Two to three sentences over the already-computed figures.

**The model never produces a number.** This surface is read by an owner
deciding which class needs another teacher; a wrong sentence is embarrassing,
a wrong number is a staffing decision made on fiction. The rejected
alternative — letting the model choose what to query — makes fabricated
figures possible in principle, and this codebase has no content-quality evals
that would catch one (§9).

Consequences worth keeping:
- **Two calls, not one.** A combined call would put the routing decision and
  the prose in the same token stream, making a misroute invisible. Splitting
  them also makes narration skippable: if it fails or the budget runs out, the
  figures are already computed and still render with `answer: null`.
- **The routed report name is echoed to the UI** and always displayed. A
  misroute is this feature's most likely failure and prose alone would hide it.
- **`unsupported` is a first-class answer.** Fees, individual children and
  staff questions are refused rather than approximated by the nearest academic
  report.
- **The PII split is structural.** The at-risk table carries student names —
  API to browser, never through a prompt. The narration input for that same
  report is aggregate only ("12 students flagged, average 38%"), because a
  per-student line is a student record reaching the model even without a name
  attached.

No new table: reports are computed live. A pre-computed weekly snapshot (which
ARCHITECTURE §7 floats) would need its own staleness story, and a head teacher
asking on a Wednesday wants Wednesday's answer. Revisit if the live queries get
slow at real roll sizes.

### Remaining decisions — resolved by default, flagged for objection

1. **Multilingual output** (Yoruba / Igbo / Hausa / Pidgin, per ARCHITECTURE
   §7) — **deferred to its own slice.** Translation quality is exactly what
   the current eval suite cannot measure, and shipping unevaluable Yoruba to
   a parent is worse than shipping English.
2. **Delivery channels** — portal + push + email by default, **SMS opt-in.**
   SMS is per-message real money on top of token cost. Interacts with Phase
   4's notification preferences; confirm against that schema before building.
3. **Quiet weeks — skip, don't send.** A child with no new grades and full
   attendance has nothing to summarise, and sending "nothing happened" weekly
   trains parents to ignore the channel. Needs a defined threshold, set at
   implementation.
4. **Budget sizing checked before code, not after.** Every enrolled student
   every week is a materially larger standing volume than anything shipped so
   far — a 400-student school is 400 calls/week, ~1,600/month, on top of
   report comments. This is the first feature that could plausibly exhaust
   `DEFAULT_MONTHLY_TOKEN_BUDGET` (2M tokens) on its own; if the arithmetic
   says it does, the default moves in this slice.

**Acceptance bar for slice 5:** a guardian receives a summary that is
specific to their child (not a template), on a schedule, with no student PII
having left the platform, every call ledgered, and the school's budget
respected — verifiable by reading `ai_generations` for the week.
