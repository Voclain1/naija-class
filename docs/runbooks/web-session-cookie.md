# Staff web sign-in: moving the API to api.schoolkit.ng

Why this exists: until this change, the staff web app held the session token
in page JavaScript and sent it as a bearer header. Any script injected into
the page could copy it and use it from anywhere. Now the token lives only in
the HttpOnly `sk_session` cookie, which page scripts cannot read. The browser
sends the cookie straight to the API (`docs/deferred.md` item 1, decided
2026-10-05).

For the browser to send that cookie to the API, the API must sit under the
same domain as the web app. So the API gets the address `api.schoolkit.ng`,
and the cookie is set for `schoolkit.ng`.

**Nothing here touches the mobile app, the parent portal or the exam app.**
They keep using bearer tokens and the existing API address.

> **No laptop needed.** Every step is a web dashboard.

---

## Before the switch-over PR is merged

The API side (it accepts the cookie, from the web app's origin only) ships
first and changes nothing on its own. Then:

1. **DNS.** Add a record wherever `schoolkit.ng`'s DNS is managed:

   | Type | Name | Value |
   |---|---|---|
   | CNAME | `api` | `school-kit-api.fly.dev` |

2. **Fly certificate.**
   - Fly dashboard → `school-kit-api` → Certificates → Add certificate →
     `api.schoolkit.ng`.
   - Wait until it shows **Issued**. This is usually minutes once the DNS
     record exists.
3. **Check from a phone.** `https://api.schoolkit.ng/api/v1/health` answers
   the same as `https://school-kit-api.fly.dev/api/v1/health`.
4. **Vercel, project `school-kit-web`.** Settings → Environment Variables
   (Production):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://api.schoolkit.ng/api/v1` (was the fly.dev address) |
   | `SESSION_COOKIE_DOMAIN` | `schoolkit.ng` |

   Then check the list (or run `vercel env ls`). CLAUDE.md records why: a
   recreated project once silently had none.
5. **Fly `school-kit-api`.** `CORS_ORIGIN` must be exactly
   `https://app.schoolkit.ng`, with no trailing slash. It already is if
   sign-in works today. The API accepts the cookie only from that exact
   origin.

## Merging the switch-over PR

- **Merge only after steps 1–4.** If they are missing, the web build fails
  with "Staff session cookie misconfigured: …", and the version already live
  keeps running. Nobody is signed out. Fix the setting, then redeploy.
- **People already signed in stay signed in.** On their next page load, the
  web app moves their existing cookie onto `schoolkit.ng`.

## After

- Sign in on `app.schoolkit.ng`, open a few pages, and upload something:
  a logo, a CSV or a receipt.
- In the browser's developer tools (Network tab), requests to
  `api.schoolkit.ng` carry a `Cookie` header and no `Authorization` header.

## Rolling back

Set `NEXT_PUBLIC_API_URL` back to `https://school-kit-api.fly.dev/api/v1` and
revert the switch-over PR. Both must change together: the reverted web app
sends bearer tokens again, which work on either address.
