# Moving School Kit to a VPS

Status: **repo side built 21–23 Oct 2026, nothing live.** Fly, Vercel and
Neon are untouched until the cutover in §6. Decided Oct 2026: move all of
School Kit (the apps and the marketing site) off Fly, Vercel and Neon to a
Contabo VPS, to cut monthly cost, before Vercel renews on **28 October**,
together with betgenius (`betgenius/docs/VPS_MIGRATION.md`). Other projects
follow afterwards.

Everything is driven from GitHub Actions, so it can be run from a phone.

## 1. What moves where

| Today | On the VPS |
|---|---|
| Fly `school-kit-api` | `api` container, same image (`apps/api/Dockerfile`) |
| Fly `school-kit-render-worker` (stops when idle, woken over HTTP) | `render-worker` container (`apps/api/Dockerfile.render`), always running, one instance |
| Vercel `school-kit-web`, `school-kit-portal` | `web`, `portal` containers (`infra/vps/Dockerfile.next`, Next.js standalone) |
| Exam app (`apps/cbt`, not live yet) | `cbt` container, off until `VPS_CBT_ENABLED=true` |
| Vercel `schoolkit` (the marketing site, `schoolkit.ng`, repo `schoolkit-landing`) | `landing` container, deployed by that repo's own `deploy-vps.yml` through `infra/vps/deploy-landing.sh` |
| Neon Postgres | Postgres 16 + pgvector in Docker (`infra/vps/postgres`), loopback only |
| Fly/Upstash Redis | `redis` container, append-only, `noeviction` (BullMQ) |
| Fly and Vercel HTTPS | Caddy, certificates from Let's Encrypt; Cloudflare in front |
| Neon's backups and point-in-time restore | Nightly `pg_dump` plus continuous WAL archiving (WAL-G) to object storage, §8 |

Unchanged: Cloudflare R2 (files), Paystack, Termii, Resend, Expo push,
Anthropic, Voyage, Sentry, PostHog. Their webhooks use `api.schoolkit.ng`,
which keeps its name. The marketing site keeps its Upstash Redis (rate
limits over HTTPS, works from anywhere) and its Resend webhook
(`schoolkit.ng/api/webhooks/resend`, same name).

## 2. What changed in the code, and why

Each of these silently stops working off Fly or Vercel unless fixed:

| Change | Why |
|---|---|
| `apps/mobile/eas.json` calls `https://api.schoolkit.ng`, not `school-kit-api.fly.dev` | An installed app keeps its API address until every phone updates. **Must be merged before the store build.** |
| `CLIENT_IP_HEADER` (`client-ip-throttler.guard.ts`) | Per-client rate limits read Fly's `Fly-Client-IP`. On a VPS anyone could send that header. Set to `x-real-ip`, which Caddy overwrites with the address it trusts. |
| `SCHEDULED_JOBS=off` (`common/schedule/scheduled-jobs.ts`) | A rehearsal runs on a copy of production. Its scheduled jobs would remind real families. |
| `APP_ENV=production` in `session-cookie-config.mjs` | The staff session-cookie safety check only ran on Vercel production builds. |
| `NEXT_OUTPUT=standalone` in the three `next.config.mjs` | Self-contained Next.js servers for the images. Unset on Vercel, so nothing changes there. |
| `FLY_DEPLOY_DISABLED` in `deploy-staging.yml` | Stops merges deploying to Fly and migrating Neon after cutover. |

## 3. The days before Vercel renews (28 October)

| Day | What | Who |
|---|---|---|
| Thu 23 Oct | Merge the branches in naija-class and schoolkit-landing (the mobile fix before any store build). Order the VPS. Cloudflare: add `schoolkit.ng`, check every record, switch nameservers (§5). Create the object storage bucket. | Owner |
| Fri 24 Oct | Add the GitHub settings (§4) in both repos. Run `vps-setup`, `deploy-vps`, then `vps-db-copy`; then schoolkit-landing's `deploy-vps`. The rehearsal is up on `*.vps.schoolkit.ng` and `vps.schoolkit.ng`. | Owner, from GitHub |
| Sat 25 Oct | Rehearsal checks (§6.1). Fix what they find. Run `db-restore-test` and check the bucket has `wal/` and `dumps/`. | Both |
| Sun 26 Oct | If anything was fixed: `vps-db-copy` again and repeat the checks. **Go / no-go by the evening.** | Both |
| **Mon 27 Oct, 04:00 Lagos** | **Cutover** (§6.2): apps and marketing site together. | Owner, from GitHub |
| Mon 27 Oct, afternoon | If all is well, downgrade Vercel before it renews (§7). | Owner |
| Following week | Watch: Sentry, `/api/v1/health`, the backup ping, one real payment. Then cancel Fly and Neon (§7). | Owner |

