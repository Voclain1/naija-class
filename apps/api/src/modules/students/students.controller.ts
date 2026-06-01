import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  createStudentSchema,
  graduateStudentSchema,
  listStudentsQuerySchema,
  reactivateStudentSchema,
  updateStudentSchema,
  withdrawStudentSchema,
  type CreateStudentInput,
  type GraduateStudentInput,
  type ListStudentsQuery,
  type ReactivateStudentInput,
  type StudentDetailDto,
  type StudentDto,
  type StudentListResponse,
  type UpdateStudentInput,
  type WithdrawStudentInput,
} from "@school-kit/types";
import type { Request } from "express";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthGuard } from "../../common/auth/auth.guard";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import { Permissions } from "../../common/auth/permissions.decorator";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { StudentsService } from "./students.service";

// Authz: AuthGuard + PermissionsGuard (slice 13). The service-layer
// assertUserActiveAndHasOneOf("owner"/"admin") calls stay as defense-in-depth.
//
// student.delete is intentionally NOT exposed — owner-only hard-delete is
// deferred. Withdrawal / graduation are the modelled lifecycle exits, gated by
// student.deactivate.
@Controller("students")
@UseGuards(AuthGuard, PermissionsGuard)
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  @Get()
  @Permissions("student.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listStudentsQuerySchema))
    query: ListStudentsQuery,
  ): Promise<StudentListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  @Permissions("student.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<StudentDetailDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("student.create")
  async create(
    @Body(new ZodValidationPipe(createStudentSchema)) dto: CreateStudentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentDto> {
    return this.service.create(authCtx, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Patch(":id")
  @Permissions("student.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStudentSchema)) dto: UpdateStudentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentDto> {
    return this.service.update(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post(":id/withdraw")
  @HttpCode(200)
  @Permissions("student.deactivate")
  async withdraw(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(withdrawStudentSchema)) dto: WithdrawStudentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentDto> {
    return this.service.withdraw(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post(":id/graduate")
  @HttpCode(200)
  @Permissions("student.deactivate")
  async graduate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(graduateStudentSchema)) dto: GraduateStudentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentDto> {
    return this.service.graduate(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }

  @Post(":id/reactivate")
  @HttpCode(200)
  @Permissions("student.deactivate")
  async reactivate(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reactivateStudentSchema))
    dto: ReactivateStudentInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<StudentDto> {
    return this.service.reactivate(authCtx, id, dto, {
      ipAddress: ip,
      userAgent: req.header("user-agent") ?? null,
    });
  }
}
