# Academic calendar bootstrap (closing #198)

Plan-first. **Nothing in this document is built yet.** Commissioned 2026-08-21
after the finance-dashboard work established that #198's blast radius is wider
than "the dashboard looks empty".

## 1. Why this exists

Every newly provisioned school lands with **no academic year and no term**,
through both onboarding paths — `docs/deferred.md`'s open #198. A term is a
required FK for enrollment (`Enrollment.termId`, non-null), invoicing
(`Invoice.termId`), assessment, and report cards, and attendance resolves a
term by date. Until an owner finds Settings → Academic unprompted, they cannot
enroll a student, issue an invoice, or mark a register — the three things a
school bought the product for.

This is the same failure shape as the incident `school-defaults.ts` was
written to fix: four schools provisioned 2026-08-08 with zero class levels,
where "an owner could log in and do nothing", one of whose owners gave up and
re-registered, leaving two rows for one school. That fix covered class
structure, subjects and grading. The academic-year half was never part of it.

## 2. The decision this document exists to make

The obvious fix is to auto-seed a year and three terms in
`applySchoolDefaults()`, exactly as class levels and arms are seeded. **This
plan recommends against it.** The reasoning is the point of the document, so
it comes before the design.

### D1 — Term dates are load-bearing, not decorative. This is the whole argument.

`AcademicYear` and `Term` both carry non-null `startDate`/`endDate`
(`@db.Date`). A seed cannot avoid choosing them. Four places consume them, and
the consumption is not cosmetic:

| Consumer | What a wrong date does |
|---|---|
| `attendance-shared.util.ts:83` — `resolveTermForDate()` | Resolves the term for an attendance date **purely by date range, ignoring `isCurrent`**. If the seeded range doesn't cover today: hard 400, *"Date is not within any academic term"* — attendance is impossible. If it covers today but is wrong (seeded First Term while the school is really in Second): every register silently lands on the **wrong term**. |
| `finance.service.ts:206` | `totalExpenses` filters `Expense.incurredAt` between the term's start and end — `Expense` has no `termId` of its own. Wrong range → wrong expenses → wrong **net position**. This is money, computed server-side, displayed as fact. |
| `report-card-template.ts:156` | Prints "Term Duration" on the report-card PDF handed to a parent. A guessed range becomes a line on a real document. |
| `dashboard.service.ts:74` | Previous-term comparison ordered by `startDate`. |

So the guessed field is precisely the field that corrupts attendance and
expense attribution, and it corrupts them **silently** in the common case.
Once enrollments, invoices and attendance rows have attached to a wrongly
dated term, correcting it is not editing a field — it is moving real rows
between terms.

### D2 — The subject-catalogue precedent decides this, and it decides it against seeding.

`packages/db/src/seeds/subjects.ts` seeds exactly three subjects, and its
header is explicit about the standard: only what is **universally true** —
WAEC-compulsory for every SSCE candidate regardless of track, *and* the same
subject under the same name at every level. Basic Science and Social Studies
were considered and **rejected** because they "look universal" but don't
survive past JSS. The seed was deliberately kept short rather than "stretched
in".

Apply that same test to a Nigerian academic calendar:

| Candidate | Universally true? |
|---|---|
| Three terms per year | **Yes** — near-universal in Nigerian schools. |
| Named "First / Second / Third Term" | **Yes** — the convention this codebase already uses everywhere. |
| Year runs September → July | **Mostly** — common, but not universal, and it says nothing about a specific school's dates. |
| *This* school's actual term start/end dates | **No.** Varies by school and by year. |
| Which term the school is in *right now* | **No.** Depends on their calendar *and* on when they happen to sign up. |

The **structure** passes the test. The **dates** fail it — and the dates are
the load-bearing part. By the standard this project already set for itself,
that settles it: seeding a guessed calendar is exactly the "looks universal,
isn't" mistake `subjects.ts` refused to make, with worse consequences, because
a wrong subject row is visibly wrong and deletable while a wrong term date is
invisible and structural.

### D3 — A school signing up mid-year makes the guess wrong for most signups, not a minority of them.

A "sensible default" of First Term, September–December is correct only for
schools onboarding in roughly Aug–Dec. A school signing up in February gets a
calendar claiming they are in a term that ended two months ago — and
`resolveTermForDate()` then refuses every attendance mark, because no seeded
range contains today.

