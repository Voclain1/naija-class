# CP2 Gate 5 — independent verification of a real device mark

**Purpose.** After a teacher marks a register from the phone, confirm
server-side what actually landed — rather than trusting the app's
"Saved N students" notice, which is only the client's report of a response.

**Everything here is READ-ONLY.** No step writes, updates or deletes. Nothing
here requires handing a credential to anyone: step 1 runs in the operator's own
browser session, step 2 in the operator's own Neon SQL editor. Both steps must
be run by the maintainer — there is no path by which an agent can perform them,
because both require credentials that exist only in the maintainer's browser and
Neon account.

Both steps now resolve the class arm **by name**, so no id needs to be hunted
out of DevTools first.

---

## Before you start — what a failed enablement looks like

If the phone login returns:

```
403  STAFF_MOBILE_DISABLED  "Staff mobile access is not enabled for this school."
```

then `School.staffMobileEnabled` is NOT true for this school and Gate 5 stops
there. Do not debug the register. The flag is re-read from the row at both
password acceptance and 2FA challenge completion, so a successful login is
itself proof the flag is genuinely set.

---

## Step 1 — read the register back through the API (browser console)

Log into the **normal web app** (not the super-admin dashboard) as an owner or
admin of the school, then open DevTools → Console and paste. Only the two
constants at the top need editing:

```js
// READ-ONLY. Four GETs, no writes.
const ARM_NAME = "JSS3 main";     // exactly as it appears in the app
const DATE = "2026-08-25";        // the UTC day the phone marked

const { token } = await (await fetch("/api/auth/session")).json();
const API = "https://school-kit-api.fly.dev/api/v1";
const auth = { headers: { Authorization: `Bearer ${token}` } };

const arms = await (await fetch(`${API}/class-arms`, auth)).json();
const arm = (Array.isArray(arms) ? arms : arms.data).find(
  (a) => a.name.toLowerCase() === ARM_NAME.toLowerCase(),
);
const me = await (await fetch(`${API}/auth/me`, auth)).json();

const res = await fetch(
  `${API}/attendance/register?classArmId=${encodeURIComponent(arm.id)}&date=${DATE}`,
  auth,
);
const body = await res.json();
const rows = body.records ?? [];
const marked = rows.filter((r) => r.status !== null);
const writers = [...new Set(marked.map((r) => r.markedBy))];

console.log("HTTP", res.status, "| termId:", body.termId, "| date:", body.date);
console.table(
  rows.map((r) => ({
    student: r.fullName,
    admissionNumber: r.admissionNumber,
    status: r.status,
    markedBy: r.markedBy,
    markedAt: r.markedAt,
  })),
);
// The verdict block. The arm's OWN classTeacherId is the expected writer, so
// this identifies the correct author positively rather than merely ruling out
// the owner.
console.log({
  armId: arm.id,
  armFormTeacherId: arm.classTeacherId,
  meRunningThisQuery: me.user?.id,
  rowsReturned: rows.length,
  rowsWithAStatus: marked.length,
  distinctMarkedBy: writers,
  writtenByFormTeacher: writers.length === 1 && writers[0] === arm.classTeacherId,
  writtenByMe: writers.includes(me.user?.id),
});
```

`/api/auth/session` is an existing route that returns the session token held in
the `sk_session` HttpOnly cookie so the client can rehydrate on cold boot; it is
being used here for exactly that, and the token never leaves the browser.

**What to look for.** This is a genuinely independent read — a different client,
a different session, a different principal (owner/admin, not the teacher) —
hitting the same rows the phone wrote:

- `status` matches what was tapped on the phone, per student.
- `markedBy` is the **teacher's** user id, not the owner's, and there is exactly
  ONE distinct value. The phone's session is what wrote the rows, and this is
  what proves it — if `markedBy` came back as the owner id, the rows were not
  written by the device.
- `markedAt` is a timestamp from the marking session, not null.
- `date` echoes the day the phone used.

If the app said "Saved 12 students" and fewer than twelve rows carry a status
here, the client reported a success the server did not perform, and that is a
real CP2 defect rather than a verification hiccup.

---

## Step 2 — the audit row (Neon SQL editor)

Open the Neon console for `school-kit-prod` → SQL Editor. Set the two values in
the first CTE and run the whole block:

```sql
-- READ-ONLY. Resolves the arm by name; no id needed.
WITH target AS (
  SELECT ca.id AS arm_id, ca.school_id
  FROM class_arms ca
  WHERE ca.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
    AND lower(ca.name) = lower('JSS3 main')
),
day AS (SELECT DATE '2026-08-25' AS d)

-- 1. The attendance rows the phone wrote.
SELECT
  s.admission_number,
  s.last_name,
  s.first_name,
  ar.status,
  ar.date,
  ar.marked_by,
  ar.marked_at
FROM attendance_records ar
JOIN target t ON t.arm_id = ar.class_arm_id AND t.school_id = ar.school_id
JOIN day    d ON d.d = ar.date
JOIN students s ON s.id = ar.student_id
ORDER BY s.last_name, s.first_name;
```

```sql
-- 2. The audit row(s). Exactly ONE row per save is expected — the endpoint
--    writes one audit entry carrying the status tally, NOT one per student.
--    Twelve students marked in one save is still ONE row, whose metadata
--    should read count = 12.
WITH target AS (
  SELECT ca.id AS arm_id
  FROM class_arms ca
  WHERE ca.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
    AND lower(ca.name) = lower('JSS3 main')
)
SELECT
  al.id,
  al.action,
  al.entity_type,
  al.entity_id,
  al.user_id,
  al.created_at,
  al.ip_address,
  al.metadata
FROM audit_logs al
JOIN target t ON t.arm_id = al.entity_id
WHERE al.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
  AND al.created_at >= NOW() - INTERVAL '12 hours'
ORDER BY al.created_at DESC;
```

**What to look for:**

- Query 1 returns **one row per student marked** — twelve, for a twelve-student
  save — each with a non-null `status`, `marked_by` and `marked_at`.
- `marked_by` and query 2's `user_id` are the **same teacher id**, and the same
  value step 1 returned.
- Query 2 returns **exactly one row per save on the phone**. One save of twelve
  students → one row. Two rows means two saves (an amendment), which is correct
  behaviour if the register was saved twice, and a defect if it was not.
- `metadata` carries the status tally: `count` and a `byStatus` breakdown that
  should add up to the number of students marked.
- `date` is the calendar day with no time-of-day (the column is `DATE`), and it
  matches the day the phone was railed to.

`audit_logs` is monthly-partitioned; these queries hit the parent table and the
planner selects the right child, so no partition needs naming.

---

## Why not a script in the repo

An `apps/api` script would need `DATABASE_URL` pointed at production from a
developer laptop, which is a bigger and more dangerous capability than the
question deserves — this is a handful of read-only queries, run once. The
console and the Neon SQL editor both keep the credential where it already lives.
