import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { applySchoolDefaults, basePrisma } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  type PaystackSetupStatus,
  PLATFORM_AUDIT_PAGE_SIZE,
  PLATFORM_AUDIT_VIEW_ACTIONS,
  type PlatformAdminAuditEntryDto,
  type PlatformAdminAuditLogQuery,
  type PlatformAdminAuditLogResponse,
  type PlatformAdminCancelOwnerInvitationResponse,
  type PlatformAdminDeleteSchoolInput,
  type PlatformAdminDeleteSchoolResponse,
  type PlatformAdminSchoolDeletionCheckDto,
  type PlatformAdminSchoolSuspensionResponse,
  type PlatformAdminSuspendSchoolInput,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminPaystackSetupRequestDto,
  type PlatformAdminPaystackSetupRevealDto,
  type PlatformAdminResolvePaystackSetupInput,
  type PlatformAdminResendOwnerInvitationInput,
  type PlatformAdminResendOwnerInvitationResponse,
  type PlatformAdminResolvePaystackSetupResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetAiBudgetInput,
  type PlatformAdminSetAiBudgetResponse,
  type PlatformAdminSetAiEnabledInput,
  type PlatformAdminSetAiEnabledResponse,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
  type PlatformAdminUserDto,
} from "@school-kit/types";

import { DEFAULT_MONTHLY_TOKEN_BUDGET } from "../../common/ai/ai.constants.js";
import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { EmailService } from "../../common/email/email.service";
import { PaystackService } from "../../common/paystack/paystack.service";
import { redactEmail } from "../../common/redact";
import { generateUniqueSchoolSlug } from "../../common/slug/school-slug.js";

import { deleteSchoolRows, holdsPlatformAdmin, readDeletionFacts } from "./school-deletion";

// Cross-tenant service. Reads go through the platform_admin_* SECURITY
// DEFINER functions (see CLAUDE.md's inventory) via basePrisma directly —
// this module deliberately stays outside the tenant-scoping helper every
// other service uses, and never references the Invoice/Payment/Student
// Prisma delegates. Both constraints are enforced mechanically by
// platform-admin-access.spec.ts's import-boundary test, not just this
// comment.
//
// createSchool() (2026-08-07) is the surface's first write. It does NOT
// need a SECURITY DEFINER function for the write itself — School/Invitation
// creation reuses AuthService.signupOwner's exact pattern (basePrisma.
// $transaction, create School, `SET LOCAL app.current_school_id` via raw
// SQL inside the same tx, then ordinary tenant-scoped inserts satisfy RLS's
// WITH CHECK). SECURITY DEFINER is only needed for the pre-tenant
// availability *read* (platform_admin_check_owner_email_available), same
// division of concerns as every other function in the inventory.

// Slug derivation moved to ../../common/slug/school-slug.ts (2026-08-12)
// when self-serve signup became a second generator caller — see that file's
// header for why sharing became a correctness requirement rather than a
// tidiness one.

// 14 days — longer than the 7-day staff/guardian invitation precedent.
// Standing up a whole school is a bigger commitment to act on than
// accepting a portal invite, and there's no self-serve resend on this
// surface yet if it lapses (see CLAUDE.md's "Platform super-admin" note).
const OWNER_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// Mirrors AuthService's SIGNUP_TRANSACTION_TIMEOUT_MS, and for the same
// reason. Until 2026-08-14 createSchool's transaction was three quick writes
// and ran fine on Prisma's 5000ms interactive-transaction default. Adding
// applySchoolDefaults() puts ~8 more sequential round-trips inside that
// boundary — which is exactly the shape that caused the 2026-08-02/03
// production incident, where signupOwner's equivalent transaction measured
// 5172ms against real Neon latency (172ms over the default) and failed every
// signup with a 500 for roughly two hours. Provisioning is far lower-volume
// than signup, but the failure mode is identical and the remedy is the same.
// Deliberately a local constant rather than an import from auth.service.ts:
// that one is module-private there, and this module's import-boundary spec
// keeps platform-admin from reaching into other services.
const CREATE_SCHOOL_TRANSACTION_TIMEOUT_MS = 20_000;

// Same WEB_BASE_URL convention as UsersService.invite() / GuardiansService
// (PORTAL_BASE_URL) — dev default matches the web dev port, production must
// set it explicitly. Duplicated rather than imported: it's three lines, and
// there's no shared module either sibling already reaches into.
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}


interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupUserForLoginRow {
  user_id: string;
  school_id: string;
  password_hash: string | null;
  is_active: boolean;
}

interface ListSchoolsRow {
  school_id: string;
  name: string;
  slug: string;
  created_at: Date;
  is_active: boolean;
  student_count: bigint;
  staff_count: bigint;
  has_owner: boolean;
  owner_invite_pending: boolean;
  owner_invite_expires_at: Date | null;
  early_access_granted_at: Date | null;
  ai_enabled: boolean;
  ai_monthly_token_budget: number | null;
  staff_mobile_enabled: boolean;
  suspended_at: Date | null;
}

// Mirrors platform_admin_list_paystack_setup_requests()'s columns.
interface ListPaystackSetupRequestsRow {
  request_id: string;
  school_id: string;
  school_name: string;
  business_name: string;
  status: PaystackSetupStatus;
  submitted_at: Date;
  contact_name: string;
}

interface CheckOwnerEmailAvailableRow {
  is_available: boolean;
  reason: "USER_EXISTS" | "INVITE_PENDING" | null;
}

interface ListUsersRow {
  user_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  role_names: string[];
  created_at: Date;
  last_login_at: Date | null;
  is_active: boolean;
}

type TxClient = Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0];

function newOwnerInvitationToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash, expiresAt: new Date(Date.now() + OWNER_INVITATION_TTL_MS) };
}