This leaves a single rehearsal with one day of slack. **If the rehearsal
finds something that is not fixed by Sunday evening, do not cut over on
Monday:** pay one more Vercel month and cut over the following weekend.

Vercel's free Hobby plan does not allow commercial use, so Pro can only end
once every commercial project has left it (betgenius, and the other
projects that follow, such as credocatholica). Until then, cutting builds
(Build Machine "Standard", previews off) keeps Pro close to its bare $20.

## 4. Settings

### The server

One Contabo Cloud VPS for School Kit alone: **at least 8 GB RAM, 4 vCPU, NVMe**
(Postgres, Redis, the API, the 2 GB render worker and two Next.js servers).
Run betgenius on its own server so a traffic spike there cannot slow schools
down. Order it with Ubuntu 24.04 and an **SSH key**. Then set the
`PG_SHARED_BUFFERS` variable to a quarter of the RAM and
`PG_EFFECTIVE_CACHE_SIZE` to half, unless you keep the defaults
(1 GB / 3 GB, which suit 8 GB).

**Postgres version.** The VPS runs 16, like CI. `vps-db-copy` refuses to copy
from a newer Neon and names the version to set as `PG_MAJOR`. Settle that
before the server's first deploy: it decides the data format.

### GitHub (Settings → Secrets and variables → Actions)

Secrets:

| Name | Value |
|---|---|
| `VPS_HOST` | The server's IP address |
| `VPS_SSH_KEY` | The private half of the key the server was ordered with |
| `VPS_POSTGRES_PASSWORD`, `VPS_SCHOOL_KIT_DB_PASSWORD`, `VPS_APP_USER_DB_PASSWORD` | Three different `openssl rand -hex 24` values. **Set once.** They are written into the database on its first start; changing them later does not change the database. |
| `API_ENV_FILE` | Everything the Fly API has today, one `NAME=value` per line: `flyctl secrets list` names them, and `apps/api/fly.toml [env]`. The deploy replaces `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `RENDER_WORKER_URL`, `API_PORT`, `NODE_ENV` and sets `CLIENT_IP_HEADER=x-real-ip`. For the rehearsal: `CORS_ORIGIN`, `CORS_ORIGIN_PORTAL`, `WEB_BASE_URL`, `PORTAL_BASE_URL`, `API_URL`, `BETTER_AUTH_URL` use the rehearsal names, and Paystack's **test** keys. |
| `WEB_ENV_FILE` | The `school-kit-web` Vercel variables (`vercel env pull`). Must include `NEXT_PUBLIC_API_URL` and `SESSION_COOKIE_DOMAIN=schoolkit.ng`. |
| `PORTAL_ENV_FILE` | The `school-kit-portal` Vercel variables, including `PORTAL_PROXY_SECRET` (the same value as in `API_ENV_FILE`). |
| `CBT_ENV_FILE` | The exam app's, when it goes live (`docs/runbooks/cbt-go-live.md`). |
| In **schoolkit-landing**: `VPS_HOST`, `VPS_SSH_KEY` (the same values), `LANDING_ENV_FILE` | The marketing site's Vercel variables (`RESEND_*`, `UPSTASH_*`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `PIONEER_LEADS_TO`). |
| `BACKUP_ENV_FILE` | `BACKUP_BUCKET=<bucket>`, `WALG_S3_PREFIX=s3://<bucket>/wal`, `AWS_ACCESS_KEY_ID=…`, `AWS_SECRET_ACCESS_KEY=…`, `AWS_ENDPOINT=https://…` (the provider's S3 address), `AWS_REGION=…`, `AWS_S3_FORCE_PATH_STYLE=true`, and `HEALTHCHECK_PING_URL=…` (healthchecks.io, free: it emails when a night's backup does not arrive). |
| `STAGING_DIRECT_URL`, `FLY_API_TOKEN` | Already set. `vps-db-copy` reads Neon through the first and stops Fly with the second. |

Variables:

