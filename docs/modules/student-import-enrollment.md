# Student CSV import — class-arm column and enrollment creation

**Status: BUILT 2026-08-09.** Plan-first approved same day with three
decisions settled at review (recorded in §3 against D1/D3/D7). §8 at the
bottom records where the implementation diverged from this plan — read it
before trusting any earlier section.

Written 2026-08-09, out of the pre-Phase-5 readiness sweep
(`docs/deferred.md` → "Bulk student add — ranked follow-ups", where this is
named as the single highest-leverage fix and deliberately excluded from the
"not building now" list).

Not a numbered Phase — per CLAUDE.md's "Permission naming for work that isn't
a numbered Phase", this gets its own descriptively-named doc rather than being
force-fit into an adjacent phase's spec.

---

## 1. The problem

A school with 300 students currently has to:

1. Import 300 students via CSV → they exist, in **no class**, appearing on no
   class roster, invisible to attendance, gradebook, invoicing and report
   cards (all of which join through `Enrollment`).
2. Go to `/enrollments/bulk` **once per class arm** — a wizard built for
   *term-roll carry-over*, which derives a source term and diffs three groups
   against it. For a first-time school with no previous term, that framing
   barely applies.
3. Repeat for all ~14 levels.

`commitStudentRow` (`apps/api/src/modules/imports/workers/commit-students.row.ts`)
is a single `db.student.create` and writes no `Enrollment`. The onboarding
guide states this correctly at §8, which is how we know it's a known,
deliberate gap rather than a bug.

**This multi-pass shuffle — not per-request latency — is the real reason
large-school onboarding is slow.** Latency is the visible symptom.

## 2. Scope

**In:** one optional `classArm` column on the student CSV import; when
mapped, each committed row creates a `Student` **and** an `Enrollment` in the
same per-row transaction.

**Out (explicitly):**
- The bulk grid (`/students/new/bulk`) — separate follow-ups, already ranked
  in `docs/deferred.md`.
- Guardian and teacher imports — untouched.
- Any change to `/enrollments/bulk` — it remains the right tool for term-roll
  carry-over, which is a genuinely different job.
- Multiple enrollments per row (a student in two terms). One row, one
  enrollment, into one target term.

## 3. Decisions

### D1 — The CSV column carries the arm **name**, matched case-insensitively

Admins type what they see in the UI ("JSS 1A"), not a code or a UUID.

**The complication, and it is real:** `ClassArm` has
`@@unique([schoolId, classLevelId, code])` — uniqueness is on **code**, scoped
**per level**, and `name` carries **no uniqueness constraint at all** (the
schema comment calls it "human-facing; renamable"). So "JSS 1A" is *not*
guaranteed to resolve to exactly one arm. Two levels could each hold an arm
named "A"; nothing prevents duplicate names within a level either.

Resolution rule, applied against the school's arms:
- **exactly 1 case-insensitive name match** → resolve to that arm's id
- **0 matches** → row error: `Class arm "X" not found. Check Settings →
  Academic → Class Arms for the exact name.`
- **more than 1 match** → row error naming the conflict: `Class arm "X" is
  ambiguous — N arms share that name. Rename one, or leave this column blank
  and enrol from /enrollments/bulk.`

Rejected alternatives: matching on `code` (also not school-wide unique, and
admins don't see codes); requiring a `Level|Arm` composite cell (ugly, and
admins would get it wrong more often than the ambiguity it prevents).

Failing loudly on ambiguity is the point — silently picking the first match
would mis-enrol children into the wrong class, which propagates into
attendance, grades and invoices before anyone notices.

### D2 — Inactive arms are rejected, per row

`ClassArm.isActive` exists and `EnrollmentsService.bulkCreate` already throws
`INACTIVE_CLASS_ARM` for this case. Import matches that behaviour rather than
inventing a softer one: row error, `Class arm "X" is not active.`

### D3 — The target **term** is an import-level option, not a CSV column