// Pre-write availability check for an owner email, via the SECURITY DEFINER
// function (users and invitations are FORCE RLS, and the check is
// cross-tenant). Takes a client so the resend path can run it inside its
// transaction, where it sees that transaction's own just-ended invitations.
async function assertOwnerEmailAvailable(
  db: Pick<TxClient, "$queryRaw">,
  email: string,
): Promise<void> {
  const rows = await db.$queryRaw<CheckOwnerEmailAvailableRow[]>`
    SELECT * FROM platform_admin_check_owner_email_available(${email})
  `;
  const availability = rows[0];
  if (availability?.is_available) return;
  if (availability?.reason === "INVITE_PENDING") {
    throw new ConflictError(
      "INVITE_PENDING",
      "This email already has a pending owner invitation at another school.",
    );
  }
  throw new ConflictError("EMAIL_TAKEN", "A user with that email already exists on the platform.");
}

// Ends every unaccepted, unexpired owner invitation for the school by setting
// expires_at to the TRANSACTION's start time. The caller must already have set
// the school's GUC in `tx`.
//
// Raw SQL rather than updateMany({ expiresAt: new Date() }) on purpose: inside
// a transaction Postgres' now() is the transaction start, so a JavaScript
// "now" lands a few milliseconds AFTER it — and the availability check that
// follows (`expires_at > now()`) would still see the invitation as live and
// refuse to resend to the same address. Same reference clock on both sides —
// TRUNCATED to milliseconds, because expires_at is timestamp(3) and storing
// now()'s microseconds would ROUND, half the time to a value just after now(),
// leaving the invitation live for the check. (Found as a 50% flaky spec.)
async function endOpenOwnerInvitations(tx: TxClient, schoolId: string): Promise<number> {
  return tx.$executeRaw`
    UPDATE invitations
    SET expires_at = date_trunc('milliseconds', now() AT TIME ZONE 'UTC')
    WHERE school_id = ${schoolId}
      AND role_key = 'owner'
      AND accepted_at IS NULL
      AND expires_at > (now() AT TIME ZONE 'UTC')
  `;
}

// `before` cursor: "<ISO time>|<id>" of the last entry on the previous page.
// Anything unparseable is treated as "from the top" rather than an error — it
// is our own opaque string round-tripping through the browser.
function parseAuditCursor(raw: string | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = raw.split("|");
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

// Same account-enumeration defense as AuthService.login / PortalAuthService
// — argon2.verify against a fixed dummy hash on a miss, so total response
// time is on the same order as a real verification. Lazily generated,
// cached for the process lifetime; a local copy (not imported from
// auth.service.ts) since that constant is module-private there.
let dummyVerifyHash: string | undefined;
// Resolves a setup request id to its school_id + status BEFORE any tenant
// exists — the same chicken-and-egg the SECURITY DEFINER functions solve
// elsewhere. paystack_setup_requests is under FORCE RLS, so a plain
// basePrisma read with no GUC set returns nothing at all (verified against a
// live database, see the migration's commit).
//
// Reuses the existing list function rather than adding a second SECURITY
// DEFINER function for a single-row lookup: the queue is bounded by how many
// schools are waiting on a human, and one more SD function to save a filter
// would widen the inventory for no security benefit. Returns only the two
// scalars the callers need, never the banking fields.
async function resolvePaystackSetupRequestSchool(
  requestId: string,
): Promise<{ schoolId: string; status: PaystackSetupStatus }> {
  const rows = await basePrisma.$queryRaw<ListPaystackSetupRequestsRow[]>`
    SELECT * FROM platform_admin_list_paystack_setup_requests()
  `;
  const match = rows.find((r) => r.request_id === requestId);
  if (!match) {
    throw new NotFoundError("Paystack setup request not found.");
  }
  return { schoolId: match.school_id, status: match.status };
}

async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-platform-admin-login-target");
  }
  return dummyVerifyHash;
}

const LOGIN_AUDIT_ACTION = "platform_admin.login";
const SCHOOLS_LIST_AUDIT_ACTION = "platform_admin.schools.list";
const USERS_LIST_AUDIT_ACTION = "platform_admin.users.list";
const SCHOOLS_CREATE_AUDIT_ACTION = "platform_admin.schools.create";
const SCHOOLS_SET_EARLY_ACCESS_AUDIT_ACTION = "platform_admin.schools.set-early-access";
const SCHOOLS_SET_AI_ENABLED_AUDIT_ACTION = "platform_admin.schools.set-ai-enabled";
const SCHOOLS_SET_STAFF_MOBILE_AUDIT_ACTION = "platform_admin.schools.set-staff-mobile";
// Same action name the hand-written production row used on 2026-08-16, so
// that row and every later one read as one history.
const SCHOOLS_SET_AI_BUDGET_AUDIT_ACTION = "platform_admin.schools.set-ai-budget";
const OWNER_INVITATION_RESEND_AUDIT_ACTION = "platform_admin.owner-invitation.resend";
const OWNER_INVITATION_CANCEL_AUDIT_ACTION = "platform_admin.owner-invitation.cancel";
const SCHOOLS_SUSPEND_AUDIT_ACTION = "platform_admin.schools.suspend";
const SCHOOLS_REACTIVATE_AUDIT_ACTION = "platform_admin.schools.reactivate";
const SCHOOLS_DELETE_AUDIT_ACTION = "platform_admin.schools.delete";
const SCHOOLS_DELETION_CHECK_AUDIT_ACTION = "platform_admin.schools.deletion-check";
const AUDIT_LOG_READ_AUDIT_ACTION = "platform_admin.audit-log.read";

