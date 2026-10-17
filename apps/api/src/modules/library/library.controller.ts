import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  addCopiesSchema,
  createBookSchema,
  issueLoanSchema,
  listBooksSchema,
  listBorrowersSchema,
  listLoansSchema,
  lookupCopySchema,
  markLostSchema,
  returnLoanSchema,
  updateBookSchema,
  updateCopySchema,
  updateLibrarySettingsSchema,
  type AddCopiesInput,
  type CreateBookInput,
  type FamilyLibraryDto,
  type IssueLoanInput,
  type LibraryBookDto,
  type LibraryBookSummaryDto,
  type LibraryBorrowerDto,
  type LibraryBorrowerLoansDto,
  type LibraryContextDto,
  type LibraryCopyLookupDto,
  type LibraryLoanDto,
  type LibraryLoanResultDto,
  type LibrarySettingsDto,
  type ListBooksInput,
  type ListBorrowersInput,
  type ListLoansInput,
  type LookupCopyInput,
  type MarkLostInput,
  type ReturnLoanInput,
  type UpdateBookInput,
  type UpdateCopyInput,
  type UpdateLibrarySettingsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import { CurrentStudent } from "../../common/auth/current-student.decorator.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import type { StudentAuthContext } from "../../common/auth/student-auth-context.js";
import { StudentAuthGuard } from "../../common/auth/student-auth.guard.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { LibraryService } from "./library.service.js";

// Phase 9 / CP6.1 — the library (docs/modules/phase-9.md §14). library.read,
// library.manage and library.lend: owner, admin and the librarian.
// library.settings: owner and admin. The service re-checks the role on every
// call.
@Controller("library")
@UseGuards(AuthGuard, PermissionsGuard)
export class LibraryController {
  constructor(private readonly service: LibraryService) {}

  // ─── Settings and context ─────────────────────────────────────────────────

  @Get("context")
  @Permissions("library.read")
  context(@CurrentUser() authCtx: AuthContext): Promise<LibraryContextDto> {
    return this.service.context(authCtx);
  }

