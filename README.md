# School Kit

A multi-tenant SaaS school management platform for Nigerian private schools, with AI-assisted learning built in from day one.

**Status (2026-10-10):** Live. Schools sign up and run on the staff web app (`app.schoolkit.ng`) and the parent portal, on early-access pricing as pioneer schools. The mobile app is built but not yet released to families (device checks outstanding). What is left, and what waits on whom, is in [`docs/deferred.md`](./docs/deferred.md).

**Stack:** Next.js 15 · NestJS 10 · PostgreSQL 16 (with RLS + pgvector) · Redis · Prisma · Expo · Anthropic Claude API · Paystack · Termii

---

## Read these first

Before doing anything in this repo, read in order:

1. [`CLAUDE.md`](./CLAUDE.md) — conventions, rules, and how code is written here
2. [`WORKFLOW.md`](./WORKFLOW.md) — how work happens day-to-day; module lifecycle; quality gates
3. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — system design, data model, all 17 modules, build phases
4. The `docs/modules/<module>.md` for the work at hand, and [`docs/deferred.md`](./docs/deferred.md) for what is known but not done

Future contributors and future-you should be productive after reading these four documents.

---

## Quick start

### Prerequisites

- Node.js 22.x LTS (use `nvm` or `volta`)
- pnpm 9.x (`npm install -g pnpm`)
- Docker Desktop (for local Postgres + Redis)
- Git

### Setup

```bash
# Clone and install
git clone <repo-url> school-kit
cd school-kit
pnpm install

# Environment
cp .env.example .env
# Fill in API keys: see "Env vars" below

# Database
pnpm db:up               # docker-compose: postgres + redis + pgvector
pnpm db:migrate          # apply migrations
pnpm db:seed             # seed system roles (idempotent)
pnpm dev:seed            # DEV-ONLY: full test school for browser testing
                         #   (idempotent; run db:seed first). Logs the
                         #   dev-owner / dev-teacher logins + password.

# Run everything
pnpm dev
```

After `pnpm dev` boots, you should see:

- Web (admin/teacher): `http://localhost:3001`
- API: `http://localhost:4000`
- Mobile (Expo): scan QR with Expo Go app
- Prisma Studio (optional): `pnpm db:studio` → `http://localhost:5555`

### First-time sanity check

```bash
pnpm typecheck    # should pass
pnpm lint         # should pass
pnpm test         # should pass
```

If any of those fail on a clean clone, something is broken — fix before touching feature code.

---

## Dev commands

```bash
# Daily
pnpm dev                  # all apps via Turborepo
pnpm dev:api              # api only
pnpm dev:web              # web only
pnpm dev:mobile           # expo only

# Database
pnpm db:up                # start postgres + redis
pnpm db:down              # stop postgres + redis
pnpm db:migrate           # apply pending migrations
pnpm db:migrate -- --name <name>   # create a new migration
pnpm db:reset             # NUKE local db, re-migrate, re-seed
pnpm db:seed              # re-run seed
pnpm db:studio            # browse data in Prisma Studio

# Quality
pnpm lint
pnpm lint:fix
pnpm typecheck
pnpm test                 # unit + integration
pnpm test:watch
pnpm test:e2e             # Playwright happy-path smoke (e2e/ workspace).
                          # Reuses dev servers if running; otherwise spawns
                          # them. ~1–2 min on a warm machine.

# AI
pnpm ai:eval              # run prompt eval suite (required before merging prompt changes)
```

---

## Project structure

```
school-kit/
├── CLAUDE.md             How code is written (read first)
├── WORKFLOW.md           How work happens
├── README.md             This file
├── apps/
│   ├── web/              Next.js 15 — admin + teacher portals
│   ├── mobile/           Expo — parent + student app
│   └── api/              NestJS 10 — backend
├── packages/
│   ├── db/               Prisma schema, client, migrations
│   ├── types/            Shared TS types, Zod schemas
│   ├── ui/               Shared React components
│   ├── ai/               Claude prompts, RAG helpers, evals
│   └── config/           Shared tsconfig, eslint, tailwind
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md      ADRs
│   ├── deferred.md       Scope-cut ideas
│   ├── journal/          Daily notes
│   ├── modules/          Per-phase specs
│   └── runbooks/         Deploy, rollback, incident
├── infra/                Terraform / Pulumi
└── .github/workflows/    CI/CD
```

---

## Environment variables

All variables documented in [`.env.example`](./.env.example). The critical ones:

| Variable | Where it's used | Where to get it |
|---|---|---|
| `DATABASE_URL` | Postgres connection | Local docker; prod = Neon/Supabase |
| `REDIS_URL` | Redis connection | Local docker; prod = Upstash |
| `BETTER_AUTH_SECRET` | Session signing | Generate: `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Public app URL | e.g. `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | Claude API | console.anthropic.com |
| `PAYSTACK_SECRET_KEY` | Payments | dashboard.paystack.com |
| `PAYSTACK_PUBLIC_KEY` | Payments (client) | dashboard.paystack.com |
| `TERMII_API_KEY` | SMS / WhatsApp / OTP | accounts.termii.com |
| `TERMII_SENDER_ID` | SMS sender name | Termii (must be approved) |
| `RESEND_API_KEY` | Email | resend.com |
| `R2_ACCOUNT_ID` | File storage | Cloudflare dash |
| `R2_ACCESS_KEY_ID` | File storage | Cloudflare dash |
| `R2_SECRET_ACCESS_KEY` | File storage | Cloudflare dash |
| `R2_BUCKET` | File storage bucket name | Cloudflare dash |
| `SENTRY_DSN_API` / `NEXT_PUBLIC_SENTRY_DSN` | Error monitoring (API / web) | sentry.io |
| `POSTHOG_API_KEY` / `NEXT_PUBLIC_POSTHOG_KEY` | Product analytics (API / web), same project key | posthog.com |

**Never commit `.env`.** It's in `.gitignore`. Keep test keys and live keys in separate `.env` files.

---

## Current status

There is no "active phase" to keep updated here any more. For the state of
things, read, in this order:

- [`docs/deferred.md`](./docs/deferred.md): what is known and not done, what
  waits on the owner or an outside party, and what waits for a trigger.
- The latest entry in [`docs/journal/`](./docs/journal/) and `git log` on
  `main`: what shipped recently, with the PR to read for detail.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) section 9: which phases
  have shipped.

---

## Build phases

Detail, and the as-built notes, in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) section 9.

- **Shipped:**
  - Phases 0–4: foundations, SIS and academic structure, attendance and grading, finance with Paystack, parent portal and communication.
  - Phase 5: the AI layer (lesson plans, report comments, parent summaries, insights).
  - Phase 6: mobile app, student portal and guardian mobile (not yet released to families).
  - Phase 7 v1: curriculum RAG grounding lesson plans in a school's own scheme of work.
  - Phase 8 and 8c: event calendar, reports, timetable, assessments and exams, report card completeness, result checker.
- **Built, not deployed:** online exams (CBT) on school lab computers; `docs/runbooks/cbt-go-live.md` says when.
- **Not started:** Phase 8b, the student AI tutor. It waits on the NDPR review and a safeguarding workstream.
- **Rolling (Phase 9):** auxiliary modules, as schools ask for them.

---

## Architecture in one paragraph

A Next.js admin/teacher web app, an Expo parent/student mobile app, and a NestJS API back them all. PostgreSQL with row-level security enforces multi-tenancy: every domain table has a `school_id` column, and a session-scoped Postgres setting (`app.current_school_id`) makes cross-tenant data leaks structurally impossible. Redis handles caching and BullMQ queues background work (audit writes, SMS, AI batches). The AI layer uses Anthropic Claude (Sonnet + Haiku) with RAG over the WAEC/NECO curriculum, indexed via pgvector in the same Postgres database. Paystack for payments, Termii for SMS/WhatsApp, Resend for email, Cloudflare R2 for files, Sentry for errors, PostHog for analytics.

Full detail in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Hard rules (the unflexible ones)

These are bypassed under *no* circumstances, regardless of deadline pressure. Breaking any of them causes permanent damage. Full list with reasoning in [`CLAUDE.md`](./CLAUDE.md).

1. **Multi-tenancy isolation** — `withTenant` on every query, every endpoint
2. **Money in integer kobo** — never floats, never decimals
3. **AI never auto-finalises** — grades and comments always need teacher approval
4. **No secrets in commits** — `.env` in `.gitignore` from commit zero
5. **Rollback works before deploy** — runbook written before it's needed

---

## Contributing

Currently solo development. When the first contributor joins, this section grows.

For now: every change goes through a branch and a PR into `main`, even though you're solo. There is no `staging` branch: a merge to `main` passes CI and then deploys to the one production environment (see CLAUDE.md, "There is no isolated staging environment"). See [`WORKFLOW.md`](./WORKFLOW.md) for the module lifecycle.

---

## Licence

Proprietary. All rights reserved. Not for redistribution.
