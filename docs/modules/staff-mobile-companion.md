# Staff mobile companion

**Status:** approved 2026-08-24. CP1, CP2 and CP3 complete. CP1/CP2 device-gated and server-side verified against Virgo Fidelis (`docs/journal/2026-08-25.md`); CP3 complete — gates 0-4 verified and Gate 5 closed on device evidence (`docs/journal/2026-08-26.md`). **D16 is SETTLED: option (a) stands**, decided on a measured ~4-5 s cold open of which the term chain is only ~0.6-1.2 s. CP4 (owner/admin dashboard + web handoffs) not started.

This addendum supersedes only Phase 6's original “not a teacher mobile app”
boundary. Staff is one principal with existing role grants, not four new
principals. Native scope is teacher daily attendance, bursar collection
monitoring, and the owner/admin operational dashboard. Everything else uses a
fixed-origin browser handoff. Payroll, BVN, staff/role management, school
configuration, bulk imports, refunds, payment recording or approval, and 2FA
setup/disable remain web-only.

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
