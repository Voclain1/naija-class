# Staff mobile companion

**Status:** approved 2026-08-24. CP1, CP2 and CP3 complete. CP1/CP2 device-gated and server-side verified against Virgo Fidelis (`docs/journal/2026-08-25.md`); CP3 complete — gates 0-4 verified and Gate 5 closed on device evidence (`docs/journal/2026-08-26.md`). **D16 is SETTLED: option (a) stands**, decided on a measured ~4-5 s cold open of which the term chain is only ~0.6-1.2 s. CP4 (owner/admin dashboard + web handoffs) not started.

This addendum supersedes only Phase 6's original “not a teacher mobile app”
boundary. Staff is one principal with existing role grants, not four new
principals. Native scope is teacher daily attendance, bursar collection
monitoring, and the owner/admin operational dashboard. Everything else uses a
fixed-origin browser handoff. Payroll, BVN, staff/role management, school
configuration, bulk imports, refunds, payment recording or approval, and 2FA
setup/disable remain web-only. **Amended 2026-09-21 (CP9):** recording a
manual payment, sending fee reminders, sharing a payment link and logging an
expense move to the phone behind the D37/D38 safeguards; refunds, payroll, BVN,
fee and discount setup, whole-class invoice generation, staff/roles, settings
and bulk work stay web-only.

**Scope widened 2026-09-17.** The "companion" boundary above is superseded for
native scope: staff mobile now aims to carry what each role does **daily or
weekly**, so that an older, phone-first administrator rarely has to find the
website. The web-only list in the previous paragraph is **unchanged** — it was
drawn around money, identity and bulk configuration, not around screen size,
and none of those reasons moved. Whatever stays web-only is reached through the
CP4 handoff, which must sign the user in without a second login. Agreed order:
**CP6 teacher gradebook → CP4 owner/admin dashboard + approvals + handoffs →
bursar lookups**. CP6 is numbered after CP5 but runs first.

The session union is guardian/student/staff. Staff login has dedicated mobile
routes, a challenge audience that cannot be exchanged with web 2FA, a random
install-scoped device id, and a mobile session row capped at seven days by
`STAFF_MOBILE_SESSION_TTL_HOURS` (values above 168 are clamped). Staff tokens
may be persisted only when an OS credential is enrolled. Cold launch and a
return after more than two minutes require biometric/device-credential
re-entry. Staff data is protected from screenshots/app-switcher previews where
the OS supports it and is never persisted in the offline query cache. Cache
keys for later workflow reads begin `["staff", schoolId, userId, ...]`. There
are no queued/offline staff writes and no staff push notifications.

Remote session listing/revocation exposes only device label and timestamps,
never token hashes, IP addresses, or full user agents. Revocation is
tenant/user scoped, actor audited, and invalidates Redis immediately. Rollout
is gated by `School.staffMobileEnabled`, default false, and is enabled one
reviewed school at a time.

Checkpoints: CP1 auth/security foundation; CP2 teacher attendance; CP3 bursar
monitoring; CP4 owner/admin dashboard and web handoffs; CP5 one-school rollout.
No workflow screen begins before CP1 has real Postgres/Redis and real-device
evidence.

---

## CP2 — teacher attendance (plan-first, approved pending review 2026-08-25)

**Scope boundary: CP2 is mobile-only.** The API, permissions and data model
this checkpoint needs already exist and are already correctly scoped. CP2 adds
no migration, no endpoint, no permission, no `ALL_PERMISSIONS` entry, and
therefore nothing that touches `rbac-two-gate-conformance.spec.ts`. If
implementation finds itself wanting a server change, that is a signal to stop
and re-plan, not to widen scope.

Endpoints consumed, all pre-existing:

- `GET /teacher-scope/me` — `classArms` (id + name), `formTeacherArmIds`,
  `currentTerm`, in one round-trip.
- `GET /attendance/register?classArmId=&date=` — roster merged with existing
  marks; `status: null` means unmarked.
- `POST /attendance/mark` — atomic all-or-nothing upsert; returns `{ count }`;
  writes exactly one audit row per submit.

Authorization is unchanged and is enforced server-side
(`attendance.service.ts`, `assertCanAccessArmAttendance`): the form teacher of
the arm may mark; a SUBJECT teacher of the same arm gets 403; a teacher for
whom the arm is out of scope gets 404, so the arm is invisible rather than
merely forbidden. Mobile must not re-implement this rule — it renders what the
server allows.

### Behaviour decided by parity with web, not invented here

Both open questions from the CP2 sketch are already answered by the shipped web
teacher surface, and CP2 matches it rather than diverging:

- **Date scope.** Web defaults to today in the viewer's LOCAL timezone and
  allows any past date, with `max={today}` on the picker. The server
  independently rejects future dates (`resolveTermForDate` →
  "Cannot record attendance for a future date."), so the client restriction is
  a convenience, not the boundary. Mobile does the same: default today, past
  dates selectable, future unreachable. Divergence here would be a
  teacher-visible inconsistency between two surfaces showing the same register.
- **Re-marking.** `POST /attendance/mark` is an upsert and web already treats
  amending as normal: it submits DIRTY ROWS ONLY and surfaces a
  "last marked at HH:MM" stamp from the register's `markedAt`. Mobile does the
  same — dirty-only submit, visible last-marked stamp — so an amendment is
  never silent.

### Gates

Each gate produces evidence before the next begins, in CP1's order:
real-code proof, then real-DB proof, then real-device proof.

**Gate 0 — verify the no-server-change claim.** Confirm against real local
Postgres that `GET /teacher-scope/me` plus `GET /attendance/register` supply
everything the screens render — arm label, student identity, current status,
last-marked stamp, term — with no second call and no admin student DTO. A
genuinely missing field becomes its own reviewed decision, not a quiet addition.

**Gate 1 — arm selection.** `/staff` lists the teacher's form-teacher arms from
`formTeacherArmIds` intersected with `classArms`. Evidence: a teacher with no
form-teacher arm sees an explicit empty state that names why, not a blank list;
a subject-only teacher is never offered a markable arm.

**Gate 2 — the register screen.** Load the day's register for one arm, set
PRESENT/ABSENT/LATE/EXCUSED per student, submit dirty rows through the single
atomic endpoint. **No offline queue and no optimistic write** — the plan-first
forbids queued staff writes, so a failed submit surfaces as a failure with the
register unchanged, never as a silent local success. `ApiNetworkError` (no
signal) must read as "not saved", distinctly from a rejected submit.

**Gate 3 — CP1's security invariants, proven not assumed.** Every attendance
query key begins `["staff", schoolId, userId, …]`, with a test asserting the
actual keys the screens use resolve to `mayPersistQuery === false`. Plus, on
device: the register survives a lock/unlock cycle without appearing in the
app-switcher thumbnail, and re-locks after more than two minutes backgrounded
while a register is on screen.

**Gate 4 — real-DB API conformance.** Positive/control pairing against real
Postgres: form teacher marks successfully; subject teacher of the same arm →
403; teacher of a different arm → 404; cross-tenant arm id → 404; a stale
roster row → whole batch rejected; exactly one audit row per successful submit.

**Gate 5 — real device.** An actual mark from the phone against a reviewed test
school, verified afterwards by reading the `AttendanceRecord` rows and the audit
row server-side — not by trusting the app's success state. Same standard CP1
was held to.

### Out of scope for CP2

Subject-period attendance (`/attendance/subject/*`, gated by
`subjectAttendanceEnabled`), the term summary view, bursar collections, the
owner/admin dashboard, and any staff push notification.

### CP2 marking window — TEMPORARY rail, not D14's answer

CP2 restricts marking from the phone to the server's today. This is a pilot
safety default, explicitly NOT the marking-window policy: D14 stays open and is
decided on its own terms. `apps/mobile/src/lib/staff/marking-window.ts` carries
the same statement at the top of the file, and deleting that one file restores
mobile to web's behaviour.

Two consequences worth stating plainly:

- **It is not a security boundary.** The server still accepts any past in-term
  date from any caller holding `attendance.mark`, which is exactly what the web
  teacher surface does today by design. This rail narrows one client; it closes
  no hole, and removing it opens none.
- **It is deliberately not parity with web.** Web allows back-dating behind a
  picker capped at today. Mobile is narrower for now and says so on screen —
  "For now, the app can only mark today's register. Use the web teacher portal
  to correct an earlier day." The read path is NOT railed: looking at an earlier
  register is not the risk; silently writing to one is.

**Timezone: UTC, and deliberately so.** The rail derives "today" in UTC, which
is what the rest of the attendance path already does — `AttendanceRecord.date`
is `@db.Date` (no timezone), `parseIsoDate` builds UTC midnight, and
`resolveTermForDate`'s own future-date rejection compares against UTC midnight.
Deriving this rail's "today" in Africa/Lagos would put the client and the
server's own check on different calendars, which is precisely the "midnight in
which zone?" trap CLAUDE.md's `@db.Date` convention exists to avoid. Nigeria is
UTC+1 with no DST, so the two agree throughout a school day and differ only
between 00:00 and 01:00 Lagos time, when no register is being marked. (There is
no Africa/Lagos date handling anywhere in the codebase today; the one place the
zone is named — `ai.constants.ts` — is a comment recording that UTC was chosen
over it on purpose.)

