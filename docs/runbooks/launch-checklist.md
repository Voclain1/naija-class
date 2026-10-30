# Launch checklist

Everything that stands between the code as built and schools relying on it,
with who does it and where. Written 2026-10-19 after the pre-launch sweep; updated for the VPS on
2026-10-30.
Tick an item here **and** in `docs/deferred.md` when it is done. Engineering
work that is already built is not listed; this page is what is left.

Status key: **Done**, **Open** (needs doing), **Waiting** (on someone outside).

## 1. Settings on the live services

Since the move on 2026-10-26 everything runs on the VPS
(`docs/runbooks/vps-migration.md`). Settings live in three GitHub secrets,
written to the server by `deploy-vps.yml` on every deploy: `API_ENV_FILE`
(the API and render worker), `WEB_ENV_FILE` and `PORTAL_ENV_FILE`. They were
filled from the Fly and Vercel values at the move. Changing one takes effect
at the next deploy (the next merged PR, or **deploy-vps** run by hand).

| Item | Where | Status |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` | `API_ENV_FILE` | **Check** that the line is there. Then an announcement's outbox shows "delivered"; without it the webhook answers 503. |
| Resend webhook to `https://api.schoolkit.ng/api/v1/webhooks/resend` (delivered, bounced, complained) | Resend → Webhooks | **Done** 2026-10-19, enabled. |
| `STORAGE_DRIVER=r2` and the four `R2_*` values | `API_ENV_FILE` | **Done** 2026-10-20, carried to the VPS. Any other value would keep uploads inside the container, which a deploy replaces. |
| `RESULT_PIN_HMAC_KEY` | `API_ENV_FILE` | **Done.** The API refuses to start in production without it, and it is running on the VPS. |
| `PORTAL_PROXY_SECRET`, the same value in both | `API_ENV_FILE` and `PORTAL_ENV_FILE` | **Check** the two values match. In one only, it silently does nothing (rate limits key on the portal, not on each family). |
| `SESSION_COOKIE_DOMAIN=schoolkit.ng` | `WEB_ENV_FILE` | **Done** 2026-10-07 (`docs/runbooks/web-session-cookie.md`). The web build refuses to start without it, so a running web app means it is set. |
| WhatsApp alerts for setup-call bookings (`WHATSAPP_*`) | Meta, then `API_ENV_FILE` | **Open** (optional). Steps in `docs/runbooks/whatsapp-alerts.md`. Until then bookings come by email, in the platform admin under Setup calls, and from the school's own WhatsApp. |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | `API_ENV_FILE` | **Open** (optional). Unset sends nothing. |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` for the web build | the web image build in `deploy-vps.yml` | **Open** (optional). Uploads source maps, so browser errors show real file names. Needs the token passed to the build as a build secret; today the VPS web build has none, so it uploads nothing. |
| School web addresses (`<code>.schoolkit.ng`): wildcard domain and certificate | The VPS (Caddy) | **Done.** Live since 2026-10-23, on the VPS since 2026-10-26 (`docs/runbooks/school-addresses.md`, VPS section). |
| The old Vercel projects (`school-kit-web`, `school-kit-portal`) | Vercel | **Open.** Git is disconnected (owner, 2026-10-26), but the projects still build PR previews. Unlink the repository or delete the projects once nothing points at them. |

## 2. Payments, messages and AI

| Item | Status |
|---|---|
| Paystack webhook URL in the Paystack dashboard | **Done** 2026-10-11. |
| One real payment from a phone: checkout closes and the invoice updates | **Done** 2026-10-20. Production runs on the live key, so it was a real ₦100 payment from the portal on a phone, to a test school whose subaccount is the owner's own account. Checkout closed, the invoice showed Paid, and the split reached the subaccount. |
| Switch off Paystack's own customer receipt emails (Paystack dashboard → Settings → Preferences) | **Open**, and safe to do now: our school-named payment confirmation email (2026-10-21) is live. Paystack's email says "payment to SchoolKit"; ours names the school. |
| SchoolKit's Paystack trading name | **Open** (optional). Suggested: "SchoolKit School Fees" (21 characters, so statements do not cut it off). It is what parents see on bank statements. Paystack may ask for it to match the registered business. |
| SMS sender name: SchoolKit's CAC registration, then `TERMII_SENDER_ID` | **Waiting** (CAC). Schools with their own CAC can request their own name now. |
| WhatsApp (CP9) | **Waiting** on a Meta-approved business number. |
| AI: `AI_ENABLED` is on, and every school's AI and Smart Import switches are on | **Done** 2026-10-25 (migration `20261125120000`): on for every school, and new schools start with both on. The platform admin can still switch either off for one school. |
| Setup reminders to stuck schools (`docs/modules/activation.md`) | **Live with the deploy.** The daily run (08:41 Lagos) sends existing stuck schools their first reminder 25 a day; follow them on the platform admin's **Getting started** page. Delivered and bounced need the Resend webhook (`RESEND_WEBHOOK_SECRET`, section 1); clicks are counted by the API either way. |
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
| Production database connection limit | **No longer applies.** Neon's limit was the concern; since 2026-10-26 the database is Postgres on the VPS, beside the API. |
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
