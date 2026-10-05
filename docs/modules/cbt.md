# Online exams (CBT)

Students sit a school's own exam papers (CP5c) on the school's lab computers,
in a browser. Built on the shape fixed in `docs/modules/phase-8.md` D59:
- a separate delivery service, on its own address;
- the same accounts and data;
- offline exam packs unlocked by an invigilator's code, with answers synced
  in batches;
- a load test as a gate before any school's first live exam.

Starting point: the assessment in `docs/deferred.md` ("CBT / online exams —
capability assessment").

## Owner's decisions (2026-10-05)

| # | Decision |
|---|---|
| Q1 | **School computer lab, in a browser.** Not phones, not the app, in v1. |
| Q2 | **Objective questions only.** Multiple choice (true/false is a two-option multiple choice) is delivered and marked automatically. Short-answer and theory sections stay on paper; the teacher types those marks in when the scores go to the gradebook. |
| Q3 | **Build it to completion now; pay for nothing yet.** The paid database plan, the separate exam machine and the load test happen a few weeks before an exam period, then a proper test before the first live exam. |

## Decisions

**D1 — A sitting is a FINAL paper, scheduled for one or more class arms.**
- A teacher, for their subject (the D62 scope), or an owner or admin, creates a
  **sitting**. It names:
  - the paper;
  - the arms (all at the paper's class level);
  - the start time;
  - the latest time a student may begin;
  - the exam length.
- Only a FINAL paper can be scheduled. FINAL papers are frozen, so what
  students see can never drift from what was approved.
- A paper with no deliverable question is refused. A deliverable question is
  multiple choice with at least two options and exactly one correct.

**D2 — Publishing freezes the candidate list and builds the exam pack.**
- **Candidates.** Publish snapshots every student enrolled in the chosen
  arms for the paper's term.
- **Versions.** Each candidate gets one of the paper's versions (A–D) from a
  hash of the sitting and student, so neighbours rarely share one. The
  version decides the option order, exactly as on the printed paper.
- **The pack.** Publish builds one **exam pack** for the sitting:
  - every version's objective questions, with no answer key;
  - the candidate list (admission number, first name and surname initial,
    arm, version);
  - the timing.
- **Unpublishing** is allowed until the start time, and only while no answers
  have arrived. The pack must then be downloaded again.

**D3 — Two codes per sitting.**
- **Access code**: 6 characters, unique within the school. A lab machine uses
  it, with the school's web address name (slug), to download the pack ahead
  of time. Knowing it reveals nothing, because the pack is encrypted.
- **Unlock code**: 12 characters, shown as `XXXX-XXXX-XXXX`. The invigilator
  types it on each machine when the exam starts. The pack is decrypted with a
  key derived from it, so nobody can read the questions early from a
  downloaded pack.
  - Crypto: AES-256-GCM, with a PBKDF2-SHA256 key at 210,000 iterations.
    These are standard primitives (Node `crypto` and the browser's WebCrypto),
    not home-made crypto.
  - Strength: 60 bits of code behind 210,000 iterations is far beyond a
    brute force in the hours between download and start.
- Both codes are shown only to staff with `cbt.manage`, on the printable
  invigilator sheet. Every view of that sheet is audited.

**D4 — The answer key never leaves the server.** Marking happens when answers
reach the API, against the frozen paper. A copied pack gives away the
questions after the start, never the answers.

**D5 — Students identify themselves by admission number, and confirm their
name.**
- The machine shows "Is this you? Adaeze O., JSS 2 Gold". Invigilators watch
  the room, as they do for a paper exam.
- No per-student password: lab students often have no portal account, and a
  slip-code system would add printing for little gain in an invigilated room.
- If two machines send answers for the same student, both are kept, and the
  results page asks the teacher which one counts.

**D6 — Offline first.**
- Answers are saved on the machine after every choice, in IndexedDB.
- Answers sync to the API in batches (about every 30 seconds when online, and
  at submit). A machine that loses power or network keeps its answers and
  sends them later.
- **The clock** is wall time from the student's start, like a paper exam.
  After a power cut the invigilator re-enters the unlock code to resume, and
  can add extra time on that machine.
- **Server checks.** The server records device and arrival times. It flags,
  rather than rejects, an attempt that ran over, so a teacher decides.

**D7 — Deterrents, not proctoring.**
- Each version moves the options.
- Copy and paste are off.
- Every time the student leaves the exam window is counted and reported.
- No webcam, lockdown browser or screen recording. Those are a different
  product, and for children they are an NDPR and consent question.

**D8 — Scores reach the gradebook only through a teacher.**
- **The results page shows:**
  - each candidate's objective score, out of the objective total;
  - a box for the theory or short-answer mark from the paper scripts;
  - the total, out of the paper's total.
- **"Send to gradebook"** writes the totals into the paper's gradebook
  column (CP5a raw marks, out of the paper's total). It uses the same
  preview-then-save path, and the scaling happens on the server.
- **Nothing is written automatically.**

**D9 — A separate delivery service.**
- **The student app.** The delivery app is its own Next.js app,
  `apps/cbt`, served at `cbt.schoolkit.ng`. It is a static, installable page
  with a service worker, so a lab machine can load it with no network once
  it has been opened.
- **The API side** is two public endpoints: download a pack, and send
  answers. They live in a `cbt-delivery` NestJS module that can run alone
  (`API_MODE=cbt-delivery`) as its own Fly app, so an exam-day spike cannot
  touch fees, attendance or report cards.
- **Load.** A whole exam costs the server about one request per machine to
  download, plus a few small syncs.

**D10 — Go-live gate (decision Q3).** Before any school's first live exam:
- the paid database plan and the separate Fly app are set up;
- the load test (`pnpm cbt:load-test`, `apps/cbt/scripts/load-test.mjs`) passes at the target concurrency;
- a dry run happens in one school's lab.

The runbook is `docs/runbooks/cbt-go-live.md`. Nothing here is paid for
until then.

## Slices

| Slice | Contents |
|---|---|
| **CBT1** | Schema + RLS, permissions; staff API to create, publish, unpublish and close a sitting; pack builder and encryption; staff screens (schedule a sitting, invigilator sheet, candidate list). |
| **CBT2** | Public delivery API (pack download, answer sync); attempts table; `apps/cbt` (download, unlock, sign in, timed exam, autosave, offline sync, submit). |
| **CBT3** | Marking; results page with theory marks; multiple-device choice; send to gradebook via the CP5a preview; flags (over time, left the window). |
| **CBT4** | Standalone deployment config (Fly app in `cbt-delivery` mode, Vercel project), load-test script, go-live runbook. |

## As built — CBT1 (2026-10-08)

Migration `20261008120000_cbt1_sittings`:
- `cbt_sittings`, `cbt_sitting_arms` and `cbt_candidates`, each with a flat
  `school_id` policy under FORCE RLS.
- Checks hold the code formats, the window (`window_ends_at > starts_at`) and
  "a draft has no pack, a published sitting always has one".
- No new SECURITY DEFINER function (count stays 23).
- Permissions `cbt.read` and `cbt.manage` go to admin and teacher, appended
  idempotently to the system roles.

**API** (`apps/api/src/modules/cbt/`):

| Route | Purpose |
|---|---|
| `GET /cbt/papers` | Papers that can be scheduled: FINAL, in scope, with at least one deliverable question. |
| `GET / POST /cbt/sittings`, `GET / PUT / DELETE /cbt/sittings/:id` | List, create, read, edit and delete sittings. Editing and deleting are draft only. |
| `POST …/publish`, `…/unpublish`, `…/close` | Lifecycle. Unpublish is refused once the start time has passed. |
| `GET …/candidates` | The student list. Live while draft, frozen once published. |
| `GET …/invigilator-sheet` | The codes. `cbt.manage` only, and every read writes `cbt-sitting.view-codes`. |

**Pack:**
- Built in `cbt-pack-crypto.ts`: PBKDF2-SHA256 at 210,000 iterations, then
  AES-256-GCM. The ciphertext uses WebCrypto's layout, with the tag appended,
  so the browser opens it unchanged in CBT2.
- **Version assignment:** `versionForCandidate` (in `@school-kit/types`,
  beside `optionOrderFor`) hashes the sitting and student ids.
- **Spec-proven:**
  - the pack opens only with the unlock code, typed in any case or with
    dashes;
  - each version's option order matches its printed paper;
  - there is no answer key anywhere in the payload. Mutation-checked: adding
    `isCorrect` to the pack fails the spec;
  - theory text is never in it;
  - the public envelope carries no question text and no names.

**Screens:**
- `/teacher/cbt`: the list, and a "Schedule an online exam" form.
- `/teacher/cbt/[id]`: online and on-paper totals, students with versions,
  and the lifecycle buttons.
- `/teacher/cbt/[id]/invigilator`: the printable sheet with both codes, the
  steps for the day and the register.
- "Online exams" is in both the admin and teacher sidebars.
- The sheet prints the exam app's address: `https://cbt.schoolkit.ng` in a
  production build, `localhost:3003` in development, or `NEXT_PUBLIC_CBT_URL`
  when set (2026-10-05: the production default was added so the sheet reads
  correctly before go-live).

**Tests:**
- `cbt-sittings.service.spec.ts` (8 tests);
- `cbt-format.spec.ts`;
- RBAC coverage;
- E2E `cbt-sittings.spec.ts`: schedule, publish, then the invigilator sheet
  shows the codes, the register and the audited view.

## As built — CBT2 (2026-10-09)

Migration `20261009120000_cbt2_attempts`:
- `cbt_attempts`: one row per (candidate, lab machine), flat `school_id`
  policy under FORCE RLS. A student who moved computers has two rows (D5).
- The machine sends a **snapshot** of the whole attempt every time (all
  answers so far, plus a `seq` that only goes up), never a diff. One
  `INSERT … ON CONFLICT … WHERE seq < EXCLUDED.seq AND submitted_at IS NULL`
  keeps the highest copy, so repeats, late batches and two batches racing
  each other change nothing, and a submitted attempt is final.
- Two clocks: `started_at`/`submitted_at` are the machine's, and
  `first_received_at`/`last_received_at` the server's (D6).
- The candidate FK is RESTRICT, and unpublish is refused once any answers
  exist (`SITTING_HAS_ANSWERS`): the same rule in the service and the database.
- No new SECURITY DEFINER function (count stays 23).

**Public API** (`apps/api/src/modules/cbt-delivery/`, its own module so it can
run alone in CBT4):

| Route | Protection |
|---|---|
| `GET /cbt-delivery/:slug/packs/:accessCode` | The encrypted envelope only. Published sittings only; closed → `SITTING_CLOSED`; suspended school → `SCHOOL_SUSPENDED`. |
| `POST /cbt-delivery/:slug/sittings/:sittingId/answers` | `X-CBT-Signature`: HMAC-SHA256 of the exact body, under a **sync key** derived from the unlock code (PBKDF2, the pack's 210,000 iterations, salt `school-kit-cbt-sync:<sittingId>`). Only an unlocked machine holds it. Per attempt: `STORED`, `ALREADY_STORED`, or `REJECTED` (`NOT_ON_REGISTER`, `UNKNOWN_ANSWER` — every answer must be an option of a multiple-choice item on the frozen paper). |

- The school comes from its slug (`schools` has no RLS), as in the Result
  Checker; everything after runs under `withTenant`.
- **Throttles** are sized for a whole lab behind one router address: 600
  downloads and 1,200 syncs a minute per address.
- **Closed sittings still accept answers.** A machine offline at the close
  keeps its answers; `last_received_at` against `closed_at` shows they were
  late (D6: flag, don't reject). CBT3 shows it.
- **CORS**: `CORS_ORIGIN_CBT` (default `http://localhost:3003`), and
  `X-CBT-Signature` is an allowed header.

**Browser crypto** (`packages/types/src/cbt/cbt-web-crypto.ts`):
- `openPackInBrowser`, `deriveSyncKey` and `signSyncBody`, using WebCrypto only.
- The API's HTTP spec runs this exact code on Node's WebCrypto against packs
  the server built.

**`apps/cbt`** (port 3003):
- **Screens:** home (downloaded exams, download with the access code) → unlock
  (invigilator) → admission number → "Is this you?" → exam → finished →
  next student.
- **On the machine** (IndexedDB):
  - the encrypted packs;
  - every attempt, saved after each choice;
  - what the server has confirmed, kept in a separate store so a sync cannot
    overwrite a newer answer;
  - the machine's id;
  - each sitting's sync key.
- The sync key is a **non-extractable** WebCrypto key. Answers saved before a
  restart can be sent without the code, but the key cannot open the questions.
  The opened questions are only ever in memory.
- **Sync** runs every 30 seconds, on reconnect, and at finish.
- **Resume after a power cut:** the unlock code again, then sign in again.
  The clock kept running from the student's start (D6).
- **Invigilator actions:** a late start after the latest start time, and
  extra time. Both need the unlock code typed again, checked by comparing
  signatures, so the code is never stored.
- **Deterrents (D7):** copy, paste and the context menu are blocked; each time
  the student leaves the window is counted once.
- **Offline:** a service worker (`public/sw.js`, production only) keeps the
  app's own files, so a machine that opened the page online can open it
  again offline.

**Staff screen:** the sitting page's student list gains a Progress column
("Sitting — 12 of 40 answered", "Submitted … (2 computers)") and a Refresh
button.

**Tests:**
- `cbt-delivery.http.spec.ts` (8, real HTTP and Postgres). Mutation-checked:
  dropping the `seq` guard, or the signature check, fails it.
- apps/cbt specs (14), on fake-indexeddb, including the one-device-id race:
  two concurrent first syncs once minted two ids, so one student looked like
  two computers. Caught by the E2E and fixed.
- E2E `cbt-delivery.spec.ts`: download, wrong and right unlock code, sign in,
  answer, reload, resume with answers kept, finish, "All answers sent", the
  attempt in the database, and the teacher's Progress column.

## As built — CBT3 (2026-10-10)

Migration `20261010120000_cbt3_results`:
- `cbt_attempts.chosen` — the attempt that counts, for a student who used
  more than one computer (D5). At most one per student: a partial unique
  index enforces it. It sits on the attempt, not as a `chosen_attempt_id` on
  the candidate, so the two tables do not reference each other.
- `cbt_candidates.theory_mark` — whole marks, 0..1000 in the database. The
  service caps it at the paper's on-paper total.
- No new table, policy, permission or SECURITY DEFINER function (count stays
  23).

**Marking** (`apps/api/src/modules/cbt/cbt-marking.ts`, pure):
- **Scores are not stored.** Every read marks each attempt against the frozen
  paper's key. The key never leaves the server (D4), and a FINAL paper cannot
  change, so the score cannot drift.
- **Flags.** These inform; they never decide anything (D6):
  - started after the latest start;
  - ran over time (the exam's length, plus any extra time, plus 2 minutes'
    grace for machine clocks);
  - did not finish;
  - arrived after the close;
  - left the exam window (with the count).
- **The attempt that counts:** the one the teacher chose, otherwise the only
  one. Two attempts with none chosen need the teacher.
- **The total** is the multiple-choice score plus the theory mark, out of the
  paper's total. It exists only when it can honestly go to the gradebook: an
  attempt counts and, if the paper has theory, its mark is in.

**API** (in `CbtSittingsController`, the same D62 scope):

| Route | Permission | Purpose |
|---|---|---|
| `GET /cbt/sittings/:id/results` | `cbt.read` | Each student with their attempts (score, answered, minutes, flags), the attempt that counts, theory mark and total. Also returns the paper's term, subject and gradebook column. |
| `PUT /cbt/sittings/:id/theory-marks` | `cbt.manage` | All or nothing. Students must be on the register; marks run 0..on-paper total. Audited as `cbt-result.theory-marks`. |
| `POST /cbt/sittings/:id/attempts/:attemptId/choose` | `cbt.manage` | The attempt that counts. Clears the student's other choice first. Audited as `cbt-result.choose-attempt`. |

**Gradebook (D8).** The results page sends ready totals through the existing
CP5a calls, `POST /assessment-scores/preview` and then `/bulk`. Each row is
`raw: { mark: total, outOf: paperTotal }`. The server scales them, and every
gradebook rule applies unchanged: teacher scope, enrolment, sign-off.
- **Column:** the paper's own column by default; the teacher can pick another.
- **Nothing is written without "Save to gradebook"**, after the teacher has
  seen every "12/15 → 48".

**Screens:**
- `/teacher/cbt/[id]/results`:
  - each student's attempt or attempts, with flags in words;
  - "Use this one" for a student who used two computers;
  - a theory mark box, with a bulk save;
  - the total, or the reason there isn't one yet;
  - the "Send to the gradebook" panel.
- The sitting page gains a "Results" button.
- Its "Close exam" text now says late answers are kept.

**Tests:**
- `cbt-marking.spec.ts` (5 tests).
- `cbt-results.service.spec.ts` (4 tests, Postgres):
  - marks against the key, and the results never carry the key;
  - the theory-mark cap, the register check, and that a refused batch
    writes nothing;
  - choosing, and moving the choice;
  - the database's one-chosen rule.
  - Mutation check: dropping the "clear the old choice" step fails it.
- RBAC coverage for the three routes.
- `cbt-format.spec.ts`.
- E2E `cbt-results.spec.ts`: two computers → "Use this one" → theory mark 7
  → total 12 → preview "12/15 → 48" → saved. The gradebook row is checked in
  the database, with `rawScore` 12 and `rawOutOf` 15.

## As built — CBT4 (2026-10-10)

Everything the go-live gate (D10) needs is written. **None of it is created,
paid for or deployed yet** (decision Q3). `docs/runbooks/cbt-go-live.md` is
the order of work, starting about four weeks before the first exam period.

**The exam service:** `API_MODE=cbt-delivery`.
- `apps/api/src/root-module.ts` picks `CbtDeliveryAppModule` for that mode,
  and the full `AppModule` for anything else (unset included).
- `CbtDeliveryAppModule` loads only:
  - config;
  - Redis and the per-client throttle;
  - the error filter;
  - the health check;
  - `CbtDeliveryModule`.
- **Same image, its own app.**
  - The service is the same image as `school-kit-api`.
  - `apps/api/fly-cbt.toml` describes the Fly app `school-kit-cbt`: 512 MB,
    `jnb`, a request soft limit of 200 per machine, and it stops when idle.
  - Proven by `cbt-delivery-app.module.spec.ts`: the delivery route answers;
    `/cbt/sittings` and `/auth/login` are 404 there.
  - Also checked by starting the compiled `dist/main.js` in that mode. That is
    the CommonJS path, which Vitest does not exercise (CLAUDE.md "ESM module
    resolution").

**Deploying:** `.github/workflows/deploy-cbt.yml`, manual only.
- Actions: `deploy`; `exam-day` (keep N machines running and wake them);
  `quiet` (back to one).
- Every run ends by checking the service answers.
- It can be run from the GitHub app, since `flyctl` is not available on the
  maintainer's machine.
- **No migrations:** the service shares the main database, and the main
  deploy migrates it.

**Load test:** `pnpm cbt:load-test` (`apps/cbt/scripts/load-test.mjs`).
- **What it plays:** a whole lab from one address, with the browser's own
  crypto:
  - every computer downloads at once;
  - each sends a growing, signed answer snapshot every `--interval` seconds;
  - each finishes with a submitted snapshot.
- **Pass:** no non-200 responses, and p95 ≤ `--p95-ms` (1,500 by default).
- **Measured locally:**
  - 100 computers × 4 syncs against the compiled service: p95 305 ms for
    downloads, 15 ms for syncs, no failures;
  - all 100 attempts were stored as submitted;
  - the throwaway school was then deleted.

**Runbook:** `docs/runbooks/cbt-go-live.md`.
- **Setup:**
  - paid Neon;
  - the Fly app and its four secrets;
  - the Vercel project (`apps/cbt`, `NEXT_PUBLIC_API_URL`, `cbt.schoolkit.ng`,
    then `vercel env ls`);
- **The three gates:** deployed and answering; the load test at the target
  size; a dry run in one lab, with a cable pulled and a computer switched off
  on purpose.
- **Exam-day steps**, and what to do if the service is down: computers that
  already unlocked carry on offline, and the exam app can be pointed at
  `school-kit-api`, which serves the same two routes.
