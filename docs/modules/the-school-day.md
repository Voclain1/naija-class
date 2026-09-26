# The school day — absence alerts, homework, behaviour, and the reply path

**Status:** approved 2026-09-26. **Parts A, B and D built** — see the status
sections at the end. C not started.
**Asked for:** after the device pass, "plan for the number 3 above" — the four
things nobody has ever decided against, as opposed to the work deliberately
kept on the web (bulk/high-trust) or waiting on Phase 7's vendor choice (AI).

## Why these four, together

Every role can do their daily work phone-first. What the app still cannot do
is carry the *school day itself*: a child who did not arrive, the work due
tomorrow, a note about conduct, and a parent's reply. Three of the four are
information a Nigerian school already produces on paper or by phone call; the
fourth is a product decision that should be made deliberately rather than by
drift.

They are planned together because they share one risk — **notification
fatigue** — and one constraint: N3, which keeps names, grades and amounts out
of every payload. Decided one at a time, each would reasonably add a push, and
the app would arrive at five buzzes a day and be silenced.

**Recommended order: A → B → D → C.** A is days and the highest value per
hour spent. B is the biggest genuine hole. D is one screen and stops a real
support problem. C is last because it carries social risk and the least daily
value — see D14.

---

## Part A — A child was marked absent

The most wanted alert in the product, and the cheapest: `AttendanceRecord`
exists, the rail exists, and `attendance.service.ts` does not import the
notifier at all today.

### A1 — ABSENT only, never LATE or EXCUSED

`AttendanceStatus` is PRESENT / ABSENT / LATE / EXCUSED. Only ABSENT
notifies. LATE is already known to the parent who dropped the child late,
EXCUSED was granted by the school *at the parent's request*, and a
notification for either is a buzz that tells someone what they told you.

### A2 — One notification per GUARDIAN per day, not per mark

The register submits in bulk (`AttendanceMarkInput`), so a naive hook would
fire once per absent child — three buzzes for a parent with three children
absent on a sick day. `eventId` is `student:date` for dedupe, and the
per-guardian collapse follows N6, exactly as `resultsReleased` already does:
one row per guardian, the app shows which child.

### A3 — The name is NOT in the payload, and this costs something

N3 forbids it, and the lockscreen is the reason: a phone on a desk would
otherwise announce which child is missing to whoever is nearby. So the body is
**"A child was marked absent today. Open the app to see."**

The cost is real and worth stating rather than hiding: a parent with three
children must open the app to learn which one. The alternative — naming the
child — is a safeguarding regression for a message that arrives on a locked
screen, and it is the same trade `resultsReleased` already made. If a school
asks for names, that is a per-school setting with its own sign-off, not a
default.

### A4 — A fifteen-minute delay before sending

**The most important decision in Part A.** A teacher marking a register
mistypes, notices, and corrects it within the minute. An absence notified
instantly cannot be recalled — the parent has already read "your child is not
in school" and is already calling.

So the send is enqueued with a 15-minute delay (the queue already takes
`delayMs` for quiet hours), and the job **re-reads the record before sending**:
if the status is no longer ABSENT, nothing goes out. Corrections made in the
first quarter-hour cost nothing, which is when essentially all of them happen.

### A5 — Push only. No SMS in v1

Fee reminders use SMS because money justifies a per-message cost. Daily
absences do not: a 400-student school with 5% absence is ~20 SMS a day, every
school day, on a Termii balance nobody has budgeted for. Push is free. A
school that wants SMS absence alerts is a paid feature with its own decision.

Consequence stated plainly: **a parent without the app gets nothing.** That is
the same position they are in today (a phone call, if anyone has time), so it
is not a regression — but it is not coverage either.

### A6 — Quiet hours apply; this is never urgent

Registers are taken in the morning. If one is taken at 22:00 the alert waits
until 06:00, because a parent who cannot act until morning should not be woken
to learn it.

---

## Part B — Homework

The biggest hole: a student opens this app for results, which change three
times a year. Homework is the only thing that would make it daily.

### B7 — Information, not workflow

v1 is **what to do and by when**. Teachers post; students and parents read;
nothing is submitted, uploaded, or marked.

Submissions are a different product: per-student file storage, a marking
queue, late/resubmit states, and an offline-sync story for a child with one
bar of signal. Each is a real design. Posting alone delivers the daily-open
value in a fraction of the work, and it is what a parent asking "what is your
homework?" needs tonight.

If submissions are ever built, they are their own plan-first. This one must
not quietly grow into them.

### B8 — Shaped like `LessonPlan`, scoped like the gradebook

`Assignment`: `schoolId`, `classArmId`, `subjectId`, `createdBy`, `title`,
`instructions`, `dueDate` (`@db.Date` — a calendar date, per the convention
that avoids "midnight in which zone"), `postedAt`, `withdrawnAt`.

A teacher may post only for a class and subject their own teacher scope
lists — the same gate the gradebook uses, not a new one. Owner/admin may post
for any, as they may enter marks for any.

### B9 — NO push per assignment

