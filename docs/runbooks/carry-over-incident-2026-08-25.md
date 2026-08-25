# Carry-over incident — read-only diagnosis (2026-08-25)

**Status: root cause identified in code. NOTHING has been changed. No fix, no
rollback, no write of any kind has been attempted.** These queries are all
`SELECT`. Run them in the Neon SQL editor for `school-kit-prod` and paste the
output; the remediation plan is written only after the real state is known.

---

## Root cause (from the code, not inference)

It is **not** the carry-over acting school-wide by design, and **not** every
arm's button pointing at the same arm id. Both symptoms come from one defect
in the wizard's third candidate group.

`/enrollments/bulk` takes an explicit `studentIds` array — the API enrols
exactly who it is told. So the defect is in what the web wizard *puts into*
that array.

The wizard builds three groups
(`apps/web/src/app/(admin)/enrollments/bulk/page.tsx`):

| Group | Source | Arm-scoped? | Default |
|---|---|---|---|
| (a) Carried over | `listEnrollments({ termId: source, classArmId: armId })` | YES | checked |
| (b) Withdrew last term | `listEnrollments({ termId: source, classArmId: armId })` | YES | unchecked |
| (c) **Admitted after term 1** | **`listStudents({ status: "ACTIVE" })`** | **NO** | **checked** |

Group (c) is school-wide **by design** — a student admitted mid-year has no arm
yet, so there is no arm to filter on. Its only filters are:

1. not already accounted for in groups (a)/(b) **for this arm**, and
2. `Student.admittedAt > sourceTerm.endDate`.

`Student.admittedAt` is `@default(now())` (`schema.prisma:662`). For a school
onboarded recently — every student record created after the previous term
ended — **filter 2 is true for the entire school**. Every ACTIVE student
therefore lands in group (c), pre-ticked, and Commit enrols all of them into
the target arm.

That is symptom 1: all 12 students into JSS3 main.

**Symptom 2 follows from the same event, via two term-scoped rules:**

- `Enrollment` has `@@unique([schoolId, studentId, termId])` — one row per
  student per term (`schema.prisma:1157`).
- `bulkCreate` computes `alreadyEnrolled` with `where: { termId, studentId }` —
  **no arm in that filter** (`enrollments.service.ts:378-388`).

So once a student holds an enrolment for the target term, every later
carry-over into a *different* arm counts them as `skipped` and creates nothing.
Meanwhile the button's visibility rule is "target term has no enrolments **for
this arm** AND a previous term does" — which stays true forever, because those
students are sitting in JSS3 main. The button therefore never disappears and
never works: a self-reinforcing dead end, exactly as reported.

**Blast radius, from the schema:** enrolment is per-term, so the SOURCE term's
rows are untouched. The damage is confined to the TARGET term's enrolment rows.
Prior-term history, and the record of which arm each student was in last term,
should still be intact — the queries below verify that rather than assume it.

---

## Query 1 — what the target term looks like now

```sql
SELECT
  t.name        AS term_name,
  ca.name       AS arm_name,
  count(*)      AS students,
  min(e.created_at) AS first_row,
  max(e.created_at) AS last_row
FROM enrollments e
JOIN terms t      ON t.id  = e.term_id
JOIN class_arms ca ON ca.id = e.class_arm_id
WHERE e.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
GROUP BY t.name, ca.name, t.start_date
ORDER BY t.start_date DESC, ca.name;
```

Expected if the diagnosis is right: for the current term, one row — JSS3 main
with 12 — and every other arm absent. Earlier terms should show the real
per-arm spread.

## Query 2 — where each student WAS, versus where they are now

This is the query that decides how remediation works: it recovers each
student's correct arm from the previous term.

```sql
WITH cur AS (
  SELECT e.student_id, ca.name AS now_arm, e.term_id, e.id AS enrollment_id, e.created_at
  FROM enrollments e
  JOIN class_arms ca ON ca.id = e.class_arm_id
  JOIN terms t ON t.id = e.term_id
  WHERE e.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
    AND t.is_current = true
),
prev AS (
  SELECT DISTINCT ON (e.student_id)
         e.student_id, ca.name AS prev_arm, t.name AS prev_term, t.start_date
  FROM enrollments e
  JOIN class_arms ca ON ca.id = e.class_arm_id
  JOIN terms t ON t.id = e.term_id
  WHERE e.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
    AND t.is_current = false
  ORDER BY e.student_id, t.start_date DESC
)
SELECT s.admission_number, s.last_name, s.first_name,
       prev.prev_term, prev.prev_arm, cur.now_arm,
       s.admitted_at, cur.created_at AS enrolled_into_current_at
FROM cur
JOIN students s ON s.id = cur.student_id
LEFT JOIN prev ON prev.student_id = cur.student_id
ORDER BY prev.prev_arm NULLS FIRST, s.last_name;
```