`Enrollment` needs `termId` + `academicYearId` + `classArmId`. Term does not
belong in a per-row CSV cell — every row in a given import goes to the same
term, and asking admins to repeat it 300 times invites 300 chances to typo it.

It becomes a third field on the existing options object
(`packages/types/src/imports/options.ts`, alongside `dateFormat` and
`treatBlankAs`), chosen on the **mapping step** where the date-format radio
already lives:

> **OVERRIDDEN AT REVIEW (2026-08-09) — an explicit choice is required; there
> is no default.** The two bullets below describe the *proposed* behaviour and
> are kept only to show what was rejected. As built: the dropdown ships with
> no pre-selected value, the CTA is blocked until one is chosen, and the API
> rejects with `TARGET_TERM_REQUIRED`. A silent default is most dangerous
> exactly when it is most likely wrong — a school onboarding mid-transition
> between terms would enrol its whole roster into the wrong one, with nothing
> downstream to flag it.

- ~~default: the school's **current term** (`Term.isCurrent`)~~ — rejected
- overridable: a dropdown of the school's terms — kept, and now the only path

`academicYearId` is **derived server-side** from the chosen term, never
accepted from input — matching `EnrollmentsService.bulkCreate`, which resolves
it from `term.academicYearId`, and honouring the schema comment's warning that
the two columns must stay consistent.

### D4 — Preconditions fail the whole import up front, not per row

If the `classArm` column is mapped but **no target term can be resolved** (no
current term, none chosen), the import is rejected at mapping-submit time with
a single clear error — not 300 identical row errors. This is a precondition of
the whole job, not a property of any row.

Same treatment if the school has **zero class arms**.

### D5 — Backward compatible by construction: the column is optional

`classArm` joins `STUDENT_IMPORT_TARGET_FIELDS` as an **optional** target
field. It is deliberately **not** added to
`STUDENT_IMPORT_REQUIRED_FIELDS`.

- An existing CSV with no arm column, or a mapping that leaves `classArm`
  unmapped → **byte-identical behaviour to today**: student created, no
  enrollment, no new error paths reachable.
- A row with the column mapped but the **cell blank** → student created, no
  enrollment, **and a warning is surfaced** (see D7). Deliberately not a hard
  error: a school mid-admission legitimately has students not yet placed.

This matters because the template CSV and any file a school already prepared
must keep working untouched.

### D6 — Enrollment is created in the **same per-row transaction** as the student

`commit.handler.ts`'s loop already wraps each row in its own `withTenant()`
transaction precisely so one row's failure doesn't roll back the others.
`commitStudentRow` gains a second write inside that existing transaction.

**A row is all-or-nothing: a student is never created without their
enrollment when an arm was specified.** The alternative (create the student,
let the enrollment fail separately) produces exactly the orphaned-student
state this whole change exists to eliminate.

The arm id is **re-resolved at commit time**, not trusted from validate — an
arm can be renamed or deactivated in the gap between the two, the same race
`commit-students.row.ts` already documents for admission numbers. Its error
maps to the existing per-row `CommitRowError` path.

`Enrollment` status is `ENROLLED`, matching `bulkCreate`.

### D7 — Blank-cell warnings need a warning tier the import pipeline lacks

D5 wants "student created, but not enrolled" surfaced without failing the row.
The pipeline today has exactly two outcomes: **good** or **bad**. There is no
warning tier.

