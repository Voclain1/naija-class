import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateGuardianInput,
  type CreateAndLinkGuardianInput,
  type CreateStudentGuardianLinkResponse,
  type GuardianDetailDto,
  type GuardianDto,
  type GuardianListResponse,
  type InviteGuardianResponse,
  type LinkExistingGuardianInput,
  type ListGuardiansQuery,
  type UpdateGuardianInput,
  type UpdateStudentGuardianLinkInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { EmailService } from "../../common/email/email.service.js";
import { redactEmail, redactPhone } from "../../common/redact";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb. Matches the slice-4
// students convention (student.create, student.update, …). The link table
// uses the singular-hyphenated form student-guardian.{create,update,delete}
// (per docs/modules/phase-1.md line 1140-1141).
const AUDIT = {
  guardianCreate: "guardian.create",
  guardianUpdate: "guardian.update",
  guardianDelete: "guardian.delete",
  guardianInvite: "guardian.invite",
  linkCreate: "student-guardian.create",
  linkUpdate: "student-guardian.update",
  linkDelete: "student-guardian.delete",
} as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Phase 4 / Slice 2 — same 7-day TTL as staff invitations (users.service.ts),
// same reasoning: a week of inbox attention is plenty. Not shared as an
// import between the two services — genuinely independent constants that
// happen to agree, same precedent as the onboarding-step-3 copy
// users.service.ts already documents.
const GUARDIAN_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// Where the guardian portal accept URL points. Mirrors users.service.ts's
// webBaseUrl() exactly — same "don't throw on missing env, just build a
// wrong-but-recoverable URL" reasoning.
function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? "http://localhost:3002";
}

