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
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { StudentsService } from "./students.service";

// PermissionsGuard is slice 13; until then AuthGuard + service-layer
// assertUserActiveAndHasOneOf("owner"/"admin") is the authz pattern (same
// as every prior Phase 1 slice).
//
// student.delete is intentionally NOT exposed — owner-only hard-delete is
// deferred. Withdrawal / graduation are the modelled lifecycle exits.
@Controller("students")
@UseGuards(AuthGuard)
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  @Get()
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listStudentsQuerySchema))
    query: ListStudentsQuery,
  ): Promise<StudentListResponse> {
    return this.service.list(authCtx, query);
  }

  @Get(":id")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<StudentDetailDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
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
