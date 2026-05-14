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
SENTRY_DSN
POSTHOG_KEY
```

Never commit. Never log. Test keys and live keys are different env files.

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