// A delete touches every tenant table; give it room on real Neon latency.
const DELETE_SCHOOL_TRANSACTION_TIMEOUT_MS = 60_000;
// Paystack assisted setup (2026-08-15). The reveal action is the important
// one: it is the only path in the product that returns a school's bank
// account number, and every single call writes one of these rows.
const PAYSTACK_SETUP_LIST_AUDIT_ACTION = "platform_admin.paystack-setup.list";
const PAYSTACK_SETUP_REVEAL_AUDIT_ACTION = "paystack-setup.reveal";
const PAYSTACK_SETUP_FULFILLED_AUDIT_ACTION = "paystack-setup.fulfilled";
const PAYSTACK_SETUP_REJECTED_AUDIT_ACTION = "paystack-setup.rejected";

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    private readonly email: EmailService,
    private readonly paystack: PaystackService,
  ) {}

  // Reuses the exact same SECURITY DEFINER lookup, argon2 verification, and
  // session-minting helper as staff login (AuthService.login) — "no new
  // credential system", per the approved plan. This deliberately does NOT
  // also check the platform-admin flag here: that check belongs solely to
  // PlatformAdminGuard, re-read from the DB on every request, not trusted
  // from application code at login time (and not duplicated here, per this
  // module's own import-boundary constraint above). A staff member who
  // authenticates here but isn't a platform admin gets a session exactly
  // like any other successful login — their very next platform-admin
  // request is rejected by the guard with a real 403.
  async login(
    input: PlatformAdminLoginInput,
    ctx: RequestContext,
  ): Promise<PlatformAdminLoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupUserForLoginRow[]>`
      SELECT * FROM auth_lookup_user_for_login(${input.email})
    `;
    const row = rows[0];

    if (!row) {
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordOk = await password
      .verifyPassword(row.password_hash ?? (await getDummyVerifyHash()), input.password)
      .catch(() => false);
    if (!passwordOk || !row.is_active) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const { rawToken } = await createSession(row.school_id, row.user_id, ctx);

    // Direct write, not tenant-scoped — this action is cross-tenant by
    // nature (see CLAUDE.md's audit_logs RLS policy note: schoolId IS NULL
    // rows pass through unconditionally).
    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: row.user_id,
        action: LOGIN_AUDIT_ACTION,
        entityType: "user",
        entityId: row.user_id,
        ipAddress: ctx.ipAddress,
        metadata: { email: redactEmail(input.email) },
      },
    });

    return { token: rawToken };
  }

  async listSchools(
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSchoolDto[]> {
    const rows = await basePrisma.$queryRaw<ListSchoolsRow[]>`
      SELECT * FROM platform_admin_list_schools()
    `;

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_LIST_AUDIT_ACTION,
        entityType: "school",
        ipAddress: reqCtx.ipAddress,
        metadata: { resultCount: rows.length },
      },
    });

    return rows.map((r) => ({
      schoolId: r.school_id,
      name: r.name,
      slug: r.slug,
      createdAt: r.created_at.toISOString(),
      isActive: r.is_active,
      studentCount: Number(r.student_count),
      staffCount: Number(r.staff_count),
      hasOwner: r.has_owner,
      ownerInvitePending: r.owner_invite_pending,
      ownerInviteExpiresAt: r.owner_invite_expires_at ? r.owner_invite_expires_at.toISOString() : null,
      earlyAccessGrantedAt: r.early_access_granted_at
        ? r.early_access_granted_at.toISOString()
        : null,
      aiEnabled: r.ai_enabled,
      aiMonthlyTokenBudget: r.ai_monthly_token_budget,
      aiEffectiveMonthlyTokenBudget: r.ai_monthly_token_budget ?? DEFAULT_MONTHLY_TOKEN_BUDGET,
      staffMobileEnabled: r.staff_mobile_enabled,
      suspendedAt: r.suspended_at ? r.suspended_at.toISOString() : null,
    }));
  }

  // ─── Paystack assisted setup (2026-08-15) ─────────────────────────────────
  //
  // Three methods, deliberately split into a browse tier and a reveal tier.
  // See docs/modules/paystack-assisted-setup.md §2 D4 and CLAUDE.md's
  // inventory row for platform_admin_list_paystack_setup_requests.

  // GET /platform-admin/paystack-setup-requests — the operator's queue.
  // Carries NO banking fields: this renders on page load for every pending
  // request whether or not the operator is acting on one.
  async listPaystackSetupRequests(
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminPaystackSetupRequestDto[]> {
    const rows = await basePrisma.$queryRaw<ListPaystackSetupRequestsRow[]>`
      SELECT * FROM platform_admin_list_paystack_setup_requests()
    `;

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: PAYSTACK_SETUP_LIST_AUDIT_ACTION,
        entityType: "paystack_setup_request",
        ipAddress: reqCtx.ipAddress,
        metadata: { resultCount: rows.length },
      },
    });

    return rows.map((r) => ({
      requestId: r.request_id,
      schoolId: r.school_id,
      schoolName: r.school_name,
      businessName: r.business_name,
      status: r.status,
      submittedAt: r.submitted_at.toISOString(),
      contactName: r.contact_name,
    }));
  }

  // GET /platform-admin/paystack-setup-requests/:id/reveal — the ONLY path
  // that returns a school's account number.
  //
  // Deliberately NOT a SECURITY DEFINER function. The list above has already
  // resolved a school_id, so a tenant exists: set the GUC and let the
  // ordinary RLS policy govern the read. That keeps banking data out of every
  // SD return shape in the inventory and makes each access individually
  // attributable. Mirrors BvnService.revealBvn's contract exactly — audit
  // every call, record who and for whom, never the value.
  //
  // The school_id comes from the SD-listed row rather than from the caller,
  // so a platform admin cannot use a guessed request id to set an arbitrary
  // GUC: an unknown id resolves to no row and 404s before any GUC is set.
  async revealPaystackSetupRequest(
    requestId: string,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminPaystackSetupRevealDto> {
    const owner = await resolvePaystackSetupRequestSchool(requestId);

    const row = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${owner.schoolId}, true)`;
      return tx.paystackSetupRequest.findUnique({ where: { id: requestId } });
    });

    if (!row) {
      throw new NotFoundError("Paystack setup request not found.");
    }

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: PAYSTACK_SETUP_REVEAL_AUDIT_ACTION,
        entityType: "paystack_setup_request",
        entityId: requestId,
        ipAddress: reqCtx.ipAddress,
        // Never the account number. Last 4 is enough to correlate a reveal
        // with the row it touched without the log becoming a second copy of
        // the data the reveal exists to protect.
        metadata: {
          schoolId: owner.schoolId,
          accountNumberLast4: row.accountNumber.slice(-4),
        },
      },
    });

    return {
      requestId: row.id,
      bankName: row.bankName,
      accountNumber: row.accountNumber,
      accountName: row.accountName,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
    };
  }

  // PATCH /platform-admin/paystack-setup-requests/:id — resolve a request as
  // FULFILLED (with the ACCT_ code that was issued) or REJECTED (with a
  // reason the school will see).
  //
  // This deliberately does NOT write School.paystackSubaccountCode. The
  // school pastes the code into Settings -> Payments itself, which runs the
  // save-time GET /subaccount/:code verification and shows the business name
  // back for confirmation — the check that catches a valid code belonging to
  // the wrong school. Writing it here would skip that entirely and make the
  // operator's typo the school's silent problem.
  async resolvePaystackSetupRequest(
    requestId: string,
    input: PlatformAdminResolvePaystackSetupInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminResolvePaystackSetupResponse> {
    const owner = await resolvePaystackSetupRequestSchool(requestId);

    if (owner.status !== "PENDING") {
      throw new ConflictError(
        "PAYSTACK_SETUP_ALREADY_RESOLVED",
        `This request is already ${owner.status.toLowerCase()}.`,
      );
    }

    let splitCode: string | null = null;
    if (input.status === "FULFILLED") {
      const subaccount = await this.paystack.getSubaccount(input.subaccountCode);
      if (!subaccount.active) {
        throw new ConflictError(
          "PAYSTACK_SUBACCOUNT_INACTIVE",
          "The supplied Paystack subaccount is inactive.",
        );
      }
      const split = await this.paystack.ensureSchoolPercentageSplit({
        schoolId: owner.schoolId,
        subaccountCode: input.subaccountCode,
      });
      splitCode = split.split_code;
    }

    const updated = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${owner.schoolId}, true)`;
      const request = await tx.paystackSetupRequest.update({
        where: { id: requestId },
        data: {
          status: input.status,
          subaccountCode: input.status === "FULFILLED" ? input.subaccountCode : null,
          notes: input.notes ?? null,
          fulfilledBy: adminCtx.userId,
          fulfilledAt: new Date(),
        },
      });
      if (input.status === "FULFILLED") {
        await tx.school.update({
          where: { id: owner.schoolId },
          data: {
            paystackSubaccountCode: input.subaccountCode,
            paystackSplitCode: splitCode,
            paystackPaymentsEnabled: true,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action:
            input.status === "FULFILLED"
              ? PAYSTACK_SETUP_FULFILLED_AUDIT_ACTION
              : PAYSTACK_SETUP_REJECTED_AUDIT_ACTION,
          entityType: "paystack_setup_request",
          entityId: requestId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            schoolId: owner.schoolId,
            subaccountCode: request.subaccountCode,
            splitCode,
          },
        },
      });
      return request;
    });

    return { requestId: updated.id, status: updated.status };
  }

  // PATCH /platform-admin/schools/:schoolId/early-access — sets or clears the
  // early-access marker. The surface's second write, and a much smaller one
  // than createSchool: a single-column UPDATE plus an audit row.
  //
  // No SECURITY DEFINER function needed, and no GUC dance either: `schools`
  // is the one table with no RLS policy at all (it IS the tenant table —
  // every other table's policy keys off it), which is why
  // generateUniqueSlug() above can already do plain basePrisma reads against
  // it. So an ordinary basePrisma.school.update is both sufficient and
  // consistent with what this module already does.
  //
  // Deliberately idempotent-ish rather than strictly idempotent: setting
  // `true` on an already-early-access school RE-STAMPS the timestamp to now.
  // That's a real (if minor) behaviour choice — the alternative (preserve the
  // original stamp) hides operator mistakes, and the audit log records every
  // transition either way. Flagged here rather than left implicit.
  async setEarlyAccess(
    schoolId: string,
    input: PlatformAdminSetEarlyAccessInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSetEarlyAccessResponse> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, earlyAccessGrantedAt: true },
    });
    if (!existing) {
      throw new NotFoundError("School not found.");
    }

    const nextValue = input.earlyAccess ? new Date() : null;

    const updated = await basePrisma.school.update({
      where: { id: schoolId },
      data: { earlyAccessGrantedAt: nextValue },
      select: { id: true, earlyAccessGrantedAt: true },
    });

    await basePrisma.auditLog.create({
      data: {
        // schoolId: null for the same reason as every other action on this
        // surface — audit_logs' RLS policy only lets null-schoolId rows
        // through a GUC-less read, and platform-admin reads are always
        // GUC-less. The school is identified by entityId.
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_SET_EARLY_ACCESS_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          from: existing.earlyAccessGrantedAt
            ? existing.earlyAccessGrantedAt.toISOString()
            : null,
          to: updated.earlyAccessGrantedAt
            ? updated.earlyAccessGrantedAt.toISOString()
            : null,
        },
      },
    });

    return {
      schoolId: updated.id,
      earlyAccessGrantedAt: updated.earlyAccessGrantedAt
        ? updated.earlyAccessGrantedAt.toISOString()
        : null,
    };
  }

  // PATCH /platform-admin/schools/:schoolId/ai — turns the per-school AI kill
  // switch on or off. Structurally identical to setEarlyAccess above (single
  // -column UPDATE on the RLS-free `schools` table + one audit row, no
  // SECURITY DEFINER function and no GUC needed), but the two differ in one
  // way worth stating plainly: early access is an inert marker, and this is
  // not. School.aiEnabled is read on the hot path by
  // AiGenerationService.reserve() and by ParentSummariesService, so setting
  // it false stops every AI feature for that school within one request and
  // no deploy — which is the entire point of it being a kill switch.
  //
  // Setting it TRUE does not by itself start anything: the platform-wide
  // AI_ENABLED env var is a separate gate, and this endpoint deliberately
  // does not read, report, or touch it. Conflating the two here would make a
  // per-school action silently depend on process state the caller can't see.
  //
  // Genuinely idempotent, unlike setEarlyAccess (which re-stamps a timestamp
  // on a repeat `true`): a boolean set to the value it already holds is a
  // no-op. The audit row is still written on a no-change call — "an operator
  // asserted this state at this time" is worth recording even when the value
  // didn't move, and metadata carries both from and to so a reader can tell
  // a real transition from a re-assertion.
  async setAiEnabled(
    schoolId: string,
    input: PlatformAdminSetAiEnabledInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSetAiEnabledResponse> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, aiEnabled: true },
    });
    if (!existing) {
      throw new NotFoundError("School not found.");
    }

    const updated = await basePrisma.school.update({
      where: { id: schoolId },
      data: { aiEnabled: input.aiEnabled },
      select: { id: true, aiEnabled: true },
    });

    await basePrisma.auditLog.create({
      data: {
        // schoolId: null for the same reason as every other action on this
        // surface — audit_logs' RLS policy only lets null-schoolId rows
        // through a GUC-less read, and platform-admin reads are always
        // GUC-less. The school is identified by entityId.
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_SET_AI_ENABLED_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          field: "aiEnabled",
          from: existing.aiEnabled,
          to: updated.aiEnabled,
        },
      },
    });

    return {
      schoolId: updated.id,
      aiEnabled: updated.aiEnabled,
    };
  }

  async setStaffMobileEnabled(
    schoolId: string,
    input: { staffMobileEnabled: boolean },
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<{ schoolId: string; staffMobileEnabled: boolean }> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId }, select: { id: true, staffMobileEnabled: true },
    });
    if (!existing) throw new NotFoundError("School not found.");
    const updated = await basePrisma.school.update({
      where: { id: schoolId }, data: { staffMobileEnabled: input.staffMobileEnabled },
      select: { id: true, staffMobileEnabled: true },
    });
    await basePrisma.auditLog.create({ data: {
      schoolId: null, userId: adminCtx.userId,
      action: SCHOOLS_SET_STAFF_MOBILE_AUDIT_ACTION,
      entityType: "school", entityId: schoolId, ipAddress: reqCtx.ipAddress,
      metadata: { field: "staffMobileEnabled", from: existing.staffMobileEnabled, to: updated.staffMobileEnabled },
    }});
    return { schoolId: updated.id, staffMobileEnabled: updated.staffMobileEnabled };
  }

  // POST /platform-admin/schools — the surface's first write. Creates the
  // School row and an `owner`-role Invitation, then emails the invitee a
  // real accept link via Resend. Reuses the existing Invitation/accept/
  // session machinery completely unchanged: POST /invitations/:token/accept
  // already handles an arbitrary roleKey generically (it looks up the
  // system Role by key), so no invitations-module changes were needed.
  //
  // Two gates before any write, mirroring signupOwner's "cheap rejection
  // stays cheap" ordering:
  //   1. platform_admin_check_owner_email_available — pre-tenant read via
  //      SECURITY DEFINER (see migration 20260807000000 for why this can't
  //      be an ordinary basePrisma query against FORCE-RLS tables).
  //   2. slug derivation + collision retry against the (RLS-free) School
  //      table.
  //
  // Atomicity: School + Invitation + audit row commit or roll back together,
  // same basePrisma.$transaction + raw GUC pattern as AuthService.
  // signupOwner (no nested tenant-scoped transaction — Prisma doesn't
  // support nested transactions). Email delivery happens AFTER commit and
  // is best-effort:
  // a send failure is logged, never thrown, and never removes acceptUrl
  // from the response — same posture as GuardiansService.deliverInvitation.
  async createSchool(
    input: PlatformAdminCreateSchoolInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminCreateSchoolResponse> {
    await assertOwnerEmailAvailable(basePrisma, input.ownerEmail);

    const slug = await generateUniqueSchoolSlug(input.schoolName);

    const { rawToken, tokenHash, expiresAt } = newOwnerInvitationToken();

    const created = await basePrisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.schoolName,
          slug,
          // status, onboardingStep default per schema (ONBOARDING, 0).
          // ndprConsent stays false here — it's stamped by onboarding step
          // 4 once the owner reaches it, same as a self-serve signup.
          // aiEnabled explicit for the same reason as signupOwner's copy —
          // see that call site's comment. Deliberately NOT pushed down into
          // applySchoolDefaults(): that function seeds academic structure into
          // an ALREADY-CREATED school and has a third caller,
          // backfill-school-defaults.ts, which repairs live schools. Putting
          // an aiEnabled write there would make a structure-repair script
          // silently switch off AI on schools it was only asked to fix.
          aiEnabled: false,
        },
        select: { id: true, name: true, slug: true },
      });

      // From here on, every tenant-scoped INSERT must satisfy the policy's
      // WITH CHECK — set the GUC inside the same tx so RLS sees the new
      // school's id as the current tenant (mirrors signupOwner exactly).
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;

      // Seed the same class levels, default arms, subject catalogue and
      // grading scheme/components/boundaries a self-serve signup gets.
      //
      // MISSING FROM 2026-08-07 (this method's first ship) TO 2026-08-14.
      // createSchool reused signupOwner's transaction *pattern* but not its
      // seeding, because the seeding wasn't a callable unit — it was inline
      // in signupOwner. Four schools provisioned on 2026-08-08 landed with no
      // academic structure at all, and their owners could log in and do
      // nothing; one re-registered through self-serve signup instead, leaving
      // two school rows for one real school. Now shared: packages/db's
      // applySchoolDefaults() is the single definition both paths call, so
      // they cannot drift apart again. Requires the GUC set above and the
      // raised transaction timeout below — see that function's header.
      await applySchoolDefaults(tx, school.id);

      const invitation = await tx.invitation.create({
        data: {
          schoolId: school.id,
          email: input.ownerEmail,
          roleKey: "owner",
          tokenHash,
          // Bare FK, no relation (see Invitation.invitedBy's own comment) —
          // deliberately tolerates invitedBy referencing a User who belongs
          // to a DIFFERENT school (the platform admin's own). The accept
          // page's inviter-name lookup is already null-safe for exactly
          // this case (invitations.service.ts's getByToken falls back to
          // "An administrator" when the tenant-scoped lookup finds nothing).
          invitedBy: adminCtx.userId,
          expiresAt,
        },
        select: { id: true },
      });

      // schoolId: null, not school.id — matches the other three platform-
      // admin audit actions, deliberately: audit_logs' RLS policy lets
      // schoolId IS NULL rows pass through unconditionally, which is what
      // makes them readable by a later GUC-less basePrisma query (the same
      // way this action's own row needs to be readable). A non-null
      // schoolId here would only be visible to a query running with that
      // exact school's GUC set — which platform-admin reads, by design,
      // never do. The school is still identified via entityId below.
      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action: SCHOOLS_CREATE_AUDIT_ACTION,
          entityType: "school",
          entityId: school.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            ownerEmail: redactEmail(input.ownerEmail),
            schoolSlug: school.slug,
            invitationId: invitation.id,
          },
        },
      });

      return { school };
    }, { timeout: CREATE_SCHOOL_TRANSACTION_TIMEOUT_MS });

    const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;

    // Unconditional send — unlike GuardiansService, there's no
    // NotificationPreference row to gate on yet (the school was just
    // created in this call). Best-effort: never blocks or rolls back the
    // already-committed invitation.
    await this.sendOwnerInvitation(input.ownerEmail, created.school.name, acceptUrl);

    return {
      schoolId: created.school.id,
      schoolName: created.school.name,
      schoolSlug: created.school.slug,
      ownerEmail: input.ownerEmail,
      invitationExpiresAt: expiresAt.toISOString(),
      acceptUrl,
    };
  }

  // PATCH /platform-admin/schools/:schoolId/ai-budget — the per-school
  // monthly AI cap, in tokens; null falls back to DEFAULT_MONTHLY_TOKEN_BUDGET.
  // Same shape as setAiEnabled: `schools` has no RLS policy, so this is one
  // column update plus an audit row, no SECURITY DEFINER function.
  // AiGenerationService.reserve() reads the column on every call, so a new
  // cap applies from the next AI request.
  async setAiBudget(
    schoolId: string,
    input: PlatformAdminSetAiBudgetInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSetAiBudgetResponse> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, aiMonthlyTokenBudget: true },
    });
    if (!existing) throw new NotFoundError("School not found.");

    const updated = await basePrisma.school.update({
      where: { id: schoolId },
      data: { aiMonthlyTokenBudget: input.aiMonthlyTokenBudget },
      select: { id: true, aiMonthlyTokenBudget: true },
    });

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_SET_AI_BUDGET_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          field: "aiMonthlyTokenBudget",
          from: existing.aiMonthlyTokenBudget,
          to: updated.aiMonthlyTokenBudget,
        },
      },
    });

    return {
      schoolId: updated.id,
      aiMonthlyTokenBudget: updated.aiMonthlyTokenBudget,
      aiEffectiveMonthlyTokenBudget: updated.aiMonthlyTokenBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET,
    };
  }

  // POST /platform-admin/schools/:schoolId/owner-invitation/resend — ends
  // every open owner invitation for the school and sends a fresh one, to the
  // last address or a corrected one. Refused once the school has an owner:
  // from then on, inviting people is the owner's job, through the school's
  // own staff screens.
  //
  // One transaction under the school's GUC (invitations and users are FORCE
  // RLS — the same pattern createSchool uses). The availability check runs
  // INSIDE it, after the old invitations are ended, so resending to the same
  // address is not refused as "already has a pending invitation".
  async resendOwnerInvitation(
    schoolId: string,
    input: PlatformAdminResendOwnerInvitationInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminResendOwnerInvitationResponse> {
    const school = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    });
    if (!school) throw new NotFoundError("School not found.");

    const { rawToken, tokenHash, expiresAt } = newOwnerInvitationToken();

    const ownerEmail = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;

      const owners = await tx.user.count({
        where: { schoolId, roles: { some: { role: { key: "owner" } } } },
      });
      if (owners > 0) {
        throw new ConflictError(
          "SCHOOL_HAS_OWNER",
          "This school already has an owner. They can invite staff from the school's own settings.",
        );
      }

      const last = await tx.invitation.findFirst({
        where: { schoolId, roleKey: "owner" },
        orderBy: { createdAt: "desc" },
        select: { email: true },
      });
      const email = input.ownerEmail ?? last?.email ?? null;
      if (!email) {
        throw new ValidationError(
          "OWNER_EMAIL_REQUIRED",
          "This school has no earlier owner invitation to resend. Enter the owner's email address.",
        );
      }

      const ended = await endOpenOwnerInvitations(tx, schoolId);
      await assertOwnerEmailAvailable(tx, email);

      const invitation = await tx.invitation.create({
        data: { schoolId, email, roleKey: "owner", tokenHash, invitedBy: adminCtx.userId, expiresAt },
        select: { id: true },
      });

      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action: OWNER_INVITATION_RESEND_AUDIT_ACTION,
          entityType: "school",
          entityId: schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            ownerEmail: redactEmail(email),
            emailChanged: Boolean(last?.email && last.email !== email),
            invitationId: invitation.id,
            endedCount: ended,
          },
        },
      });

      return email;
    });

    const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;
    await this.sendOwnerInvitation(ownerEmail, school.name, acceptUrl);

    return {
      schoolId,
      ownerEmail,
      invitationExpiresAt: expiresAt.toISOString(),
      acceptUrl,
    };
  }

  // POST /platform-admin/schools/:schoolId/owner-invitation/cancel — ends
  // every open owner invitation without sending another (e.g. it went to the
  // wrong person). The rows stay; a link already sent now reads as expired.
  async cancelOwnerInvitation(
    schoolId: string,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminCancelOwnerInvitationResponse> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundError("School not found.");

    const cancelledCount = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      const ended = await endOpenOwnerInvitations(tx, schoolId);
      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action: OWNER_INVITATION_CANCEL_AUDIT_ACTION,
          entityType: "school",
          entityId: schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { endedCount: ended },
        },
      });
      return ended;
    });

    return { schoolId, cancelledCount };
  }

  // ─── School lifecycle (slice 2, 2026-10-07) ───────────────────────────────
  //
  // Suspend / reactivate write schools.suspended_at — `schools` has no RLS, so
  // a column update plus an audit row, like the AI switch. Enforcement lives
  // in the session helpers and the three session guards
  // (common/auth/school-suspension.ts). A school holding a platform admin is
  // refused, so the operator can never suspend the school they work from.

  async suspendSchool(
    schoolId: string,
    input: PlatformAdminSuspendSchoolInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSchoolSuspensionResponse> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true, suspendedAt: true } });
    if (!school) throw new NotFoundError("School not found.");

    const suspendedAt = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      if (await holdsPlatformAdmin(tx, schoolId)) {
        throw new ConflictError(
          "SCHOOL_HAS_PLATFORM_ADMIN",
          "This school holds a platform admin account, so it can't be suspended from here.",
        );
      }
      // Re-suspending keeps the original date: it answers "since when".
      const at = school.suspendedAt ?? new Date();
      await tx.school.update({ where: { id: schoolId }, data: { suspendedAt: at } });
      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action: SCHOOLS_SUSPEND_AUDIT_ACTION,
          entityType: "school",
          entityId: schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { reason: input.reason, alreadySuspended: Boolean(school.suspendedAt) },
        },
      });
      return at;
    });

    return { schoolId, suspendedAt: suspendedAt.toISOString() };
  }

  async reactivateSchool(
    schoolId: string,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSchoolSuspensionResponse> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true, suspendedAt: true } });
    if (!school) throw new NotFoundError("School not found.");

    await basePrisma.school.update({ where: { id: schoolId }, data: { suspendedAt: null } });
    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_REACTIVATE_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: { suspendedSince: school.suspendedAt ? school.suspendedAt.toISOString() : null },
      },
    });
    return { schoolId, suspendedAt: null };
  }

  // GET /platform-admin/schools/:schoolId/deletion-check — counts only, so the
  // dialog can say what a delete would remove before anyone types the slug.
  // Audited like every other read on this surface.
  async deletionCheck(
    schoolId: string,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSchoolDeletionCheckDto> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true, slug: true } });
    if (!school) throw new NotFoundError("School not found.");
    const facts = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      return readDeletionFacts(tx, schoolId);
    });
    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_DELETION_CHECK_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: { deletable: facts.blockers.length === 0, blockers: facts.blockers },
      },
    });
    return { schoolId, slug: school.slug, deletable: facts.blockers.length === 0, ...facts };
  }

  // POST /platform-admin/schools/:schoolId/delete — permanent. The checks run
  // again INSIDE the deleting transaction, so a payment recorded between the
  // dialog's check and the click still stops it.
  async deleteSchool(
    schoolId: string,
    input: PlatformAdminDeleteSchoolInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminDeleteSchoolResponse> {
    const school = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, slug: true, name: true },
    });
    if (!school) throw new NotFoundError("School not found.");
    if (input.confirmSlug !== school.slug) {
      throw new ValidationError("CONFIRM_SLUG_MISMATCH", `Type the school's slug, ${school.slug}, to confirm.`);
    }

    const deletedRowCount = await basePrisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
        const facts = await readDeletionFacts(tx, schoolId);
        if (facts.blockers.includes("HAS_PAYMENTS")) {
          throw new ConflictError(
            "SCHOOL_HAS_PAYMENTS",
            `This school has recorded ${facts.paymentCount} payment${facts.paymentCount === 1 ? "" : "s"}, so it can't be deleted. Suspend it instead.`,
          );
        }
        if (facts.blockers.includes("HAS_PLATFORM_ADMIN")) {
          throw new ConflictError(
            "SCHOOL_HAS_PLATFORM_ADMIN",
            "This school holds a platform admin account, so it can't be deleted from here.",
          );
        }
        const n = await deleteSchoolRows(tx, schoolId);
        // schoolId null and the school named in metadata: the school row is
        // gone, and this row must outlive it.
        await tx.auditLog.create({
          data: {
            schoolId: null,
            userId: adminCtx.userId,
            action: SCHOOLS_DELETE_AUDIT_ACTION,
            entityType: "school",
            entityId: schoolId,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              slug: school.slug,
              name: school.name,
              deletedRowCount: n,
              studentCount: facts.studentCount,
              staffCount: facts.staffCount,
              guardianCount: facts.guardianCount,
            },
          },
        });
        return n;
      },
      { timeout: DELETE_SCHOOL_TRANSACTION_TIMEOUT_MS },
    );

    this.logger.log(`Deleted school ${school.slug} (${deletedRowCount} rows) by platform admin ${adminCtx.userId}`);
    return { schoolId, slug: school.slug, deletedRowCount };
  }

  // ─── Audit log (slice 3, 2026-10-07) ──────────────────────────────────────
  //
  // GET /platform-admin/audit-log — the platform's OWN audit rows, newest
  // first: every row this surface writes has school_id = NULL, which is also
  // exactly what audit_logs' RLS policy lets a GUC-less read see. So this is a
  // plain read with no GUC and no SECURITY DEFINER function, and it cannot
  // reach a school's own rows by construction — the policy hides them.
  //
  // `ip_address` is never returned. Actor names come from
  // platform_admin_list_users(NULL), the same roster the dashboard already
  // shows; school names from `schools` (no RLS), falling back to the name a
  // delete entry recorded for a school that no longer exists.
  async listAuditLog(
    query: PlatformAdminAuditLogQuery,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminAuditLogResponse> {
    const limit = query.limit ?? PLATFORM_AUDIT_PAGE_SIZE;
    const includeViews = query.includeViews === "true";
    const cursor = parseAuditCursor(query.before);

    const rows = await basePrisma.auditLog.findMany({
      where: {
        schoolId: null,
        ...(includeViews ? {} : { action: { notIn: [...PLATFORM_AUDIT_VIEW_ACTIONS] } }),
        ...(query.schoolId ? { entityType: "school", entityId: query.schoolId } : {}),
        ...(cursor
          ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: { id: true, createdAt: true, action: true, userId: true, entityType: true, entityId: true, metadata: true },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];

    const actorIds = new Set(page.map((r) => r.userId).filter((id): id is string => Boolean(id)));
    const actors = new Map<string, string>();
    if (actorIds.size > 0) {
      const users = await basePrisma.$queryRaw<ListUsersRow[]>`SELECT * FROM platform_admin_list_users(${null})`;
      for (const u of users) if (actorIds.has(u.user_id)) actors.set(u.user_id, `${u.first_name} ${u.last_name}`);
    }

    const schoolIds = [...new Set(page.filter((r) => r.entityType === "school" && r.entityId).map((r) => r.entityId!))];
    const schools = new Map(
      (await basePrisma.school.findMany({ where: { id: { in: schoolIds } }, select: { id: true, name: true } })).map((s) => [
        s.id,
        s.name,
      ]),
    );
    // A deleted school's earlier entries (suspend, budget…) carry no name of
    // their own; its delete entry recorded one. Look those up once.
    const gone = schoolIds.filter((id) => !schools.has(id));
    if (gone.length > 0) {
      const deletes = await basePrisma.auditLog.findMany({
        where: { schoolId: null, action: SCHOOLS_DELETE_AUDIT_ACTION, entityId: { in: gone } },
        select: { entityId: true, metadata: true },
      });
      for (const d of deletes) {
        const name = (d.metadata as { name?: unknown } | null)?.name;
        if (d.entityId && typeof name === "string") schools.set(d.entityId, name);
      }
    }

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: AUDIT_LOG_READ_AUDIT_ACTION,
        entityType: query.schoolId ? "school" : null,
        entityId: query.schoolId ?? null,
        ipAddress: reqCtx.ipAddress,
        metadata: { resultCount: page.length, includeViews },
      },
    });

    const entries: PlatformAdminAuditEntryDto[] = page.map((r) => {
      const metadata = (r.metadata && typeof r.metadata === "object" && !Array.isArray(r.metadata) ? r.metadata : null) as
        | Record<string, unknown>
        | null;
      const schoolId = r.entityType === "school" ? r.entityId : null;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        actorUserId: r.userId,
        actorName: r.userId ? (actors.get(r.userId) ?? null) : null,
        schoolId,
        schoolName: schoolId ? (schools.get(schoolId) ?? null) : null,
        metadata,
      };
    });

    return {
      entries,
      nextBefore: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    };
  }

  // Best-effort: a failed send is logged, never thrown, and never undoes the
  // committed invitation — the response carries acceptUrl for exactly this.
  private async sendOwnerInvitation(to: string, schoolName: string, acceptUrl: string): Promise<void> {
    try {
      await this.email.send({
        to,
        subject: `You've been invited to set up ${schoolName} on School Kit`,
        html: `<p>Hi,</p><p>You've been invited to create and manage <strong>${schoolName}</strong> on School Kit. Use the link below to set your password and get started — it expires in 14 days.</p><p><a href="${acceptUrl}">${acceptUrl}</a></p>`,
      });
    } catch (err) {
      this.logger.warn(`Owner invite email failed for ${redactEmail(to)}: ${String(err)}`);
    }
  }

  async listUsers(
    schoolId: string | undefined,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminUserDto[]> {
    const rows = await basePrisma.$queryRaw<ListUsersRow[]>`
      SELECT * FROM platform_admin_list_users(${schoolId ?? null})
    `;

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: USERS_LIST_AUDIT_ACTION,
        entityType: "user",
        ipAddress: reqCtx.ipAddress,
        metadata: { schoolIdFilter: schoolId ?? null, resultCount: rows.length },
      },
    });

    return rows.map((r) => ({
      userId: r.user_id,
      schoolId: r.school_id,
      firstName: r.first_name,
      lastName: r.last_name,
      roleNames: r.role_names,
      createdAt: r.created_at.toISOString(),
      lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
      isActive: r.is_active,
    }));
  }
}
