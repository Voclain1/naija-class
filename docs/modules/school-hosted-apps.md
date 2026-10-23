# Schools work from their own address

Planned 2026-10-23; approved and built the same day. **As built.** Builds on
`docs/modules/school-addresses.md` (each school's `<code>.schoolkit.ng`) and
`docs/modules/school-website.md`. Switch-on steps:
`docs/runbooks/school-addresses.md` §5.

## Why

The owner's brief (2026-10-23): schools should work from their own address,
not from `app.schoolkit.ng` or `portal.schoolkit.ng`. Those two still work and
can be linked to where needed.

## What a school's address serves

| Who | Address | Served by |
|---|---|---|
| Families (public) | `virgo.schoolkit.ng`, `/apply`, `/results`, `/news`, `/gallery` | the portal, unchanged |
| Parents | `virgo.schoolkit.ng/parents/…` | the portal, rewritten by its middleware |
| Staff | `virgo.schoolkit.ng/staff/…` | the staff web app, forwarded by the portal |
| Students | the SchoolKit app | unchanged |
| New schools signing up | `app.schoolkit.ng/staff/signup` | never at a school's address |
| SchoolKit's super-admin | `app.schoolkit.ng/staff/super-admin` | never at a school's address |

The front page's **Parents** and **Staff** buttons open `/parents/login` and
`/staff/login` when the page is at the school's own address, and the portal's
or staff app's sign-in (with `?school=`) when it is not.

## Decisions (the owner's, 2026-10-23)

1. **Paths:** `/parents` and `/staff`.
2. **`portal.` and `app.` afterwards:** option (a). Both keep working; we stop
   sending links to them. Moving people across automatically after sign-in
   (option (b)) can follow once schools are used to it.
3. **A teacher at two schools** keeps one account per school; each school's
   address signs into its own account. The same holds for a parent.

## Parents (`apps/portal`)

- **Routing** (`src/middleware.ts`): on a school's host, `/parents[/x]` is
  rewritten to the portal page `/[x]`. Signed-in pages need the session cookie
  there, as on the portal's own host, and a signed-out visitor goes to
  `/parents/login?next=…`. Any other unknown path is redirected to its
  `/parents` form, so an unprefixed link still lands. `/parents/school/…`,
  `/parents/apply/…` and `/parents/result-checker/…` go to `/`: another
  school's public pages are never shown inside this one's.
- **Links** (`src/lib/portal-path.ts`): Next has no per-request base path, so
  the prefix is read from the browser's address. `PortalLink` (a drop-in for
  `next/link`) and `usePortalRouter` add `/parents` on a school's host; so do
  the sign-out, post-sign-in and student-invite links. Server rendering starts
  without the prefix and corrects itself on mount; the middleware redirect
  covers that moment.
- **Cookie:** `sk_portal_session` is host-only away from `portal.schoolkit.ng`
  already, so signing in at Virgo Fidelis signs you in there only.
- **Paystack:** a parent paying at the school's address sends
  `returnTo: "school"`. Paystack returns them to
  `<code>.schoolkit.ng/parents/payments/callback`, where their sign-in lives.
  The value comes from a fixed list, never a URL.

## Staff (`apps/web`)

- **Base path `/staff`** (`next.config.mjs`), everywhere. Every older address
  redirects (307, method and query kept) to the same page under `/staff`.
  Next prefixes `<Link>`, the router and `redirect()` itself. Everything else
  goes through `withBasePath` (`src/lib/base-path.ts`): `proxyFetch` to our own
  `/api` routes, the preview proxy, `window.location`, the import templates and
  the brand images.
- **Forwarding:** on a school's host the portal rewrites `/staff/…` to
  `NEXT_PUBLIC_WEB_URL` + `/staff/…` (Next.js multi-zones). It sets
  `x-schoolkit-host` to the school's host. The staff app builds its server
  redirects on that host (`src/lib/public-origin.ts`), never on its own. A
  header that is not a school address is ignored. `/staff/signup` and
  `/staff/super-admin` redirect to `/staff/login` there.