**"Today" comes from the SERVER, not the handset.** A rail that reads the
phone's own clock is one a wrong phone clock walks around silently. Every API
response carries a `Date` header, so `apiFetch` records it and the register load
itself establishes the server's day — no new endpoint, and CP2's
no-server-change boundary holds. If no response has been seen yet, marking is
BLOCKED rather than falling back to the device clock.

---

## CP3 — bursar collection monitoring (plan-first, for review 2026-08-25)

**Scope: read-only.** The plan-first's own boundary already settles this —
"payment recording or approval" and "refunds" are web-only. Monitoring is
therefore what CP3 is: a bursar standing in a corridor can see where collections
stand and who owes, and cannot move money from the phone. That asymmetry is
deliberate and worth keeping visible on screen, not just in this document.

**Like CP2, no server change is expected.** Every endpoint exists and the bursar
role already holds every permission needed:

| Need | Endpoint | Permission (bursar holds) |
|---|---|---|
| Collections summary | `GET /finance/dashboard?termId=` | `finance.dashboard.read` |
| Who owes | `GET /finance/debtors?termId=` | `finance.debtors.read` |
| Recent money in | `GET /payments` | `payment.read` |
| Term context | `GET /academic-years`, `GET /academic-years/:yearId/terms` | `academic-year.read`, `term.read` |

`FinanceDashboardDto` already returns `totalInvoiced`, `totalCollected`,
`collectionRatePercent`, `outstandingBalance`, `debtorCount`, `totalExpenses`
and `netPosition`. `DebtorDto` already returns student name, admission number,
class arm, `totalDue`/`totalPaid`/`balance`, status, due date and
`hasPaymentPlan` — and carries NO guardian contact details, which is the right
shape for a phone and means CP3 introduces no new PII surface.

### The one real finding, and it is a Gate 0 question

**A bursar has no one-stop context endpoint, and the phone therefore pays two
round-trips before it can render anything.** Both finance endpoints require
`termId: uuid` with no server-side "current term" fallback (`dashboard.dto.ts`
says so explicitly, mirroring `listDebtorsSchema`). Resolving it means
`GET /academic-years` → find `isCurrent` → `GET /academic-years/:yearId/terms`
→ find `isCurrent` → only then the dashboard.

This is the mirror image of the teacher's position and worth stating plainly:
teachers were GIVEN `/teacher-scope/me` precisely because they lacked
`term.read` and could not resolve a term at all. Bursars hold the permission,
so nobody ever built them the convenience — the web finance pages resolve it
through a year/term selector the user is already looking at. On a phone opened
for a ten-second glance, three sequential requests on a Nigerian mobile network
is the whole interaction.

**Decision required before Gate 1 (D16).** Three options, and this is the one
place CP3 might legitimately need a server change:

- **(a) Client-side chain, no server change.** Preserves CP2's "mobile-only"
  property exactly. Costs two extra round-trips on every cold open.
- **(b) A `currentTermId` convenience on an existing bursar-readable read.**
  Small, but it is a server change and needs its own justification.
- **(c) Accept `termId` optional on the two finance endpoints, defaulting to the
  current term.** Cleanest for every client including web — and precisely what
  `dashboard.dto.ts` says was deliberately NOT done, so it reopens a settled
  decision and must not be done casually.

**Recommendation: (a) for CP3.** It keeps the checkpoint honest to the CP2
precedent, and the cost is measurable rather than theoretical. If Gate 0 shows
the cold open is genuinely slow on a real network, that measurement is the
argument for (b) or (c) — made with evidence, in its own PR, rather than
assumed now.

### D17 — payment-link share is deliberately EXCLUDED, and should be revisited

The single most natural bursar action on a phone is sharing an invoice's
payment link to WhatsApp, which the web already does (`GET/POST
/invoices/:id/payment-link`, `wa.me` share, shipped in the payment-links
initiative). WhatsApp is on the phone; the parent is on WhatsApp.

It is excluded from CP3 anyway, because `POST /invoices/:id/payment-link`
requires `payment.record` and creates a remote Paystack object — a write, and
one adjacent to the money boundary this plan-first put behind a web-only line.
Shipping it inside a checkpoint scoped as "monitoring" would widen that line
quietly.

Recorded as a real candidate for CP4 or its own slice, with the note that the
READ half (`GET …/payment-link`, showing an already-created link and offering
the share) is a materially smaller ask than the write half and could be taken
alone.

### Gates

**Gate 0 — verify the no-server-change claim, and MEASURE the cold open.**
Against real Postgres, confirm the four endpoints supply everything the screens
render. Separately, time the resolve-term-then-load chain against the deployed
API and record the number. That measurement is D16's evidence; without it, (a)
vs (b) vs (c) is a matter of taste.

**Gate 1 — the collections screen.** Dashboard figures for the current term:
collected vs invoiced, collection rate, outstanding, debtor count. Money is
formatted from kobo at the display layer only; the phone computes nothing —
`netPosition` and `collectionRatePercent` are server-computed and rendered as
given. Evidence: a school with zero invoices renders an explicit empty state
naming why, not "0%" presented as a fact about collections.

**Gate 2 — the debtor list.** Name, arm, balance, status, `hasPaymentPlan`.
Read-only, no reminder sending (`finance.debtors.remind` is a write and a real
outbound message; it stays web-only for CP3). Evidence: the list renders
identically to the web debtors page for the same term, verified against real
data rather than by eye.

**Gate 3 — CP1's security invariants, on the most sensitive payload yet.**
Every key begins `["staff", schoolId, userId, …]`, with a spec asserting the
ACTUAL keys these screens build — the same shape as `staff-keys.spec.ts`, and
more load-bearing here than for attendance: a debtor list is every family in the
school that owes money, by name and amount, and it must never reach plaintext
AsyncStorage. Plus, on device: obscured in the app switcher, and re-locked after
more than two minutes backgrounded while a debtor list is on screen.

**Gate 4 — real-DB API conformance.** Positive/control pairing: bursar reads
successfully; a TEACHER is refused on all four endpoints (they hold none of
these permissions); cross-tenant `termId` returns nothing, not another school's
figures. Money assertions in kobo, exact, no float arithmetic anywhere.

**Gate 5 — real device.** A real bursar login against a reviewed school, figures
compared against the web finance dashboard for the same term — the two surfaces
must agree to the kobo. Same standard CP2 was held to.

### Out of scope for CP3

Recording payments, refunds, reminder sends, payment-link creation or sharing
(D17), expenses, payroll, BVN, and the invoice detail page. Every one of these
is either a write or an established web-only surface.

---

## CP6 — teacher gradebook (plan-first, approved 2026-09-17)

**Approved as written, 2026-09-17:** D18 mark-sheet mode, D19 in-memory draft
store (survives the lock, not an app kill), and CP6b as a separate PR after
CP6a.

**Why this is first.** Score entry is the teacher's heaviest recurring job
outside attendance, and today it is the one thing that forces every subject
teacher onto the website after every test and every term. It is also the job
least exposed to the web-only reasons: no money, no identity, no bulk
configuration — scores for classes the server already says are yours.

**Ships as two PRs, gated separately:**

- **CP6a — scores and sign-off.** Enter and correct component scores for one
  (arm × subject) in the current term; sign the column off.
- **CP6b — subject comments.** Draft comments with AI, edit, accept one student
  at a time. Split out because it adds a polled background batch, AI budget
  spend and the AI approval gate — a different risk profile from typing numbers.

### No server change expected

Every endpoint exists, is in production behind the shipped web teacher
gradebook, and the `teacher` role already holds every permission:

| Need | Endpoint | Permission |
|---|---|---|
| Arms, subjects per arm, current term, form-teacher arms | `GET /teacher-scope/me` (already bound in `staff-attendance.ts`) | authenticated staff |
| Components and their weights | `GET /grading-scheme` | `grading-scheme.read` (teacher grant added 2026-07-28) |
| The column: students + saved scores + summary | `GET /assessments?termId=&classArmId=&subjectId=` | `assessment.read` |
| Save | `POST /assessment-scores/bulk` — atomic, returns the refreshed feed | `assessment-score.create` |
| Sign off | `POST /assessments/sign-off/bulk` | `assessment.sign-off` |
| CP6b — list / draft / accept | `GET /report-card-comments`, `POST …/generate`, `POST …/accept` | `report-card-comment.generate` / `.write` |

Scoping is server-side and is not reimplemented on the phone:
`AssessmentService` returns 404 for a column outside the teacher's
(arm, subject) scope, refuses a score above the component's weight, refuses
students not enrolled this term, and refuses any write touching a student whose
report card is `RELEASED`. The feed's student DTO is already narrowed to id,
name and admission number, so CP6 introduces no new PII surface.

### Behaviour decided by parity with web, not invented here

- **Current term only**, from `teacherScope.currentTerm`; null → an explicit
  "No active term — ask an administrator" state, as on web.
- **Subjects offered** come from `subjectsByArm`. A form-teacher-only arm with
  no subject entry offers nothing to score, and the screen says why.
