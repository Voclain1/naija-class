# CP2 Gate 5 — independent verification of a real device mark

**Purpose.** After a teacher marks a register from the phone, confirm
server-side what actually landed — rather than trusting the app's
"Saved N students" notice, which is only the client's report of a response.

**Everything here is READ-ONLY.** No step writes, updates or deletes. Nothing
here requires handing a credential to anyone: step 1 runs in the operator's own
browser session, step 2 in the operator's own Neon SQL editor.

Run steps 1 and 2 and paste both outputs. Step 1 proves the attendance rows;
step 2 proves the audit row and is the only way to see it, because **there is
no audit-log read endpoint or UI anywhere in this system** — audit rows are
write-only from the application's point of view, by design.

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
admin of the school, then open DevTools → Console and paste:

```js
// READ-ONLY. Two GETs, no writes.
// Fill these two in before running:
const CLASS_ARM_ID = "<the arm the teacher marked>";
const DATE = "<YYYY-MM-DD, the day marked — UTC, same day the phone used>";

const { token } = await (await fetch("/api/auth/session")).json();
const API = "https://school-kit-api.fly.dev/api/v1";
const res = await fetch(
  `${API}/attendance/register?classArmId=${encodeURIComponent(CLASS_ARM_ID)}&date=${DATE}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const body = await res.json();
console.log("HTTP", res.status);
console.table(
  (body.records ?? []).map((r) => ({
    student: r.fullName,
    admissionNumber: r.admissionNumber,
    status: r.status,
    markedBy: r.markedBy,
    markedAt: r.markedAt,
  })),
);
console.log("termId:", body.termId, "date:", body.date);
```

`/api/auth/session` is an existing route that returns the session token held in
the `sk_session` HttpOnly cookie so the client can rehydrate on cold boot; it is
being used here for exactly that, and the token never leaves the browser.

**What to look for.** This is a genuinely independent read — a different client,
a different session, a different principal (owner/admin, not the teacher) —
hitting the same rows the phone wrote:

- `status` matches what was tapped on the phone, per student.
- `markedBy` is the **teacher's** user id, not the owner's. The phone's session
  is what wrote the row, and this proves it.
- `markedAt` is a timestamp from the marking session, not null.
- `date` echoes the day the phone used.

If the app said "Saved 5 students" and fewer than five rows carry a status here,
the client reported a success the server did not perform, and that is a real
CP2 defect rather than a verification hiccup.

---

## Step 2 — the audit row (Neon SQL editor)

Open the Neon console for `school-kit-prod` → SQL Editor, and run:

```sql
-- READ-ONLY. Replace the two placeholders.
-- 1. The attendance rows the phone wrote.
SELECT
  ar.student_id,
  s.admission_number,
  ar.status,
  ar.date,
  ar.marked_by,
  ar.marked_at
FROM attendance_records ar
JOIN students s ON s.id = ar.student_id
WHERE ar.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
  AND ar.class_arm_id = '<CLASS_ARM_ID>'
  AND ar.date = DATE '<YYYY-MM-DD>'
ORDER BY s.last_name, s.first_name;

-- 2. The audit row(s) for that submit. Exactly ONE row per submit is expected —
--    the endpoint writes one audit entry carrying the status tally, NOT one per
--    student. A second row means a second submit (an amendment), which is
--    correct behaviour and should correspond to a second save on the phone.
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
WHERE al.school_id = '6beff17c-c65a-47db-9f00-61936e0ac467'
  AND al.entity_id = '<CLASS_ARM_ID>'
  AND al.created_at >= NOW() - INTERVAL '2 hours'
ORDER BY al.created_at DESC;
```

**What to look for:**

- `marked_by` and `user_id` are the **teacher's** id — the same value in both
  queries, and the same one step 1 returned.
- One audit row per save on the phone. Two saves → two rows; five students in
  one save → still one row.
- `metadata` carries the status tally for the submit.
- `date` is the calendar day with no time-of-day (the column is `DATE`), and it
  matches the day the phone was railed to.

`audit_logs` is monthly-partitioned; these queries hit the parent table and the
planner selects the right child, so no partition needs naming.

---

## Why not a script in the repo

An `apps/api` script would need `DATABASE_URL` pointed at production from a
developer laptop, which is a bigger and more dangerous capability than the
question deserves — this is two read-only queries, run once. The console and
the Neon SQL editor both keep the credential where it already lives.
