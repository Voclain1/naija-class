# School web addresses: `<code>.schoolkit.ng`

Plan-first and approved by the owner, 2026-10-22. Built 2026-10-22.
Picks up D3 of `docs/modules/school-identity.md` ("school subdomains later, as
their own slice"). The richer front page (the school's own content, by plan) is
`docs/modules/school-website.md`.

## Why

Each school gets its own web address, `virgo-fidelis.schoolkit.ng` (no `app.`),
whose page is the school's front door. The address is the school code
(`schools.slug`) that already existed: students type it to sign in, and it is
printed on result PIN cards, inside shared admission links, on invigilator
sheets and in offline exam packs. A school may now change it, within limits.

## Decisions (owner, 2026-10-22)

- **D1. The address is the school code.** No second identifier. Sign-up makes
  it from the school's name, as before, and now previews it as the name is
  typed.
- **D2. The owner changes it, within limits.** Free for the first 30 days and
  while still onboarding; after that, 2 changes in any 12 months, at least 30
  days apart (`SCHOOL_ADDRESS_LIMITS`). Owner only; admins see it. SchoolKit
  can change it from the platform admin without using the school's allowance.
  Every change is audited (`school.address.change`,
  `platform_admin.schools.set-address`).
- **D3. Old codes never die, and never move.** The previous code goes to
  `school_previous_addresses` and keeps working everywhere a code is looked
  up. It is never given to another school, so nobody can pose as a school at
  an address its families already know. A school may take back one of its own
  earlier codes.
- **D4. Rules for a new code:** 3 to 30 lower-case letters, digits and single
  hyphens, starting and ending with a letter or digit; not reserved; not any
  school's, now or before. Codes made earlier may run to 40 characters and stay
  valid.
- **D5. The front page is public; signed-in pages stay where they are.** The
  school's address serves its front page, admission form (`/apply`) and result
  checker (`/results`). Signing in, and everything after, stays on
  `portal.schoolkit.ng` and `app.schoolkit.ng`, so sessions never spread across
  schools' hosts and the staff cookie's Origin rule is untouched.
- **D6. One switch for links.** `SCHOOL_ADDRESSES_LIVE=on` (API) makes the links
  we send and print use the school's address. Off, they stay on the portal.
  Both forms work either way, so flipping it never breaks a link already out.
- **D7. Hosting-neutral.** The portal reads the request's Host; nothing depends
  on Vercel. It runs the same behind a wildcard proxy on a VPS
  (`docs/runbooks/school-addresses.md`).

## As built

**Data.** Migration `20261117120000_school_addresses`:
- `school_previous_addresses` (`slug` unique, `school_id`, `retired_at`,
  `retired_by`, `counts_toward_limit`). FORCE RLS: a read-all policy (codes are
  public; public pages resolve a code before any school is known), insert and
  delete only under the school's own GUC, no update
  (`policies/school-addresses.sql`).
- Two triggers keep codes apart across `schools` and the history table, the
  backstop to the advisory lock every change takes.
- No SECURITY DEFINER function added or changed; count stays 23. Student
  sign-in resolves the typed code to the current one in the service, then calls
  `auth_lookup_student_for_login` unchanged.

**Resolving a code.** `resolveSchoolCode` / `currentSchoolCode`
(`apps/api/src/common/slug/school-code.ts`) are used by student sign-in, the
result checker, the admission form, exam-pack delivery and ID card checks.
Student sign-in and the result checker key their lockout counters on the
current code, so an old and a new code share one counter.

**Changing it.** `changeSchoolAddress` and `addressAllowance`
(`common/slug/school-address-change.ts`), shared by:
- `GET /schools/me/address` (owner/admin), `GET /schools/me/address/check?code=`,
  `PUT /schools/me/address` (owner);
- `PATCH /platform-admin/schools/:id/address`.

**Public.**
- `GET /school-addresses/preview?name=`: the code sign-up would give.
- `GET /school-addresses/:code`: the front page's data (`SchoolPublicDto`):
  name, motto, logo (signed for an hour), the school's own address, phone and
  email, whether admissions are open and whether results can be checked. A
  suspended school is a 404.
- CORS allows `https://<code>.<SCHOOL_ADDRESS_DOMAIN>` without credentials
  (`common/school-origin.ts`), for the pages that call the API from the browser.

**Links.** `schoolSiteUrls` (`common/school-site-url.ts`) builds every public
link: admission tracking emails, the admissions settings link, the PIN card
link (`SchoolMeDto.siteUrls`).

**Portal.**
- `middleware.ts` reads the Host (`lib/school-host.ts`):
  - `/` → `/school/<code>`
  - `/apply…` → `/apply/<code>…`
  - `/results` → `/result-checker/<code>`
  - `/id/…` unchanged
  - anything else → the portal's own address (`/login` gains `?school=<code>`).
- On the portal's own host it guards the signed-in pages as before.
- `/school/[code]` is the front page, rendered on the server on each visit
  with the visitor's signed address. An older code redirects to the current
  one.

**The front page (every plan).**
- Header: the school's logo, or SchoolKit's, with its name and motto.
- **Sign in**: Parents → portal, Students → "the SchoolKit app with school code
  X", Staff → staff app.
- **For families**: Apply and Check results, when open.
- **Contact the school**: address, phone, email, when set.
- One line of footer, `© <year> SchoolKit`.

**Sign-in pages.** With `?school=<code>`, the portal's and the staff app's
sign-in pages say "Signing in to <school>" with its logo.

**Staff web.** Settings → School: the address, earlier addresses, what the
limits allow now, Change address with a live check, View your school's page.
Sign-up previews the address. Super-admin Manage: "Web address".

**Environment.**

| Variable | Where | Value |
|---|---|---|
| `SCHOOL_ADDRESS_DOMAIN` | `school-kit-api` | `schoolkit.ng` (CORS for school addresses, and links) |
| `SCHOOL_ADDRESSES_LIVE` | `school-kit-api` | `on` once DNS and certificates work; else unset |
| `NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN` | `school-kit-portal` | `schoolkit.ng` |
| `NEXT_PUBLIC_PORTAL_URL` | `school-kit-portal` | `https://portal.schoolkit.ng` |
| `NEXT_PUBLIC_WEB_URL` | `school-kit-portal` | `https://app.schoolkit.ng` |

## Tests

- `school-address.service.spec.ts` (real database):
  - the owner changes the address; the old code resolves, and the change is
    audited;
  - an admin can see the address but not change it;
  - another school's code, current or old, is refused, and sign-up skips it;
  - a school can take back its own old code;
  - reserved, malformed and unchanged codes are refused;
  - the limits;
  - the triggers block a direct update to another school's old code;
  - the RLS write rules hold;
  - the public data: an old code resolves, only the listed fields are
    returned, and a suspended school is a 404.
- `school-origin.spec.ts`, `school-site-url.spec.ts`.
- Portal: `school-host.spec.ts`, `middleware.spec.ts` (routing on a school's
  host, and the signed-in guard unchanged).
- e2e `school-address.spec.ts`:
  - the owner changes the address in Settings;
  - the old code's page redirects to the new one;
  - the parent sign-in names the school.
