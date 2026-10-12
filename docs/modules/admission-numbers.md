# Admission numbers assigned by SchoolKit

Plan-first, 2026-10-12. Status: **approved 2026-10-12; slices 1 and 2 built (see "As built").**

## Why

Every student needs an admission number, and today the admin types each one:
in the single form, in every row of the bulk grid, in the CSV. Most schools
follow a pattern (`VFM/2026/0001`), so SchoolKit can write the next one
itself. Typing stays possible for schools that keep their own register.

## Decisions taken (owner, 2026-10-12)

- **D1. Three ways to number**, one ticked per school:
  - **In order, across the school:** `VFM/2026/0001`, `VFM/2026/0002`, …
  - **In order, per class:** each class keeps its own count, and the class is
    in the number: `VFM/JSS1/001`, `VFM/JSS1/002`, `VFM/PRI4/001`.
  - **Random:** the digits are random and never repeat in the school:
    `VFM/2026/4821`. Harder to guess, and a student signs in to the portal
    with this number.
- **D2. The year is the year of admission**, the calendar year the child is
  added. It never changes.
- **D3. With the year in the format, an in-order count starts again each
  year** (`VFM/2027/0001`). Without it, the count keeps going.
- **D4. Set in three places:** a first-time question on the add-student page,
  a Settings page, and a small "Change" dialog while adding students.

## The format: one field

The school writes its number once, with a few blanks SchoolKit fills in:

| Write | SchoolKit puts | Example |
|---|---|---|
| `{YYYY}` | year of admission | 2026 |
| `{YY}` | short year | 26 |
| `{CLASS}` | the class's code (per-class numbering only, and required there) | JSS1 |
| `{NNNN}` | the number, as many digits as there are N's (3 to 8) | 0042 |

Everything else is kept as written, so the prefix and suffix are just text
around the blanks: `VFM/{YYYY}/{NNNN}`, `{NNNNN}-VF`, `SJC{YY}{CLASS}{NNN}`.
Letters, digits, `/`, `-` and `.` only; exactly one run of N's; at most 40
characters once filled. The field shows the next number live as you type
("Next student: VFM/2026/0001").

## Data

- `schools` gains `admission_number_mode` (`MANUAL` | `AUTO`),
  `admission_number_format`, `admission_number_order`
  (`SCHOOL` | `CLASS` | `RANDOM`) and `admission_number_decided_at` (the
  first-time question was answered). `schools` has no RLS policy; the school
  changes them through `PATCH /schools/me/admission-numbers` (owner/admin,
  audited).
- New table `admission_number_counters (school_id, scope, last_value)`, RLS
  like every tenant table. `scope` is the year and class the count belongs to
  (`2026`, `2026:JSS1`, or empty). The next number is one
  `INSERT … ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING`,
  in the same transaction as the student insert, so two admins adding students
  at once never get the same number, and a failed add uses no number.
- A counter's first value starts after the highest number the school already
  has in that pattern, so turning numbering on mid-year carries on from the
  register (`…/0147` → `…/0148`).
- Random: random digits, checked against the roll, tried again on a clash. The
  existing unique (school, admission number) is the backstop.

No SECURITY DEFINER function is needed: everything runs under the school's own
GUC. Count stays 23.

## Where numbers are given (slice 1)

The server assigns a number when the admission number is **left blank** and
the school is on `AUTO`. A typed number is always kept, so an admin can still
override one student.

- **Single add** (`POST /students`): the field says "Leave blank —
  SchoolKit will assign VFM/2026/0042". Per-class numbering needs a class, so
  "place later" asks for a typed number instead.
- **Bulk grid** (`POST /students/bulk`): the admission number column becomes
  optional. Per-class numbering adds one **Class** picker for the batch, which
  also places those students in that class for the current term.
- CSV import, scanned registers and the staff mobile app keep requiring a
  typed number in slice 1. Blank cells there are **slice 2**, once slice 1 has
  been used.

## Screens

1. **First-time question** on `/students/new` and `/students/new/bulk`, for a
   school with no students that has not answered yet. It opens on arrival:
   "How does your school give admission numbers?"
   - **SchoolKit assigns them**: the format field with its explanation and live
     example, and the three ticks from D1.
   - **We type them in**: closes, and the question does not return.
   It can be put off ("Decide later"), and it comes back on the next visit.
2. **Settings → Admission numbers**: a tile on the Settings page, easy to
   find, with the same fields, the next number, and how many students already
   follow the format.
