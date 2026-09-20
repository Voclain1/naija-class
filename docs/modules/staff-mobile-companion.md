# Staff mobile companion

**Status:** approved 2026-08-24. CP1, CP2 and CP3 complete. CP1/CP2 device-gated and server-side verified against Virgo Fidelis (`docs/journal/2026-08-25.md`); CP3 complete — gates 0-4 verified and Gate 5 closed on device evidence (`docs/journal/2026-08-26.md`). **D16 is SETTLED: option (a) stands**, decided on a measured ~4-5 s cold open of which the term chain is only ~0.6-1.2 s. CP4 (owner/admin dashboard + web handoffs) not started.

This addendum supersedes only Phase 6's original “not a teacher mobile app”
boundary. Staff is one principal with existing role grants, not four new
principals. Native scope is teacher daily attendance, bursar collection
monitoring, and the owner/admin operational dashboard. Everything else uses a
fixed-origin browser handoff. Payroll, BVN, staff/role management, school
configuration, bulk imports, refunds, payment recording or approval, and 2FA
setup/disable remain web-only.

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