@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  // Phase 4 / Slice 6 — invite() sends real email/SMS through these,
  // gated by NotificationPreferencesService.getEnabledChannels. See
  // docs/modules/phase-4.md §8 D5.
  constructor(
    private readonly email: EmailService,
    private readonly termii: TermiiService,
    private readonly notificationPreferences: NotificationPreferencesService,
  ) {}

  // ----------------------------------------------------------------------
  // list — cursor-paginated, id ASC. Search OR'd across firstName,
  // lastName, phone (case-insensitive). studentId filter joins via the
  // link table.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    query: ListGuardiansQuery,
  ): Promise<GuardianListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.GuardianWhereInput = {};
      if (query.cursor) where.id = { gt: query.cursor };
      if (query.search) {
        const s = query.search.trim();
        where.OR = [
          { firstName: { contains: s, mode: "insensitive" } },
          { lastName: { contains: s, mode: "insensitive" } },
          { phone: { contains: s, mode: "insensitive" } },
        ];
      }
      if (query.studentId) {
        where.students = { some: { studentId: query.studentId } };
      }

      const rows = await db.guardian.findMany({
        where,
        select: GUARDIAN_SELECT,
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const cursor = hasNext ? page[page.length - 1].id : undefined;

      return {
        data: page.map(toGuardianDto),
        meta: cursor === undefined ? {} : { cursor },
      };
    });
  }

  // ----------------------------------------------------------------------
  // findById — detail with linked students.
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<GuardianDetailDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.guardian.findUnique({
        where: { id },
        select: {
          ...GUARDIAN_SELECT,
          students: {
            select: {
              id: true,
              studentId: true,
              isPrimary: true,
              canPickup: true,
              student: {
                select: {
                  admissionNumber: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });
      if (!row) throw new NotFoundError("Guardian not found.");
      return {
        ...toGuardianDto(row),
        students: row.students.map((link) => ({
          linkId: link.id,
          studentId: link.studentId,
          admissionNumber: link.student.admissionNumber,
          firstName: link.student.firstName,
          lastName: link.student.lastName,
          isPrimary: link.isPrimary,
          canPickup: link.canPickup,
        })),
      };
    });
  }

  // ----------------------------------------------------------------------
  // create — flat /guardians, no link.
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateGuardianInput,
    reqCtx: RequestContext,
  ): Promise<GuardianDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const created = await db.guardian.create({
        data: guardianCreateData(authCtx.schoolId, input),
        select: GUARDIAN_SELECT,
      });

      await writeGuardianCreateAudit(db, authCtx, reqCtx, created.id, created.relationship);

      return toGuardianDto(created);
    });
  }

  // ----------------------------------------------------------------------
  // update — partial. No P2002 mapping needed: Guardian has zero unique
  // constraints (spec — phone explicitly shareable; see schema.prisma).
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateGuardianInput,
    reqCtx: RequestContext,
  ): Promise<GuardianDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.guardian.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Guardian not found.");

      const data: Prisma.GuardianUpdateInput = {};
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.relationship !== undefined) data.relationship = input.relationship;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.email !== undefined) data.email = input.email;
      if (input.occupation !== undefined) data.occupation = input.occupation;
      if (input.employer !== undefined) data.employer = input.employer;
      if (input.address !== undefined) data.address = input.address;
      if (input.notes !== undefined) data.notes = input.notes;

      const updated = await db.guardian.update({
        where: { id },
        data,
        select: GUARDIAN_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.guardianUpdate,
          entityType: "guardian",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          // Field names only — no values — so PII can't leak through audit
          // metadata. Same discipline as students.service.update.
          metadata: { changed: Object.keys(data) },
        },
      });

      return toGuardianDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // invite — POST /guardians/:id/invite (Phase 4 / Slice 2, D2). Admin
  // triggers a guardian portal invitation. No request body — the guardian's
  // email is already on the row; there is nothing else to submit.
  // ----------------------------------------------------------------------
  async invite(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<InviteGuardianResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const result = await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.guardian.findUnique({
        where: { id },
        select: { id: true, email: true, phone: true, firstName: true },
      });
      if (!existing) throw new NotFoundError("Guardian not found.");
      if (!existing.email) {
        throw new ValidationError(
          "GUARDIAN_HAS_NO_EMAIL",
          "This guardian has no email on file. Add one before sending a portal invitation.",
        );
      }

      // Reject a second invite while one is still outstanding. Guardian
      // has no unique constraint that would enforce this at the DB level
      // (unlike staff, where the email+outstanding-invitation check in
      // UsersService.invite serves the same purpose) — checked explicitly.
      const outstanding = await db.guardianInvitation.findFirst({
        where: { guardianId: id, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (outstanding) {
        throw new ConflictError(
          "INVITATION_ALREADY_PENDING",
          "This guardian already has an outstanding portal invitation.",
        );
      }

      const now = new Date();

      await db.guardianInvitation.create({
        data: {
          schoolId: authCtx.schoolId,
          guardianId: id,
          tokenHash,
          invitedBy: authCtx.userId,
          expiresAt: new Date(now.getTime() + GUARDIAN_INVITATION_TTL_MS),
        },
      });

      const updated = await db.guardian.update({
        where: { id },
        data: { portalInvitedAt: now },
        select: { portalInvitedAt: true },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.guardianInvite,
          entityType: "guardian",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { email: redactEmail(existing.email) },
        },
      });

      const school = await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { name: true },
      });

      return {
        portalInvitedAt: updated.portalInvitedAt as Date,
        email: existing.email,
        phone: existing.phone,
        firstName: existing.firstName,
        schoolName: school.name,
      };
    });

    // The URL is always logged (not the raw token in isolation) as the
    // manual-copy fallback the admin UI already relies on — see
    // guardians-tab.tsx's inline copy-link panel. Real delivery (below) is
    // best-effort on top of that fallback, not a replacement for it: the
    // invitation row + audit log are already committed by this point, and
    // acceptUrl is always returned regardless of send outcome, so a Resend/
    // Termii failure never breaks the endpoint's response contract.
    const acceptUrl = `${portalBaseUrl()}/invitations/${rawToken}`;
    this.logger.log(`[GUARDIAN INVITATION] ${acceptUrl}`);

    await this.deliverInvitation({
      schoolId: authCtx.schoolId,
      schoolName: result.schoolName,
      firstName: result.firstName,
      email: result.email,
      phone: result.phone,
      acceptUrl,
    });

    return { guardianId: id, portalInvitedAt: result.portalInvitedAt, acceptUrl };
  }

  // Phase 4 / Slice 6 — best-effort email/SMS delivery of the invite link,
  // gated per-channel by the school's NotificationPreference. Runs after
  // the invitation row is already committed (see invite() above) — a send
  // failure here is logged, never thrown, and never rolls back the
  // invitation or removes acceptUrl from the response.
  private async deliverInvitation(params: {
    schoolId: string;
    schoolName: string;
    firstName: string;
    email: string | null;
    phone: string | null;
    acceptUrl: string;
  }): Promise<void> {
    const { email: emailEnabled, sms: smsEnabled } =
      await this.notificationPreferences.getEnabledChannels(params.schoolId);

    if (emailEnabled && params.email) {
      try {
        await this.email.send({
          to: params.email,
          subject: `You're invited to ${params.schoolName}'s parent portal`,
          html: `<p>Hi ${params.firstName},</p><p>${params.schoolName} has invited you to the School Kit parent portal. Use the link below to set your password and log in — it expires in 7 days.</p><p><a href="${params.acceptUrl}">${params.acceptUrl}</a></p>`,
        });
      } catch (err) {
        this.logger.warn(
          `Guardian invite email failed for ${redactEmail(params.email)}: ${String(err)}`,
        );
      }
    }

    if (smsEnabled && params.phone) {
      const normalized = normalizeNigerianPhone(params.phone);
      if (!normalized) {
        this.logger.warn(`Guardian invite SMS skipped — unrecognized phone format (${redactPhone(params.phone)})`);
      } else {
        try {
          await this.termii.sendSms(
            normalized,
            `${params.schoolName}: You've been invited to the parent portal. Set your password: ${params.acceptUrl}`,
          );
        } catch (err) {
          this.logger.warn(
            `Guardian invite SMS failed for ${redactPhone(params.phone)}: ${String(err)}`,
          );
        }
      }
    }
  }

  // ----------------------------------------------------------------------
  // delete — hard-delete, gated on no links. Spec: "hard-delete only if no
  // StudentGuardian rows" (docs/modules/phase-1.md line 751). The Cascade
  // onDelete on student_guardians is defence-in-depth in case the spec ever
  // softens; today the explicit guard is the only allowed path.
  // ----------------------------------------------------------------------
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.guardian.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Guardian not found.");

      const linkCount = await db.studentGuardian.count({
        where: { guardianId: id },
      });
      if (linkCount > 0) {
        throw new ConflictError(
          "GUARDIAN_HAS_LINKS",
          "Cannot delete a guardian who is still linked to one or more students. Unlink first.",
        );
      }

      await db.guardian.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.guardianDelete,
          entityType: "guardian",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });
    });
  }

  // ----------------------------------------------------------------------
  // linkExisting — POST /students/:studentId/guardians.
  //
  // Pre-checks the student exists (RLS would otherwise turn a foreign-key
  // P2003 into a confusing 500 — explicit 404 is friendlier). Pre-checks
  // the guardian too for symmetry. Then, inside the SAME withTenant
  // transaction:
  //   1. demote any existing isPrimary link if input.isPrimary === true
  //   2. create the new link (P2002 → GUARDIAN_ALREADY_LINKED)
  //   3. write the audit row
  // All three either commit together or roll back together because
  // withTenant wraps its callback in $transaction.
  // ----------------------------------------------------------------------
  async linkExisting(
    authCtx: AuthContext,
    studentId: string,
    input: LinkExistingGuardianInput,
    reqCtx: RequestContext,
  ): Promise<CreateStudentGuardianLinkResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({
        where: { id: studentId },
        select: { id: true },
      });
      if (!student) throw new NotFoundError("Student not found.");

      const guardian = await db.guardian.findUnique({
        where: { id: input.guardianId },
        select: GUARDIAN_SELECT,
      });
      if (!guardian) throw new NotFoundError("Guardian not found.");

      const isPrimary = input.isPrimary ?? false;
      const canPickup = input.canPickup ?? true;

      if (isPrimary) {
        await demoteOtherPrimaries(db, studentId);
      }

      let link;
      try {
        link = await db.studentGuardian.create({
          data: {
            schoolId: authCtx.schoolId,
            studentId,
            guardianId: input.guardianId,
            isPrimary,
            canPickup,
          },
          select: LINK_SELECT,
        });
      } catch (e) {
        throw mapStudentGuardianLinkUniqueViolation(e);
      }

      await writeLinkCreateAudit(db, authCtx, reqCtx, link);

      return {
        link: toLinkDto(link),
        guardian: toGuardianDto(guardian),
        createdGuardian: false,
      };
    });
  }

  // ----------------------------------------------------------------------
  // createAndLink — POST /students/:studentId/guardians/new.
  //
  // Same transactional discipline as linkExisting; just creates the
  // Guardian first. If the student doesn't exist, the Guardian insert is
  // rolled back too (NotFoundError thrown BEFORE the insert).
  // ----------------------------------------------------------------------
  async createAndLink(
    authCtx: AuthContext,
    studentId: string,
    input: CreateAndLinkGuardianInput,
    reqCtx: RequestContext,
  ): Promise<CreateStudentGuardianLinkResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({
        where: { id: studentId },
        select: { id: true },
      });
      if (!student) throw new NotFoundError("Student not found.");

      const { isPrimary: isPrimaryIn, canPickup: canPickupIn, ...guardianInput } = input;
      const isPrimary = isPrimaryIn ?? false;
      const canPickup = canPickupIn ?? true;

      const guardian = await db.guardian.create({
        data: guardianCreateData(authCtx.schoolId, guardianInput),
        select: GUARDIAN_SELECT,
      });

      await writeGuardianCreateAudit(db, authCtx, reqCtx, guardian.id, guardian.relationship);

      if (isPrimary) {
        await demoteOtherPrimaries(db, studentId);
      }

      const link = await db.studentGuardian.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId,
          guardianId: guardian.id,
          isPrimary,
          canPickup,
        },
        select: LINK_SELECT,
      });

      await writeLinkCreateAudit(db, authCtx, reqCtx, link);

      return {
        link: toLinkDto(link),
        guardian: toGuardianDto(guardian),
        createdGuardian: true,
      };
    });
  }

  // ----------------------------------------------------------------------
  // updateLink — PATCH /student-guardians/:id. Toggle isPrimary / canPickup.
  // ----------------------------------------------------------------------
  async updateLink(
    authCtx: AuthContext,
    linkId: string,
    input: UpdateStudentGuardianLinkInput,
    reqCtx: RequestContext,
  ): Promise<CreateStudentGuardianLinkResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.studentGuardian.findUnique({
        where: { id: linkId },
        select: { id: true, studentId: true },
      });
      if (!existing) throw new NotFoundError("Student-guardian link not found.");

      // If promoting to primary, demote siblings BEFORE the update so the
      // updated row stays primary even if Postgres ever re-orders writes.
      if (input.isPrimary === true) {
        await demoteOtherPrimaries(db, existing.studentId, linkId);
      }

      const data: Prisma.StudentGuardianUpdateInput = {};
      if (input.isPrimary !== undefined) data.isPrimary = input.isPrimary;
      if (input.canPickup !== undefined) data.canPickup = input.canPickup;

      const link = await db.studentGuardian.update({
        where: { id: linkId },
        data,
        select: LINK_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.linkUpdate,
          entityType: "student-guardian",
          entityId: linkId,
          ipAddress: reqCtx.ipAddress,
          metadata: { changed: Object.keys(data) },
        },
      });

      const guardian = await db.guardian.findUnique({
        where: { id: link.guardianId },
        select: GUARDIAN_SELECT,
      });
      // Guardian must exist — the FK guarantees it. If somehow it's gone
      // under us, fall through to a generic NotFound rather than a crash.
      if (!guardian) throw new NotFoundError("Guardian not found.");

      return {
        link: toLinkDto(link),
        guardian: toGuardianDto(guardian),
        createdGuardian: false,
      };
    });
  }

  // ----------------------------------------------------------------------
  // unlink — DELETE /student-guardians/:id. Guardian row preserved.
  // ----------------------------------------------------------------------
  async unlink(
    authCtx: AuthContext,
    linkId: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.studentGuardian.findUnique({
        where: { id: linkId },
        select: { id: true, studentId: true, guardianId: true },
      });
      if (!existing) throw new NotFoundError("Student-guardian link not found.");

      await db.studentGuardian.delete({ where: { id: linkId } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.linkDelete,
          entityType: "student-guardian",
          entityId: linkId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: existing.studentId,
            guardianId: existing.guardianId,
          },
        },
      });
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const GUARDIAN_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  relationship: true,
  phone: true,
  email: true,
  occupation: true,
  employer: true,
  address: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GuardianSelect;