3. **While adding students** (schools that already have students): a line
   above the form reads "Admission numbers: automatic, VFM/2026/#### · Change".
   **Change** opens a small dialog with the prefix, the suffix and the three
   ticks. Saving it changes the school's setting, for everyone.

## Tests

- Format parsing and filling: tokens, digit runs, the 40-character limit,
  invalid formats refused with a reason.
- Counters (real database): in order, per class, the yearly restart, carrying
  on from existing numbers, two transactions at once never sharing a number,
  and a rolled-back add not using up a number.
- Random: digit length, no clash with existing numbers.
- A typed number always wins; `MANUAL` never assigns.
- Bulk: a batch of blanks gets consecutive numbers in row order.
- E2E: the first-time question on a new school, choose automatic, add three
  students with blank numbers, see `…/0001`–`…/0003` on the roster.

## As built (slice 1, 2026-10-12)

- **Format rules** in `packages/types/src/admission-numbers/admission-number-format.ts`,
  shared by the API and the screens. `{CLASS}` is refused unless numbering per
  class, and required when it is.
- **Migration** `20261015120000_admission_numbers`: the four `schools`
  columns (with CHECKs: `AUTO` needs a format), enums `AdmissionNumberMode`
  and `AdmissionNumberOrder`, and `admission_number_counters`
  (PK `(school_id, scope)`, FORCE RLS `tenant_isolation`).
- **Assigning** in `apps/api/src/modules/students/admission-numbers.ts`:
  `loadNumbering`, `assignAdmissionNumbers` (in order: `UPDATE … RETURNING`,
  else seed from the register and `INSERT … ON CONFLICT DO UPDATE`; random:
  `crypto.randomInt`, checked against the roll), `admissionYear` (Lagos).
  Errors: `ADMISSION_NUMBER_REQUIRED` (typing school, blank number),
  `ADMISSION_NUMBER_NEEDS_CLASS`, `ADMISSION_NUMBERS_EXHAUSTED`,
  `ADMISSION_FORMAT_INVALID`.
- **Endpoints**: `GET/PATCH /schools/me/admission-numbers` (owner/admin,
  audited `school.admission-numbers.update` with before/after). `POST
  /students` and `POST /students/bulk` take a blank admission number; the bulk
  add also takes one `enrollment` for the batch, which places the students
  (audited `enrollment.create`, `via: "student-bulk-create"`).
- **Screens**: `components/students/admission-numbers.tsx` (the question, the
  editor, the bar and its Change dialog), `/settings/admission-numbers`, a
  Settings tile, and blank-number support in `student-form.tsx` and
  `bulk-student-form.tsx` (per class: a class picker above the grid).
- **Tests**: `admission-numbers.spec.ts` (API, real database, 10 cases),
  `admission-format-ui.spec.ts` (web), and two cases in
  `e2e/tests/bulk-student-add.spec.ts`. The e2e fixture answers the question
  ("We type them in") for every other spec, as it dismisses the tour.

## As built (slice 2, 2026-10-12)

A blank admission number now works in the other three ways students arrive.

- **CSV import.** The column is optional (`studentImportRowSchema`;
  `STUDENT_IMPORT_REQUIRED_FIELDS` no longer lists it, and the mapping page
  adds it back for a school that types its numbers). The validate engine
  (`runStudentValidationEngine`, now given the `schoolId`) skips blanks in
  both dedup passes, then makes a blank a row error for a typing school, and
  for per-class numbering on a row without a class. `commitStudentRow`
  resolves the class first and numbers the row in its own transaction.
- **Numbers typed elsewhere in the file are reserved.** A blank row committed
  before a row that typed `C001` must not take `C001`; the commit handler (and
  the scan commit) pass the file's typed numbers to the assigner. Found by the
  slice's own test.
- **Scanned registers.** `reviewedStudentRowSchema.admissionNumber` is
  optional; the review grid lets a row through without one on automatic
  numbering (per class: with a class), and the commit numbers it through the
  same `commitStudentRow`.
- **Staff mobile app.** The add-student screen reads
  `GET /schools/me/admission-numbers` (query key `staffAdmissionNumbers`,
  never persisted, like every staff key); the field becomes optional with the
  next number as a hint, and a blank is left out of the request.
- **Tests.** `admission-numbers.spec.ts` gains three CSV cases (typing school,
  automatic around typed numbers, per class); `student-scan.service.spec.ts`
  one; `apps/mobile/src/lib/staff/students.spec.ts` three.