`prev_arm IS NULL` means that student has no earlier enrolment at all, so their
correct placement cannot be recovered from the database and must come from the
school.

## Query 3 — is `admittedAt` really the trigger?

```sql
SELECT
  (SELECT count(*) FROM students
    WHERE school_id = '6beff17c-c65a-47db-9f00-61936e0ac467' AND status = 'ACTIVE') AS active_students,
  (SELECT count(*) FROM students s
    WHERE s.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467' AND s.status = 'ACTIVE'
      AND s.admitted_at > (SELECT max(t.end_date) FROM terms t
                            WHERE t.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
                              AND t.is_current = false)) AS would_be_group_c;
```

If `would_be_group_c` equals `active_students`, the diagnosis is confirmed
against the real data: the entire school qualified as "admitted after term 1".

## Query 4 — the audit trail for the runs

```sql
SELECT al.action, al.user_id, al.created_at, al.metadata
FROM audit_logs al
WHERE al.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
  AND al.action LIKE '%enrol%'
  AND al.created_at >= NOW() - INTERVAL '7 days'
ORDER BY al.created_at DESC;
```

Shows how many carry-over runs happened, by whom, and what each claimed to
create versus skip — which distinguishes "one bad run" from "one bad run plus
several no-ops".

## Query 5 — has anything downstream consumed the wrong arm?

Enrolment is not the only place an arm id lands. Both of these snapshot or
record the arm at the time of the action, so a wrong roster can have already
propagated.

```sql
-- Invoices snapshot the class arm at ISSUE time (PR #210). The column is a
-- plain FK (invoices.class_arm_id, nullable) held deliberately outside the
-- relation so renaming or deleting an arm cannot rewrite historical finance
-- attribution.
SELECT i.id, i.status, ca.name AS invoiced_arm, i.total_due, i.total_paid, i.created_at
FROM invoices i
JOIN terms t ON t.id = i.term_id
LEFT JOIN class_arms ca ON ca.id = i.class_arm_id
WHERE i.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
  AND t.is_current = true
ORDER BY i.created_at DESC
LIMIT 50;

-- Attendance records carry the arm context at marking time.
SELECT ca.name AS arm_name, ar.date, count(*) AS rows
FROM attendance_records ar
JOIN class_arms ca ON ca.id = ar.class_arm_id
WHERE ar.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
GROUP BY ca.name, ar.date
ORDER BY ar.date DESC;
```

**Note the overlap with CP2's Gate 5.** That test marked attendance for "all 12
students in JSS3 main" — the same 12. If the carry-over ran before that test,
the register was correct *as a system* (it showed exactly who was enrolled in
the arm) but the roster it was reading was already wrong. Gate 5's evidence
about the attendance path still stands; the attendance rows themselves may need
revisiting once placements are corrected. Query 5 shows how many rows are
involved.

---

## What is NOT yet decided

Remediation. Once the queries above are back, the options differ sharply
depending on what they show — in particular whether every affected student has
a recoverable previous-term arm (query 2), and whether invoices or attendance
have already consumed the wrong placement (query 5). Correcting enrolment rows
is easy; correcting an invoice that has already been paid against the wrong arm
snapshot is not, and that decision is the school's, not a script's.

The code fix is separate from the data fix and is also not yet made. Both come
after the real state is known.

---

# Remediation — READ-ONLY DRY RUN (2026-08-25)

Confirmed placement list, from Virgo Fidelis directly:

| Students | Target arm |
|---|---|
| Bello Idris, Idris Yahaya | JSS1I (restore — unchanged from previous term) |
| **Issa David, Junior Michael** | **JSS2** — school-confirmed, NOT the JSS1I the previous term recorded |
| Okafor Ada, Okonkwo Ngozi | JSS2A (restore) |
| Adewale Tomi, Bello Fatima, Eze Chinedu | SS! (restore) |
| Adeyemi Sarah, Akon Samuel, Njoku Gabriel | Jss3 main (already correct — no change) |

## Step A — resolve the JSS2 arm (needed before anything else)

The school said "JSS2". The previous-term data shows an arm literally named
`JSS2A`, but Query 1 only listed arms that HAD enrolments, so another JSS2 arm
may exist. Resolve it explicitly rather than guessing at a name that decides
where two real children sit:

```sql
SELECT ca.id, ca.name, cl.name AS level_name, ca.is_active,
       (SELECT count(*) FROM enrollments e WHERE e.class_arm_id = ca.id) AS enrolments_ever
FROM class_arms ca
JOIN class_levels cl ON cl.id = ca.class_level_id
WHERE ca.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
ORDER BY cl.order_index, ca.name;
```

If exactly one JSS2 arm exists, use it. If there are several, the school must
say which — this must not be inferred.

## Step B — the dry run

Substitute the JSS2 arm id from step A for `<JSS2_ARM_ID>`. **This writes
nothing.** It shows every row that would change, and every row that would not.

