# Prisma 5 → 7 upgrade

Plan-first, 2026-10-12. Status: **plan, awaiting the owner's approval.** Nothing
is upgraded yet. The upgrade PR updates CLAUDE.md's stack table, and this
file's "As built" section, in the same PR.

## Why

We are on Prisma 5.22. Two majors have shipped since: 6 (late 2024) and 7
(7.0.0 on 2025-11-19, latest **7.10.0** on 2026-08-25). Prisma 5 receives no
fixes. The longer we wait, the larger the jump, and 7 changes how the client
talks to Postgres, which is exactly where our tenancy rules live.

**Pin 7.10.0 exactly.** npm's `latest` tag already points at a Prisma **8**
release candidate (`8.0.0-rc.22`), so `pnpm add prisma@latest` would install
an RC. The upgrade pins `prisma@7.10.0` and `@prisma/client@7.10.0`.

## What changes, and what it touches here

Facts from Prisma's upgrade guides for
[v6](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v6) and
[v7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7), the
[7.0.0](https://github.com/prisma/prisma/releases/tag/7.0.0) and
[7.10.0](https://github.com/prisma/prisma/releases/tag/7.10.0) release notes,
and the published `@prisma/adapter-pg@7.10.0` code. Each is checked against
this repo.

| Change | Here | Work |
|---|---|---|
| 6: implicit many-to-many tables get a primary key (needs a migration) | **None.** No `CREATE TABLE "_…"` in any of the 121 migrations; every join is an explicit model | Confirm `migrate diff` is empty after upgrading |
| 6: `Bytes` is `Uint8Array`, not `Buffer` | One field, `users.bvn_encrypted`, passed back into `decrypt_bvn(...)` by `BvnService` | Covered by the BVN specs; type-only |
| 6: `NotFoundError` removed | Not used (our `NotFoundError` is our own, from `@school-kit/types`) | None |
| 7: Node ≥ 20.19, TypeScript ≥ 5.4 | Node 22, TypeScript 5.9 | None |
| 7: **a driver adapter is required**; `new PrismaClient()` with no arguments, and `datasources`, are removed | 7 places: `tenant-client.ts` (the one runtime client), `seed.ts`, `dev-seed.ts`, `census-paystack-splits.ts`, and 3 specs | One `createPrismaClient(url, pool?)` in `packages/db`, used by all of them, built on `@prisma/adapter-pg` |
| 7: `prisma.config.ts` is required; `url`/`directUrl` leave `schema.prisma`; `directUrl` is gone | Migrations run as `school_kit` via `DIRECT_URL`, the app as `app_user` via `DATABASE_URL` | `prisma.config.ts` sets `datasource.url = DIRECT_URL` (the CLI's, for migrate). The app passes `DATABASE_URL` to the adapter. The two-role split is kept exactly. |
| 7: the CLI no longer reads `.env` | Our scripts already wrap it in `dotenv -e ../../.env` | None. `prisma.config.ts` reads `process.env` and does not load a file itself, so prod (Fly secrets) and CI are unchanged. |
| 7: the seed command moves from `package.json#prisma` to `prisma.config.ts` | `"prisma": { "seed": "tsx prisma/seed.ts" }` | Move it; `seed` and `seed:prod` keep working |
| 7: `migrate dev` no longer runs `generate` or the seed | `pnpm db:migrate` | CLAUDE.md's dev commands say to run `pnpm --filter @school-kit/db generate` after a migration |
| 7: `prisma-client-js` is deprecated (still works in 7, "will be removed"); the new `prisma-client` generator writes TypeScript into `output` | `prisma-client-js` with `output = "../generated/client"`, built into `packages/db/dist` | Move to `prisma-client` with `moduleFormat = "cjs"` now (D2) |
| 7: the Rust query engine is gone | `apps/api/Dockerfile` strips engine binaries for other platforms and installs `libssl3` for the engine; `Dockerfile.render` too | Remove the engine-stripping step and `binaryTargets`; keep `libssl3` only if something else needs it |
| 7: pool settings in the URL (`connection_limit`, `pool_timeout`) no longer apply; the pool is `pg`'s, with different defaults | Nothing sets them, so production gets Prisma's default, 2 × vCPU + 1 = **3** on the 1-vCPU Fly machine. `withTenant`'s retry logic and the 2026-09-11 dashboard work were tuned against that. | Set the pool explicitly (D3). `pg`'s own defaults would be **10** connections and **no acquire timeout** (wait forever). |
| 7: a unique-violation error (`P2002`) no longer carries `meta.target` | `AuthService.translatePrismaError` reads `meta.target` and the message to tell `EMAIL_TAKEN` / `PHONE_TAKEN` / `SCHOOL_SLUG_TAKEN` apart. The other ~20 `P2002` checks only read the code. | Read the constraint name from where 7.10 puts it (`meta.driverAdapterError.cause.constraint`) as well. That field is "not public API" ([prisma/orm#28281](https://github.com/prisma/orm/issues/28281)), so the signup specs must pin each case. |
| 7: connection errors come from `pg`, mapped by the adapter | `withTenant` retries once on `P1001`, `P1002`, `P1008`, `P1017`, `P2024` and a never-started `P2028`, telling the two `P2028`s apart **by message wording** | Prove each mapping with a spec that causes it (D4) |
| 7: `pg` checks TLS certificates; the old engine accepted invalid ones | Neon presents a valid certificate | Verify against the production database with a read-only connection before deploying |
| 7: `$use` middleware and metrics removed | Not used | None |

What does **not** change:
- RLS and `withTenant`: an interactive `$transaction` holds one `pg`
  connection from `BEGIN` to the end, so `SET LOCAL app.current_school_id`
  still binds every query in it. The RLS specs prove it either way.
- Tagged `$queryRaw` (78 call sites) and `@db.Date`: the adapter writes a
  `DATE` from the UTC day of the `Date` passed, which is what we already pass.
- The SECURITY DEFINER functions: no SQL changes, so the count stays 23.

## Decisions for the owner

- **D1. One PR, two hops inside it.** Upgrade to 6, run everything, then to
  7.10.0 and run everything again, then open one PR. There is no schema
  migration, so a revert of the PR is the whole rollback.
- **D2. Move to the new `prisma-client` generator now** (recommended), not
  stay on the deprecated `prisma-client-js`. Staying would mean a second
  upgrade of the same code when it is removed. Every app imports Prisma only
  through `@school-kit/db`, so the change stays inside `packages/db`.
- **D3. Pool settings, explicit and the same as today**: `max: 3`,
  acquire timeout 10 s (today's `pool_timeout`), idle connections closed
  after 300 s. Overridable with `DATABASE_POOL_MAX` for the day we size it
  properly (`docs/deferred.md`: production's `connection_limit` is still
  unverified). Changing the number is a separate decision, not part of this
  upgrade.
- **D4. No deploy until each error mapping is proven**: a duplicate email,
  phone and slug at signup, and a never-started transaction (pool of 1,
  connection held). If 7.10.0 maps any of them differently, the fix goes in
  the same PR.

## How it is verified

- The whole API suite against Postgres, including `rls.spec.ts`,
  `security-definer-inventory.spec.ts`, the signup conflict specs, the BVN
  specs, and `dashboard-pool-probe.spec.ts` at `max: 3`.
- `prisma migrate diff` from the migrations to the database: empty.
- `migrate deploy` and `seed` on a fresh database, as CI does.
- The compiled API, not just Vitest: build, then start `node dist/main.js`
  and hit `/health` and a tenant read. Vitest can pass where the built
  CommonJS fails (CLAUDE.md, "ESM module resolution"). The render worker too.
- The full e2e suite.
- Before merging: a read-only connection to production through the new
  adapter, to prove TLS and the pool against Neon.

## Risk and rollback

The risk is in the runtime client, not the schema. No migration ships, so
rolling back is reverting the PR and redeploying; the database is untouched.
The deploy goes out on a quiet evening, with Sentry watched for `P1xxx`,
`P2024` and `P2028` errors for the next school day.
