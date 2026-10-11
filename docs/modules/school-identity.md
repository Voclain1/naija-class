# School identity: the school's name on screens and messages

Plan-first, 2026-10-11. **Approved by the owner 2026-10-11.** Slice 1 built
2026-10-11; slice 2 next.

## Why

Parents and staff should see their school, not SchoolKit. Today the staff web
app's sidebar, the parent portal's header and the mobile app's screens lead
with the SchoolKit mark, and every SMS goes out from one platform sender name.
SchoolKit stays visible, smaller, as the platform ("Powered by SchoolKit").

## Decisions taken (owner, 2026-10-11)

- **D1. Branding is for every school, on every plan.** The school's name and
  logo replace the SchoolKit mark wherever a signed-in person is inside one
  school. Report-card branding is unchanged: still a paid-plan extra
  (`docs/modules/plans.md` D5).
- **D2. SMS first; WhatsApp later, as its own module** with the same
  "school's own name, else SchoolKit" design.
- **D3. School subdomains (`<slug>.schoolkit.ng`) later, as their own slice.**
  `schools.slug` is already reserved for it.
- **D4. SchoolKit registers with CAC** for its own sender name (in progress).

## Slice 1: the school's name and logo on screens

| Surface | Today | After |
|---|---|---|
| Staff web: admin sidebar, teacher sidebar, mobile nav | SchoolKit wordmark | School logo + name; "Powered by SchoolKit" small at the foot of the sidebar |
| Staff web: browser tab | "SchoolKit" | "<School> · SchoolKit" once signed in |
| Parent portal: header after sign-in | SchoolKit mark | School logo + name |
| Mobile app: parent, student and staff home headers | SchoolKit / no school | School logo + name |
| Emails the school's people receive (invites, reminders, receipts) | From "no-reply@schoolkit.ng" | Display name "<School> via SchoolKit", same address |

**Stays SchoolKit, deliberately:**
- Sign-in, forgot-password and invitation-accept pages before a school is known.
  Subdomains (D3) are what would let these show the school.
- The mobile app's store name, icon and splash screen. There is one app in the
  stores; a separate build per school is out of scope.
- The super-admin dashboard.

A school with no logo shows its initials on the primary colour. The school's
own colour is not applied to the interface in this slice: free-form colours
break contrast and dark mode, and the request was for names and logos.

### As built (2026-10-11)

- **Staff web:** `SchoolBrand` (`apps/web/src/components/school/school-brand.tsx`)
  heads the admin sidebar, teacher sidebar and mobile drawer;
  `PoweredBySchoolKit` sits at their foot. The topbar's own name and logo now
  show only where there is no sidebar (`sm` to `md`), so they never appear
  twice. `SchoolDocumentTitle`, mounted by `RequireAuth`, sets the tab.
  `SchoolLogo` shares one signed-URL fetch between the instances on a page
  (reused for 45 minutes of the URL's hour) and takes a `fallback`;
  `forgetSchoolLogoUrl()` refreshes every mounted logo after an upload, which
  can keep the same storage path.
- **Portal:** `SchoolBanner` (`apps/portal/src/components/school-banner.tsx`)
  tops the seven signed-in pages and names the tab. `GET /portal/school` and
  `GET /student-portal/me/school` now return `logoUrl`, a signed URL valid for
  an hour or null; still no address or email.
- **App:** `SchoolBadge` (`apps/mobile/src/components/school-badge.tsx`) sits
  above the greeting on the parent, student and staff home screens, whose
  subtitles no longer repeat the name. Its query is never persisted
  (`meta: { persist: false }`): a signed URL restored from disk after the hour
  is a broken image.
- **Email:** `EmailService.send` takes `schoolName`, sent as
  `"<school> via SchoolKit" <no-reply@schoolkit.ng>` (`emailFrom`, which strips
  anything that could break out of the header). Used by the guardian invite,
  guardian password reset, fee reminders and the weekly parent summary.
  SchoolKit's own mail to schools (owner invitations, setup nudges, Paystack
  setup) keeps the bare address.
- **Shared:** `schoolInitials` and `signSchoolLogoUrl` (`apps/api/src/common/storage/school-logo.ts`).

## Slice 2: SMS under the school's own name

A sender name is approved by the four networks against a CAC registration, so
it cannot be self-service.

- **Data.** `schools.sms_sender_id` (3–11 letters/digits) and
  `sms_sender_status` (`none`, `requested`, `approved`, `rejected`), with
  `sms_sender_decided_at`. Operator-set status about the tenancy, like
  `ai_enabled`.
- **School side.** Settings → SMS: the school asks for a sender name and is
  told what the networks need (CAC certificate, letter on letterhead). The
  documents go to SchoolKit by email for now; no upload is built.
- **Operator side.** The platform-admin roster shows each request. The
  operator submits it through SchoolKit's Termii account and marks it approved
  or rejected (audited, like the other platform-admin writes).
- **Sending.** `TermiiService.sendSms` takes the school's approved sender name,
  else falls back to the platform's `TERMII_SENDER_ID`. The message text keeps
  the school's name at the start either way, as invites and reminders already do.
- **Until SchoolKit's CAC lands** there is no approved fallback. Schools without
  their own sender keep email and push, as today.

## Later slices (not in this plan)

- WhatsApp (D2): needs each school's own WhatsApp Business number, verified by
  Meta, for its own name; SchoolKit's number as the fallback.
- Subdomains (D3): wildcard domain on Vercel, school lookup by host, and a
  change to the staff cookie's Origin rule, which is the CSRF defence and
  needs its own security review.

## Tests

- Each surface renders the school's name and logo, and initials with no logo.
- No school's name or logo appears for another school's session.
- `sendSms` uses the approved sender only when status is `approved`; a
  `requested` or `rejected` name never reaches Termii.
- Only the platform operator can change `sms_sender_status`; each change is audited.
