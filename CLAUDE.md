# CLAUDE.md

This file tells Claude Code how School Kit is built. Read it before doing anything in this repo.

## Project

School Kit — multi-tenant school management platform for Nigerian private schools. Solo build with Claude Code. AI-assisted learning is a first-class feature, not an add-on.

## Read first (in this order)

1. `docs/ARCHITECTURE.md` — system overview
2. This file (`CLAUDE.md`)
3. The relevant `docs/modules/<module>.md` for the work at hand

If the work touches multi-tenancy, money, or AI, also read the "Hard rules" section below carefully — those are the failure modes that will cause real damage.

## Tech stack (exact versions)

- Node.js: 22.x LTS
- pnpm: 9.x
- TypeScript: 5.6+
- Next.js: 15.x (App Router, React Server Components)
- React: 19.x
- NestJS: 10.x
- Prisma: 5.x
- PostgreSQL: 16.x (with `pgvector` extension)
- Redis: 7.x
- Expo SDK: 52.x
- Tailwind CSS: 3.4+
- shadcn/ui: latest
- Anthropic SDK (`@anthropic-ai/sdk`): latest
- Better Auth: latest
- BullMQ: latest

When upgrading any of these, update this file in the same PR.

## Monorepo layout

```
apps/
  web/      Next.js — admin + teacher
  portal/   Next.js — parent portal (Phase 4), own Vercel project + deploy
  mobile/   Expo — parent + student
  api/      NestJS — backend
packages/
  db/       Prisma schema and client
  types/    Shared TypeScript types and Zod schemas
  ui/       Shared React components
  ai/       Claude prompts, RAG helpers, evals
  config/   Shared tsconfig, eslint, tailwind presets
docs/
  ARCHITECTURE.md
  modules/  Per-module specs (one per Phase or feature)
infra/      Terraform / Pulumi
```

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `students.controller.ts` |
| Classes | `PascalCase` | `StudentsController` |
| Functions / variables | `camelCase` | `getStudentById` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_FILE_SIZE` |
| DB tables | `snake_case`, plural | `students`, `class_arms` |
| DB columns | `snake_case` | `school_id`, `created_at` |
| Prisma models | `PascalCase`, singular | `Student`, `ClassArm` |
| API routes | `kebab-case`, plural | `/api/v1/students`, `/api/v1/class-arms` |
| React components | `PascalCase.tsx` | `StudentCard.tsx` |
| Env vars | `SCREAMING_SNAKE_CASE` | `ANTHROPIC_API_KEY` |
| Test files | sibling, `.spec.ts` or `.test.ts` | `attendance.service.spec.ts` |
| Git branches | `<phase>/<module>` | `phase-2/attendance` |

## Hard rules — never do these

### Multi-tenancy

- **Never query without a `school_id` filter.** Use `getTenantPrisma(schoolId)` from `packages/db/src/tenant-client.ts`. Raw SQL must `SET LOCAL app.current_school_id` first.
- Never expose any ID from one school to a user from another. Re-validate `school_id` against the JWT on every endpoint that takes an ID in the path or body.
- Never log full user PII in production. Email, phone, BVN, NIN all get redacted by the logger; if you bypass the logger you're doing it wrong.
- **Runtime DB role must NOT have SUPERUSER or BYPASSRLS.** Postgres silently skips RLS policies for privileged roles, even with FORCE ROW LEVEL SECURITY. The runtime app connects as `app_user` (no privileges beyond SELECT/INSERT/UPDATE/DELETE on `public`). Migrations connect as `school_kit` via `DIRECT_URL`. If `DATABASE_URL` is ever changed to a privileged role, the RLS spec must fail loudly — this is a feature, not a bug.

### Money

- Never use `Float` or `Number` for money in the DB or in TypeScript. Money is `Int` (kobo) in the DB and `bigint` in TS. Format to naira only at the display layer.
- Never compute fees, discounts, or balances in the frontend. The frontend displays what the API returned, full stop.
- Every payment-mutating action goes through `FinanceService` and writes to `audit_logs`. No exceptions, including admin overrides.

### Auth

- Never trust the JWT subject alone for mutations. Re-fetch the user (and verify `is_active`) on every write.
- Never include secrets, BVN, full passwords, or OTP codes in any log, error message, or response body.
- Never roll your own crypto. Use Better Auth primitives.

### AI

- Never auto-finalise AI output for grades, report card comments, or behaviour records. There is always a teacher-approval gate.
- Never send student PII (full name, address, DOB, contact info) to the LLM. Use opaque IDs and class-level context (e.g. "JSS2 student") only.
- Every call to `claudeClient.messages.create` must log to the `ai_generations` table: model, prompt name + version, input/output tokens, latency, cost estimate, success/error.
- Per-school monthly token budget enforced before the call, not after.

### Git

- Never commit to `main`. PR per module.
- Never commit `.env`, `.env.*`, secrets, `dist/`, `.next/`, `node_modules/`, or generated Prisma client.
- `.env.example` is committed and stays in sync with required keys.

## Coding patterns

### Prisma column types in raw SQL

When writing raw SQL (migrations with SECURITY DEFINER functions, custom queries via `$queryRaw`):
- Prisma `String @id` → PostgreSQL `TEXT`, not `uuid`
- Prisma `DateTime` → `TIMESTAMP(3)` (3-digit ms precision; matches Prisma's default)
- Prisma `DateTime @db.Date` → PostgreSQL `DATE` (no time-of-day) — use this for calendar dates: academic year start/end, term start/end, student `dateOfBirth`, enrollment `enrolledAt`-as-date, etc. Reserve plain `DateTime` for true moments (`createdAt`, `updatedAt`, `acceptedAt`, `withdrawnAt`-as-event). The semantic difference matters because `DATE` doesn't store a timezone and avoids the "midnight in which zone?" trap when an admin in Lagos sets "term ends 2026-07-31" — the row stores the date, full stop. Convention established in Phase 1 / Slice 1 (2026-05-22); subsequent Phase 1 slices follow.
- Prisma `Boolean` → `BOOLEAN`
- Prisma `Int` → `INTEGER`
- Prisma `Json` → `JSONB`

If you need a uuid column specifically, declare it in Prisma as `String @id @db.Uuid`. Check `prisma migrate dev --create-only` and inspect the generated SQL before assuming.

### package.json `exports` maps are exhaustive

When adding an `exports` map to a shared package (`packages/config`, etc.), 
list every export the package needs to provide — not just the new ones. 
Exports maps are exhaustive: any path NOT listed becomes inaccessible 
to consumers. Symptoms include tsconfig `extends` silently falling back 
to TypeScript's defaults (producing misleading errors about 
esModuleInterop and similar). Always verify with `pnpm typecheck` 
after touching exports maps.

### SECURITY DEFINER functions — index

SECURITY DEFINER SQL functions bypass RLS by running with the privileges of the function owner (the migration role, `school_kit`). They are the only legitimate escape hatch from FORCE RLS for the runtime role (`app_user`), so they are load-bearing security primitives — treat every one as you would a piece of auth code, not as a generic helper.

Discipline for every function in this category:

1. Owned by the migration role; runtime role has EXECUTE only (PUBLIC revoked).
2. `SET search_path = public, pg_temp` pinned in the function body.
3. Returns scalars / opaque ids only — never a full row, never PII the caller didn't supply.
4. Has a header comment in the migration explaining (a) **why** SECURITY DEFINER is needed, (b) what fields it returns, and (c) what fields are **deliberately NOT** returned.
5. Added to the inventory below in the same PR that introduces it.

| Function | Migration | Purpose | Deliberately omits |
|---|---|---|---|
| `auth_check_signup_uniqueness(email, phone)` | `20260515000000_add_signup_uniqueness_function` | Distinguishes `EMAIL_TAKEN` vs `PHONE_TAKEN` at signup (FORCE RLS strips P2002 target). | Row ids, names, school_id — returns only two booleans. |
| `auth_resolve_session(token_hash)` | `20260516000000_add_auth_lookup_functions` | AuthGuard session lookup pre-tenant; resolves bearer token to `{ session_id, user_id, school_id, expires_at, user_is_active }`. | `password_hash`, email/phone/names, roles/permissions. |
| `auth_lookup_user_for_login(email)` | `20260516000000_add_auth_lookup_functions` | Login service user lookup pre-tenant; returns `{ user_id, school_id, password_hash, is_active }`. | phone, names, role grants, session rows. |
| `auth_resolve_invitation_by_token_hash(token_hash)` | `20260517000000_invitation_names_and_lookup` | Public invitation endpoints (GET /invitations/:token, POST /invitations/:token/accept) resolve a token hash to `{ invitation_id, school_id, email, role_key, first_name, last_name, invited_by, expires_at, accepted_at }` before withTenant() can apply. | `token_hash`, `phone`, `created_at` — caller already has the token; phone is Phase-4 territory; created_at is read tenant-scoped from the pending-invitations list. |
| `create_audit_log_partition(p_year, p_month)` | `20260628000000_phase_3_slice_3_audit_partitioning` | Called by `PartitionService` at startup and on the monthly cron; creates the named monthly child partition of `audit_logs`. `app_user` cannot `CREATE TABLE` directly; this runs as `school_kit`. | Returns VOID. Table name derived from integer arithmetic only; quoted via `%I` in the function body — no caller input reaches the DDL string. |
| `encrypt_bvn(p_bvn_plaintext)` | `20260708010000_phase_3_slice_12_bvn_encryption_functions` | Wraps `pgp_sym_encrypt` for staff BVN capture (`BvnService.captureBvn`). `pgp_sym_encrypt`/`pgp_sym_decrypt` have EXECUTE revoked from PUBLIC in the same migration, so this is the only path to producing BVN ciphertext. Pure crypto primitive — no table access, no school_id/user_id params; the row UPDATE stays ordinary `app_user` SQL under `withTenant`/RLS. | Nothing beyond the ciphertext — there is no row here. |
| `decrypt_bvn(p_bvn_encrypted)` | `20260708010000_phase_3_slice_12_bvn_encryption_functions` | Wraps `pgp_sym_decrypt` for `BvnService.revealBvn`. Same PUBLIC-revoked pgcrypto primitive as above. | Nothing beyond the plaintext BVN string — the service layer (not this function) is responsible for auditing every call and never logging the return value. |

**SECURITY DEFINER inventory audit (Phase 3 / Slice 12, 2026-07-08):** reviewed
all 5 pre-existing functions for consolidation when the count crossed the
"past 5" trigger. **Decision: keep all 5 as-is, no consolidation.** Each has a
deliberately narrow, non-overlapping return shape tailored to one caller
(`auth_lookup_user_for_login` returns `password_hash`, which the other three
auth functions correctly never see; `create_audit_log_partition` is a
different domain — DDL, not an RLS pre-tenant lookup). Merging any of them
would either widen a return row beyond what its caller needs or require a
branching "which entity type" argument — both weaken the "returns scalars
only, narrow to the one caller's need" discipline this table exists to
enforce. A dedicated `auth_service` schema/role (the other option
`docs/deferred.md` floated) was also rejected for this PR: it touches every
existing call site in the login/session path, unacceptable blast radius for a
refactor that isn't required to reduce count, only to review it.

The refactor actually delivered: **`apps/api/src/__tests__/security-definer-inventory.spec.ts`**
is a mechanical conformance gate, run on every CI pass, that queries `pg_proc`
for every function with `prosecdef = true` and asserts each one (a) appears in
the spec's `SECURITY_DEFINER_FUNCTIONS` constant — the single source of truth
this table and the spec both point at, so a new SD function added without
updating both fails loudly; (b) is owned by `school_kit`; (c) has
`search_path=public, pg_temp` pinned; (d) has EXECUTE revoked from `PUBLIC`
and granted to `app_user`. This replaces "if it grows past 5, refactor" — a
human-memory threshold — with a standing gate that holds at any count.
Table-review cadence: revisit this table's shape every +3 functions; the
conformance spec itself never needs a count bump.

**Current count: 7.**

### ESM module resolution

- Workspace packages (`packages/*`) compile to `dist/`. Their `package.json` `main`/`types`/`exports` fields point at compiled output, never at `src/`.
- TypeScript `module: Node16`, `moduleResolution: Node16` in each workspace package's `tsconfig.json`.
- Relative imports inside `.ts` source files use `.js` extensions — TypeScript preserves them; Node ESM requires them.
- Generated code (Prisma client) lives outside `src/` so compiled `dist/` can reach it with the same relative path.
- - Tests pass under Vitest+SWC's permissive resolution; runtime AND CI use 
  Node ESM's strict resolution. If a package builds clean but runtime fails 
  with `ERR_MODULE_NOT_FOUND`, either the package is misconfigured, or 
  `dist/` doesn't exist yet — locally that's a missing `pnpm build`, in CI 
  it's a missing "Build workspace packages" step before the failing step. 
  Tests passing isn't proof of correct module resolution — Vitest+SWC 
  tolerates missing `dist/` by walking workspace symlinks to `.ts` source. 
  Any tooling that uses Node ESM directly (`tsx`, plain `node`, Next.js' 
  server runtime, `prisma db seed`) will surface the gap.
- Config files for CSS/build tooling (`tailwind.config.ts`, `postcss.config.mjs`, etc.) must also be ESM in an ESM project. Use top-of-file `import` rather than `require()` even when the tool's docs show `require()` examples — those examples assume CommonJS. Tests don't catch this because the CSS pipeline only runs on real browser routes; the symptom is `ReferenceError: require is not defined` at the first request that triggers a Tailwind compile.
- CJS-only npm packages (no `"type": "module"`, no `"exports"` map, single `module.exports = X`) work fine via `import x from "pkg"` thanks to Node's CJS interop — `x` resolves to `module.exports`. If a package instead does `module.exports.foo = ...` (named exports) the default import gives you the *namespace object*, and you either destructure (`import { foo } from "pkg"`) or use `import * as pkg`. Inspect `node_modules/<pkg>/index.js` once when adding a new dependency; the project standardises on the simplest form that works.

### NestJS module structure

Every module lives in `apps/api/src/modules/<module-name>/`:

```
attendance/
  attendance.module.ts
  attendance.controller.ts
  attendance.service.ts
  attendance.repository.ts        # only if Prisma calls get complex
  dto/
    mark-attendance.dto.ts
    get-attendance.dto.ts
  guards/
    can-mark-attendance.guard.ts
  attendance.service.spec.ts
```

DTOs are Zod schemas in `packages/types`, validated by a global `ZodValidationPipe`.

### Next.js routes

App Router with route groups for role-based layouts:

```
src/app/
  (marketing)/        Public marketing pages
  (auth)/             Login, signup, password reset
  (admin)/            Admin + owner UI (shared layout)
    dashboard/
    settings/
  (teacher)/          Teacher UI
    classes/
    gradebook/
  api/                Edge functions only if absolutely needed
```

Server components by default. Add `'use client'` only when needed (forms, interactive state, hooks).

### Server actions vs API

- NestJS REST API for everything with business logic, transactions, or cross-cutting concerns (auth, audit, AI calls).
- Next.js server actions only for trivial form submits that proxy to the API.
- Mobile and web both hit the same NestJS endpoints. No duplicated logic.

### Error handling

- All API errors extend `BaseError` from `packages/types/src/errors.ts`
- Response shape: `{ error: { code: string, message: string, details?: unknown } }`
- Frontend uses `@tanstack/react-query` with a global error handler that shows a toast and routes 401s to login.

### Tests

- Unit tests for services with business logic (grading, fee calc, attendance %).
- Integration tests for controllers with mocked Prisma.
- E2E (Playwright) for critical user flows: signup → onboard → first student → first payment.
- Run: `pnpm test` (all), `pnpm test:e2e`, `pnpm test:watch`.

### Next.js route groups vs URL segments

- Route groups: folders wrapped in parens like `(auth)`, `(admin)`. 
  Organise files without affecting the URL. The folder name is stripped.
  - `app/(admin)/dashboard/page.tsx` → URL `/dashboard`
  - `app/(auth)/login/page.tsx` → URL `/login`
- Real URL segments: plain folder names without parens.
  - `app/onboarding/3/page.tsx` → URL `/onboarding/3`
- When `docs/modules/*.md` specifies a URL path, the folder structure 
  must match that path literally. If the spec says `/onboarding/3`, 
  the folder is `onboarding/3` — NOT `(onboarding)/3`.
- Tests don't catch this. Only the browser does. Verify visually 
  when introducing any new route.

  ### Dev overlay vs production error boundaries

Next.js dev mode shows a red error overlay BEFORE `global-error.tsx` renders.
This is a dev tool, not a bug. To verify the production error boundary,
either dismiss the overlay (press Esc), or run `pnpm build && pnpm start`
to test against the production server. In prod, errors go straight to
`global-error.tsx` and `Sentry.captureException` fires from inside that
boundary's useEffect.

## Adding a new module

1. Read or write `docs/modules/<module>.md` (purpose, entities, endpoints, screens, tests).
2. Add Prisma models to `packages/db/prisma/schema.prisma`.
3. Run `pnpm db:migrate -- --name add_<module>`.
4. Add RLS policies in `packages/db/prisma/policies/<module>.sql` and apply them.
5. Create the NestJS module skeleton in `apps/api/src/modules/<module>/`.
6. Add DTOs in `packages/types/src/<module>/` with Zod schemas.
7. Implement the service test-first.
8. Implement the controller with auth + RBAC guards.
9. Add API client functions in `packages/types/src/api/<module>.ts`.
10. Build web UI in `apps/web/src/app/(role)/<module>/`.
11. Build mobile UI in `apps/mobile/src/screens/<module>/` if user-facing for parents/students.
12. Add at least one E2E test for the happy path.
13. Update `docs/modules/<module>.md` with anything that changed.

## Dev commands

```bash
# First-time setup
pnpm install
cp .env.example .env
pnpm db:up                    # postgres + redis in docker
pnpm db:migrate
pnpm db:seed

# Daily dev
pnpm dev                      # all apps via Turborepo
pnpm dev:api                  # api only
pnpm dev:web                  # web only
pnpm dev:mobile               # expo

# Database
pnpm db:migrate -- --name <name>
pnpm db:reset                 # nuke and re-seed
pnpm db:studio                # Prisma Studio

# Quality
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e

# AI evals
pnpm ai:eval                  # run prompt eval suite (required before any prompt PR merges)
```

## Git conventions

- Branches: `<phase>/<module>` e.g. `phase-2/attendance`, or `fix/<short>`.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).
- PR title: scope + summary, e.g. `feat(attendance): daily marking with SMS alert`.
- One module = one PR. Squash on merge.

## Environment variables

Documented in `.env.example`. Critical:

```
DATABASE_URL
REDIS_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_PUBLIC_KEY
TERMII_API_KEY
TERMII_SENDER_ID
RESEND_API_KEY
R2_ACCOUNT_ID
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
SENTRY_DSN_API
NEXT_PUBLIC_SENTRY_DSN
SENTRY_ENVIRONMENT
NEXT_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST
WEB_BASE_URL
```

Never commit. Never log. Test keys and live keys are different env files.

`WEB_BASE_URL` — the API can hold a `WEB_BASE_URL` env var when constructing
user-facing URLs (invitation accept links, password reset links, etc.). The
API never follows these URLs; it only constructs them for delivery. Production
must set this explicitly; dev defaults to `http://localhost:3001`.

## When asking Claude Code for help

Open with the relevant spec. Example:

> Read `docs/modules/attendance.md` and `CLAUDE.md`, then implement the daily attendance endpoint in `apps/api/src/modules/attendance/`. Write the service spec first, then the implementation. Don't touch the UI yet.

Avoid pasting the whole codebase — Claude Code reads what it needs. Keep each prompt scoped to a single concern.

## Things this file does not cover yet

These get added as decisions are made:

- Subscription billing system (per-student vs flat)
- Offline sync strategy for mobile
- WhatsApp Business API approval state
- Curriculum content licensing
- Specific PII fields covered by NDPR redaction