The project has already met this problem and solved it the honest way, in a
context where it controlled the truth: `dev-seed.ts:268` computes its three
terms **relative to today** so the current term always contains the seed date,
with a comment saying so. That works for a fixture, where "today" *is* the
answer. It is not available for a real school, where the answer is the
school's own calendar and nobody has asked them.

### D4 — Recommendation: an onboarding step with pre-filled, editable dates. Not a seed.

**The distinction that carries this: a visible default a human confirms is a
suggestion; the same value written silently is a guess.** The ergonomic
argument for seeding — "the owner shouldn't have to do work" — is fully
satisfied by pre-filling the field and letting them click through in seconds.
What seeding uniquely adds is *not asking*, and not asking is the entire
defect.

So: add an academic-calendar step to the onboarding wizard, pre-filled with a
sensible Nigerian default (three terms, First/Second/Third, dates derived from
a proposed year start), every date editable, and nothing written until the
owner submits the step.

This also fixes the second half of #198's complaint, which a seed does not
touch: *"A UI to create one DOES exist, at Settings → Academic → Years. So
this is not 'impossible', it is 'nothing points there'."* An onboarding step
is the thing that points there.

### D5 — An onboarding step covers BOTH provisioning paths, so it needs no `school-defaults.ts` counterpart.

This was the strongest argument for putting the fix in `applySchoolDefaults()`
— that function is the shared bootstrap both paths call, and the brief asked
for consistency with it.

It does not apply here. `platform-admin.service.ts:631` creates its schools
with *"status, onboardingStep default per schema (ONBOARDING, 0)"* — a
platform-admin-provisioned school's owner accepts their invitation and then
runs **the same five-step wizard** a self-serve owner runs. Both paths already
converge on the wizard, so a wizard step covers both by construction, with no
second call site to keep in sync and no drift risk of the kind that caused the
2026-08-08 incident.

`applySchoolDefaults()` stays exactly as it is. Its contract — seed what is
universally true, in one transaction, idempotently — is correct, and the
academic calendar simply does not qualify under D2.

## 3. Design

### The step

Insert as **step 5**, immediately before Success (which becomes step 6):
after Basics/Branding/Invites/NDPR, and before the owner is told they are
done. It must be before Success, because Success is what tells them setup is
complete.

Inputs, pre-filled and all editable:
- **Academic year label** — e.g. `2026/2027`, derived from the proposed start.
- **Year start / end.**
- **Three terms**, named First/Second/Third, each with start/end.
- **Which term is current** — defaulted to the one containing today, if any.

Skippable? **No.** A skipped step returns the school to the exact broken state
this document exists to close. If the owner genuinely doesn't know their
dates, the pre-filled values are there to accept — that is what pre-filling is
for.

### The write

One transactional endpoint, not five round trips: create the `AcademicYear`,
create three `Term` rows, set `isCurrent` on the year and the chosen term,
atomically. Partial state here is the failure mode (a year with one term, or
a year with no current term) and it is exactly the state this document is
trying to eliminate — so it must not be constructible.

Note the partial unique index `terms_school_id_current_key` permits only one
`is_current` term per school; the write must clear before setting, the same
ordering `dev-seed.ts:300-304` documents.

### Renumbering cost (real, and the main reason this isn't trivial)

Onboarding is a strict sequential state machine: `schools.service.ts:205`
rejects unless `onboardingStep === payload.step - 1`. Adding a step touches
the step schemas in `packages/types`, the controller's `parseOrThrow` switch,
the service's step handlers, the web route folders
`apps/web/src/app/onboarding/1..5`, the progress indicator, and
`RequireAuth`'s `/onboarding/<onboardingStep + 1>` redirect.

**Schools mid-onboarding at deploy time need explicit thought** — a school
sitting at `onboardingStep: 4` under the old numbering means something
different under the new one. Options: gate the new step so existing
`ONBOARDING` schools skip it and are picked up by §4's in-app prompt instead,
or run a small migration. Decide at implementation; flag it now so it is not
discovered at deploy.

## 4. Existing broken schools — a prompt, not a backfill

**This is where I depart from the `backfill-school-defaults.ts` precedent, and
the departure follows directly from D2.**

That backfill was safe because what it wrote was *universally correct*: the 14
standard class levels are the same 14 for every Nigerian school, so writing
them into a school that lacked them could not be wrong. An academic calendar
is school-specific judgement. A backfill that writes guessed dates into
existing schools takes the D1 risk and applies it to schools that may already
have data attached — strictly worse than doing it at signup.

