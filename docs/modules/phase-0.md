# Phase 0 — Foundations

The work that has to exist before any school-facing feature can be built. End of Phase 0, a school owner can sign up, complete onboarding, invite an admin, and see a working dashboard shell. No real domain features yet — but tenancy, auth, RBAC, and UI scaffolding are solid enough to build on for the next 12 months.

**Estimated time solo with Claude Code:** 2–3 weeks.

## Deliverables checklist

End of Phase 0, all of these are true:

- [ ] Monorepo bootstrapped with Turborepo; all three apps run via `pnpm dev`
- [ ] Postgres 16 + Redis 7 + pgvector running via `docker-compose`
- [ ] Better Auth integrated; email+password works for staff, SMS OTP stub works for parents
- [ ] Multi-tenant Postgres with RLS policies on every domain table
- [ ] Tenant-aware Prisma client (`getTenantPrisma`) wired into every authenticated request
- [ ] RBAC at API layer (`@Permissions(...)` guard) and UI layer (route guards + conditional renders)
- [ ] School signup → 5-step onboarding wizard → admin dashboard shell
- [ ] Admin invitation flow end-to-end (send → accept → first login)
- [ ] Audit log writing one row per authenticated mutation
- [ ] Sentry + PostHog integrated and verified in dev
- [ ] GitHub Actions CI: lint, typecheck, test, build — all green on every PR
- [x] One Playwright E2E test: full signup → onboarding → invite admin → admin accepts → admin logs in

## Data model

The Prisma schema for Phase 0. Lives in `packages/db/prisma/schema.prisma`.

```prisma
// ---------- Tenancy ----------

model School {
  id            String   @id @default(uuid())
  name          String
  slug          String   @unique           // for subdomains: <slug>.schoolkit.ng
  motto         String?
  logoUrl       String?  @map("logo_url")
  address       String?
  phone         String?
  email         String?
  primaryColor  String?  @map("primary_color")
  status        SchoolStatus @default(ONBOARDING)
  onboardingStep Int     @default(1) @map("onboarding_step")
  ndprConsent   Boolean  @default(false) @map("ndpr_consent")
  ndprConsentAt DateTime? @map("ndpr_consent_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  branches      Branch[]
  users         User[]
  invitations   Invitation[]

  @@map("schools")
}

enum SchoolStatus {
  ONBOARDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

model Branch {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  name      String
  address   String?
  isMain    Boolean  @default(false) @map("is_main")
  createdAt DateTime @default(now()) @map("created_at")

  school    School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
  @@map("branches")
}

// ---------- Identity ----------

model User {
  id            String    @id @default(uuid())
  schoolId      String    @map("school_id")
  email         String?   @unique
  phone         String?   @unique
  firstName     String    @map("first_name")
  lastName      String    @map("last_name")
  passwordHash  String?   @map("password_hash")
  isActive      Boolean   @default(true) @map("is_active")
  emailVerified Boolean   @default(false) @map("email_verified")
  phoneVerified Boolean   @default(false) @map("phone_verified")
  lastLoginAt   DateTime? @map("last_login_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  school        School    @relation(fields: [schoolId], references: [id])
  roles         UserRole[]
  sessions      Session[]

  @@index([schoolId])
  @@map("users")
}

model Role {
  id          String   @id @default(uuid())
  schoolId    String?  @map("school_id")   // null = system role (seeded)
  key         String                       // 'owner', 'admin', 'teacher', etc.
  name        String
  description String?
  isSystem    Boolean  @default(false) @map("is_system")
  permissions Json     @default("[]")      // string[] of permission keys, or ["*"]
  createdAt   DateTime @default(now()) @map("created_at")

  users       UserRole[]

  @@unique([schoolId, key])
  @@map("roles")
}

model UserRole {
  userId    String   @map("user_id")
  roleId    String   @map("role_id")
  createdAt DateTime @default(now()) @map("created_at")

  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  @@id([userId, roleId])
  @@map("user_roles")
}

model Session {
  id         String   @id @default(uuid())
  userId     String   @map("user_id")
  tokenHash  String   @unique @map("token_hash")
  ipAddress  String?  @map("ip_address")
  userAgent  String?  @map("user_agent")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}

model Invitation {
  id         String   @id @default(uuid())
  schoolId   String   @map("school_id")
  email      String?
  phone      String?
  roleKey    String   @map("role_key")
  tokenHash  String   @unique @map("token_hash")
  invitedBy  String   @map("invited_by")
  expiresAt  DateTime @map("expires_at")
  acceptedAt DateTime? @map("accepted_at")
  createdAt  DateTime @default(now()) @map("created_at")

  school     School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)

  @@index([schoolId])
  @@map("invitations")
}

model AuditLog {
  id         String   @id @default(uuid())
  schoolId   String?  @map("school_id")
  userId     String?  @map("user_id")
  action     String   // e.g. 'school.create', 'user.invite'
  entityType String?  @map("entity_type")
  entityId   String?  @map("entity_id")
  metadata   Json?
  ipAddress  String?  @map("ip_address")
  createdAt  DateTime @default(now()) @map("created_at")

  @@index([schoolId, createdAt])
  @@map("audit_logs")
}
```