| Name | Rehearsal | After cutover |
|---|---|---|
| `VPS_MODE` | `rehearsal` | `live` |
| `VPS_API_HOST` | `api.vps.schoolkit.ng` | `api.schoolkit.ng` |
| `VPS_WEB_HOST` | `app.vps.schoolkit.ng` | `app.schoolkit.ng` |
| `VPS_PORTAL_HOST` | `portal.vps.schoolkit.ng` | `portal.schoolkit.ng` |
| `VPS_CBT_HOST`, `VPS_CBT_ENABLED` | unset | when the exam app goes live |
| `VPS_DEPLOY_ENABLED` | unset (deploy by hand) | `true` (every merge that passes `ci`) |
| `FLY_DEPLOY_DISABLED` | unset | `true` |
| `PG_MAJOR` | `16` unless `vps-db-copy` says otherwise | same |
| schoolkit-landing: `VPS_LANDING_HOST` | `vps.schoolkit.ng` | `schoolkit.ng` |
| schoolkit-landing: `VPS_DEPLOY_ENABLED` | unset | `true` |

`VPS_MODE=rehearsal` adds `infra/vps/docker-compose.rehearsal.yml`:
scheduled jobs off, and the hosts for Expo push, Resend and Termii resolve to
nowhere inside the API containers. A copy of production then cannot message
a real family, even if a tester presses "send".

## 5. DNS on Cloudflare (day 1)

1. Add `schoolkit.ng` to a free Cloudflare account. It imports the records.
2. Check each one against the current DNS: `app`, `portal`, `api`, the apex
   and `www` (the marketing site), and **every mail record** (Resend's sending
   records, MX, SPF, DKIM, DMARC). Mail records must come across exactly.
   **Write down the current targets of `api`, `app` and `portal`: they are the
   rollback (§6.3).**
3. Switch the nameservers at the registrar. Nothing else changes yet.
4. Set the TTL of `api`, `app` and `portal` to 5 minutes.
5. SSL/TLS: **Full (strict)**. Leave "Always Use HTTPS" **off**: Caddy
   redirects to HTTPS itself, and Let's Encrypt's check arrives on port 80.
