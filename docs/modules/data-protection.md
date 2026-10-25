# Data protection: consent records, the parent letter and the legal pages

Built 2026-10-25, after the owner asked whether SchoolKit gets parents'
consent and whether the legal pages were complete. They were not: the
privacy policy predated most features, there was no data processing
agreement, cookie consent, refund policy or public account-deletion page, the
consent ticks linked to nothing, and a parent's tick was not recorded.

## Decisions

- **The school obtains a parent's consent, not SchoolKit.** The school is
  the controller, SchoolKit the processor (NDPA 2023). SchoolKit's job is to
  make the school's duty explicit and easy: the owner confirms it, and the
  product gives the school a letter to send.
- **Every consent record carries a wording version.** `SCHOOL_CONSENT_VERSION`
  and `PARENT_CONSENT_VERSION` in `packages/types/src/legal`. When wording
  changes in a way that changes what someone agrees to, bump the version: the
  owner sees a dashboard line and parents see the consent screen again.
- **Never lock a parent out.** The parent's consent screen shows only when a
  read succeeds and says the record is not current; a failed read shows
  nothing.
- **No AI company is named in the product** (owner's rule, 2026-10-24). The
  privacy policy describes "AI model providers (United States)" by category;
  a school can ask for the named list. A lawyer may want them named in the
  policy itself — the owner's call.
- The legal pages are drafts written for this product. They need review by a
  Nigerian data protection lawyer before they are relied on (see
  `docs/legal/ndpr-ai-review.md`, which is also still unsigned).

## What was built

**Marketing site (schoolkit-landing)**
- `/privacy-policy` brought up to date: health data, admissions, messages and
  photos, the AI drafting features and their two PII exceptions, current
  providers and where data is held, retention periods, parental consent.
- New: `/data-processing-agreement`, `/cookies`, `/refund-policy`,
  `/delete-account` (the public page the app stores ask for).
- Google Analytics and the Meta Pixel load only after **Accept** on a cookie
  banner (`components/CookieConsent.tsx`); **Cookie settings** in the footer
  reopens it.
- Terms link the DPA (with the parental-consent duty) and the refund policy.

**Product (this repo)**
- `schools.ndpr_consent_version`, `schools.ndpr_consent_by`,
  `guardians.portal_consent_at`, `guardians.portal_consent_version`
  (migration `20261120120000_data_protection_consent`). Existing RLS covers
  them; no SECURITY DEFINER change (count stays 23).
- Sign-up and setup step 4 record the version; step 4 also records who.
- `GET /schools/me/data-protection`, `POST /schools/me/data-protection/confirm`
  (owner only, audited `data_protection.school_confirmed`).
- Accepting a parent invitation records the consent and version.
  `GET|POST /portal/me/consent` (audited `data_protection.guardian_consented`)
  for parents who joined earlier.
- Staff web: the sign-up, step-4 and staff-invitation ticks name and link the
  documents; **Settings → Data protection** (confirmation, the letter to
  parents with Copy / Print / Download, the documents); dashboard line
  `data_protection_unconfirmed`; legal links under every sign-in page.
- Parents' site: the invitation tick links the documents; a one-time consent
  screen (`components/consent-gate.tsx`, mounted by `SchoolBanner`); legal
  links on sign-in and Settings; a privacy line under the admission consent;
  **Privacy** in the school website footer.
- App: the same one-time consent screen for parents
  (`src/components/guardian-consent-gate.tsx`, at the root layout); legal links
  on the sign-in screen and in the **Delete my account** card; the staff
  dashboard line opens Settings → Data protection on the web.

Tests: `data-protection.service.spec.ts` (old record not current, owner-only
confirm with version and who, parent consent, version moves, schools kept
apart); `portal-auth.accept-guard.spec.ts` (accept records the version);
`lib/consent.test.ts` on the marketing site.
