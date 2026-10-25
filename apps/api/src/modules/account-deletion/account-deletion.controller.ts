import { Controller, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import type { AccountDeletionRequestDto, MyAccountDeletionRequestDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { AccountDeletionService } from "./account-deletion.service.js";

// Account deletion requests (docs/modules/account-deletion-requests.md): one
// controller per principal, like every other family surface, and the school's
// list for its owner and admins.

@Controller("users/me/deletion-request")
@UseGuards(AuthGuard)
export class StaffAccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  mine(@CurrentUser() ctx: AuthContext): Promise<MyAccountDeletionRequestDto> {
    return this.service.mine({ schoolId: ctx.schoolId, principal: "STAFF", subjectId: ctx.userId });
  }

  @Post()
  @HttpCode(200)
  request(@CurrentUser() ctx: AuthContext, @Ip() ip: string): Promise<MyAccountDeletionRequestDto> {
    return this.service.request({ schoolId: ctx.schoolId, principal: "STAFF", subjectId: ctx.userId, userId: ctx.userId }, { ipAddress: ip ?? null });
  }
}

@Controller("portal/me/deletion-request")
@UseGuards(GuardianAuthGuard)
export class GuardianAccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  mine(@CurrentGuardian() ctx: GuardianAuthContext): Promise<MyAccountDeletionRequestDto> {
    return this.service.mine({ schoolId: ctx.schoolId, principal: "GUARDIAN", subjectId: ctx.guardianId });
  }

  @Post()
  @HttpCode(200)
  request(@CurrentGuardian() ctx: GuardianAuthContext, @Ip() ip: string): Promise<MyAccountDeletionRequestDto> {
    return this.service.request({ schoolId: ctx.schoolId, principal: "GUARDIAN", subjectId: ctx.guardianId }, { ipAddress: ip ?? null });
  }
}

@Controller("student-portal/me/deletion-request")
@UseGuards(StudentAuthGuard)
export class StudentAccountDeletionController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  mine(@CurrentStudent() ctx: StudentAuthContext): Promise<MyAccountDeletionRequestDto> {
    return this.service.mine({ schoolId: ctx.schoolId, principal: "STUDENT", subjectId: ctx.studentId });
  }

  @Post()
  @HttpCode(200)
  request(@CurrentStudent() ctx: StudentAuthContext, @Ip() ip: string): Promise<MyAccountDeletionRequestDto> {
    return this.service.request({ schoolId: ctx.schoolId, principal: "STUDENT", subjectId: ctx.studentId }, { ipAddress: ip ?? null });
  }
}

// The school's list. user.deactivate: the people who can remove an account.
@Controller("account-deletion-requests")
@UseGuards(AuthGuard, PermissionsGuard)
export class AccountDeletionRequestsController {
  constructor(private readonly service: AccountDeletionService) {}

  @Get()
  @Permissions("user.deactivate")
  list(@CurrentUser() ctx: AuthContext): Promise<AccountDeletionRequestDto[]> {
    return this.service.list(ctx);
  }

  @Post(":id/handled")
  @HttpCode(204)
  @Permissions("user.deactivate")
  async handled(@CurrentUser() ctx: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Ip() ip: string): Promise<void> {
    await this.service.markHandled(ctx, id, { ipAddress: ip ?? null });
  }
}