## RLS policies

Apply to every tenant-scoped table. Live in `packages/db/prisma/policies/phase-0.sql`:

```sql
ALTER TABLE branches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON branches
  USING (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON users
  USING (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON invitations
  USING (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON audit_logs
  USING (school_id::text = current_setting('app.current_school_id', true));

-- user_roles: joined through users
CREATE POLICY tenant_isolation ON user_roles
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = user_roles.user_id
      AND users.school_id::text = current_setting('app.current_school_id', true)
  ));
```

`schools` and `roles` (system rows) deliberately do **not** have RLS — they're filtered at the API layer by user ownership and the `is_system` flag respectively.

## Tenant client

`packages/db/src/tenant-client.ts`:

```typescript
import { PrismaClient } from '@prisma/client';

// Single base client for shared use; tenant scoping happens via transaction-local setting
const basePrisma = new PrismaClient();

export async function withTenant<T>(
  schoolId: string,
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  return basePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `SET LOCAL app.current_school_id = '${schoolId}'`
    );
    return fn(tx as unknown as PrismaClient);
  });
}
```

Use it in every authenticated request:

```typescript
// example
@Get('users')
async list(@CurrentUser() user: AuthUser) {
  return withTenant(user.schoolId, (db) =>
    db.user.findMany({ include: { roles: { include: { role: true } } } })
  );
}
```

`SET LOCAL` scopes the setting to the transaction. A bug-prone alternative is `SET` (session-wide) — don't use it; with connection pooling, a leaked setting will leak data.

## API endpoints

All under `/api/v1`. Auth required except `/auth/*` (signup/login) and `/health`.

### Auth

```
POST   /auth/signup-owner
POST   /auth/login
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
POST   /auth/request-otp           — SMS OTP for parents
POST   /auth/verify-otp
GET    /auth/me                    — current user with roles + school
```

Example request shape:

```typescript
// POST /auth/signup-owner
{
  schoolName: string,
  schoolSlug: string,              // server validates uniqueness + format
  ownerFirstName: string,
  ownerLastName: string,
  ownerEmail: string,
  ownerPhone: string,
  password: string,                // min 8 chars, server enforces
  ndprConsent: true                // must be true
}
// Response: { user: User, school: School, token: string }
```

### Schools

```
GET    /schools/me
PATCH  /schools/me                          — owner/admin only
POST   /schools/me/onboarding/:step         — advance wizard
GET    /schools/me/branches
POST   /schools/me/branches
```

### Users

```
GET    /users
POST   /users/invite
DELETE /users/invitations/:id
GET    /users/:id
PATCH  /users/:id
POST   /users/:id/deactivate
POST   /users/:id/activate
```

### Invitations (public, token-based)

```
GET    /invitations/:token         — view invitation details (school name, role, expiry)
POST   /invitations/:token/accept  — set password, accept, get session
```

### Roles

```
GET    /roles                      — system roles + this school's custom roles
GET    /roles/:id
PATCH  /roles/:id                  — only non-system roles
```

### Audit

```
GET    /audit?from=&to=&action=&userId=
```

## UI screens — web (Next.js)

### Public

- `/` — marketing landing (placeholder copy + screenshot, fine for Phase 0)
- `/signup` — school owner signup form
- `/login` — email+password
- `/forgot-password`
- `/reset-password/[token]`
- `/invitations/[token]` — accept invitation, set password

### Onboarding wizard (route group `(onboarding)`)

Each step persists to `schools.onboarding_step` so refresh resumes. Owner is locked out of the dashboard until `status = ACTIVE`.

- Step 1 — school basics: name, motto, address, phone, email
- Step 2 — branding: logo upload (to R2), primary colour
- Step 3 — invite admins (skip-able)
- Step 4 — NDPR consent confirmation
- Step 5 — success screen, "Go to dashboard" button (flips school to `ACTIVE`)

### Admin shell (route group `(admin)`)

- Sidebar: Dashboard, Students, Staff, Academics, Finance, Reports, Settings (most are placeholders in Phase 0)
- Topbar: school logo + name, branch switcher (if >1 branch), notifications bell (empty), profile menu
- `/dashboard` — empty state ("Get started by adding your first class") with onboarding CTAs
- `/settings/profile` — edit own name/email/phone/password
- `/settings/school` — edit school details (owner/admin only)
- `/settings/users` — list, invite, deactivate
- `/settings/roles` — view roles, edit permissions on non-system roles
- `/settings/audit` — paginated audit log view