- **Save submits dirty cells only**, through the one atomic bulk call, and
  replaces local state with the feed the server returns. Totals, letter grades
  and remarks are **rendered from the server's response, never computed on the
  phone** — the same rule CP3 applied to money.
- **Sign-off requires every student fully scored**; the button is disabled with
  the reason shown, as web's `signOffReason` does.
- **No offline queue, no optimistic write, no retry** — CP2's rule. A failed
  save leaves the unsaved marks on screen, marked unsaved. `ApiNetworkError`
  reads "Not saved — you're offline", distinct from a rejected save, and a
  rejected save points at the offending students using the server's
  `['rows', i, 'score']` issue paths.

### Decisions for review

**D18 — entry shape: one component at a time (recommended).** A phone cannot
show web's grid of 40 students × 3–4 components. Two shapes fit:

- **(a) Mark-sheet mode — recommended.** Pick a component ("1st CA /20"), then
  go down the class list typing one number per student, on a numeric keypad,
  with "next" moving to the following student. This is how a teacher holds a
  pile of marked scripts: one test at a time.
- (b) Student mode — open a student, fill all their components. Better for
  correcting one child, worse for the common case.

CP6a builds (a), and makes a student row tappable to show that student's saved
components read-only, which answers "what does Chidi have so far" without
building (b).

**D19 — unsaved marks must survive the two-minute lock. This is the real
finding.** A teacher entering 40 marks will switch to WhatsApp or the camera
roll to check a script. After more than two minutes in the background, CP1's
lock fires, every staff screen returns `<Redirect href="/unlock" />`, and the
gradebook **unmounts** — silently discarding every unsaved mark. Attendance
never hit this because a register is a minute's work; a mark sheet is not.

- **(a) In-memory draft store — recommended.** Unsaved cells live in a
  module-level store outside the screen, keyed
  `["staff", schoolId, userId, termId, armId, subjectId, componentId]`. It
  survives the unlock redirect and is restored when the screen remounts. It is
  **never written to disk** (CP1: staff data is never persisted) and is **wiped
  on sign-out, session end, or a different user unlocking** — the same
  principal boundary the query keys enforce. Closing the app loses the draft,
  and while any marks are unsaved the screen says so in those words. (Leaving
  the screen loses nothing, since the draft is not screen state, so no
  "leave without saving?" prompt is needed; the picker instead labels any
  column that still holds unsaved marks.)
- (b) Autosave each cell as typed. Rejected: every keystroke becomes an audited
  write, a half-typed "1" on its way to "17" reaches a student's record, and a
  stray tap on a signed-off column un-signs it (D20).
- (c) Encrypted drafts on disk. Rejected for CP6: it reopens CP1's
  never-persist rule for a benefit (surviving an app kill) nobody has asked for
  yet.

**D20 — editing a signed-off column silently undoes the sign-off.** The server
clears `subjectSignedOffAt` on any write for a signed-off student
(`clearedSignOff` in `materializeSummary`) and records it only as audit
metadata. Web guards this with a locked grid and "Re-open to edit". The phone
does the same, in plainer words, because a finger slip is likelier than a
mouse slip: a signed-off column opens read-only, and "Edit marks" first asks
**"Changing a mark will undo your sign-off for this subject. You'll need to sign
off again."**

**D21 — a saved mark cannot be removed from the phone.** The bulk upsert has no
delete; web silently skips an emptied cell, so it looks cleared and stays saved.
The phone refuses to leave a saved cell empty and says "Saved marks can be
changed but not removed." If removal is genuinely needed, that is a server
change for its own PR, not a CP6 addition.

**D22 — positions are not shown on the phone.** Subject and class positions come
from a separate aggregation pass that only a form teacher triggers, on web, so
after any save they may be stale. A possibly-wrong "3rd" on a screen a teacher
might screenshot and send to a parent is worse than no position. "Recompute
positions" stays web-only in CP6.

**D23 — CP6b keeps the AI approval gate visible, not just enforced.** A draft
sits in an editable box labelled **"Draft — not on the report card"** until
"Accept" is pressed for that student; there is no "accept all". Polling runs
only while the comments screen is focused and stops at web's ~5-minute cap,
and skipped students are named ("3 already signed off"). If AI is off for the
school or the budget is spent, the refusal reads "AI drafting isn't available —
you can still type comments yourself", and typing and accepting a hand-written
comment still works.

### Gates — CP6a

**Gate 0 — verify the no-server-change claim** against real local Postgres:
scope + scheme + feed supply everything the screens render. Record exactly how
the server refuses a RELEASED-card write, a weight overflow and an out-of-scope
column (status + error code), since the phone's messages are built on them. A
genuinely missing field becomes its own reviewed decision.

**Gate 1 — picker.** `/staff` gains "Enter marks", listing arm → subject pairs
from `subjectsByArm`. Evidence: a form-teacher-only teacher gets a named empty
state; the no-current-term state renders; the list matches web for the same
teacher.

**Gate 2 — mark sheet.** Component picker showing each weight; one number per
student on a numeric keypad; a 0–weight check before save (the server still
decides); dirty-only atomic save; totals and grades from the response. Unit
specs port web's `gradebook-form.ts` rules (`cellError`, `collectDirtyRows`
ordering, `isColumnFullyScored`, `columnSignedOffAt`) — shared behaviour gets
shared tests, not a re-derivation.

**Gate 3 — sign-off and D20.** Sign-off disabled with the reason until fully
scored; a signed-off column is read-only; "Edit marks" confirmation; after an
edit and save, the column shows as not signed off, taken from the returned
feed.

**Gate 4 — CP1 invariants and D19, proven.** Every gradebook query key begins
`["staff", schoolId, userId, …]`, asserted in `staff-keys.spec.ts` against the
keys the screens actually build, with `mayPersistQuery === false`. Draft store
specs: survives unmount/remount; wiped on sign-out, session end and user change;
never touches AsyncStorage or SecureStore. On device: type marks, background
the app for more than 2 minutes, unlock → marks still there and still unsaved;
app-switcher thumbnail obscured.

**Gate 5 — real-DB conformance.** Positive/control pairs: subject teacher saves;
the same teacher, a subject they don't teach in that arm → 404; another school's
arm → 404; a score above weight → whole batch rejected, nothing written; a
student with a RELEASED card in the batch → rejected, nothing written; exactly
one audit row per successful save, with `clearedSignOffCount` correct after a
D20 edit.

**Gate 6 — real device.** Enter a full component for a test class from the
phone, sign it off, then confirm every mark and the sign-off stamp match the web
gradebook for the same column — read from the database, not trusted from the
app's success state.

### CP6a status (2026-09-17)

Implemented on `staff-mobile/gradebook`: `/staff/gradebook` (picker),
`/staff/gradebook/[armId]/[subjectId]` (mark sheet), an "Enter marks" entry on
`/staff`, bindings in `src/lib/api/staff-gradebook.ts`, rules in
`src/lib/staff/gradebook-rules.ts`, and the D19 store in
`src/lib/staff/gradebook-drafts.ts`, wiped from `session.tsx`'s `clearSession`
and `adoptStaffSession` and deliberately not from the lock path.

- **Gate 0 — done.** No server change. Refusals the phone's copy is built on:
  weight overflow → `400` with `details.issues[].path = ["rows", i, "score"]`;
  unenrolled → `400` with `["rows", i, "studentId"]`; out-of-scope column →
  `404 NOT_FOUND`; released card → `409 REPORT_CARD_RELEASED`; sign-off with a
  missing mark → `400`.
- **Gates 1-3 — done in code.** Typecheck, lint and an Android `expo export`
  pass. Screens cannot be driven on the web target: staff sign-in refuses there
  by design (`canProtectStaffSession` returns false on web), so their visual
  check is Gate 6.
- **Gate 4 — done in specs; on-device half open.** `staff-keys.spec.ts` covers
  both new keys; `gradebook-drafts.spec.ts` asserts survival across remount,
  principal isolation, wipe-and-notify, no storage imports, and that
  `session.tsx` wipes on session end and sign-in but not on lock. The
  background-over-two-minutes device check is still to run.
- **Gate 5 — satisfied by existing real-Postgres specs**, since CP6a sends
  exactly what web sends: `assessment.service.spec.ts` (scope 404, weight
  overflow, unenrolled, whole-batch rollback, one audit row, sign-off cleared
  and counted, bulk sign-off incl. cross-tenant) and
  `report-card-workflow.service.spec.ts` (released card → 409 on bulk save and
  sign-off) — 47 tests, run 2026-09-17, all passing.
- **Gate 6 — open.** Needs a real phone against a test school with
  `staffMobileEnabled`.

### Gates — CP6b

- **Gate 0** — confirm the list/generate/accept response shapes and how
  AI-disabled and budget-exhausted refusals arrive.
- **Gate 1** — comments screen per (arm × subject), drafts visibly unsaved.
- **Gate 2** — accept sends the edited text; signed-off students are read-only
  with the reason shown.
- **Gate 3** — polling only while focused and stops at the cap; edited,
  unaccepted drafts go through the D19 store, never disk.
- **Gate 4** — real DB: accept writes `Assessment.subjectComment`; a signed-off
  student refuses generate and accept; another school's student is refused; a
  generation enqueued from the phone lands its `ai_interaction_logs` row the
  same as one from web.
