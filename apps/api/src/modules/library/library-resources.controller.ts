import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createResourceFileSchema,
  createResourceLinkSchema,
  listResourcesSchema,
  ValidationError,
  type CreateResourceLinkInput,
  type LibraryResourceDto,
  type LibraryResourceListDto,
  type LibraryResourceUrlDto,
  type ListResourcesInput,
  type StudentLibraryResourcesDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { PRIVATE_FILE_MAX_BYTES } from "../../common/storage/private-file.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { LibraryResourcesService } from "./library-resources.service.js";

// Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7).
// library.resource.read / .write: owner, admin, the Librarian and teacher. The
// service holds a teacher to the subjects and levels they teach, and to their
// own resources when removing.
@Controller("library/resources")
@UseGuards(AuthGuard, PermissionsGuard)
export class LibraryResourcesController {
  constructor(private readonly service: LibraryResourcesService) {}

  @Get()
  @Permissions("library.resource.read")
  list(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listResourcesSchema)) query: ListResourcesInput): Promise<LibraryResourceListDto> {
    return this.service.list(authCtx, query);
  }

  @Post("links")
  @HttpCode(201)
  @Permissions("library.resource.write")
  createLink(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createResourceLinkSchema)) dto: CreateResourceLinkInput,
    @Ip() ip: string,
  ): Promise<LibraryResourceDto> {
    return this.service.createLink(authCtx, dto, { ipAddress: ip });
  }

  // multipart/form-data: "file" (the PDF) and "data" (JSON: title, description,
  // subjectId, levelIds).
  @Post("files")
  @HttpCode(201)
  @Permissions("library.resource.write")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PRIVATE_FILE_MAX_BYTES } }))
  @UseFilters(new UploadErrorFilter("10 MB"))
  createFile(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("data") data: string | undefined,
    @Ip() ip: string,
  ): Promise<LibraryResourceDto> {
    if (!file) throw new ValidationError("INVALID_UPLOAD", "No file uploaded. Use multipart/form-data with a 'file' field.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(data ?? "");
    } catch {
      throw new ValidationError("INVALID_UPLOAD", "Send the title, subject and classes as JSON in a 'data' field.");
    }
    const input = new ZodValidationPipe(createResourceFileSchema).transform(parsed, { type: "body" });
    return this.service.createFile(authCtx, input, file.buffer, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("library.resource.write")
  remove(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.remove(authCtx, id, { ipAddress: ip });
  }

  @Get(":id/file")
  @Permissions("library.resource.read")
  file(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<LibraryResourceUrlDto> {
    return this.service.fileUrlForStaff(authCtx, id);
  }
}

// The student's own reading list. The session is the identity: no student id
// in the path, and the class-level check runs again before any link is signed.
@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentLibraryResourcesController {
  constructor(private readonly service: LibraryResourcesService) {}

  @Get("me/library/resources")
  list(@CurrentStudent() ctx: StudentAuthContext): Promise<StudentLibraryResourcesDto> {
    return this.service.forStudent(ctx.schoolId, ctx.studentId);
  }

  @Get("me/library/resources/:id/file")
  file(@CurrentStudent() ctx: StudentAuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<LibraryResourceUrlDto> {
    return this.service.fileUrlForStudent(ctx.schoolId, ctx.studentId, id);
  }
}