`docs/deferred.md` already carries this exact gap ("the obvious upgrade is to
surface a per-row warning tier in the error report (validate / commit /
warning)"), logged against the guardian-import merge policy.

> **APPROVED AT REVIEW (2026-08-09):** aggregate count, no warning tier. The
> tier stays logged as a follow-up. Note the one correction in §8 — this
> aggregate needed a new `ImportJob.notEnrolledRows` column; the claim below
> that "aggregate counts already exist on `ImportJob`" was wrong.

**Proposal: do not build the warning tier in this change.** Instead, report it
in aggregate on the done screen — *"N students created. M were not enrolled
because the class arm cell was blank."* — plus a link to `/enrollments/bulk`
to place them. Aggregate counts already exist on `ImportJob`; a per-row
warning tier touches the engine, the error-report CSV writer, the preview
screen and the done screen, and would roughly double this change's blast
radius for a secondary benefit.

Flagging this as the one place I'd most expect pushback. If a per-row warning
tier is wanted, it should be its own change, landing first.

## 4. Files touched

| File | Change |
|---|---|
| `packages/types/src/students/import.ts` | Add `classArm` to `studentImportRowSchema` (optional string) + `STUDENT_IMPORT_TARGET_FIELDS`. The existing build-time `_AssertSchemaKeysAreTargetFields` check enforces both edits happen together. |
| `packages/types/src/imports/options.ts` | Add optional `targetTermId` to `importOptionsSchema`. Shared across import types — see that file's own note on why options are shared; guardian/teacher imports simply never set it. |
| `apps/api/src/modules/imports/validate-students.engine.ts` | New resolution phase after external dedup: one query for the school's arms, then per-row name → id resolution (D1/D2). One query, not one per row. |
| `apps/api/src/modules/imports/imports.service.ts` | Mapping-submit precondition checks (D4). |
| `apps/api/src/modules/imports/workers/commit-students.row.ts` | Re-resolve arm, create `Student` + `Enrollment` in the existing transaction (D6). Signature grows a resolved-term argument. |
| `apps/api/src/modules/imports/workers/commit.handler.ts` | Pass the target term through to the student commit path only. |
| `apps/web/.../students/import/[jobId]/mapping/page.tsx` | Target-term dropdown next to the date-format radio. |
| `apps/web/.../students/import/[jobId]/done/page.tsx` | Aggregate not-enrolled count + CTA (D7). |
| Student template CSV | New optional `class_arm` column. |
| `docs/onboarding-guide.md` §8 | The "> None of these three paths enrols a student..." note becomes conditional — CSV import now can. |

No schema migration. No RLS change. No new SECURITY DEFINER function. All
reads and writes are ordinary tenant-scoped Prisma inside `withTenant`.

## 5. Tests

- **Unit** (`validate-students.engine`): exact-match resolve; case-insensitive
  resolve; unknown arm → row error; **ambiguous name → row error** (D1's
  headline case, constructed by creating two arms with the same name under
  different levels — which the schema permits); inactive arm → row error;
  blank cell with column mapped → good row, no arm; column unmapped → good
  row, no arm, byte-identical to today's output.
- **Unit** (`commit-students.row`): creates both rows in one transaction;
  arm deactivated between validate and commit → row fails, **and no orphaned
  student exists** (the load-bearing assertion for D6); duplicate
  `(schoolId, studentId, termId)` → mapped to a per-row error, not a job crash.
- **Integration**: mapping-submit rejects when the arm column is mapped but no
  term resolves (D4).
- **Regression, the important one**: the existing student-import specs must
  pass **unmodified**. If any needs changing, D5 has been violated.
- **E2E**: import 3 students with arms → all three appear on their class
  rosters, no second pass through `/enrollments/bulk`.

## 6. Rollout

Additive and off-by-default-in-practice: a school that never maps the column
sees no behaviour change at all. Ship in one PR; no feature flag (the optional
column *is* the flag).

## 7. Open questions for review — ANSWERED 2026-08-09

All four resolved at review. Kept for the reasoning trail; see §8 for what
shipped.

1. **D7** — aggregate not-enrolled count now, or build the per-row warning
   tier first? This is the one real scope decision in here.
2. **D1's ambiguity rule** — hard row error, or resolve `Level + Arm` when the
   CSV also has a level column? (There is no level column today, and adding
   one is a bigger change than it looks.)
3. Should the target-term dropdown default to the current term **silently**,
   or force an explicit choice? Silent default is fewer clicks; explicit is
   harder to get wrong when a school is mid-term-transition.
4. Column header name in the template — `class_arm`, `class`, or `arm`?
   Whatever we pick, header auto-detection should accept all three, since the
   mapping step lets admins correct it anyway.

**Answers:** (1) aggregate count, tier deferred. (2) hard row error.
(3) explicit choice required, no silent default. (4) template ships
`Class Arm`; auto-detection accepts `class arm` / `class_arm` / `classarm` /
`class` / `arm` / `classname` / `currentclass`.

---

## 8. What changed during implementation (2026-08-09)

Recorded so a later reader trusts the code over the plan where they differ.

**Review decisions, all as recommended:**
- **D7** — aggregate count on the done screen; the per-row warning tier stays
  unbuilt and is logged as a follow-up.
- **D1** — ambiguous arm names are a hard row error, never a best-guess.
- **D3** — the target term requires an **explicit choice**. This *overrode*
  the plan's original "default to `Term.isCurrent`". The UI ships no
  pre-selected value and blocks the CTA; the API rejects with
  `TARGET_TERM_REQUIRED`. Rationale: a silent default is most dangerous
  exactly when it is most likely wrong — a school onboarding mid-transition
  between terms would enrol its whole roster into the wrong one, with nothing
  downstream to flag it.

**Divergences from the plan as written:**

1. **A migration WAS needed** — the plan said "No schema migration." Wrong:
   §4 asserted that "aggregate counts already exist on `ImportJob`", but the
   existing columns are `totalRows`/`validRows`/`invalidRows`/`committedRows`
   and none of them expresses "created but not enrolled". Added
   `ImportJob.notEnrolledRows Int @default(0)`
   (`20260809120000_import_job_not_enrolled_rows`) rather than overloading
   `previewSnapshot`'s JSON. Everything else in that claim holds: no RLS
   change, no new SECURITY DEFINER function, all reads/writes ordinary
   tenant-scoped Prisma.

2. **The term dropdown needed year+term composition.** The plan assumed a
   flat `listTerms()`. Terms are nested under academic years
   (`GET /academic-years/:id/terms`), so the mapping screen fetches years,
   then their terms via `mapWithConcurrency` (bounded fan-out, same reason
   `/enrollments/bulk` uses it), and labels each option
   `"2025/2026 — First Term"`. The year in the label is not cosmetic: a
   school mid-session may legitimately enrol into a term of a non-current
   year, where "First Term" alone is ambiguous.

3. **The deactivated-arm race is caught by re-validate, not the commit-row
   guard.** `runCommitHandler` re-runs the whole validation engine before its
   row loop, so a mutation landing before that pass shows up in
   `validateBadCount` with `commitErrorCount` at 0 — the same behaviour
   `commit.handler.spec.ts` already documents for admission-number
   collisions. The spec asserts the SUM of the two counters, because the
   guarantee under test is "the row does not commit and leaves nothing
   behind", not which layer caught it. The commit-row re-resolution is still
   load-bearing (it covers a mutation landing during the row loop itself,
   after re-validate) but that window can't be driven deterministically from
   a test, so it is defence-in-depth without direct coverage.

4. **`stateOfOrigin` lost `"state"` as a header synonym.** `classArm` claims
   `"class"`, and the two sets are now kept disjoint so a future reordering
   of the synonym table can't produce a first-match-wins surprise. No
   behaviour change in practice (nobody heads a state-of-origin column
   "class"), and every guess is admin-overridable on the mapping step.

**Test coverage delivered** (`commit-students-class-arm.handler.spec.ts`,
11 tests, real DB + real storage through the full upload → map → validate →
commit pipeline): happy path creating both rows; case-insensitive match;
unknown arm; **ambiguous arm** (constructed by creating a second arm sharing
a name under a different level, which the schema permits); inactive arm;
blank cell → student created, counted as not-enrolled; deactivated-arm race
→ no orphaned student; column unmapped → unchanged pre-feature behaviour;
and the three mapping-submit preconditions.

The pre-existing student-import specs were **not modified** — that is the
real proof of D5's backward compatibility, and if a future change needs to
edit them, D5 has been broken.