  @Put("settings")
  @Permissions("library.settings")
  updateSettings(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(updateLibrarySettingsSchema)) dto: UpdateLibrarySettingsInput,
    @Ip() ip: string,
  ): Promise<LibrarySettingsDto> {
    return this.service.updateSettings(authCtx, dto, { ipAddress: ip });
  }

  // ─── Books and copies ─────────────────────────────────────────────────────

  @Get("books")
  @Permissions("library.read")
  listBooks(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listBooksSchema)) query: ListBooksInput): Promise<LibraryBookSummaryDto[]> {
    return this.service.listBooks(authCtx, query);
  }

  @Post("books")
  @HttpCode(201)
  @Permissions("library.manage")
  createBook(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(createBookSchema)) dto: CreateBookInput,
    @Ip() ip: string,
  ): Promise<LibraryBookDto> {
    return this.service.createBook(authCtx, dto, { ipAddress: ip });
  }

  @Get("books/:id")
  @Permissions("library.read")
  getBook(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<LibraryBookDto> {
    return this.service.getBook(authCtx, id);
  }

  @Patch("books/:id")
  @Permissions("library.manage")
  updateBook(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateBookSchema)) dto: UpdateBookInput,
    @Ip() ip: string,
  ): Promise<LibraryBookDto> {
    return this.service.updateBook(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete("books/:id")
  @HttpCode(204)
  @Permissions("library.manage")
  deleteBook(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<void> {
    return this.service.deleteBook(authCtx, id, { ipAddress: ip });
  }

  @Post("books/:id/copies")
  @HttpCode(201)
  @Permissions("library.manage")
  addCopies(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(addCopiesSchema)) dto: AddCopiesInput,
    @Ip() ip: string,
  ): Promise<LibraryBookDto> {
    return this.service.addCopies(authCtx, id, dto, { ipAddress: ip });
  }

  @Get("copies/lookup")
  @Permissions("library.read")
  lookupCopy(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(lookupCopySchema)) query: LookupCopyInput): Promise<LibraryCopyLookupDto> {
    return this.service.lookupCopy(authCtx, query.accessionNumber);
  }

  @Patch("copies/:id")
  @Permissions("library.manage")
  updateCopy(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(updateCopySchema)) dto: UpdateCopyInput,
    @Ip() ip: string,
  ): Promise<LibraryBookDto> {
    return this.service.updateCopy(authCtx, id, dto, { ipAddress: ip });
  }

  // ─── Lending ──────────────────────────────────────────────────────────────

  @Get("borrowers")
  @Permissions("library.lend")
  findBorrowers(
    @CurrentUser() authCtx: AuthContext,
    @Query(new ZodValidationPipe(listBorrowersSchema)) query: ListBorrowersInput,
  ): Promise<LibraryBorrowerDto[]> {
    return this.service.findBorrowers(authCtx, query);
  }

  @Get("loans")
  @Permissions("library.read")
  listLoans(@CurrentUser() authCtx: AuthContext, @Query(new ZodValidationPipe(listLoansSchema)) query: ListLoansInput): Promise<LibraryLoanDto[]> {
    return this.service.listLoans(authCtx, query);
  }

  @Post("loans/issue")
  @HttpCode(201)
  @Permissions("library.lend")
  issue(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(issueLoanSchema)) dto: IssueLoanInput,
    @Ip() ip: string,
  ): Promise<LibraryLoanDto> {
    return this.service.issue(authCtx, dto, { ipAddress: ip });
  }

  @Post("loans/return")
  @HttpCode(200)
  @Permissions("library.lend")
  returnCopy(
    @CurrentUser() authCtx: AuthContext,
    @Body(new ZodValidationPipe(returnLoanSchema)) dto: ReturnLoanInput,
    @Ip() ip: string,
  ): Promise<LibraryLoanResultDto> {
    return this.service.returnCopy(authCtx, dto, { ipAddress: ip });
  }

  // CP6.2 — a lost book (CP6-D4), and the same book found again.
  @Post("loans/:id/lost")
  @HttpCode(200)
  @Permissions("library.lend")
  markLost(
    @CurrentUser() authCtx: AuthContext,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(markLostSchema)) dto: MarkLostInput,
    @Ip() ip: string,
  ): Promise<LibraryLoanResultDto> {
    return this.service.markLost(authCtx, id, dto, { ipAddress: ip });
  }

  @Post("loans/:id/found")
  @HttpCode(200)
  @Permissions("library.lend")
  markFound(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<LibraryLoanResultDto> {
    return this.service.markFound(authCtx, id, { ipAddress: ip });
  }

  @Post("loans/:id/renew")
  @HttpCode(200)
  @Permissions("library.lend")
  renew(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Ip() ip: string): Promise<LibraryLoanDto> {
    return this.service.renew(authCtx, id, { ipAddress: ip });
  }

  @Get("students/:id/loans")
  @Permissions("library.read")
  studentLoans(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<LibraryBorrowerLoansDto> {
    return this.service.studentLoans(authCtx, id);
  }

  @Get("staff/:id/loans")
  @Permissions("library.read")
  staffLoans(@CurrentUser() authCtx: AuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<LibraryBorrowerLoansDto> {
    return this.service.staffLoans(authCtx, id);
  }
}

// Phase 9 / CP6.2 — a parent reads their own child's library books out: title,
// author and due date, nothing about the staff who lent them (CP6-D6). Behind
// withGuardian.
@Controller("portal")
@UseGuards(GuardianAuthGuard)
export class PortalLibraryController {
  constructor(private readonly service: LibraryService) {}

  @Get("students/:id/library")
  library(@CurrentGuardian() guardianCtx: GuardianAuthContext, @Param("id", new ParseUUIDPipe()) id: string): Promise<FamilyLibraryDto> {
    return this.service.libraryForGuardian(guardianCtx, id);
  }
}

// Phase 9 / CP6.2 — the child's own books out. The session is the identity: no
// student id in the path.
@Controller("student-portal")
@UseGuards(StudentAuthGuard)
export class StudentLibraryController {
  constructor(private readonly service: LibraryService) {}

  @Get("me/library")
  library(@CurrentStudent() ctx: StudentAuthContext): Promise<FamilyLibraryDto> {
    return this.service.libraryForStudent(ctx.schoolId, ctx.studentId);
  }
}