Five subjects posting daily is five buzzes, and the app gets silenced within a
week — taking the absence alert in Part A down with it, which is the one that
matters most.

Homework appears on the student's **Today** band ("2 due tomorrow") and the
parent's child card, both of which already exist and already know how to say
nothing when there is nothing. A single **daily digest** ("3 pieces of
homework due tomorrow", one push, evening, quiet-hours-aware) is the right
shape if push is wanted — deferred to its own decision once we can see whether
schools post at all.

### B10 — Withdrawable, not deletable

Same treatment as an announcement: a posted assignment is withdrawn, not
erased, because a child who wrote it down deserves a record that it existed
and was cancelled.

---

## Part D — The reply path (planned before C, deliberately)

A parent reads "the gate is closed tomorrow" and has no way to respond. Today
they call the school, which is fine — except the number is not in the app.

### D11 — No general messaging. Not now, possibly not ever

Two-way messaging brings adult–child contact into a product used by minors,
and with it a safeguarding duty, moderation, retention rules and a support
burden this project has no capacity for. Teacher↔student messaging in
particular is a category we should refuse on purpose rather than arrive at.

### D12 — v1 is "Call the school", and that is honest

The school's phone number is already on `School`. One button on the parent and
student surfaces, one on each announcement: **Call the school**. It does what
parents already do, with the friction removed.

### D13 — If a reply is ever needed, it is parent → admin only

One direction, one recipient (the school's admin inbox, not a person), no
threads between families, never a child. Scoped that tightly it is a
contact form, which is a week's work. Anything wider needs a policy decision
first, not a schema.

---

## Part C — Behaviour records (last, and narrower than it sounds)

CLAUDE.md's AI rules already reference behaviour records ("never auto-finalise
AI output for grades, report card comments, or behaviour records"), so the
intent existed before the feature. Nothing implements it.

### C14 — Internal in v1. Parents do not see it

A behaviour note visible to a parent changes what a teacher is willing to
write, and "my child did not do that" needs an appeal path that does not
exist. v1 is an **internal record**: form teacher and admin write and read it,
it feeds the conversation at a parent meeting, and it can inform a report-card
comment a human still approves.

Making it parent-visible later is a decision with a design (right of reply,
retention, who may amend). Making it parent-visible *by default now* is how a
school ends up in an argument it cannot win.

### C15 — No AI anywhere near it

Not summarised, not drafted, not categorised. The hard rule bars
auto-finalising; this goes further and keeps the model out entirely, because a
machine-written judgement about a child's conduct is not something a teacher
can meaningfully approve.

### C16 — Positive as well as negative, or it becomes a punishment log

Each entry carries a kind (COMMENDATION / CONCERN) and free text. A system
that only records what a child did wrong is one teachers stop using and
parents rightly resent.

---

## What stays out of this plan

- **Submissions, marking, plagiarism, file uploads per student** (B7).
- **SMS absence alerts** (A5) — per-school paid feature.
- **Parent-visible behaviour records** (C14).
- **Any messaging beyond a call button** (D11–D13).
- **Push per assignment** (B9) — a digest is the candidate, not per-post.
- Anything AI-shaped: Phase 7 owns that and is blocked on a vendor choice.

## Tests

- **A4 is the one to test hardest**: a record corrected within the delay window
  sends nothing; a record still ABSENT at send time sends exactly one per
  guardian; a re-marked register does not notify twice (`eventId` dedupe).
- A guardian of another school's child is never a recipient — real Postgres,
  like every other tenant boundary test.
- B8's scope gate: a teacher posting for a class they do not teach is refused;
  owner/admin is not.
- Every new query key stays under the right prefix — family keys persist,
  staff keys refuse (`staff-keys.spec.ts`).
- Payload safety: no test may find a child's name in a notification body.

## Open questions for the maintainer

1. **A3** — accept "a child was marked absent" without the name, or is naming
   the child worth the lockscreen exposure for a school that asks?
2. **B9** — no push for homework in v1: agreed, or do you want the evening
   digest built at the same time?
3. **C14** — internal-only behaviour records: agreed, or is parent visibility
   the point of the feature for you?
4. **Order** — A → B → D → C, or does homework come first?

---

## Part A status (2026-09-26) — built

Absence alerts ship as planned, with every decision above intact. What is
worth recording is where the work actually went, which was not the notifying:

- **`EVENT.attendanceAbsent` + `attendanceAbsent()`** in
  `event-notifier.service.ts`: guardians only, collapsed per guardian with
  `eventId = date`, body naming no child, and a back-filled register silent
  because `date !== today`.
- **`markBulk` tells it AFTER its transaction commits**, and outside it. A
  notification must never be the reason a teacher's marking fails, and a
  parent must never be told about a row that was rolled back. The notifier
  swallows its own errors for the same reason.
- **A4 needed a new seam.** The grace period is a delay on the push job, but a
  delay alone is not the decision — something has to RE-READ when it expires,
  because a claim written fifteen minutes ago is evidence of what a teacher
  tapped, not of what is true now. `PushSendJobData` gained an optional
  `verify` descriptor (a narrow named union, since a queued job cannot carry a
  function) and `PushProcessor` checks it before sending.
- **The skip RELEASES the claim.** This is the subtle one, and it is why the
  spec has a test named for it: a child marked absent at 08:00, corrected at
  08:05, then genuinely absent at 11:00 must still produce an alert. Leaving
  the claim in place would let a morning typo silence the rest of the day.
- **Quiet hours and the grace period compose as a MAX, not a sum.** A 21:30
  absence is held to 06:00, by which time the grace has long passed; adding
  them would push it to 06:15 for nothing.
- Tap-routing sends a parent to the children list, not to a child — the alert
  names nobody, so the destination must be where they can see which.

13 tests in `attendance-absence.spec.ts`, including the two that matter most
(nothing sent after a correction; the claim released so a later absence still
alerts), plus one asserting no other push pays for this: a job with no
`verify` performs no extra read.

## Part B status (2026-09-26) — built

Homework ships as planned: information, not workflow. Server, mobile (teacher,
student, parent) and web (teacher). What is worth recording:

- **B8's gate lives in the service, not the picker.** Both phone and web build
  their class/subject pickers from the teacher's own scope, so neither can
  offer something the server refuses — but the server re-checks the pair
  anyway, which is what makes the picker a convenience rather than the
  boundary. `?all=true` is REFUSED for a teacher rather than narrowed: quietly
  returning their own would look like the school had set nothing.
- **`homework.create` went to TEACHER**, unlike `announcement.create`. Setting
  homework is teaching work; an announcement is the school speaking. Bursar got
  read only, so they can answer "what homework does my child have?" at the
  counter.
- **The family read is one private method with two callers.** The guardian read
  goes through `withGuardian` nested in `withTenant` — RLS knows `school_id`
  and nothing about who may see whom — and the student's own needs no such
  check because the id comes from their session. Sharing the read means the two
  cannot diverge about what a family sees.
- **Yesterday's work still shows, marked overdue by the SERVER.** A child who
  forgot it needs to see it, and hiding it at midnight is how a parent finds
  out a week later. `overdue` is the server's judgement against the school's
  day; the phone's own date only picks group HEADINGS, so a wrong clock can
  mislabel a heading but can never accuse a child of being late.
- **B9 held, and the home screens are what replaced the push.** Nothing is
  pushed when homework is set. Instead: the student's Today band carries an
  overdue-or-due-soon line directly under their next lesson, and the parent's
  child card carries the same through `childHighlight`, ranked below money and
  above results — a child sent home over fees has a bigger problem than an
  unfinished exercise, and a released result keeps for weeks.
- Grouped by WHEN, not subject, with every overdue day collapsed into one
  heading: a child at a kitchen table is answering "what must I do tonight?".
  The ordering is a pure module (`lib/family/homework.ts`) because Vitest here
  runs node-env with no React Native transform — a helper inside a `.tsx` is
  unreachable from a spec.

19 server integration tests against real Postgres, 6 for the grouping, and the
`childHighlight` ranking pinned including the "1 piece" singular.

**Found while building, worth keeping:** `permissions-coverage.spec.ts` passed
at first against a `packages/db/dist` built three days earlier, which had none
of the new grants — silently green rather than loudly broken. Rebuilding
surfaced the real failure (`expected 39 to be 38`). That is the stale-`dist`
trap CLAUDE.md's ESM section describes, and it is worse than the missing-`dist`
case it warns about, because nothing fails.

## Part D status (2026-09-26) — built

"Call the school", on every family surface: the app's parent and student homes,
both announcement screens, and the portal's home and announcements page.

- **No messaging was built, and that is the deliverable.** D11 stands: a
  two-way channel in a product used by minors brings a safeguarding duty,
  moderation and retention this project cannot carry. What shipped is the thing
  parents already do, with the friction removed.
- **One button per SCREEN, not one per announcement**, which is the one place
  this departs from D12's wording. A button repeated under every message is the
  same action a dozen times and reads as clutter; the screen-level button
  answers the same question. Recorded rather than quietly changed.
- **`callSchoolHref` is the whole of the logic**, in `@school-kit/types` so all
  three apps share one rule. It strips whatever a human typed into a phone
  field, KEEPS a leading `+` (dropping it turns +234… into a local number that
  dials somewhere else), and returns null below seven digits.
- **Null hides the button; it never disables it.** A greyed-out "Call the
  school" tells a worried parent the feature exists and has been taken away
  from them. Absent, it simply leaves them where they were.
- **The portal needed a server addition and the app did not.** The app already
  had the school in its session; the browser knew the child, the invoices and
  the calendar and had no idea what school it was showing them for. `GET
  /portal/school` and `GET /student-portal/me/school` return two fields —
  name and phone — with the school id coming from the session, never the
  request.
- The app's tablet case is handled rather than ignored: where there is no
  dialler, the number is shown so it can be read out or typed elsewhere.

**Still not built: Part C (behaviour records).** Last by design — it carries
the most social risk and the least daily value.