## UI screens — mobile (Expo)

Phase 0 mobile is a placeholder so parents can log in once invited. Real parent features start Phase 4.

- Login screen — phone + OTP (OTP comes via real SMS once Termii is wired; before that, log to console in dev)
- Empty dashboard — "No children linked yet"
- Profile screen — edit name, change phone (re-verification required)

## RBAC implementation

### Permission strings

In `packages/types/src/permissions.ts`. Phase 0 list:

```typescript
export const PHASE_0_PERMISSIONS = [
  'school.read', 'school.update',
  'branch.read', 'branch.create', 'branch.update', 'branch.delete',
  'user.read', 'user.invite', 'user.update', 'user.deactivate',
  'role.read', 'role.update',
  'audit.read',
] as const;

export const ALL_PERMISSIONS = [...PHASE_0_PERMISSIONS /* extend per phase */] as const;
export type Permission = typeof ALL_PERMISSIONS[number] | '*';
```

### Seeded roles

Seed script creates these on first migration:

| Role key | Permissions | Notes |
|---|---|---|
| `owner` | `["*"]` | One per school, created at signup |
| `admin` | All Phase 0 perms except `school.delete` | Multiple per school |
| `teacher` | TBD Phase 2 | Placeholder |
| `student` | TBD Phase 6 | Placeholder |
| `parent` | TBD Phase 4 | Placeholder |
| `bursar` | TBD Phase 3 | Placeholder |

### Guard

```typescript
// apps/api/src/auth/guards/permissions.guard.ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<Permission[]>('permissions', ctx.getHandler());
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    return required.every(p => userHasPermission(user, p));
  }
}

// Decorator
export const Permissions = (...perms: Permission[]) => SetMetadata('permissions', perms);

// Usage
@Permissions('user.invite')
@Post('invite')
async invite(@Body() dto: InviteDto) { ... }
```

`userHasPermission` checks `*` wildcard, then iterates `user.roles[].permissions[]`.

## Audit interceptor

```typescript
// apps/api/src/audit/audit.interceptor.ts
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      tap(() => {
        if (req.method === 'GET' || !req.user) return;
        this.audit.log({
          schoolId: req.user.schoolId,
          userId: req.user.id,
          action: `${ctx.getClass().name.replace('Controller', '').toLowerCase()}.${ctx.getHandler().name}`,
          ipAddress: req.ip,
          metadata: { method: req.method, path: req.path },
        });
      })
    );
  }
}
```

Registered globally in `app.module.ts`. Writes are fire-and-forget through a BullMQ queue so audit logging never blocks the response.

## Acceptance criteria

End of Phase 0 these must all pass:

1. New user can sign up at `/signup`, complete the 5-step onboarding wizard, and land on `/dashboard`.
2. Owner can invite an admin via `/settings/users`. Admin receives invitation (email in dev — Resend; SMS once Termii is wired). Admin accepts via `/invitations/[token]`, sets a password, and logs in.
3. Two separate schools cannot see each other's data. Verified by E2E test: log in as School A's owner, attempt to fetch School B's student list by guessing the ID — must 404 or 403, never leak.
4. RLS works at the DB layer. Verified by SQL test: connect to DB, `SET app.current_school_id = '<school_a_id>'`, `SELECT * FROM users` returns only School A's users. Switch to School B's ID, returns only School B's.
5. Audit log contains entries for: signup, login, school update, user invite, invitation accept, profile update, user deactivate.
6. Sentry catches a deliberately thrown error in dev.
7. PostHog records `signup_completed` and `onboarding_completed` events.
8. All tests pass: unit, integration, one E2E ("happy path signup → invite → accept → login").
9. CI passes on every PR.

## Work breakdown

Three weeks, day-ish granularity. Adjust as you go.

### Week 1 — scaffolding

- [ ] Bootstrap Turborepo: `pnpm create turbo@latest school-kit`
- [ ] Add `apps/web` (Next.js 15), `apps/api` (NestJS 10), `apps/mobile` (Expo 52)
- [ ] Add packages: `db`, `types`, `ui`, `config`, `ai` (empty for now)
- [ ] `docker-compose.yml` with postgres-16 + pgvector + redis
- [ ] Prisma init in `packages/db`; commit schema above
- [ ] First migration; seed system roles
- [ ] Set up GitHub repo + Actions CI (lint, typecheck, test, build)
- [ ] `.env.example` complete; `README.md` with setup steps

### Week 2 — auth + tenancy