- **Cookie:** `sk_session` is set with Domain `schoolkit.ng`
  (`SESSION_COOKIE_DOMAIN`), so it reaches the API from a school's address too.
  This needs no change.

## The API's per-school Origin rule

The staff cookie's CSRF defence was "Origin must be `CORS_ORIGIN`". It now also
accepts a school address Origin, but **only for a session of that same school**:

- `staffSessionToken` returns the code from a school address Origin
  (`common/school-origin.ts` `schoolCodeFromOrigin`). Reserved codes
  (`app`, `portal`, `cbt`, `api`…) are not school addresses, and the web
  app's own origin is checked first.
- `AuthGuard` resolves that code (`resolveSchoolCode`, old codes included,
  remembered for a minute) and refuses a session of any other school with 401
  `INVALID_SESSION`.
- CORS allows credentials for school addresses (`main.ts`).

This is stricter than before for a session used at a school's address: it is
tied to that school.

**What it cannot separate.** At a school's address the parents' pages and the
staff area share one origin. A script injected into either could act with the
other's session. The staff cookie stays HttpOnly, but such a script could still
call the API with it. Treat an XSS in the portal as an XSS in the staff app.

## Signing in names the school

`loginSchema`, `forgotPasswordSchema`, `guardianLoginSchema` and
`guardianForgotPasswordSchema` take an optional `schoolCode`. The sign-in pages
send it only when opened at a school's address.

- `signInSchoolScope` (`common/slug/school-code.ts`) allows any school when no
  code is given, that school only for a known code, and none for an unknown one.
- Staff sign-in: an account at another school fails as `INVALID_CREDENTIALS`,
  checked after the password, like `is_active`.
- Parent sign-in and recovery: the lookup rows are filtered to the school
  before the password loop. At a school's address, `AMBIGUOUS_GUARDIAN_ACCOUNT`
  can no longer happen.
- No SECURITY DEFINER function changed; count stays 23.

## Links

`parentSiteUrl(code, path)` and `staffSiteUrl(code, path)`
(`common/school-site-url.ts`) give `<code>.schoolkit.ng/parents|staff<path>`
while `SCHOOL_ADDRESSES_LIVE` is on, and the portal's or staff app's address
otherwise. The school's slug is read with `schoolSlugOf`
(`common/slug/school-slug-of.ts`). They are used for:

- staff invitations (single, CSV import, owner invitation from the
  super-admin);
- parent invitations and resends;
- staff and parent password resets;
- message alerts to staff and parents;
- admission alerts to staff;
- the announcement email's "Read it" link;
- the Paystack return page (above).

`SchoolMeDto.siteUrls` gains `parents` and `staff`, the two sign-in pages; the
debtor reminder message uses `parents`.

Unchanged, on purpose:

- unsubscribe links (`portal.schoolkit.ng/email/unsubscribe`, which needs no
  sign-in);
- ID card verification;
- new-school sign-up;
- links with no school to hand, which fall back to the portal or the staff app.

## Not changed

- The phone apps.
- Online exams (`cbt.schoolkit.ng`).
- The API at `api.schoolkit.ng`.

## Tests

- **API:**
  - `staff-session-token.spec.ts` (school address Origin, look-alikes, the web
    app first);
  - `school-origin.spec.ts`;
  - `school-site-url.spec.ts`;
  - `auth.session.spec.ts` (the cookie from its own school's address is
    accepted and from another's refused; scoped staff sign-in);
  - `portal-auth.recovery.spec.ts` (scoped parent sign-in and reset).
- **Portal:** `middleware.spec.ts` (`/parents`, the redirects, `/staff`
  forwarding with the header, the blocked paths); `portal-path.spec.ts`.
- **Web:** `base-path.spec.ts`; `public-origin.spec.ts`.
- **e2e** (`school-hosted-apps.spec.ts`):
  - a parent signs in at the school's address and stays on it;
  - another school's address refuses both a parent and a member of staff;
  - old staff addresses redirect under `/staff`.

  In development a school's address is `<code>.localhost:3002`. There the staff
  cookie is host-only, so a full staff sign-in at a school's address is checked
  in production (runbook §5), not in e2e.
