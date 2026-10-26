# Launch checklist

Everything that stands between the code as built and schools relying on it,
with who does it and where. Written 2026-10-19 after the pre-launch sweep.
Tick an item here **and** in `docs/deferred.md` when it is done. Engineering
work that is already built is not listed; this page is what is left.

Status key: **Done**, **Open** (needs doing), **Waiting** (on someone outside).

## 1. Settings on the live services

| Item | Where | Status |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` on `school-kit-api` | Fly → school-kit-api → Secrets | **Staged** 2026-10-19. Takes effect at the next deploy (the next merged PR). Then an announcement's outbox should show "delivered". |
| Resend webhook to `https://api.schoolkit.ng/api/v1/webhooks/resend` (delivered, bounced, complained) | Resend → Webhooks | **Done** 2026-10-19, enabled. |
| `STORAGE_DRIVER=r2` and the four `R2_*` values on `school-kit-api` | Fly → Secrets | **Done** 2026-10-20: confirmed `r2` (image addresses are served from R2). Any other value would keep uploads on the machine, which a deploy replaces. |
| `RESULT_PIN_HMAC_KEY` on `school-kit-api` | Fly → Secrets | **Check.** The API refuses to start in production without it, so a running API means it is set. |
| `PORTAL_PROXY_SECRET`, same value on `school-kit-portal` (Vercel) and `school-kit-api` (Fly) | Vercel → Environment Variables; Fly → Secrets | **Check** with `vercel env ls`. On one side only, it silently does nothing. |
| `SESSION_COOKIE_DOMAIN=schoolkit.ng` on `school-kit-web` | Vercel | **Done** 2026-10-07 (`docs/runbooks/web-session-cookie.md`). |
| WhatsApp alerts for setup-call bookings (`WHATSAPP_*` in `API_ENV_FILE`) | Meta, then the VPS | **Open** (optional). Steps in `docs/runbooks/whatsapp-alerts.md`. Until then bookings come by email, in the platform admin under Setup calls, and from the school's own WhatsApp. |
| `POSTHOG_API_KEY` on `school-kit-api` | Fly → Secrets | **Open** (optional). Unset sends nothing. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` on `school-kit-web` | Vercel | **Open** (optional). Uploads source maps, so browser errors show real file names. |
| Public addresses (`PORTAL_BASE_URL`, `WEB_BASE_URL`, `CORS_ORIGIN`, `CORS_ORIGIN_PORTAL`) moved from secrets to `fly.toml [env]` | `apps/api/fly.toml` | **Open.** Tidy-up, not urgent. Do it while watching a deploy. |
| School web addresses (`<code>.schoolkit.ng`): the wildcard domain and the variables | Vercel (DNS is on Vercel today), then the VPS | **Done** on Vercel, with `SCHOOL_ADDRESSES_LIVE=on`, by 2026-10-23 (owner, confirmed 2026-10-25). Links, PIN cards and Google's official addresses use `<code>.schoolkit.ng`. Repeat the VPS steps in `docs/runbooks/school-addresses.md` at the move. |

## 2. Payments, messages and AI

| Item | Status |
|---|---|
| Paystack webhook URL in the Paystack dashboard | **Done** 2026-10-11. |
| One real payment from a phone: checkout closes and the invoice updates | **Done** 2026-10-20. Production runs on the live key, so it was a real ₦100 payment from the portal on a phone, to a test school whose subaccount is the owner's own account. Checkout closed, the invoice showed Paid, and the split reached the subaccount. |
| Switch off Paystack's own customer receipt emails (Paystack dashboard → Settings → Preferences) | **Open.** Do it **after** the deploy carrying the school-named payment confirmation email (2026-10-21), never before, or parents get no confirmation at all in between. Paystack's email says "payment to SchoolKit"; ours names the school. |
| SchoolKit's Paystack trading name | **Open** (optional). Suggested: "SchoolKit School Fees" (21 characters, so statements do not cut it off). It is what parents see on bank statements. Paystack may ask for it to match the registered business. |
| SMS sender name: SchoolKit's CAC registration, then `TERMII_SENDER_ID` | **Waiting** (CAC). Schools with their own CAC can request their own name now. |
| WhatsApp (CP9) | **Waiting** on a Meta-approved business number. |
| AI: `AI_ENABLED` is on; each school's own AI switch is off until the operator turns it on | **Done.** Turn on per school in the platform admin. |
| Smart Student Import accuracy test (about 10 photographed registers with checked answers, `pnpm ai:eval:registers`) | **Open, no longer blocking.** Since 2026-10-25 Smart Import is on for every school as a beta (owner's decision, `docs/modules/smart-student-import.md` §9). The beta's real correction counts now take this test's place as the bar for leaving beta. |

## 3. Legal and commercial

| Item | Status |
|---|---|
| NDPR review of AI processing: sign Part 1 of `docs/legal/ndpr-ai-review.md`, send Part 2 to a lawyer | **Waiting** on the owner's signature. Also add the AI providers to the onboarding consent text. |
| AI study assistant (tutor) decisions Q9 and Q10 (`docs/modules/phase-8.md`) | **Waiting** on the owner. |
| Each school on its right plan in the platform admin; `PLAN_ENFORCEMENT=enforce` when early access ends | **Open.** |
| Duplicate "Virgo Fidelis Montessori School" in production | **Waiting** on the owner: merge or delete. |

## 4. Apps and devices

| Item | Status |
|---|---|
| Device checks: mobile session-end, calendar, class timetables, Android and iOS smoke tests | **Open.** Before telling families to download the app (`docs/runbooks/android-smoke-browserstack.md`). |
| Store listings and EAS builds | See `docs/runbooks/mobile-eas-setup.md`. |

## 5. Engineering left before public launch

| Item | Status |
|---|---|
| Force a password reset for accounts created under the Phase 0 password rules | **Done** 2026-10-19: at sign-in, a right password that fails today's rules gets a 15-minute reset token instead of a session (web and staff app). |
| Confirm the production database connection limit (assumed 3) in the Neon dashboard | **Open.** |
| Online exams: switch on about four weeks before a school's first exam period | **Open** (`docs/runbooks/cbt-go-live.md`). |

## 6. What the 2026-10-19 sweep fixed

For the record, so nobody re-checks these. Four reviewers read every route
added since 2026-10-13 (behaviour, health, homework, transport, library,
hostels, admissions, messages, email, RSVPs, fee risk, ID cards, the store).
They found nothing that crossed schools. What they did find, all fixed in the
same PR:

- An ID card whose holder left still scanned "valid". It now scans "No longer
  at the school".
- Approving a stock take twice (a double click) doubled the adjustment. The
  take is now claimed first.
- A child removed from a bus or hostel after billing, then put back, was
  billed twice. The billed charge now follows the new place.
- A child could be sold to from the store after leaving. Refused now.
- Graduation did not free next term's bus seat and bed. It does now, as
  withdrawal did.
- Parallel uploads could get past the three-file limit on homework; files
  attached and never handed in were never deleted. Both fixed (a nightly
  clean-up after 30 days).
- An address that bounced or marked mail as spam still got message and
  admission emails. It gets none now.
- A crash could write an unsubscribe link (with the parent's email) or an
  admissions tracking link into the error logs. Logs now carry the route,
  never the address.
- Smaller: RSVPs no longer ask parents of withdrawn children; a report PDF
  can be fetched only by whoever asked for it; a failed AI-draft start no
  longer leaves the draft stuck; a stuck announcement email no longer waits
  forever; delivery reports are no longer rate-limited; replacing a
  vaccination document no longer risks a dead link; the vehicle seat count
  and card numbering are race-safe.
- Three libraries with known issues were updated (`proxy-addr`, `multer`,
  `fast-uri`). The rest of `pnpm audit`'s list is build and app-tooling only
  (Expo's dev server, PostCSS at build time), not code that serves requests.