- [ ] Install Better Auth in api, configure
- [ ] Implement `/auth/signup-owner` with full happy path
- [ ] Implement `/auth/login`, `/auth/logout`, `/auth/me`
- [ ] Build `withTenant` helper and apply to all authenticated handlers
- [ ] Write and apply RLS policies; commit a SQL test that proves isolation
- [ ] Implement `PermissionsGuard` and `@Permissions(...)` decorator
- [ ] Seed roles (owner, admin) with their permission sets
- [ ] Audit interceptor wired up; queue worker writes audit_logs
- [ ] Invitations: generate, store hash, send via Resend (dev), accept endpoint

### Week 3 — UI shell + onboarding

- [ ] Tailwind + shadcn/ui setup in `apps/web`
- [ ] Marketing landing at `/` (placeholder copy)
- [ ] `/signup` form with Zod validation matching API
- [ ] Onboarding wizard — 5 steps, state persisted server-side
- [ ] Admin shell layout (sidebar + topbar) at `(admin)/layout.tsx`
- [ ] `/dashboard` empty state
- [ ] `/settings/profile`, `/settings/school`, `/settings/users`, `/settings/audit`
- [ ] Invitation accept flow at `/invitations/[token]`
- [ ] Expo app: login with phone+OTP, empty dashboard, profile
- [ ] Sentry SDK in both web and api; PostHog SDK in web
- [ ] Playwright E2E: signup → onboarding → invite admin → accept → admin logs in

## First prompts for Claude Code

Run these in order. Don't paste the whole spec — Claude Code reads the file.

**Prompt 1 — scaffold:**

> Read `docs/ARCHITECTURE.md`, `CLAUDE.md`, and `docs/modules/phase-0.md`. Then bootstrap the monorepo per the spec: Turborepo with `apps/web` (Next.js 15 App Router), `apps/api` (NestJS 10), `apps/mobile` (Expo SDK 52), and packages `db`, `types`, `ui`, `ai`, `config`. Set up `docker-compose.yml` with postgres-16 + pgvector + redis. Initialise Prisma in `packages/db` with the schema from the Phase 0 spec. Do not implement auth or business logic yet — just scaffolding. After scaffolding, run `pnpm install` and `pnpm dev` and confirm all three apps boot.

**Prompt 2 — tenancy:**

> Read `docs/modules/phase-0.md`. Implement the `withTenant` helper in `packages/db/src/tenant-client.ts` per the spec, write the RLS policies SQL file at `packages/db/prisma/policies/phase-0.sql`, and add a migration that applies them. Write an integration test in `apps/api/src/__tests__/rls.spec.ts` that creates two schools with one user each and proves that querying as School A cannot return School B's user.

**Prompt 3 — auth signup:**

> Read `docs/modules/phase-0.md` section on auth. Implement `POST /auth/signup-owner` end-to-end: validation via Zod DTO, school + owner user creation in a transaction, owner role assignment, Better Auth session creation, return shape per spec. Write the service spec first, then the controller. Cover: happy path, slug already taken, weak password, NDPR consent not given.

Continue scoping like this — one focused concern per prompt.

## What's deferred to later phases

These belong in Phase 0 *eventually* but are deferred until they're actually needed:

- Real SMS delivery via Termii (stub the OTP send in Phase 0; log to console)
- Real WhatsApp delivery (Phase 4)
- File upload to R2 — only logo upload in Phase 0; everything else later
- Multi-branch support beyond CRUD (timetabling per branch is Phase 5)
- 2FA for owners (Phase 3, before finance goes live)
- Password complexity policy beyond min-length (Phase 3)

## Risks and gotchas

- **RLS + connection pooling.** If you switch to PgBouncer in transaction mode, `SET LOCAL` still works; in statement mode it doesn't. Document the mode in `infra/`.
- **Slug collisions.** `schoolkit.ng` subdomain space is small. Reserve common words (`admin`, `api`, `www`, `app`) in seed.
- **Invitation race conditions.** Two admins can simultaneously invite the same email. Treat the invitations table as the source of truth, dedupe on `(school_id, email)` with a unique partial index.
- **Audit volume.** At scale, `audit_logs` grows fast. Plan partition-by-month from day one (`PARTITION BY RANGE (created_at)`).
- **Phone uniqueness on `users`.** The Phase 0 schema makes `users.phone` globally unique, which works for owner/admin signup but breaks Phase 4 (guardians who may legitimately share a phone number — e.g. two siblings whose mother is the contact). Decide before Phase 4 whether to (a) drop the unique constraint and dedupe at the application layer, (b) make uniqueness conditional on a role/type column, or (c) move guardian phones to a separate contact table. Tracked from Phase 0 Prompt 3.
