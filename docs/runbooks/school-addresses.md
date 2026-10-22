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
