import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  admissionCounterScope,
  admissionNumberPattern,
  fillAdmissionNumber,
  highestExistingValue,
  parseAdmissionFormat,
  type AdmissionNumberSettingsDto,
  type UpdateAdmissionNumberSettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { admissionYear } from "../students/admission-numbers";

// GET / PATCH /schools/me/admission-numbers (docs/modules/admission-numbers.md).
// The school's choice lives on `schools` (no RLS policy: the tenant table), read
// and written under the school's own GUC like every other /schools/me write.

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class AdmissionNumberSettingsService {
  async get(authCtx: AuthContext): Promise<AdmissionNumberSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, (db) => readSettings(db, authCtx.schoolId));
  }

  async update(
    authCtx: AuthContext,
    input: UpdateAdmissionNumberSettingsInput,
    reqCtx: RequestContext,
  ): Promise<AdmissionNumberSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const before = await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { admissionNumberMode: true, admissionNumberFormat: true, admissionNumberOrder: true },
      });
      // Typing numbers keeps the last format, so switching back is one click.
      const format = input.mode === "AUTO" ? input.format!.trim() : before.admissionNumberFormat;
      const order = input.order ?? before.admissionNumberOrder;
      await db.school.update({
        where: { id: authCtx.schoolId },
        data: {
          admissionNumberMode: input.mode,
          admissionNumberFormat: format,
          admissionNumberOrder: order,
          admissionNumberDecidedAt: new Date(),
        },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "school.admission-numbers.update",
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            before: { mode: before.admissionNumberMode, format: before.admissionNumberFormat, order: before.admissionNumberOrder },
            after: { mode: input.mode, format, order },
          },
        },
      });
      return readSettings(db, authCtx.schoolId);
    });
  }
}

async function readSettings(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  schoolId: string,
): Promise<AdmissionNumberSettingsDto> {
  const school = await db.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: {
      admissionNumberMode: true,
      admissionNumberFormat: true,
      admissionNumberOrder: true,
      admissionNumberDecidedAt: true,
    },
  });
  const studentCount = await db.student.count({ where: { schoolId } });
  return {
    mode: school.admissionNumberMode,
    format: school.admissionNumberFormat,
    order: school.admissionNumberOrder,
    decided: school.admissionNumberDecidedAt !== null,
    studentCount,
    nextNumber: await previewNext(db, schoolId, school),
  };
}

// What the next in-order number would be today. Read only: nothing is reserved.
async function previewNext(
  db: Parameters<Parameters<typeof withTenant>[1]>[0],
  schoolId: string,
  school: { admissionNumberMode: string; admissionNumberFormat: string | null; admissionNumberOrder: "SCHOOL" | "CLASS" | "RANDOM" },
): Promise<string | null> {
  if (school.admissionNumberMode !== "AUTO" || !school.admissionNumberFormat) return null;
  if (school.admissionNumberOrder !== "SCHOOL") return null;
  const parsed = parseAdmissionFormat(school.admissionNumberFormat, school.admissionNumberOrder);
  if (!parsed.ok) return null;
  const year = admissionYear();
  const scope = admissionCounterScope(parsed.format, { year });
  const counter = await db.admissionNumberCounter.findUnique({
    where: { schoolId_scope: { schoolId, scope } },
    select: { lastValue: true },
  });
  const last =
    counter?.lastValue ??
    highestExistingValue(
      (await db.student.findMany({ select: { admissionNumber: true } })).map((s) => s.admissionNumber),
      admissionNumberPattern(parsed.format, { year }),
    );
  return fillAdmissionNumber(parsed.format, { year, value: last + 1 });
}
