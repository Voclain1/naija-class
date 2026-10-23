import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  normaliseSchoolAddress,
  schoolAddressProblem,
  schoolHost,
  type SchoolAddressCheckDto,
  type SchoolAddressDto,
  type SchoolAddressPreviewDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check";
import { addressAllowance, changeSchoolAddress } from "../../common/slug/school-address-change.js";
import { resolveSchoolCode } from "../../common/slug/school-code.js";
import { generateUniqueSchoolSlug } from "../../common/slug/school-slug.js";

// The school's web address, "<code>.schoolkit.ng" (docs/modules/school-addresses.md).
// Owner and admins see it; only the owner changes it, within the limits in
// common/slug/school-address-change.ts. Every change is audited.

export const SCHOOL_ADDRESS_CHANGE_AUDIT = "school.address.change";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class SchoolAddressService {
  async get(authCtx: AuthContext): Promise<SchoolAddressDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const isOwner = (await getActiveUserRoleKeys(authCtx)).includes("owner");
    const { school, previous } = await withTenant(authCtx.schoolId, async (db) => ({
      school: await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { slug: true, status: true, createdAt: true },
      }),
      previous: await db.schoolPreviousAddress.findMany({
        where: { schoolId: authCtx.schoolId },
        orderBy: { retiredAt: "desc" },
        select: { slug: true, retiredAt: true, countsTowardLimit: true },
      }),
    }));
    const allowance = addressAllowance({
      status: school.status,
      createdAt: school.createdAt,
      counted: previous.filter((p) => p.countsTowardLimit).map((p) => p.retiredAt),
      now: new Date(),
    });
    return {
      code: school.slug,
      host: schoolHost(school.slug),
      previousCodes: previous.map((p) => p.slug),
      canChange: isOwner && allowance.blockedReason === null,
      freeUntil: allowance.free ? (allowance.freeUntil?.toISOString() ?? null) : null,
      changesLeft: allowance.changesLeft,
      nextChangeAt: allowance.nextChangeAt?.toISOString() ?? null,
      blockedReason: !isOwner ? "Only the school's owner can change its address." : allowance.blockedReason,
    };
  }

  /** As the owner types: is this address free for this school? */
  async check(authCtx: AuthContext, raw: string): Promise<SchoolAddressCheckDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const code = normaliseSchoolAddress(raw);
    const problem = schoolAddressProblem(code);
    if (problem) return { code, host: schoolHost(code), status: problem };
    const found = await resolveSchoolCode(code);
    if (!found) return { code, host: schoolHost(code), status: "AVAILABLE" };
    if (found.schoolId !== authCtx.schoolId) return { code, host: schoolHost(code), status: "TAKEN" };
    // This school's own code: current, or an earlier one it may take back.
    return { code, host: schoolHost(code), status: found.previous ? "AVAILABLE" : "CURRENT" };
  }

  async change(authCtx: AuthContext, rawCode: string, reqCtx: RequestContext): Promise<SchoolAddressDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner"]);
    const code = normaliseSchoolAddress(rawCode);
    const result = await changeSchoolAddress(authCtx.schoolId, code, { kind: "OWNER", userId: authCtx.userId });
    await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: SCHOOL_ADDRESS_CHANGE_AUDIT,
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { from: result.from, to: result.to, counted: result.counted },
        },
      }),
    );
    return this.get(authCtx);
  }

  /** PUBLIC (sign-up): the address a school of this name would get now. */
  async preview(name: string): Promise<SchoolAddressPreviewDto> {
    const code = await generateUniqueSchoolSlug(name.trim() || "school");
    return { code, host: schoolHost(code) };
  }
}
