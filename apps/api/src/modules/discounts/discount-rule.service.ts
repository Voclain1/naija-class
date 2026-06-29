import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type CreateDiscountRuleInput,
  type DiscountRuleDto,
  type UpdateDiscountRuleInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "discount-rule.create",
  update: "discount-rule.update",
  deactivate: "discount-rule.deactivate",
} as const;

const DISCOUNT_RULE_SELECT = {
  id: true,
  schoolId: true,
  studentId: true,
  name: true,
  feeItemId: true,
  feeCategoryId: true,
  duration: true,
  termId: true,
  academicYearId: true,
  discountType: true,
  value: true,
  active: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class DiscountRuleService {
  async findAll(
    authCtx: AuthContext,
    options: {
      studentId?: string;
      feeItemId?: string;
      feeCategoryId?: string;
      includeInactive?: boolean;
    } = {},
  ): Promise<DiscountRuleDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      return db.discountRule.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(options.studentId ? { studentId: options.studentId } : {}),
          ...(options.feeItemId ? { feeItemId: options.feeItemId } : {}),
          ...(options.feeCategoryId ? { feeCategoryId: options.feeCategoryId } : {}),
          ...(options.includeInactive ? {} : { active: true }),
        },
        select: DISCOUNT_RULE_SELECT,
        orderBy: { createdAt: "desc" },
      });
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<DiscountRuleDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.discountRule.findUnique({
        where: { id },
        select: DISCOUNT_RULE_SELECT,
      });
      if (!row) throw new NotFoundError("Discount rule not found.");
      return row;
    });
  }

  async create(
    authCtx: AuthContext,
    dto: CreateDiscountRuleInput,
    reqCtx: RequestContext,
  ): Promise<DiscountRuleDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      // Defence-in-depth: re-check the XOR invariant beyond Zod.
      if ((!!dto.feeItemId) === (!!dto.feeCategoryId)) {
        throw new ValidationError(
          "SCOPE_INVARIANT",
          "Exactly one of feeItemId or feeCategoryId must be set.",
        );
      }

      await validateEntities(db, authCtx.schoolId, dto);

      const created = await db.discountRule.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId: dto.studentId,
          name: dto.name,
          feeItemId: dto.feeItemId ?? null,
          feeCategoryId: dto.feeCategoryId ?? null,
          duration: dto.duration,
          termId: dto.termId ?? null,
          academicYearId: dto.academicYearId ?? null,
          discountType: dto.discountType,
          // FULL_WAIVER has no value; service enforces null regardless of DTO content.
          value: dto.discountType === "FULL_WAIVER" ? null : (dto.value ?? null),
          createdBy: authCtx.userId,
        },
        select: DISCOUNT_RULE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "discount_rule",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: dto.studentId,
            discountType: dto.discountType,
            duration: dto.duration,
            name: dto.name,
          },
        },
      });

      return created;
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdateDiscountRuleInput,
    reqCtx: RequestContext,
  ): Promise<DiscountRuleDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.discountRule.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Discount rule not found.");

      const updated = await db.discountRule.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.value !== undefined ? { value: dto.value } : {}),
        },
        select: DISCOUNT_RULE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "discount_rule",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: dto,
        },
      });

      return updated;
    });
  }

  async deactivate(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.discountRule.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Discount rule not found.");

      await db.discountRule.update({
        where: { id },
        data: { active: false },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.deactivate,
          entityType: "discount_rule",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });
    });
  }
}

async function validateEntities(
  db: PrismaClient,
  schoolId: string,
  dto: CreateDiscountRuleInput,
): Promise<void> {
  const student = await db.student.findUnique({
    where: { id: dto.studentId },
    select: { schoolId: true },
  });
  if (!student || student.schoolId !== schoolId) {
    throw new NotFoundError("Student not found in this school.");
  }

  if (dto.feeItemId) {
    const item = await db.feeItem.findUnique({
      where: { id: dto.feeItemId },
      select: { schoolId: true },
    });
    if (!item || item.schoolId !== schoolId) {
      throw new NotFoundError("Fee item not found in this school.");
    }
  }

  if (dto.feeCategoryId) {
    const cat = await db.feeCategory.findUnique({
      where: { id: dto.feeCategoryId },
      select: { schoolId: true },
    });
    if (!cat || cat.schoolId !== schoolId) {
      throw new NotFoundError("Fee category not found in this school.");
    }
  }

  if (dto.termId) {
    const term = await db.term.findUnique({
      where: { id: dto.termId },
      select: { schoolId: true },
    });
    if (!term || term.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "Term not found in this school.");
    }
  }

  if (dto.academicYearId) {
    const year = await db.academicYear.findUnique({
      where: { id: dto.academicYearId },
      select: { schoolId: true },
    });
    if (!year || year.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "Academic year not found in this school.");
    }
  }
}
