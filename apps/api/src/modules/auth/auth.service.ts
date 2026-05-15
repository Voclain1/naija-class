import { Injectable } from "@nestjs/common";
import * as crypto from "node:crypto";
import * as argon2 from "argon2";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  InternalError,
  type SignupOwnerInput,
  type SignupOwnerResponse,
} from "@school-kit/types";

import { redactEmail } from "../../common/redact";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SIGNUP_AUDIT_ACTION = "auth.signup_owner";

interface SignupContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  // Creates: School → User → UserRole (owner) → AuditLog in a single
  // transaction. Then mints a session row outside the tx and returns the
  // raw bearer token to the client (the token hash is what we persist).
  //
  // Atomicity: every row that belongs to "this new tenant exists" either all
  // commits or all rolls back. The session is intentionally outside that
  // boundary — failing to mint a session is not failing to create the
  // account; the user can log in. (See ADR-001 in docs/DECISIONS.md.)
  async signupOwner(input: SignupOwnerInput, ctx: SignupContext): Promise<SignupOwnerResponse> {
    // Pre-check email + phone uniqueness via a SECURITY DEFINER function.
    // We do this BEFORE hashing the password so the cheap rejection path
    // stays cheap. `users` is under FORCE RLS, which means a P2002 from
    // INSERT comes back with `target: null` and "Unique constraint failed
    // on the (not available)" — Postgres deliberately hides which field
    // collided. Without this pre-check we cannot tell email-taken from
    // phone-taken. See migration 20260515000000_add_signup_uniqueness_function.
    await this.assertEmailAndPhoneAvailable(input.ownerEmail, input.ownerPhone);

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });

    let created: {
      schoolId: string;
      userId: string;
      school: Prisma.SchoolGetPayload<{ select: typeof SCHOOL_RESPONSE_SELECT }>;
      user: Prisma.UserGetPayload<{ select: typeof USER_RESPONSE_SELECT }>;
    };

    try {
      created = await basePrisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            name: input.schoolName,
            slug: input.schoolSlug,
            ndprConsent: true,
            ndprConsentAt: new Date(),
            // status, onboardingStep default per schema.
          },
          select: SCHOOL_RESPONSE_SELECT,
        });

        // From here on, every tenant-scoped INSERT must satisfy the policy's
        // WITH CHECK. Set the GUC inside the same tx so RLS sees the new
        // school's id as the current tenant.
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;

        const user = await tx.user.create({
          data: {
            schoolId: school.id,
            firstName: input.ownerFirstName,
            lastName: input.ownerLastName,
            email: input.ownerEmail,
            phone: input.ownerPhone,
            passwordHash,
            // is_active, verification flags default per schema.
          },
          select: USER_RESPONSE_SELECT,
        });

        const ownerRole = await tx.role.findFirst({
          where: { schoolId: null, key: "owner", isSystem: true },
          select: { id: true },
        });
        if (!ownerRole) {
          // Configuration error — should be caught in CI via the integration
          // suite. If it happens in prod, fail loudly and roll back; do NOT
          // silently create a school without an owner role.
          throw new InternalError(
            "System role 'owner' is not seeded. Run `pnpm db:seed` against this database.",
          );
        }

        await tx.userRole.create({
          data: { userId: user.id, roleId: ownerRole.id },
        });

        // Audit entry written inline rather than queued through BullMQ. Two
        // reasons: (1) signup is the bootstrap event for the tenant — there
        // is no school_id yet when a queue worker would dequeue, so the
        // out-of-band write loses the atomicity we want here. (2) writing
        // inside the same tx as the school + user means we either record the
        // signup or we don't have a school at all — never an orphaned
        // user-without-audit-log. Once we have the audit interceptor for
        // post-auth mutations (Phase 0 Week 2), it queues via BullMQ; this
        // one signup write stays direct on purpose.
        await tx.auditLog.create({
          data: {
            schoolId: school.id,
            userId: user.id,
            action: SIGNUP_AUDIT_ACTION,
            entityType: "school",
            entityId: school.id,
            ipAddress: ctx.ipAddress,
            metadata: {
              schoolSlug: school.slug,
              ownerEmail: redactEmail(input.ownerEmail),
              // password / passwordHash / token are deliberately absent.
            },
          },
        });

        return {
          schoolId: school.id,
          userId: user.id,
          school,
          user,
        };
      });
    } catch (err) {
      throw translatePrismaError(err);
    }

    // Session creation outside the school+user transaction (see method
    // comment for why). Goes through withTenant so the RLS policy on
    // `sessions` is satisfied.
    const { rawToken } = await this.createSession(created.schoolId, created.userId, ctx);

    return {
      user: created.user,
      school: created.school,
      token: rawToken,
    };
  }

  // Calls the SECURITY DEFINER function added in
  // 20260515000000_add_signup_uniqueness_function — returns two booleans
  // and never row data, so it leaks no cross-tenant information beyond
  // what the response itself would surface (a separate code per field).
  private async assertEmailAndPhoneAvailable(email: string, phone: string): Promise<void> {
    const rows = await basePrisma.$queryRaw<
      Array<{ email_taken: boolean; phone_taken: boolean }>
    >`SELECT * FROM auth_check_signup_uniqueness(${email}, ${phone})`;
    const check = rows[0];
    if (!check) {
      // Shouldn't happen — the SQL function always returns one row.
      throw new InternalError("Uniqueness pre-check returned no rows.");
    }
    if (check.email_taken) {
      throw new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (check.phone_taken) {
      throw new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
  }

  private async createSession(
    schoolId: string,
    userId: string,
    ctx: SignupContext,
  ): Promise<{ rawToken: string }> {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await withTenant(schoolId, (db) =>
      db.session.create({
        data: {
          userId,
          tokenHash,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      }),
    );

    return { rawToken };
  }
}

// Selects — explicit so we never accidentally leak passwordHash, internal
// flags, or anything else added to the model in a future migration.

const USER_RESPONSE_SELECT = {
  id: true,
  schoolId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  emailVerified: true,
  phoneVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const SCHOOL_RESPONSE_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  onboardingStep: true,
  ndprConsent: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SchoolSelect;

// Map Prisma unique-constraint errors into typed ConflictErrors with stable
// sub-codes the client can branch on. Everything else passes through.
//
// Prisma's `meta.target` shape varies — sometimes it's the field name array
// (['email']), sometimes the index name as a string ('users_email_key'),
// occasionally undefined. We build a single search haystack from target +
// error message so substring matches against the field name catch every
// observed shape, with the message as a final fallback.
function translatePrismaError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const fields: string[] = Array.isArray(target)
      ? target.map((t) => String(t))
      : typeof target === "string"
        ? [target]
        : [];
    const haystack = (fields.join(",") + " " + (err.message ?? "")).toLowerCase();

    if (haystack.includes("slug")) {
      return new ConflictError("SCHOOL_SLUG_TAKEN", "That school slug is already taken.");
    }
    if (haystack.includes("email")) {
      return new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (haystack.includes("phone")) {
      return new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
    return new ConflictError("UNIQUE_VIOLATION", "That value is already taken.");
  }
  return err;
}