6. Day 2: add `api.vps`, `app.vps`, `portal.vps` and `vps` as A records to
   the VPS IP, proxied. Also write down the apex and `www` targets (the
   marketing site's rollback).

Behind Cloudflare, Caddy trusts `CF-Connecting-IP` only from Cloudflare's
address ranges, which are listed in `infra/vps/Caddyfile`. Re-check that list
once a year against https://www.cloudflare.com/ips/.

## 6. Rehearsal, cutover, rollback

### 6.1 Rehearsal (live service untouched)

1. `vps-setup` (once), then `deploy-vps` (by hand). The first deploy starts
   an empty database and skips migrations.
2. `vps-db-copy`, typing `REPLACE`. It dumps Neon, replaces the VPS database,
   compares migration count, the 23 SECURITY DEFINER functions, the RLS tables
   and row counts with Neon, and refuses to start the apps on any difference.
3. Use a **private browser window** (the rehearsal's staff cookie shares
   `schoolkit.ng` with production) and check:
   - staff sign-in, a parent's portal sign-in, a student sign-in;
   - a report card released and its PDF appearing (the render worker);
   - a file upload and its image (R2);
   - a test payment on Paystack test keys;
   - a student import;
   - `/help/guide`;
   - `https://api.vps.schoolkit.ng/api/v1/health`;
   - `https://vps.schoolkit.ng`: the home page, the blog, the pricing page
     (a test waitlist sign-up reaches the real Resend list; delete it after).

   No family should receive anything: the rehearsal guards block it.
4. Run `db-restore-test`. In the bucket, `dumps/daily/` and `wal/` should
   both have files after the first night.

### 6.2 Cutover (about 40 minutes, 04:00 Lagos)

1. Tell schools the night before: "Maintenance 04:00–05:00".
2. `vps-db-copy`, `REPLACE`, with **"Stop Fly" ticked**. Fly's API stops, so
   nothing writes to Neon. The final copy is compared with Neon.
3. Change the variables to the "After cutover" column in §4. Change
   `API_ENV_FILE`'s addresses to the real names and its Paystack keys back to
   **live**. Change `WEB_ENV_FILE` and `PORTAL_ENV_FILE`'s `NEXT_PUBLIC_API_URL`
   to `https://api.schoolkit.ng/api/v1`.
4. In Cloudflare, point `api`, `app` and `portal` at the VPS IP, proxied. With
   the proxy, the switch is immediate.
5. Run `deploy-vps`. It rebuilds with the real names, Caddy gets the
   certificates, and the smoke test runs against `https://api.schoolkit.ng`.
6. Check: staff sign-in, portal sign-in, the mobile app, one real ₦100
   payment (as on 20 Oct), a report-card PDF.
7. Marketing site: in schoolkit-landing set `VPS_LANDING_HOST=schoolkit.ng`
   and `VPS_DEPLOY_ENABLED=true`, point the apex and `www` at the VPS IP
   (proxied), run its `deploy-vps`, and check `https://schoolkit.ng`.
8. Disconnect the Vercel projects `school-kit-web`, `school-kit-portal` and
   `schoolkit` from GitHub, so merges stop building them.

### 6.3 Rollback

While Fly is stopped and Neon untouched, rollback is three steps:
- point `api`, `app` and `portal` (and the apex and `www`, for the marketing
  site) back at the targets written down in §5;
- `flyctl scale count 1 --app school-kit-api` and the same for
  `school-kit-render-worker`;
- set `FLY_DEPLOY_DISABLED` back to unset.

Anything written on the VPS after cutover is not in Neon. Payments can be
reconciled from Paystack. The sooner a rollback is decided, the less there is
to carry back.

## 7. Cancelling (only if clean)

1. Take a last Neon dump into the bucket (`vps-db-copy`'s dump step, or
   `pg_dump` with `STAGING_DIRECT_URL`).
2. Fly: destroy `school-kit-api` and `school-kit-render-worker`, and the Fly
   Redis.
3. Vercel: delete `school-kit-web`, `school-kit-portal` and `schoolkit`.
   Downgrade the account to Hobby once no commercial project is left on it
   (§3).
4. Neon: downgrade to free, or delete the project once you are comfortable.

## 8. Backups and restoring

Two copies, both in object storage, both off the server:

- **Nightly `pg_dump`** at 02:30 Lagos (`infra/vps/postgres/ops/backup.sh`):
  14 daily copies and 8 Sunday copies. This is the simple restore.
- **WAL-G**: Postgres ships each finished WAL segment within a minute
  (`archive_timeout=60`), plus a nightly base backup; the last 7 are kept.
  This restores to **any minute**, which is what Neon's point-in-time
  restore did.

Tested locally on 21 Oct: a base backup, WAL archived, rows written after the
backup, then a restore into an empty data directory. All rows came back.
`db-restore-test` checks the dumps monthly.

### Restore to a point in time (rare; do it calmly)

On the server, as `deploy`, in `/opt/school-kit`:

```bash
dc() { docker compose --env-file deploy.env "$@"; }
dc stop api render-worker web portal ops
dc stop postgres
# Keep the current data: never delete it until the restore is checked.
docker volume create school-kit_pgdata_restore
dc run --rm --no-deps -v school-kit_pgdata_restore:/restore --entrypoint sh postgres -c '
  wal-g backup-fetch /restore LATEST &&
  touch /restore/recovery.signal &&
  chown -R postgres:postgres /restore && chmod 700 /restore'
# Then edit docker-compose.yml: point the postgres and ops services at
# school-kit_pgdata_restore (as an external volume), and add to postgres:
#   -c restore_command=wal-g wal-fetch %f %p
#   -c recovery_target_time=2026-11-03 09:15:00+01   # omit for "as late as possible"
dc up -d postgres
# Once it is promoted (check `dc logs postgres`), check the data, then:
dc up -d
```

For a single table or one school's rows, restore last night's dump into a
scratch database instead (`restore-test.sh` shows how), and copy the rows
across by hand.

## 9. What is lost

| Lost | Replacement |
|---|---|
| Neon branching, its console | `vps-db-copy` for a copy; psql through an SSH tunnel |
| Platform redundancy: one server is one point of failure | Contabo snapshots before risky changes; uptime monitor (UptimeRobot, free) on `/api/v1/health`, `app.` and `portal.` |
| Vercel preview deployments | None for now. `/api/preview-api` stays in the code, unused |
| Zero maintenance | Unattended security upgrades, fail2ban, log rotation (`server-setup.sh`) |

## 10. A finding to check on Neon now

While testing the copy, the conformance spec found the raw `pgp_sym_encrypt`
/ `pgp_sym_decrypt` callable by everyone. Migration `20260708010000` revokes
them, but only the extension's owner can, and on Neon that is `neondb_owner`,
not `school_kit`, which runs migrations. The VPS fixes it in
`database-setup.sql`. **Production Neon very likely has the same gap.** Check
in the Neon SQL editor:

```sql
SELECT oid::regprocedure, proacl FROM pg_proc WHERE proname IN ('pgp_sym_encrypt', 'pgp_sym_decrypt');
```

An entry starting `=X/` means PUBLIC can execute. The fix, as `neondb_owner`,
is the four `REVOKE` lines at the top of `infra/vps/postgres/database-setup.sql`.
The gap is limited: calling the primitive still needs the BVN key, which
only the API holds (`app.bvn_key`, set per call in `bvn.service.ts`).