- **Gate 5** — real device, with the accepted comment confirmed on the web
  report card. **CLOSED on device, 2026-09-20**, once the production bug below
  was fixed and deployed: a teacher drafted comments with AI from the phone,
  accepted one, and the accepted text was then read back on the web report
  card. Accept is the only writer of `Assessment.subjectComment`, so that
  round trip is the gate's real subject.

  What was NOT exercised, deliberately and correctly: building or releasing the
  report card itself. The test school's other subjects are not compiled yet, so
  there is nothing to build — and a RELEASED card is frozen by
  `released-guard.ts`, which the app already refuses against with its own
  message. Release remains a web-only, owner/admin action; nothing in CP6
  claims otherwise.

**CP6b's device pass found a PRODUCTION bug that had nothing to do with
mobile.** The first tap on "Draft comments with AI" returned
`500 An unexpected error occurred`. `school-kit-api`'s logs carried
`Error: Custom Id cannot contain :` from `POST /report-card-comments/generate`:
BullMQ refuses a custom job id containing a colon unless it splits into exactly
three parts, and all three AI enqueue sites interpolated a colon-separated
`sessionRef` into four or five. Subject comments, form-teacher comments and
**weekly parent summaries** were therefore all broken in production — on WEB as
much as on mobile, since the web gradebook's own "Draft comments" button hits
the same endpoint. Fixed by `queueJobId`
(`apps/api/src/common/queue/job-id.ts`, PR #313), deployed as `school-kit-api`
v256, and drafting worked from the phone immediately afterwards.

Two things worth carrying forward from how it was found and fixed:

1. **Every existing spec mocked the queue**, so no test had ever handed a real
   job id to real BullMQ. `job-id.spec.ts` now drives the real library against
   real Redis, which CI already provides as a service.
2. **The first version of that spec passed while production was failing**,
   because its probe id happened to have three colon-separated parts — the one
   shape BullMQ still allows. A rule verified with the wrong-shaped input reads
   as "no such rule". The spec now pins that trapdoor explicitly.

Neither is a mobile lesson; both belong to whoever next adds a queued job.

### CP6b status (2026-09-17)

Implemented on the same branch, on top of CP6a:
`/staff/gradebook/[armId]/[subjectId]/comments`, reached from a "Report card
comments" button under the mark sheet (below it deliberately, like web: the
comment interprets the marks above it). Bindings in
`src/lib/api/staff-comments.ts`; the roster comes from the gradebook feed's
cache, because `SubjectCommentRowDto` deliberately carries no name.

- **Gate 0 — done.** `generate` refuses up front with `403 AI_NOT_CONFIGURED`
  when the deployment has no key, and the batch is refused outright for a
  released arm (`409 REPORT_CARD_RELEASED`). The other three AI codes
  (`AI_DISABLED_SCHOOL`, `AI_DISABLED_PLATFORM`, `AI_BUDGET_EXCEEDED`) are
  raised per call ON THE WORKER, so a batch can be accepted and then produce
  nothing — the screen's ~5-minute cap and retry line is the only thing that
  closes that case, exactly as on web. `accept` refuses a signed-off student
  with `409 SUBJECT_SIGNED_OFF`.
- **Gate 1 — done.** One card per student, grade and total beside the name,
  text visibly unsaved until accepted.
- **Gate 2 — done.** Accept sends the teacher's edited text; a signed-off
  student renders read-only with the reason.
- **Gate 3 — done.** Polling runs only while the screen is focused
  (`useFocusEffect`) and stops at 50 polls; unaccepted edits go through the D19
  store under a `comment` key kept separate from the `score:` keys, so a
  comment draft never counts as unsaved marks — and it blocks sign-off, since
  sign-off would freeze it away.
- **Gate 4 — deferred to the same real-DB specs.** `report-comments.service`
  already has its own suite; the phone sends exactly what web sends.
- **Gate 5 — first device pass, 2026-09-19.** CP6a passed end to end on a real
  phone: picker, mark sheet, over-the-maximum refusal, D21 refusal to empty a
  saved mark, the per-student summary, save verified against the web gradebook,
  the D19 lock test (marks survived a >2-minute background and unlock, labelled
  unsaved), sign-off, and the D20 edit-undoes-sign-off confirmation.

  **CP6b found a real ordering trap, fixed in the same PR.** Drafting comments
  after signing off returned "Nothing to draft — 3 already signed off", which is
  the server behaving correctly (sign-off freezes the comment along with the
  marks) and a useless thing to learn by pressing a button. Two fixes, both
  copy, no behaviour change: the comments screen now states up front how many
  students are frozen — and disables drafting entirely when all are, pointing at
  the mark edit that would undo the sign-off — and the sign-off confirmation on
  the mark sheet now says it freezes comments and to write them first. **The
  workflow is comments first, sign-off last**, and both screens now say so.
  CP6b's own device pass is still outstanding: nothing has yet drafted or
  accepted a comment from the phone.

### Out of scope for CP6