```sql
WITH target_term AS (
  SELECT id FROM terms
  WHERE school_id = '6beff17c-c65a-47db-9f00-61936e0ac467' AND is_current = true
),
intended (admission_number, intended_arm_id) AS (
  VALUES
    ('2026/JSS1/049', (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='JSS1I')),
    ('2026/JSS1/046', (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='JSS1I')),
    ('2026/JSS3/050', '<JSS2_ARM_ID>'),
    ('2026SS3/120',   '<JSS2_ARM_ID>'),
    ('ADM/2025/001',  (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='JSS2A')),
    ('ADM/2025/006',  (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='JSS2A')),
    ('ADM/2025/008',  (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='SS!')),
    ('ADM/2025/009',  (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='SS!')),
    ('ADM/2025/002',  (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='SS!')),
    ('2026/JSS3/029', (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='Jss3 main')),
    ('ADM/2025/0029', (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='Jss3 main')),
    ('2026/JSS3/028', (SELECT id FROM class_arms WHERE school_id='6beff17c-c65a-47db-9f00-61936e0ac467' AND name='Jss3 main'))
)
SELECT
  s.admission_number,
  s.last_name || ', ' || s.first_name AS student,
  cur_arm.name  AS from_arm,
  new_arm.name  AS to_arm,
  CASE
    WHEN i.intended_arm_id IS NULL              THEN 'ERROR: target arm not found'
    WHEN e.id IS NULL                           THEN 'ERROR: no current-term enrolment'
    WHEN e.class_arm_id = i.intended_arm_id     THEN 'no change'
    ELSE 'WILL CHANGE'
  END AS action,
  e.id AS enrollment_id
FROM intended i
LEFT JOIN students s
       ON s.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
      AND s.admission_number = i.admission_number
LEFT JOIN enrollments e
       ON e.student_id = s.id AND e.term_id = (SELECT id FROM target_term)
LEFT JOIN class_arms cur_arm ON cur_arm.id = e.class_arm_id
LEFT JOIN class_arms new_arm ON new_arm.id = i.intended_arm_id
ORDER BY action DESC, s.last_name;
```

**Expected: 9 rows `WILL CHANGE`, 3 rows `no change`, and ZERO rows saying
`ERROR`.** Any `ERROR` row means an arm name did not match or a student is
missing, and the write must not proceed until that is understood — a NULL arm
id in an UPDATE would be a second incident on top of the first.

The write itself is not in this document, deliberately. It gets written only
after this dry run is reviewed and approved.

---

# RESOLVED — data corrected 2026-08-26

The 9 misplaced enrolments were corrected in a single reviewed transaction via
the Neon SQL editor, after a rehearsal run that rolled itself back.

**Rehearsal** (identical block ending `ROLLBACK`): `UPDATE 9`, `INSERT 1`,
`SELECT 12`, `SELECT 4`, `ROLLBACK`. The tally moved from one arm holding all
12 to four arms — proof the redistribution was real before anything was kept.

**Apply** (same block ending `COMMIT`): `UPDATE 9`, `INSERT 1`, `SELECT 12`,
`SELECT 4`, `COMMIT`.

Final placements for Second Term:

| Arm | Students |
|---|---|
| JSS1I | 2 — Bello Idris, Idris Yahaya |
| JSS2A | 4 — Okafor Ada, Okonkwo Ngozi, **Issa David, Junior Michael** |
| SS! | 3 — Adewale Tomi, Bello Fatima, Eze Chinedu |
| Jss3 main | 3 — Adeyemi Sarah, Akon Samuel, Njoku Gabriel |

Issa David and Junior Michael went to **JSS2A**, which is NOT what the previous
term recorded (JSS1I) and not what their admission numbers suggest (JSS3/SS3).
The school confirmed both directly. This is why the correction was not run as a
blind restore-from-previous-term: two of twelve children would have been put
back in the wrong class, and nothing in the database would have said so.

**Deliberately NOT changed: the 12 attendance rows for 2026-08-25.** They stay
attributed to Jss3 main, as a record of what was actually marked at the arm the
system showed at the time. Rewriting them would retroactively fabricate a
register that never existed. The cost is real and accepted: `getSummary` reads
`attendance_records` by arm and never the roster, so Jss3 main's term summary
will list 12 students for that one day, and the 9 who moved lose that day from
their new arm's history. Virgo's form teacher is being told directly, so it
reads as a known one-day anomaly rather than a mystery.

**Audit:** one `enrollment.placement-correction` row on the current term,
attributed to the operator, recording that the placements were school-confirmed
and that the change was applied out of band. Without it the term's history would
show the bad carry-over and then an unexplained change of placement.

Still outstanding at the time of writing: the kill switch and wizard fix are
implemented and verified locally but NOT deployed — the wizard remains live and
capable of reproducing this on any school with an un-enrolled term.
