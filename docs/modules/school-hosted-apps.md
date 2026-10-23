# Schools work from their own address

Plan-first, 2026-10-23. **Waiting for the owner's Start and the decisions
below.** Builds on `docs/modules/school-addresses.md` (each school's
`<code>.schoolkit.ng`) and `docs/modules/school-website.md`.

## Why

The owner's brief (2026-10-23): schools should work from their own address,
not from `app.schoolkit.ng` or `portal.schoolkit.ng`. Those two still exist
and can be linked to where needed.

Today the school's address serves only public pages: the front page, `/apply`
and `/results`. Signing in sends everyone to `portal.` or `app.`.

## The proposal

A school's address becomes its whole site:

| Who | Today | Proposed |
|---|---|---|
| Families (public) | `virgo.schoolkit.ng` | unchanged |
| Parents | `portal.schoolkit.ng/…` | `virgo.schoolkit.ng/parents/…` |
| Staff | `app.schoolkit.ng/…` | `virgo.schoolkit.ng/staff/…` |
| Students | the SchoolKit app | unchanged (the app) |
| New schools signing up | `app.schoolkit.ng/signup` | unchanged |
| SchoolKit's super-admin | `app.schoolkit.ng/super-admin` | unchanged |

The front page's **Parents** and **Staff** buttons open the sign-in pages at
the school's own address, already naming the school.

## How

### Parents (the portal)

The portal already serves school addresses, so this part is mostly routing:

- On a school's address, `/parents/…` is rewritten to the portal's own pages:
  `/parents` → the home page, `/parents/students/…`, `/parents/messages`, and
  so on.
- Internal links in the portal become relative to wherever it is served.
- The parent's sign-in cookie becomes host-only on the school's address. Signing
  in at Virgo Fidelis signs you in there only.
- **Sign-in knows the school.** At a school's address, a parent's email and
  password are checked against that school only. This retires the "which
  school?" ambiguity for a parent with children at two schools: each school's
  address is a separate sign-in. No SECURITY DEFINER change is needed: the
  existing lookup already returns each match's school, and the service keeps
  only the one for the address.

### Staff (the web app)

The staff app is a separate Vercel project, so it cannot simply be rewritten
into the portal. The standard way is Next.js **multi-zones**:

- The staff app gets the base path `/staff`.
- The portal forwards `/staff/…` on a school's address to the staff app.
- `app.schoolkit.ng` keeps working, but moves to `app.schoolkit.ng/staff/…`.
  The old paths redirect, so bookmarks still work.

**The sign-in cookie and its safety rule.** Today the staff session cookie is
accepted only from `app.schoolkit.ng`; that one Origin rule is the CSRF
defence. It will now also be accepted from a school's own address, but **only
for a session belonging to that same school**. A Virgo Fidelis session sent
from another school's address is refused. This is stricter than today, because
a session is now tied to its school's address.

### Links in emails, SMS and push

These all point at the school's address:
- staff and parent invitations;
- password resets;
- the payment return page after Paystack;
- announcement and message emails;
- links opened from the apps.

`SCHOOL_ADDRESSES_LIVE` stays the switch for links. With it off, everything
works as today.

### What does not change

- The phone apps.
- Online exams (`cbt.schoolkit.ng`), which run offline on lab computers.
- The API at `api.schoolkit.ng`.
- New-school sign-up and SchoolKit's super-admin, which stay at
  `app.schoolkit.ng`.

### The VPS move

Path-based routing on one host is simpler on a VPS than on Vercel: one
reverse proxy sends `/staff` to the staff app and the rest to the portal. The
runbook gains that block.

## Slices (one PR)

1. **Parents at the school's address:**
   - the `/parents` routes;
   - sign-in scoped to the school;
   - the host-only cookie;
   - parent links in emails.
2. **Staff at the school's address:**
   - the `/staff` base path and multi-zone forwarding;
   - the API's per-school Origin rule;
   - redirects from the old `app.` paths;
   - staff links in emails.
3. **Tidy-up:**
   - the front page buttons;
   - the Paystack return page;
   - push links;
   - the runbook for Vercel and the VPS;
   - the onboarding guide;
   - e2e tests.

## Decisions for the owner

1. **Paths:** `/parents` and `/staff`, or other words (for example `/portal`
   and `/office`)?
2. **`portal.` and `app.` afterwards:**
   - (a) keep both fully working, but stop sending links to them; or
   - (b) after sign-in, move people to their school's address automatically.
   Recommended: (a) at first, then (b) once schools are used to it.
3. **A teacher who works at two schools** already has two separate accounts,
   one per school. Each school's address signs into its own account.
   Confirm that is fine.
