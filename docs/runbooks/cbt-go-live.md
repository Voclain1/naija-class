# Online exams — go-live runbook

How to take online exams (CBT, `docs/modules/cbt.md`) from "built" to a
school's first live exam. The **go-live gate** (D10) is the three things in
§3–§5. No school sits a real exam online until all three have passed.

**Start about four weeks before the first exam period.** That leaves time
for a failed load test or dry run to be fixed and repeated. Nothing in this
runbook is paid for before then (owner's decision Q3, 2026-10-05).

> **No laptop needed.** `flyctl` is blocked on the maintainer's Windows
> machine, and most of this is done from a tablet. Everything below is either
> the Fly, Vercel or Neon web dashboard, or a GitHub Actions workflow run
> from the GitHub app ("Deploy exam service", `.github/workflows/deploy-cbt.yml`).
> The load test (§4) is the one step that needs a computer with Node 22. Any
> lab computer at the test school will do.

---

## What runs where

| Piece | Where | Until go-live |
|---|---|---|
| Exam app (`apps/cbt`) | Vercel project `school-kit-cbt`, `cbt.schoolkit.ng` | Not created. Locally on port 3003. |
| Exam service (the API with `API_MODE=cbt-delivery`) | Fly app `school-kit-cbt` (`apps/api/fly-cbt.toml`) | Not created. `school-kit-api` serves the same two routes. |
| Staff screens (scheduling, invigilator sheet, results) | `school-kit-web`, as today | Live once merged. |
| Database | The same Neon database as everything else | No change. |

Each lab computer **downloads its exam once**, ahead of time, then sends a
small batch of answers about every 30 seconds. A 200-computer lab is
therefore about 200 downloads, then about 400 small requests a minute. The
load test (§4) checks exactly that pattern.

---

## 1. Turn on what costs money (about week −4)

1. **Neon.** Move `school-kit-prod` to a paid plan. Its compute must stay up
   through the exam morning: no scale-to-zero during exam hours, and enough
   connections for both Fly apps. Use the **pooled** connection string for
   `DATABASE_URL` (`app_user`), as `school-kit-api` already does.
2. **Fly — create the app.**
   - Dashboard → Apps → Create app.
   - Name: `school-kit-cbt`. Region: `jnb`. Same organisation as
     `school-kit-api`.
   - Under the app's Secrets, set the following. These are the same values
     `school-kit-api` uses, except the CORS origin.

     | Secret | Value |
     |---|---|
     | `DATABASE_URL` | same as `school-kit-api` (`app_user`, pooled) |
     | `REDIS_URL` | same as `school-kit-api` |
     | `CORS_ORIGIN_CBT` | `https://cbt.schoolkit.ng` |
     | `SENTRY_DSN_API` | optional, same as `school-kit-api` |

     It needs **nothing else**: no auth secret, storage, email or AI key. The
     service only reads packs and stores answers.
3. **Fly — deploy.**
   - GitHub app → Actions → "Deploy exam service" → Run workflow, with
     action `deploy`.
   - The run ends by checking that the service answers. Its last step must
     be green.
4. **Vercel — the exam app.**
   - New project `school-kit-cbt` from this repository.
   - Root Directory: `apps/cbt`. Framework: Next.js.
   - Environment variable: `NEXT_PUBLIC_API_URL` = `https://school-kit-cbt.fly.dev/api/v1`.
   - Domain: `cbt.schoolkit.ng`.
   - Then run `vercel env ls`, or check the project's Settings →
     Environment Variables. CLAUDE.md records why: a recreated project once
     started with no variables, and nothing caught it for five days.
5. **Staff web app.** On `school-kit-web`, set `NEXT_PUBLIC_CBT_URL` =
   `https://cbt.schoolkit.ng` and redeploy. The invigilator sheet prints this
   address. Without it, the sheet points at `localhost:3003`.
6. **Check from a phone.**
   - `https://cbt.schoolkit.ng` shows "SchoolKit Exams".
   - `https://cbt.schoolkit.ng/<any-slug>` shows "Exams on this computer".

---

## 2. A test school

Use the platform-admin dashboard (Schools → New school) to provision a school
named e.g. "Exam load test". Then, signed in as its owner:
- one class with a handful of students (the load test cycles through the
  register, so 5–10 students is enough);
- a subject, a few multiple-choice questions and one theory question,
  approved;
- an exam paper, finalised;
- an online exam scheduled to have just started, then published;
- the invigilator sheet open, for the slug, access code and unlock code.

This school is deleted at the end (§6). It never records a payment, so the
dashboard's delete is allowed.

---

## 3. Gate 1 — the service is deployed and answers (§1, step 3)

Passed when the "Deploy exam service" run is green and the exam app loads.

---

## 4. Gate 2 — the load test

From any computer with Node 22, in a checkout of this repository:

```bash
pnpm install
pnpm --filter @school-kit/types build
pnpm cbt:load-test \
  --api https://school-kit-cbt.fly.dev/api/v1 \
  --slug <test-school-slug> --access <ACCESS> --unlock <XXXX-XXXX-XXXX> \
  --machines <TARGET> --minutes 5 --interval 30
```

Set `<TARGET>`:
- **≥ the largest lab** of any school going live;
- **×2 if two schools may sit at the same hour.**

**Pass:** the last line reads `PASS — no failures, p95 … ms`.
- `--p95-ms` defaults to 1500. Both downloads and syncs must be under it.
- **Any non-200 fails the run.** In particular, a `sync 429` means the
  per-address throttle (600 downloads and 1,200 syncs a minute) is too low
  for that lab size. That is a code change to
  `apps/api/src/modules/cbt-delivery/cbt-delivery.controller.ts`, not
  something to ignore.

Run it **from the school's own network** if you can. The throttle counts per
address, and a whole lab shares one. Running from that network measures the
real path, including the school's uplink.

**Measured locally (2026-10-10):**
- setup: 100 computers × 4 syncs against the compiled service, Postgres and
  Redis on one machine;
- downloads: p95 305 ms;
- syncs: p95 15 ms;
- no failures.

That is a floor, not the gate: the gate is the deployed service, from a real
network.

---

## 5. Gate 3 — a dry run in one school's lab

With the school's own staff, on their computers, using the test exam from §2
(or a real class's practice paper):

1. **The day before:**
   - on every computer, open `cbt.schoolkit.ng/<slug>` while online;
   - download the exam with the access code;
   - confirm each one shows "Start this exam".
2. **Unlock:** type the unlock code on each computer, then let students sign
   in with their admission numbers.
3. **Mid-exam, on purpose:**
   - **pull the network cable** on one computer for a few minutes, then plug
     it back in. Answers must keep saving, then show as sent;
   - **switch one computer off** at the wall, back on, and open the same
     address. Type the unlock code, sign the student in, and check "Welcome
     back" with their answers kept;
   - **add extra time** on one computer from the Invigilator link.
4. **Finish:** every computer says "All answers sent to the school".
5. **The teacher's side:**
   - on the sitting page, Progress shows every student as Submitted;
   - close the exam;
   - on Results, choose a computer for anyone flagged with two, type theory
     marks, preview, and save to the gradebook;
   - check the gradebook column.

Write down anything confusing on the day. Fix it before the first live exam.

---

## 6. Clean up the test school

Platform-admin dashboard → the test school → Delete (type the slug). Its
sittings, attempts and gradebook rows go with it.

---

## Exam days

- **The day before:**
  - "Deploy exam service" with action `exam-day`;
  - machines: 2 for one school, more if several sit at once. This keeps
    machines running, so the first lab is not a cold start.
- **The morning:**
  - invigilators carry the printed invigilator sheet. It is audited every
    time it is opened;
  - computers download the exam beforehand (the sheet's step 1).
- **During:** the sitting page's Progress column, with Refresh, shows who is
  sitting and who has submitted.
- **After the exam period:** "Deploy exam service" with action `quiet`.

## If the exam service is down on the day

- **Computers that already downloaded and unlocked the exam carry on.** The
  exam works offline (D6). Answers stay on each computer and send themselves
  when the service is back.
- **To move the lab to the main API:**
  1. Set `NEXT_PUBLIC_API_URL` on the `school-kit-cbt` Vercel project to
     `https://school-kit-api.fly.dev/api/v1`.
  2. Redeploy. It takes about two minutes.
  3. Add `CORS_ORIGIN_CBT=https://cbt.schoolkit.ng` to `school-kit-api`'s
     secrets if it is not there yet.
  The full API serves the same two routes, and it uses the same database.
- **Undo it afterwards.** The point of the separate service is that a busy
  exam morning cannot slow fees or report cards.

## Between exam periods

- Keep the Fly app at `quiet`; it stops when idle. Delete it only if online
  exams are dropped.
- Neon can return to its normal plan once the period's results are in the
  gradebook.