type GuardianRow = Prisma.GuardianGetPayload<{ select: typeof GUARDIAN_SELECT }>;

export function toGuardianDto(row: GuardianRow): GuardianDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    relationship: row.relationship,
    phone: row.phone,
    email: row.email,
    occupation: row.occupation,
    employer: row.employer,
    address: row.address,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const LINK_SELECT = {
  id: true,
  studentId: true,
  guardianId: true,
  isPrimary: true,
  canPickup: true,
  createdAt: true,
} satisfies Prisma.StudentGuardianSelect;

type LinkRow = Prisma.StudentGuardianGetPayload<{ select: typeof LINK_SELECT }>;

function toLinkDto(row: LinkRow) {
  return {
    id: row.id,
    studentId: row.studentId,
    guardianId: row.guardianId,
    isPrimary: row.isPrimary,
    canPickup: row.canPickup,
    createdAt: row.createdAt,
  };
}

function guardianCreateData(
  schoolId: string,
  input: Omit<CreateGuardianInput, never>,
): Prisma.GuardianCreateInput {
  return {
    schoolId,
    firstName: input.firstName,
    lastName: input.lastName,
    relationship: input.relationship,
    phone: input.phone,
    email: input.email ?? null,
    occupation: input.occupation ?? null,
    employer: input.employer ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
  } as unknown as Prisma.GuardianCreateInput;
}