Owner/admin score entry on the phone (web `/gradebook`, #306 — admins are not in
`teacher-scope`, so it belongs to CP4's planning); recompute positions (D22);
form-teacher overall comments (`PATCH /report-cards/:id` — the natural slice
after CP6b); report card build, approve and release; past terms; subject-period
attendance; removing a saved mark (D21); any offline or queued write.

---

## CP7 — finishing the teacher (plan-first, for review 2026-09-20)

**Why, in the user's own words:** *"most teachers in Nigeria don't have a
laptop — school owners may have."* That reframes the web-only line for this
role. CP6's split assumed a teacher could reach a desk for the heavy work;
for this market that assumption is wrong, and a feature a teacher cannot reach
from a phone is a feature they do not have. CP7 therefore aims at **a teacher
who never opens the website at all**.

The web-only list in this document's header is unchanged: it covers money,
identity and school configuration, and nothing in CP7 touches those.

### Scope, in build order

Ordered so half-built jobs are finished before new ones start.

| # | Feature | Endpoints (all existing) | Permission (teacher holds) |
|---|---|---|---|
| 1 | Form teacher's overall comment | `GET /report-card-comments/form`, `POST …/form/generate`, `PATCH /report-cards/:id` | `report-card-comment.generate`, workflow guard |
| 2 | Back-dated attendance | `GET /attendance/register?date=`, `POST /attendance/mark` | `attendance.mark` |
| 3 | Class list | `GET /teacher-scope/roster` | teacher scope |
| 4 | Lesson notes — generate, edit, quiz | `GET/POST /lesson-plans`, `POST /lesson-plans/:id/quiz`, `PATCH /lesson-plans/:id` | `lesson-plan.*` |
| 5 | Curriculum — list, paste, upload, review, delete | `GET/POST /curriculum/documents*` | `curriculum.read/upload/delete` |
| 6 | Profile | `GET/PATCH /teacher-profiles/me` | `teacher-profile.self.*` |
| 7 | Timetable + calendar | `GET /timetable*`, `GET /calendar*` | existing reads |

**No server change is expected**, on the CP2/CP3/CP6 precedent. If
implementation finds itself wanting one, that is a signal to stop and re-plan
rather than widen scope quietly.

### The three hard parts

**A. The two-minute lock versus long-form writing (D24).** CP6's D19 store
exists because the lock unmounts a screen and discards unsaved marks. A lesson
note is far worse: ten editable sections of up to 20,000 characters each,
typed on a phone, possibly over several sittings. Every CP7 text surface —
form comment, lesson note sections, curriculum paste box, profile fields —
routes through the same in-memory draft store, extended with a namespace per
surface. Still never written to disk (CP1), still wiped at the principal
boundary. **An app kill still loses the draft**, which was acceptable for a
mark and is NOT obviously acceptable for a 2,000-word lesson note — so D24
asks whether lesson notes need on-disk drafts, which would reopen CP1's
never-persist rule for the first time.

**B. Generation takes 10-30 seconds, synchronously (D25).** Unlike report-card
comments, `POST /lesson-plans` is a blocking Sonnet call — web cycles progress
lines through it. On a Nigerian mobile network that is longer, and if the
teacher backgrounds the app mid-wait the request may be killed by the OS with
the school's budget already spent. Options: (i) mirror web's progress lines and
accept the risk; (ii) ask for a queued/polled variant, which IS a server
change; (iii) keep it synchronous but make a duplicate generation idempotent
per (topic, class, subject) so a lost response can be recovered without paying
twice. **Recommendation: (i) for the first pass, with (iii) measured before
committing to it** — the same evidence-first move D16 settled on.

**C. Curriculum upload from a handset (D26).** The web path is a 10 MB file
picker. A phone-first teacher is more likely to have a photo of a syllabus than
a PDF of one, and **the server parses documents, not images — there is no OCR
on this path**. CP7 therefore ships the *paste* box first (already a
first-class endpoint, and the easier one on a phone), plus a document picker
for real PDF/DOCX files. **Photographing a syllabus is explicitly out of
scope** and must be said on screen, not discovered: a teacher who attaches a
photo and gets a parse failure will conclude the feature is broken.

### Decisions for review

- **D24 — SETTLED 2026-09-20 by default, not by argument.** Lesson-note drafts
  stay IN MEMORY for the first pass and the screen says so plainly. Not
  separately approved; it stands because nothing yet shows the loss is real.
  Revisit on usage, and treat any report of lost work as the evidence that
  reopens it.
- **D25 — SETTLED 2026-09-20: synchronous, with a warning the teacher cannot
  miss, and a cancel they control.** The approval was conditional — *"if
  background job can't be enabled"* — so record honestly that it CAN be, and is
  not being done yet. `POST /lesson-plans` blocks for 10-30 s on a Sonnet call,
  and the AI queue that would carry it already exists (it runs report-card
  comments and parent summaries). Making generation queued means a new job
  type, a worker processor and a status read: a real server slice, and CP7's
  own rule is to stop rather than widen scope quietly. So the first pass is
  synchronous and the screen must:
  1. **Warn before starting**, not after — plain words, on the button's own
     screen: do not leave this screen or switch apps until the note is ready.
  2. **Offer Cancel** during the wait, which aborts the request and says the
     school may still have been charged for the work already done.
  3. **Show progress that reads as work**, as web does, so a long wait is not
     mistaken for a hang.
  **Queued generation is the preferred end state** and is logged as the next
  slice after CP7, not abandoned.
- **D26 — SETTLED 2026-09-20, approved as recommended.** Paste box first, file
  picker second, photographs explicitly excluded and said so ON SCREEN rather
  than discovered through a parse failure.
- **D27** — does CP7 add bottom-tab navigation? The staff home is a list of
  cards, which does not survive seven more surfaces. *Recommendation: yes, but
  in the UI pass that follows CP7, not inside it.*

### D14 — SETTLED 2026-09-20, in CP7's first PR

CP2 railed mobile marking to the server's today and said plainly that it was a
pilot default, not the policy. The policy is now decided, and by a market fact
rather than a technical one: **most Nigerian teachers have no laptop**, so
"use the web teacher portal to correct an earlier day" is not a workaround but
a refusal. The window is therefore **parity with web** — any past date the
server accepts, no future date.

Three things did not change, which is why this widens nobody's authority: the
server was always the boundary and is untouched (it accepts any past in-term
date from a holder of `attendance.mark`, and rejects future dates itself);
"today" still comes from the server's clock, never the handset's; and a
correction is still audited and still visible through the register's
last-marked stamp. What is lost is the pilot property that the phone could not
touch history — worth having while the policy was open, not worth a teacher
being unable to fix Friday.

The screen names the day it is marking ("Today", "Yesterday", or the date) and
warns when it is not today, so a back-dated register cannot be mistaken for
the current one.

### Gates

Each numbered feature above ships behind CP6's gate ladder — no-server-change
proof against real Postgres, then screen behaviour, then CP1's security
invariants (every query key `["staff", schoolId, userId, …]`, nothing
persisted, drafts wiped at the principal boundary), then real-DB conformance
with positive/control pairs, then a real device.

**One standing rule, from the bug CP6b found:** any feature here that enqueues
work must have at least one test that hands a real job to real BullMQ. Mocked
queues are how three AI features shipped broken.

### CP7 build status (2026-09-20)

All seven items implemented. **A teacher can now do their whole week from a
phone without opening the website**, which is what CP7 set out to do.

| # | Feature | State |
|---|---|---|
| 1 | Form teacher's overall comment | built |
| 2 | Back-dated attendance (D14 settled) | built |
| 3 | Class list + roster search | built |
| 4 | Lesson notes: generate, edit per section, quiz | built |
| 5 | Curriculum: paste, file picker, confirm, remove | built |
| 6 | Profile: specialty and qualifications | built |
| 7 | Timetable + calendar | built |

Two shared-client bugs were found by CP7's own specs, both of which would have
shipped invisibly:

1. **`apiFetch` wrapped an `AbortError` as `ApiNetworkError`**, so pressing
   Stop during a lesson-note generation would have told the teacher their
   network had failed. Aborts now reach the caller unchanged, which is what
   makes D25's Stop button honest.
2. **`apiFetch` JSON-stringified every body**, so a multipart upload would
   have arrived as `"{}"`. FormData now passes through untouched, with
   Content-Type left to the runtime so the multipart boundary is present —
   setting that header by hand omits the boundary and the server finds no
   fields at all.

`expo-document-picker` is a NEW NATIVE dependency (SDK-matched, `~57.0.2`).
It cannot be exercised by `expo export`, only by a real build: the first EAS
build after this change is the check, and `apps/mobile/BUILD.md`'s warning
applies — a local pass is not evidence about EAS.

The timetable screen opens on ONE DAY, on the server's today, and expands to a
WEEK on request (added 2026-09-20 at the maintainer's ask). Day answers "what
am I teaching today" with room for the class, period label and co-teachers;
week answers the planning question — "am I free Thursday afternoon" — and a
full week cannot fit a phone's width at a readable size, so it scrolls
SIDEWAYS with the period times pinned in the first column and each cell cut
back to subject and class. Tapping a day heading in the week drops into that
day in full. Only LESSON slots get a week row: a bell schedule carries break
and assembly slots too, and spending a row on each pushes the lessons off
screen. It reads the narrow `timetable.own.read` surface (own lessons plus read-only form-class grids); the whole-school
builder grid is a different permission and stays on web with owner/admin. The
calendar uses the STAFF endpoint rather than the portal one the family screens
use: same shape on the wire, different session and permission, and reusing the
portal route with a staff token would work by accident today and break the
moment either surface's rules change.

**The calendar is a MONTH GRID** (2026-09-20, same ask), in the shape people
already know from their phone: dates laid out as weeks, a dot on any day
something happens, and the day's events listed on tap. A list answers "what is
next"; someone looking at a calendar is usually asking "what is happening ON a
date", and a list makes them count. Colour carries category but never alone —
the day list carries the words, because a legend nobody remembers is not
information. The fetch window follows the month on screen rather than a fixed
six-month span, so paging back to last term is ordinary, and each month caches
in its own right. The grid maths lives in `src/lib/calendar/month-grid.ts`
with its own spec: a month starting on Sunday, a leap February and a multi-day
entry appearing on every day it covers are all the kind of thing that breaks
silently and is noticed by a teacher, not by a test, unless it is pinned.

**Every role's calendar is now the same component** (2026-09-20, same ask):
teacher, guardian and student all render `CalendarView` — month grid by
default, with the old list kept as a second view. The list is not dead weight:
it answers "what is coming up" without tapping through days, and it reads
aloud in order for a screen reader, which a grid does not. The three screens
differ only in which endpoint feeds them, which is a session and permission
matter, not a presentation one.

**A CLASS timetable is now a table, and a TEACHER's own timetable is not**
(2026-09-20, same ask, and the distinction is the maintainer's). They are
different questions:

- A **class** timetable — what a student, a guardian, or a form teacher asked
  by their class is reading — is dense by definition, every period filled, and
  the alignment IS the information: "what follows Maths on Tuesday" is
  answered by reading down a column. It renders as `TimetableGrid`: days
  across, periods down, times pinned in the first column, scrolling sideways.
  Break and assembly rows are KEPT and span the full width, because on a class
  timetable break is part of the shape of the day, and dropping it would make
  the periods either side look adjacent when they are not.
- A **teacher's own** lessons are scattered across classes and are mostly empty
  space, so the same grid would be mostly blank. That stays day-first, with the
  week view as the planning answer.

`TimetableGrid` therefore backs the student screen, the guardian's view of a
child, and the form-class section of a teacher's own timetable. The family
screens keep the per-day list as a second view (`FamilyTimetable` owns the
toggle) for the same accessibility reason the calendar list survives.

Nothing in CP7 has run on a device yet.

### Printing a lesson note (2026-09-20)

Asked for after the first device pass: a teacher must be able to print or send
a lesson note, and **as ONE document, not section by section**. A Nigerian
lesson note is submitted as a single sheet for a head teacher to read and
sign; handing someone ten fragments is handing them a form to assemble.

On screen the note stays split into editable sections, because that is how it
is written and saved. On paper the sections become headings in one continuous
flow — `page-break-after: avoid` on the headings so none is orphaned at the
foot of a page, and deliberately NO `page-break-before`, which would print ten
near-empty pages. Empty sections are omitted rather than printed as bare
headings, and pre-v2 notes still print their legacy `introduction`/`activities`
sections so an older note comes out whole. The document carries the school,
teacher, subject, class and duration, and ends with signature lines, because
this is a document somebody signs.

Two actions, both rendering the same HTML: **Print** (the system dialog, which
on Android is also the Save-as-PDF path) and **Share as PDF**
(`printToFileAsync` then the share sheet, so a note can go by WhatsApp or
email — which is how a note actually reaches a head teacher).

**What prints is what is SAVED.** Unsaved section text would otherwise appear
on paper and then be lost with the next lock or app close, so the screen says
to save first rather than quietly including drafts.

The HTML builder (`src/lib/staff/lesson-note-document.ts`) is pure and
separately tested: section order, omission of empties, escaping (a note saying
"x < y" must print as typed rather than vanish as a broken tag), the teacher's
own line breaks, and system fonts only — a print stylesheet that reaches for a
web font fails quietly on a phone with no data.

`expo-print` and `expo-sharing` are NEW NATIVE dependencies, so like
`expo-document-picker` they cannot be exercised by `expo export`; the next EAS
build is the check.

### The curriculum upload failure (2026-09-21)

On the first build with the document picker, **every** curriculum file upload
failed with "Your phone couldn't reach the server", repeatedly, while every
other screen on the same phone worked.

Diagnosed from evidence rather than guessed:

- The live API was up and answering on every curriculum route — an
  unauthenticated probe of `POST /curriculum/documents/upload` returned `401
  MISSING_BEARER_TOKEN`, which proves the route exists and is reachable.
- So the failure was **on the handset**, inside React Native's `fetch` +
  `FormData` path, which is known to be unreliable for real files on Android.
- **The app mislabelled it.** `apiFetch` maps any transport failure to
  `ApiNetworkError`, and the screen printed the "find signal" message — so a
  teacher with a working connection was told their signal was the problem, and
  the actual native reason was thrown away.

The fix moves file upload onto Expo's NATIVE uploader,
`FileSystem.uploadAsync` from `expo-file-system/legacy` (OkHttp on Android,
URLSession on iOS). It streams from disk in native code and never passes the
file through JavaScript. Three details that matter:

1. `src/lib/api/native-upload.ts` is kept OUT of `client.ts`, which stays free
   of native imports so it remains testable under Node.
2. Response handling was extracted into one `interpretResponse`, shared by
   `apiFetch` and the native upload — so an upload refusal carries the same
   error code, message and 401 session teardown as every other request. A
   second copy would drift, and the drift would only ever show on the one
   screen that uploads.
3. The native error is **kept** and shown on screen as "Details: …". If this
   still fails on a device, the next fix starts from a screenshot, not a guess.

`expo-file-system` was already inside the build as a dependency of `expo`, but
not resolvable from `apps/mobile` under pnpm's isolated linker, so it is now a
direct dependency. **The upload is unproven until a device runs it** — the
spec mocks the native module wholesale, which proves the request is built
correctly and the response is interpreted correctly, not that Android accepts
it.

### The curriculum crash (2026-09-20) — and why nothing caught it

The first device build crashed on the curriculum screen seconds after it
loaded. `GET /curriculum/documents` returns `{ documents, usage }`; the binding
declared `CurriculumDocumentDto[]`; the screen called `.map` on the envelope,
and a throw during render takes the app down rather than showing an error.

Three of the four curriculum bindings had the wrong response type — `list`,
`getOne` and `approve`. Every OTHER staff binding was re-checked against its
controller's declared return type and is correct.

**Why it was invisible until a phone ran it:**

- `apiFetch<T>` is an **unchecked assertion about the wire**. Typecheck
  believes whatever the binding declares, so a wrong annotation is not a type
  error anywhere in the repo.
- The original spec asserted the request URL and stubbed the response as `[]`
  — **the very shape the bug assumed**. A fixture invented by the client proves
  the client agrees with itself, not with the server.
- `expo export` compiles the screen; it never runs it against data.

**The rule this establishes for any new binding:** the spec's fixture is typed
as the API's OWN response type, imported from `@school-kit/types`. Then a
controller shape change fails `pnpm typecheck` in the spec rather than failing
on a teacher's phone. `staff-curriculum.spec.ts` is the worked example, and the
screen additionally reads `data?.documents ?? []` so a future shape change
degrades to an empty list rather than a crash.

### Out of scope for CP7

Everything in the header's web-only list; report card build, approve and
release; subject-period attendance unless the school has opted in; the owner
and admin dashboard (CP4); and the staff UI visual pass, which follows CP7 as
its own piece of work.

---

## CP8 — making the staff surface look like software (plan-first, approved 2026-09-21)

**The ask, verbatim:** *"the app doesn't look professional. I want to redesign
the UI and make it look like a modern software with good aesthetics; just
arranging the stuffs orderly on the page, a dashboard just like the web
version with shortcuts/icons on the main page."*

That is a fair description of what shipped. CP2 through CP7 added ten staff
surfaces to a home screen that was a vertical list of cards with text buttons,
because each checkpoint added one card and no checkpoint owned the whole. The
result works and reads as a prototype.

**This is a presentation pass. No endpoint, permission or data rule changes.**
If implementation finds itself wanting a server change, that is a signal to
stop and re-plan — the same rule every checkpoint here has followed.

### Approved shape (2026-09-21)

- **Dashboard + bottom tabs.** A home dashboard of icon shortcuts, plus a
  persistent tab bar for the handful of destinations a teacher opens daily.
- **Staff first**, with the shared components built so the parent and student
  screens follow in a second pass.
- **A short "today" strip** on the dashboard: the next lesson, and whether
  today's register is marked. Both come from data the app already fetches
  (`/teacher-scope/me/timetable`, `/attendance/register`) — no new endpoint,
  and nothing new that can break.

Rich dashboard statistics (attendance rates, collection charts) were considered
and deliberately deferred: they need teacher-facing aggregate endpoints that do
not exist, which is a server slice, not a paint job.

### What the design is, concretely

The brand already exists and is already wired into `src/theme/tokens.ts` —
Paper `#F7F5EF`, Ink `#13262E`, Deep Emerald, Gold Spark, Fraunces for display
and Hanken Grotesk for text, matching `apps/web`. **Nothing about the palette
or the typefaces changes.** What is missing is everything above the token
layer: hierarchy, spacing rhythm, iconography, and components that repeat.

| Piece | Today | CP8 |
|---|---|---|
| Home | A list of cards, each with a text button | Greeting, today strip, icon shortcut grid |
| Navigation | Push and back, ten deep | Tab bar for daily destinations; the rest reached from the dashboard |
| Icons | None anywhere | `@expo/vector-icons`, one family, used consistently |
| Screen headers | Ad-hoc `<Heading>` + `<Body muted>` per screen | One `ScreenHeader` with title, subtitle and optional action |
| Loading | "Loading…" text | Skeletons that hold the shape of what is coming |
| Empty states | A `Notice` | `EmptyState` with an icon, a sentence and the action that resolves it |
| Lists | Cards of varying padding | One `ListRow`, consistent height and touch target |

### Decisions

**D28 — one icon family, and icons never carry meaning alone.** A single set
(`Ionicons`) rather than a mix, and every icon sits beside its label. An icon
grid where the picture IS the label fails the person who does not recognise the
metaphor — which, for an audience that includes teachers new to smartphones, is
the whole point of this work.

**D29 — the tab bar carries DAILY destinations, not all ten.** Home, Marks,
Register, Notes, and More. Everything else stays reachable from the dashboard
grid and by direct navigation; `href: null` hides a route from the bar without
removing it. A tab bar that lists everything is a menu, and a menu in a bar is
harder to read than a grid on a page.

**D30 — the today strip must degrade to nothing.** A teacher with no timetable
published, or no current term, or no form class, sees the dashboard with no
strip rather than a row of "—" placeholders. An empty state that pretends to be
data is worse than an absent one.

**D31 — `@expo/vector-icons` is a font, not a native module.** It ships with
Expo and loads through `expo-font`, which the app already uses for Fraunces and
Hanken. Unlike `expo-document-picker`, `expo-print` and `expo-sharing`, it
needs no new native code — so `expo export` remains meaningful evidence for
this checkpoint, and the icon work is not gated on an EAS build.

### Gates

1. **Components before screens.** `ScreenHeader`, `ActionTile`, `StatTile`,
   `ListRow`, `EmptyState` and `Skeleton` land first, with the theme tokens
   they use, so no screen invents its own spacing.
2. **The dashboard**, including the today strip and its absent states.
3. **The tab bar**, with every non-tab staff route still reachable and no
   route lost — a redesign that strands a screen has removed a feature.
4. **Every staff screen re-laid out** on the new components, with no change to
   what any of them fetches or writes.
5. **Typecheck, lint, the full suite and an Android `expo export`** — and,
   per D31, an export is real evidence here.
6. **Real device.** Layout is the one thing a bundle cannot prove, and this
   checkpoint is entirely layout.

### CP8 build status (2026-09-21)

Gates 1-5 done; Gate 6 (real device) open.

Every staff screen now sits on the shared vocabulary: `ScreenHeader`,
`SectionHeader`, `ActionTile`/`TileGrid`, `StatRow`, `ListRow`, `EmptyState`
and `Skeleton`. Three rules fell out of doing it, and they are what stop the
next screen drifting again:

1. **A pushed screen's native bar carries the BACK BUTTON and no title**; the
   page states the title in the serif face. Printing the same words twice,
   inches apart, is most of what made these screens read as unfinished.
2. **A section landing has no native bar at all** — the tab bar is its context.
3. **"Loading…" is replaced by a skeleton that holds the shape** of what is
   coming, so the screen does not jump when content lands, and **every empty
   state names its reason and, where there is one, the action** — "nothing yet"
   alone leaves the reader to guess whether that is normal, their fault, or a
   failure.

What deliberately did NOT change: any query, mutation, permission check, or the
meaning of any message. The collections figures keep their serif display
numerals, matching the web dashboard's KPI treatment. Error states keep
`CenteredMessage` with a Try again button — a failure is the one case where
stopping the reader is right.

`staff-navigation.spec.ts` reads the real `app/staff` directory against the
real layout, so a future surface that forgets the tab bar fails CI rather than
becoming a stray tab. That spec is the standing answer to how the old home
screen grew into a ten-card list.

### Out of scope for CP8

The parent and student screens (second pass, on the same components); dark
mode beyond what the tokens already give; animation; any change to what a
screen fetches, writes or refuses.

---

## CP4 — owner and admin on the phone (plan-first, approved 2026-09-21)

Teacher-facing work is complete (CP6-CP8). CP4 is the next role in the agreed
order, and was always "the owner/admin operational dashboard and web
handoffs". The 2026-09-17 widening applies here too: an administrator who is
phone-first should rarely need the website — but the web-only list in this
document's header (money, identity, school configuration, bulk work) is
unchanged, and it is exactly what the handoff exists for.

### Approved scope (2026-09-21)

| Area | Endpoints (all existing) | Permission |
|---|---|---|
| School overview | `GET /dashboard?termId=` | `dashboard.read` |
| Report card approval | `GET /reports/completeness` (per-arm pipeline), `GET /report-cards?termId&classArmId`, `POST /report-cards/arm/approve`, `/arm/release`, `/arm/reopen` | `report-card.principal-approve`, `.release`, `.reopen`, `.read` |
| Student records | `GET/POST /students`, `GET/PATCH /students/:id`, `POST /students/:id/withdraw`, `/graduate` | `student.read/create/update/deactivate` |
| Reports | `GET /reports/completeness`, `GET /reports/teacher-activity` | `reports.completeness.read`, `reports.teacher-activity.read` |
| Web handoff | a plain link to the website | none |

**Deferred, by decision:** announcements (they do not exist anywhere in the
system; a new feature for web AND phone with its own sending rules and SMS
cost, so it gets its own plan), and automatic sign-in on the web handoff (a
one-time login token is a security-sensitive server change and needs its own
plan and review). The handoff ships as a plain link; the admin signs in on the
website if their browser session has lapsed.

### The bug CP4 has to fix first

**A pure owner or admin who signs in today sees "We couldn't load your
classes".** The CP8 dashboard calls `GET /teacher-scope/me` for every staff
user, and `TeacherScopeService.getMyScope` gates on the `teacher` ROLE
(`assertUserActiveAndHasOneOf(["teacher"])`) — a deliberate 403 for anyone
else. `/teacher-scope/me/timetable` does the same. Holding `*` permissions does
not get an owner past it, because the gate is a role check, not a permission
check.

### Decisions

**D32 — the dashboard is role-aware, and the teacher band is gated on the
`teacher` ROLE.** This looks like it breaks the "permission, never role name"
rule every tile has followed. It does not: the rule exists so the phone never
offers what the server would refuse, and the server's gate on
`/teacher-scope/*` IS a role check. Mirroring the server's own gate exactly is
the rule applied, not broken. Everything else stays on permissions. A person
holding both roles (an owner who also teaches) sees both bands.

**D33 — releasing report cards is confirmed, and says who will see them.**
Release is the moment parents can read a child's results, and it freezes the
card (`released-guard.ts`). The confirmation names the class and the number of
cards, and says plainly that parents and students will see them. Approve is
lighter — it is internal — but still confirmed. Reopen requires a reason,
because the server requires one (`reportCardArmReopenSchema`) and the audit
trail is its whole point.

**D34 — the report-card overview is ONE call.** `GET /reports/completeness`
already returns a per-arm pipeline (`reportCards.rows`, keyed by arm id, with a
count per status). The alternative — one board request per arm — is N round
trips on a Nigerian mobile network to draw a list. The per-arm board is fetched
only when an admin opens one arm.

**D35 — teacher activity is AUDITED on every read, and the phone says so.**
`GET /reports/teacher-activity` writes an audit row per call (§16 D23): it is a
per-person view of named staff. The phone fetches it only when that screen is
opened, never in the background or on the dashboard, and tells the admin the
view is recorded — an admin browsing a colleague's activity should know that
browsing is itself logged.

**D36 — the web handoff is a plain link, and a MISSING URL is an error, not a
default.** The website address is build-time config (`EXPO_PUBLIC_WEB_URL`).
This codebase has shipped the same class of bug four times — config added to
the repo and never set on the real environment (`STORAGE_DRIVER`,
`PORTAL_BASE_URL`, a recreated Vercel project's vanished variables,
`RESEND_API_KEY`). So there is NO localhost fallback in a production build: if
the variable is absent the button explains that the website link is not
configured, rather than silently opening localhost on a head teacher's phone.

### Shipping order

Four PRs, each reviewable alone, each merged before the next begins:

1. **CP4a** — role-aware dashboard (D32, the owner bug), school overview KPIs,
   and the web handoff (D36).
2. **CP4b** — report card approval (D33, D34).
3. **CP4c** — student records.
4. **CP4d** — reports, including audited teacher activity (D35).

### CP4 build status (2026-09-21)

All four parts implemented on one branch, as four reviewable commits. **This
deviates from "four PRs, each merged before the next begins"** — the parts
were built back to back while the previous PR's CI ran, and stacked PRs in
this repository need their bases deleted by hand to retarget
(see the stacked-PR note in the maintainer's working notes), so they ship as
one PR with the commits kept separate for review.

| Part | State |
|---|---|
| CP4a — role-aware dashboard, school overview, web handoff | built |
| CP4b — report card approval | built |
| CP4c — student records | built |
| CP4d — reports + audited teacher activity | built |

**The pattern CP4 kept finding: the admin surfaces are gated on ROLE.**
`TeacherScopeService` (teacher), `StudentsService`, the report-card workflow
and `CompletenessService` (owner/admin) all call `assertUserActiveAndHasOneOf`
in addition to their `@Permissions` guard. So every CP4 gate checks the role
AND the permission — the role because the service refuses without it, the
permission because the guard does. `isSchoolAdmin` / `isTeacher` in
`src/lib/auth/roles.ts` are the only role checks in the app, each documented
against the service line it mirrors.

Two consequences worth recording:

- A teacher holds `student.read` (for their own class lists) but is refused
  by `/students`. A Students tile gated on the permission would have been a
  broken tile for every teacher in the school.
- A custom role granted `report-card.principal-approve` alone would still be
  refused by the workflow service. The approvals tab therefore needs both.

Nothing in CP4 has run on a device, and **no device pass has ever signed in as
an owner** — that is the first thing CP4's Gate 6 must do.

### Gates

The CP8 ladder, per PR: components before screens; screens on the CP8
vocabulary; `staff-navigation.spec.ts` kept green (a new section must be
declared); every new binding's spec fixture typed as the API's OWN response
type (the curriculum-crash rule); typecheck, lint, full suite and an Android
`expo export`; and a real device, which for CP4 means signing in as an OWNER —
the one role no device pass has yet exercised.

---

## CP9 — the admin's routine week, and money, on the phone (plan-first, approved 2026-09-21)

**The ask:** *"confirm that all basic, repetitive tasks can be done on the app,
and the website would be needed not too often."* An audit against the
website's admin sidebar found they could not — eight routine jobs still needed
the website. The maintainer chose to move all eight.

### This REVERSES a recorded decision, deliberately

The module header has said since 2026-08-24 that "payment recording or
approval, refunds" stay web-only, and CP3's D17 excluded payment links for the
same reason. **That line is now moved for four money jobs**, by the
maintainer's decision on 2026-09-21, on the reasoning that recording payments
is the most frequent job in a Nigerian school office and for a phone-first
school the line was costing more than it protected. What stays web-only is
unchanged in spirit: **refunds, payroll, BVN, fee and discount SETUP, invoice
generation for a whole class, staff and roles, school settings, bulk work.**
The header is amended to say so.

### Scope

| Part | Job | Endpoints (existing unless noted) |
|---|---|---|
| CP9a | Link a parent to a student; invite, resend, revoke portal access | `POST /students/:id/guardians`, `.../guardians/new`, `POST /guardians/:id/invite` (+ `/resend`, `/revoke`) |
| CP9a | Place a student in a class, or move them | `POST /enrollments`, `PATCH /enrollments/:id` |
| CP9a | Add, edit, remove a school event | `POST/PATCH/DELETE /calendar/events` |
| CP9a | Build a class's report cards; write the principal's note | `POST /report-cards/arm/build`, `PUT /report-cards/arm/principal-note` |
| CP9b | Record a cash/POS/transfer payment | `POST /payments/manual` **+ a server change (D37)** |
| CP9b | Send fee reminders | `POST /finance/debtors/remind` |
| CP9b | Share an invoice's payment link (WhatsApp) | `POST /invoices/:id/payment-link` |
| CP9b | Log an expense, with a receipt photo | `POST /expenses`, `POST /expenses/:id/receipt` |

**CP9a needs no server change. CP9b needs exactly one**, and it is a
production migration on the money path, so it is called out on its own.

### D37 — recording a payment must be idempotent, and today it is not

`recordManualPaymentSchema` carries `invoiceId, amount, method, paidAt,
reference?` — **no idempotency key**, and `reference` is optional free text,
not unique. So: a bursar records ₦50,000, the mobile network drops the
response, the bursar taps again — and the school has recorded ₦100,000
received for ₦50,000 of cash. The website carries the same flaw, but a phone on
a Nigerian mobile network meets a dropped response far more often, and the
CP2 rule (no queue, no automatic retry) means the human retry is the ONLY
retry, which makes it the likely one.

**The fix (server):**

- `recordManualPaymentSchema` gains an optional `idempotencyKey` (a UUID the
  client generates once per payment FORM, not per tap).
- `payments.idempotency_key` — nullable TEXT, with a partial unique index on
  `(school_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Nullable so
  every existing row and every existing web caller is untouched.
- `FinanceService`/`PaymentsService` looks the key up first inside the same
  transaction; a repeat returns the ORIGINAL payment with a flag saying it was
  a repeat, writes NO second payment, NO second audit row, and does NOT
  recompute totals again. A key reused with a DIFFERENT amount or invoice is a
  409, never a silent success.
- Proven against real Postgres: same key twice → one row; concurrent same-key
  requests → one row (the unique index, not the lookup, is the guarantee);
  different key → two rows; same key, different amount → 409; RLS still scopes
  the key to the school, so another school's key can never collide.

**Why a key and not "dedupe identical payments":** two genuine ₦5,000 cash
payments for the same invoice on the same day are legitimate and common
(instalments). Only the CLIENT knows whether a second request is a second
payment or a repeat of the first, so only a client-generated key can tell
them apart.

Because there is no staging tier, this migration runs against the database
real schools use on the first deploy after merge. It is additive (one nullable
column, one partial index), which is the safest shape a migration can take.

### D38 — the money safeguards on the phone

1. **Amounts are entered in naira and converted to kobo by exact string
   arithmetic, never floating point.** `"50,000.50"` → `5000050`. A value with
   more than two decimal places, or anything that is not a number, is refused
   rather than rounded.
2. **Confirmation shows the amount in figures AND in words** ("₦50,000.00 —
   fifty thousand naira"), with the student, the invoice, the method and the
   date. A misplaced zero is the most likely costly error on a phone keyboard,
   and words catch it where digits do not.
3. **The server's figures are what is shown afterwards.** Balances come back
   from the API; the phone computes no fee, discount or balance (CLAUDE.md
   money rule).
4. **One idempotency key per form (D37)**, so a lost response is safe to retry
   — and the screen says "Checking whether that payment went through…" rather
   than inviting a blind second tap.
5. **Who may:** the same permissions the website requires (`payment.record`,
   `finance.debtors.remind`, `expense.create`), plus whatever role the service
   itself checks. No new permission is created, and none is widened.
6. **Reminders show their cost before sending**: how many families, and that
   each is an SMS the school pays for.

### Shipping order

CP9a first (no server change), then CP9b beginning with D37 alone as its own
PR — server change, migration and real-DB specs, reviewed and merged BEFORE any
phone screen can record a payment. The phone screens follow in the next PR.

### D39 — moving a placed child to another class is held back (found building CP9a)

`PATCH /enrollments/:id` accepts a new `classArmId`, but it moves only the
enrolment row. The child's marks (`assessments.class_arm_id`), report card
(`report_cards.class_arm_id`) and past registers keep the OLD class, so after a
move the new class's gradebook does not show the marks already entered, and
the report card stays with the old class's batch. The website never offers a
move (its enrolments tab only creates a placement for a term), so this has not
bitten anyone yet. The phone would be the first surface to offer it.

**Not built.** The proposed fix is a server guard: refuse a class change
(409) once the child has any mark or report card in that term, so the common
real case — "I put her in JSS1A, I meant JSS1B", fixed the same day — works,
and the dangerous one is refused rather than silently splitting a child's
record. It is a server change, so it waits for sign-off like D37.

### CP9a status (2026-09-21)

Built, on the phone, for owners and admins (role + permission, as the
services check):

- **Calendar:** add, edit and remove school events. National holidays and
  term dates are never offered for editing. Edits are read fresh from
  `/calendar/events` and send only the changed fields.
- **Report cards:** Build/Rebuild while every card is a draft (mirrors
  `ARM_NOT_DRAFT`); the principal's note while every card is form-reviewed
  (mirrors `editPrincipalNote`). PDF rendering stays a website job.
- **Parents:** search-first linking (siblings share one parent record), add a
  new parent as the fallback, and invite/resend/cancel parent-app access
  exactly per the server's portal status. The invitation link is kept only in
  screen memory and shared deliberately by the admin, with a warning.
- **Placement:** place a child who has no class this term, with an explicit
  choice of class — nothing pre-picked. Moving is held back (D39).

Shared form pieces (`components/form.tsx`) now back every CP9 form.

### D37 — status (2026-09-21): approved and built

Approved by the maintainer 2026-09-21. Shipped on its own, server-only, before
any phone payment screen, as planned:

- `payments.idempotency_key` (nullable TEXT) + unique index
  `(school_id, idempotency_key)` — migration
  `20260921120000_payment_idempotency_key`. A plain composite unique rather
  than a partial one: Postgres admits any number of NULLs, so it behaves the
  same and Prisma can express it, which keeps the schema drift-free.
- `recordManualPaymentSchema.idempotencyKey` (optional UUID). The response
  (`ManualPaymentResultDto`) carries `replayed`.
- Proven against real Postgres in `payments.service.spec.ts`: same key twice →
  one payment and one audit row; four concurrent same-key requests → one
  payment; different keys → separate payments; no key → unchanged behaviour;
  same key with a different amount or method → 409 `IDEMPOTENCY_KEY_REUSED`;
  the same key at two schools → two independent payments. The race test was
  mutation-checked: with the unique-violation recovery disabled it fails on
  the index, so it genuinely exercises the database guard.

The website does not send a key yet; it keeps its previous behaviour exactly.

### D39 — moving a child between classes: decided and built (2026-09-21)

**Correction to the earlier finding.** Entered marks (`assessment_scores`)
are keyed by student, subject and term — NOT by class — so they already
follow a child to a new class's gradebook. What stays on the old class is
the per-subject `assessments` row (`class_arm_id` is denormalised there for
position ranking) and the report card. So a move does not have to erase any
teacher's work.

**Maintainer's decision (2026-09-21):** admins may move a child mid-term,
behind a security check — a confirmation, and the admin's own password when
records would change. Not for end-of-session promotion, which is its own flow
and does not come here.

**Built — `POST /enrollments/:id/move`** (`enrollment.update` + owner/admin
role, throttled 10/min):

- No marks and no report card → moves on confirmation alone.
- Marks or a report card → 409 `MOVE_NEEDS_PASSWORD` with
  `{ markCount, hasReportCard }` in `details`, so the phone can say exactly what
  will change; with `currentPassword` it re-verifies against the admin's own
  hash. A wrong password is **403** `PASSWORD_INCORRECT`, deliberately not 401,
  which the clients treat as "session over".
- In one transaction: the enrolment moves; the assessment rows move with their
  positions cleared (the next build re-ranks both classes); a DRAFT report
  card is discarded to be rebuilt. Marks are untouched.
- A report card past DRAFT → 409 `REPORT_CARD_IN_PROGRESS` (reopen first).
- Fees are never touched. If the class LEVEL changed and an invoice exists,
  the result carries `invoiceNeedsReview` for the bursar.
- One `enrollment.move-class` audit row: from/to class, counts, and whether
  the password path ran.
- `PATCH /enrollments/:id` with a new `classArmId` is now refused (409
  `ENROLLMENT_HAS_TERM_RECORDS`) once the child has records, so the old
  split-the-record path is closed. With no records it still works; no current
  caller sends `classArmId`.

### CP9b status (2026-09-22) — money on the phone, and moving a child

Built on the phone, behind D37/D38/D39:

- **Record a payment** (`payment.record`). One idempotency key per form; on
  confirm the exact request is frozen, and "Try again" after a lost reply
  resends it unchanged — the server replays the first payment rather than
  recording twice. While a request may have landed, the form is locked;
  "Start over" warns and makes a new key. Confirmation shows the amount in
  figures and words; the receipt number is shown afterwards, with a plain note
  when the result was a replay.
- **Fee reminders** (`finance.debtors.remind`): one family from their page, or
  every family, in batches of the server's 50, confirmed with a warning that
  texts are charged. Stops at the first failed batch and says some may have
  gone, rather than inviting a blind resend. The phone sends student ids only
  — the server looks up each family's contact.
- **Payment links** (owner/admin/bursar + `payment.read`/`payment.record`):
  make one, and share it on WhatsApp (wa.me with no recipient — the admin
  picks the chat). Shared only when LIVE and for exactly the current balance,
  the website's own rule.
- **Expenses** (`expense.create`): naira → kobo by exact string arithmetic;
  receipt from the camera, the gallery or a PDF, uploaded after the expense is
  saved and retried on its own if it fails. Expenses have no idempotency key
  yet, so a lost reply never offers a plain retry — the screen asks the admin
  to check first and makes them choose "save anyway". A key like D37's is the
  natural follow-up if this proves common.
- **Move a child to another class** (D39): confirmation always; the admin's
  password when the child has records, with what will change spelled out
  first. The password is held only in screen state and cleared as soon as
  the request settles.

Adds `expo-image-picker` (native — lands with the next APK build).
