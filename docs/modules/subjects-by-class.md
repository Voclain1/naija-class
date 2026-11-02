# Subjects by class

Owner's ask of 2026-11-02. It replaces the class-subject matrix
(Settings → Academic → Matrix):

- Subjects are set up automatically by stage. Nursery and KG are separate stages.
- Only subjects with scores show on results.
- Admins and form teachers can hide a subject. A hide can be undone, and the person chooses where it applies and for how long.

The owner added that schools delete classes they do not run, so a class's subjects must not depend on links to individual classes.

## The model

- **Stages:** `ClassStage` gains `KG`, between `NURSERY` and `PRIMARY`. The `KG 1`/`KG 2` levels seeded at sign-up are KG, no longer Nursery.
  - Migration `20261202120000_kg_stage` adds the value on its own, because Postgres cannot use a new enum value in the transaction that adds it.
- **Subjects carry their stages:** `subjects.stages ClassStage[]` lists the stages a subject is taught in. A class takes the school's active subjects tagged with its stage.
  - Deleting, adding or re-staging a class therefore needs no remapping.
  - `class_subjects` stays in the schema, but nothing reads it for results any more.
- **The standard list:** `SUBJECT_CATALOGUE` in `packages/db/src/seeds/subject-catalogue.ts` has about 60 subjects across the five stages, each with its stages and the other names schools use for it.
  - Every new school is seeded with it.
  - Migration `20261202130000_subjects_by_class` backfilled every existing school, one school at a time under that school's `app.current_school_id`:
    1. kg/kindergarten classes moved to KG;
    2. existing subjects took their stages from their old matrix links;
    3. catalogue subjects were added, matched on name, code or alias, so "Maths" is not added beside "Mathematics".
- **Empty subjects never show.** Report cards and every results view already list only subjects that have approved assessment rows, so a long SSS list costs a school nothing.

## Hiding a subject

`subject_hides` (RLS: `tenant_isolation`, FORCE). Each row has:

| Field | Meaning |
|---|---|
| scope | `ARM` (one class arm), `LEVEL` (every arm of a class) or `SCHOOL` |
| until | `TERM` (the term it was set in), `YEAR` (that session) or `INDEFINITE` (from that term on, never earlier terms, until unhidden) |
| unhidden_at / unhidden_by | Unhiding stamps these. Rows are never deleted, so the history stays. |

**When a hide applies:** `hideApplies(rule, at)` in `packages/types/src/subjects/subject-hide.dto.ts` is the pure rule. Nothing has to run for a term or session hide to end.

**Where it is applied:** `hiddenSubjectIds(db, termId, classArmId)` (`apps/api/src/modules/subject-hides/hidden-subjects.ts`) is the one helper every results reader uses:
- the class averages in aggregation;
- report card build (totals, averages, positions);
- the cumulative columns;
- the subject breakdown on the report card page and in the PDF;
- released results for the parent portal, the apps and the result checker.

**What changes, and when:**
- A hidden subject's scores are kept. It simply leaves results.
- The subject rows leave at once.
- Totals, averages and positions are stored on the card, so they change when the cards are next built. That is allowed only while the arm is in draft, so to change a released class you reopen it first.
- The board now has **Build again** for owners and admins on a draft arm that already has cards.

**Who can hide:**
- **Endpoints:** `GET /subject-hides`, `POST /subject-hides` and `POST /subject-hides/:id/unhide`, under `assessment.aggregate`, which owners, admins and teachers hold.
- **Owners and admins** can use any scope.
- **A teacher** can hide and unhide only `ARM` hides on an arm they are form teacher of.
- **Visibility:** a teacher sees their own arms' hides, plus level and school hides, so a missing subject is explained.
- **Audit:** every hide and unhide is audited (`subject.hidden`, `subject.unhidden`).

**"Current" hides:** `?current=true` lists hides that are not unhidden and whose term (or session) is the school's current one or has not ended. "Current" counts as well as the dates, because a school often keeps a term current past its end date while results are finished.

## Screens

**Settings → Academic → Subjects by class** (`/settings/academic/class-subjects`, the old Matrix tab):
- One section per stage the school has classes in. It names the classes and lists the stage's subjects.
- **Add a subject** picks one the school already has or takes a new name. A code is made from the name (`lib/subjects/subject-code.ts`), so the school never types one.
- The **×** on a subject takes it off that stage.
- **Hidden subjects** lists hides in force, with **Unhide**. **Show ended and unhidden** shows the history.
- **Hide a subject** asks for the subject, where (school, class or arm), how long (this term, this session, until unhidden) and the term.

**Report card board** (admin and form teacher): a **Hidden subjects** panel for the arm. The form teacher hides for this arm there. Wider hides show read-only.

**Class Levels:** the stage picker offers KG.

**Staff page → teaching assignments:** the subject list shows the chosen arm's stage subjects. If the stage has none, it shows every active subject.

**Setup checklist:** "Check your subjects by class" is done once any active subject has a stage, which the seed makes true from sign-up.

## Not done

- Insights and AI report-comment drafts still see hidden subjects. They are staff tools, and a teacher writing a comment may want the whole picture.
- The staff app has no hide screen. Hides are set on the web.
- `class_subjects` and its endpoints remain, unused by results, until a clean-up removes them.

## Tests

- **API:**
  - `report-card.service.spec.ts` ("a hidden subject counts in no total or position…"): build, detail, form-teacher limits, unhide, a current term past its end date, and the audit rows;
  - `hide-applies.spec.ts`: the pure rule;
  - `subject-catalogue.spec.ts`: unique match keys, every stage covered;
  - `setup-state.service.spec.ts`.
- **Web:** `subject-code.spec.ts`.
- **e2e:**
  - `subjects-by-class.spec.ts`: standard subjects per stage, no section for a stage with no classes, add and remove, hide and unhide;
  - `session-end-work-loss.spec.ts` now uses the lesson plan editor as its guarded surface, where it used the matrix.