So the fix for existing schools is **to ask them, in-app**, not to write on
their behalf:

- Reuse the same calendar form as a "finish setting up" route, surfaced as a
  blocking-but-honest prompt when an ACTIVE school has no current term.
- This is a natural strengthening of something that already exists:
  `OnboardingNudgeService` already sends a one-time email on almost exactly
  this trigger (ACTIVE, zero `AcademicYear` rows, zero `Student` rows, 24h
  after onboarding completes). Its two weaknesses are that it is one email,
  once, and that requiring **zero students** means a school that added
  students but no calendar — a real state, see §5 — never gets nudged. An
  in-app prompt has neither problem.

**No data is written for an existing school without its owner confirming it.**

### If a backfill is nonetheless wanted later

It should follow `backfill-school-defaults.ts`'s seven rails verbatim — dry
run by default behind `--apply`, narrow predicate, RLS-scoped as `app_user`
never `DIRECT_URL`, shared seed definition, idempotent, audited — with one
deliberate change: **the student guard is the wrong predicate here.** That
script skips any school with students; §5 shows schools with students and no
calendar are precisely the population most in need. The correct narrow
predicate is *zero academic years AND zero enrollments AND zero invoices* —
the state where nothing can be mis-attributed because nothing exists yet.

## 5. Population — measured, with a caveat

Against the **local dev database** (374 schools):

| Population | Count |
|---|---|
| Zero academic years, zero enrollments, zero invoices (pristine) | **223** |
| Zero academic years but with enrollments/invoices | **0** — impossible by FK, as expected |
| Has years, no current term, pristine | 1 |
| Has years, no current term, **with enrollments/invoices** | **51** |
| Healthy (has a current term) | 99 |
| Has students but no current term | 68 |

**Treat these as shapes, not a census.** 156 of the 374 are e2e/test schools,
and the e2e fixture `setupAcademicStructure` never sets `isCurrent` at all —
which almost certainly accounts for most of the 51. The real production census
is the **dry run against production**, which is the first implementation step
and the same discipline the previous backfill used.

Two shapes are real regardless of the counts:
1. **Zero-year schools cannot have enrollments or invoices** (0 rows, enforced
   by the FK) — so they are safe to prompt and could in principle be safely
   backfilled.
2. **Schools can have students but no current term** (68 locally) — student
   creation doesn't require a term; enrollment does. This is the population
   the existing email nudge structurally cannot reach.

## 6. Honest recommendation, stated plainly

**Do not seed. Add the onboarding step, and prompt existing schools.**

The engineering-cheap path is the seed, and it is cheap precisely because it
skips the question that matters. This project has already made this call once,
in `subjects.ts`, and made it correctly: seed what is universally true, refuse
what merely looks universal. Term dates are not universally true, they are
load-bearing for attendance and money, and being wrong about them is silent.

The one thing a seed buys — an owner not having to answer a question — is
fully recovered by pre-filling the answer. The one thing it costs is the
possibility that a school's entire attendance and expense history is
attributed to the wrong term, discovered months later, with no clean fix.

Secondary but not minor: the onboarding step also closes the discoverability
half of #198, which a seed leaves untouched.

## 7. Scope

**In:** the onboarding calendar step (pre-filled, editable, non-skippable),
one transactional create-calendar endpoint, the in-app prompt for existing
ACTIVE schools with no current term, step renumbering and the mid-onboarding
migration decision.

**Out:** `applySchoolDefaults()` changes (deliberately — D5). A data backfill
(§4 — replaced by a prompt; rails documented if it is ever wanted). Term-date
validation beyond non-overlap and ordering. Multi-year setup — one year is
what's needed to become functional. Fixing the e2e fixture's missing
`isCurrent` (worth doing, unrelated, and it would change the §5 numbers).

**Also flagged, not fixed:** `resolveTermForDate()` makes term **date ranges**
a third independent definition of "current term", alongside `Term.isCurrent`
and the finance dashboard's selector. They can disagree. That is a real
latent inconsistency this investigation surfaced, and it is what makes wrong
dates dangerous rather than merely untidy — but reconciling the three is its
own piece of work.

**Sequencing:** the production dry-run census (§5) comes first — it is
read-only, and it sizes the §4 prompt before any UI is built.