// Demote any other isPrimary=true links for this student. Used by both
// linkExisting (when input.isPrimary=true) and updateLink (when promoting
// a sibling). Runs inside the caller's withTenant transaction so the
// promote + demote land atomically.
async function demoteOtherPrimaries(
  db: import("@school-kit/db").PrismaClient,
  studentId: string,
  exceptLinkId?: string,
): Promise<void> {
  await db.studentGuardian.updateMany({
    where: {
      studentId,
      isPrimary: true,
      ...(exceptLinkId ? { NOT: { id: exceptLinkId } } : {}),
    },
    data: { isPrimary: false },
  });
}

async function writeGuardianCreateAudit(
  db: import("@school-kit/db").PrismaClient,
  authCtx: AuthContext,
  reqCtx: RequestContext,
  guardianId: string,
  relationship: string,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action: AUDIT.guardianCreate,
      entityType: "guardian",
      entityId: guardianId,
      ipAddress: reqCtx.ipAddress,
      // Relationship is an enum bucket (FATHER/MOTHER/…) — not identifying.
      // First/last/phone/email/address/occupation/employer DO NOT belong
      // here; the redactor would mask them anyway, but the rule is to keep
      // PII out of audit metadata at the source.
      metadata: { relationship },
    },
  });
}

async function writeLinkCreateAudit(
  db: import("@school-kit/db").PrismaClient,
  authCtx: AuthContext,
  reqCtx: RequestContext,
  link: LinkRow,
): Promise<void> {
  await db.auditLog.create({
    data: {
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action: AUDIT.linkCreate,
      entityType: "student-guardian",
      entityId: link.id,
      ipAddress: reqCtx.ipAddress,
      // IDs and bool flags only — no PII. Spec audit shape.
      metadata: {
        studentId: link.studentId,
        guardianId: link.guardianId,
        isPrimary: link.isPrimary,
        canPickup: link.canPickup,
      },
    },
  });
}

// student_guardians has one unique constraint: (student_id, guardian_id).
// The (only) P2002 from a link create is "this guardian is already linked to
// this student". RLS hides the constraint name (see CLAUDE.md "RLS hides
// constraint name on uniqueness errors") but the single-constraint shape
// makes the discriminator unambiguous, same as slice 4's admission-number
// helper. The multi-constraint err.meta.target inspection stays deferred
// until a slice actually adds a model with two uniques.
function mapStudentGuardianLinkUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "GUARDIAN_ALREADY_LINKED",
      "This guardian is already linked to this student.",
    );
  }
  return e;
}
