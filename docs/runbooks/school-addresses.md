# Runbook: switching on school addresses (`<code>.schoolkit.ng`)

What makes `virgo-fidelis.schoolkit.ng` answer with the school's page
(`docs/modules/school-addresses.md`). The code is live as soon as it deploys;
these steps make the addresses reachable, then switch the links over.

Order matters. Until step 4, every link we send and print keeps using
`portal.schoolkit.ng/...`, which keeps working afterwards too.

## 1. Set the variables

| Where | Variable | Value |
|---|---|---|
| `school-kit-portal` (Vercel, or the VPS) | `NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN` | `schoolkit.ng` |
| `school-kit-portal` | `NEXT_PUBLIC_PORTAL_URL` | `https://portal.schoolkit.ng` |
| `school-kit-portal` | `NEXT_PUBLIC_WEB_URL` | `https://app.schoolkit.ng` |
| `school-kit-api` (Fly) | `SCHOOL_ADDRESS_DOMAIN` | `schoolkit.ng` |

`NEXT_PUBLIC_*` values are built into the portal, so redeploy it after setting
them. On Vercel, run `vercel env ls` afterwards (CLAUDE.md: a recreated project
silently loses its variables).

## 2. Point every school address at the portal

One wildcard record, `*.schoolkit.ng`, sends every school's address to the
portal. Records that name a host exactly (`app`, `api`, `portal`, `cbt`, `www`)
win over the wildcard, so those keep working unchanged.

### While on Vercel (DNS on Vercel)

1. Vercel → the **school-kit-portal** project → Settings → Domains → Add
   `*.schoolkit.ng`.
2. Vercel adds the wildcard DNS record itself and issues a wildcard certificate.
   Vercel only does this when the domain uses **Vercel's nameservers**, which
   `schoolkit.ng` does today.
3. Wait for the domain to show **Valid Configuration**.

### On the VPS (after the move)

1. **DNS:** an `A` (and `AAAA`) record for `*.schoolkit.ng` pointing at the VPS.
   Keep the exact records for the other hosts.
2. **Certificate:** a wildcard certificate needs the **DNS-01** challenge, so the
   DNS host must have an API the certificate tool supports (Cloudflare, for
   example). With Caddy:

   ```
   *.schoolkit.ng {
     tls {
       dns cloudflare {env.CF_API_TOKEN}
     }
     reverse_proxy 127.0.0.1:3002
   }
   ```

   With nginx and certbot, use certbot's DNS plugin for the provider
   (`certbot certonly --dns-cloudflare -d '*.schoolkit.ng'`) and a server block
   with `server_name *.schoolkit.ng;` proxying to the portal.
3. **Pass the Host header through unchanged** (Caddy does by default; nginx needs
   `proxy_set_header Host $host;`). The portal decides which school from it.
4. **Pass the visitor's address** as `X-Real-IP` / `X-Forwarded-For`
   (`proxy_set_header X-Real-IP $remote_addr;`). Per-family rate limits use it.

## 3. Check before switching links

- Open `https://<a real school's code>.schoolkit.ng`: the school's page, with
  its name and logo.
- `/apply` shows the admission form and `/results` the result checker, if the
  school has them open.
- **Parents** opens the portal's sign-in naming the school.
- An unknown code shows "not found"; `portal.schoolkit.ng` still works.

## 4. Switch the links over

On `school-kit-api`: `SCHOOL_ADDRESSES_LIVE=on`. Admission emails, the
admissions settings link and the PIN card link now use the school's own
address. To undo, unset it; both kinds of link keep working.

## 5. Schools working from their own address (parents and staff)

Since 2026-10-23 (`docs/modules/school-hosted-apps.md`) parents sign in at
`<code>.schoolkit.ng/parents` and staff at `<code>.schoolkit.ng/staff`. The
staff app moves to `/staff` everywhere: `app.schoolkit.ng/dashboard` now
redirects to `app.schoolkit.ng/staff/dashboard`, so old links keep working.

**One new variable:**

| Where | Variable | Value |
|---|---|---|
| `school-kit-web` (Vercel) | `NEXT_PUBLIC_SCHOOL_ADDRESS_DOMAIN` | `schoolkit.ng` |

Set it as type **Config**, like the portal's, then redeploy `school-kit-web`.
These must already be set (steps 1 and 4, and the staff cookie runbook):

- `school-kit-portal`: `NEXT_PUBLIC_WEB_URL=https://app.schoolkit.ng`. The
  portal forwards `/staff` there.
- `school-kit-web`: `SESSION_COOKIE_DOMAIN=schoolkit.ng`. Without it the staff
  cookie would not reach the API from a school's address.
- `school-kit-api`: `SCHOOL_ADDRESS_DOMAIN=schoolkit.ng` and
  `SCHOOL_ADDRESSES_LIVE=on`.

**Deploy order:** the API first, then both Vercel projects. Merging deploys all
three within minutes. In the gap, a parent's **Forgot password?** at a school's
address can fail, because the older API refuses the new school field.

### While on Vercel

Nothing else to do. The wildcard domain from step 2 already sends every
school's address to `school-kit-portal`. The portal forwards `/staff` to
`app.schoolkit.ng` itself and names the school's address in an
`x-schoolkit-host` header. That header keeps the staff app's redirects on the
school's address.

### On the VPS (after the move)

Send `/staff` on a school's address straight to the staff app, and set the same
header. **Overwrite** any value the browser sent. With Caddy:

```
*.schoolkit.ng {
  tls {
    dns cloudflare {env.CF_API_TOKEN}
  }
  handle /staff* {
    reverse_proxy 127.0.0.1:3001 {
      header_up X-Schoolkit-Host {host}
    }
  }
  handle {
    reverse_proxy 127.0.0.1:3002
  }
}
```

With nginx, use a `location /staff` block proxying to the staff app with
`proxy_set_header X-Schoolkit-Host $host;`, and keep everything else going to
the portal. The staff app itself must still be served at `app.schoolkit.ng`,
with its `/staff` base path.

### Checks (a phone is enough)

1. Open `https://<a real school's code>.schoolkit.ng` and press **Staff**. The
   address is now `<code>.schoolkit.ng/staff/login`, and the page names the
   school. There is no "Create an account" link.
2. Sign in as a member of that school's staff. You land on the dashboard and the
   address stays `<code>.schoolkit.ng/staff/…`. Open a few pages.
3. Go back to the school's page and press **Parents**. The address is
   `<code>.schoolkit.ng/parents/login`. A parent of that school can sign in and
   open a child's page; the address stays `<code>.schoolkit.ng/parents/…`.
4. Open `https://app.schoolkit.ng/dashboard`. It moves to
   `app.schoolkit.ng/staff/dashboard` and works as before.
5. `https://portal.schoolkit.ng` still signs parents in.

**If step 2 lands on `app.schoolkit.ng`**, the `x-schoolkit-host` header is not
reaching the staff app. **If it bounces back to sign-in**, check
`SESSION_COOKIE_DOMAIN` on `school-kit-web`.
