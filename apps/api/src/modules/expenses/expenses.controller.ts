import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createExpenseSchema,
  ValidationError,
  type CreateExpenseInput,
  type ExpenseDto,
  type ExpenseReceiptUrlDto,
  type ListExpensesQuery,
  type UpdateExpenseInput,
  updateExpenseSchema,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { EXPENSE_RECEIPT_MAX_FILE_SIZE_BYTES, ExpenseService } from "./expense.service.js";

@Controller("expenses")
@UseGuards(AuthGuard, PermissionsGuard)
export class ExpensesController {
  constructor(private readonly service: ExpenseService) {}

  @Get()
  @Permissions("expense.read")
  async list(
    @CurrentUser() authCtx: AuthContext,
    @Query("categoryId") categoryId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ): Promise<ExpenseDto[]> {
    const query: ListExpensesQuery = {
      ...(categoryId ? { categoryId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
    return this.service.findAll(authCtx, query);
  }

  @Get(":id")
  @Permissions("expense.read")
  async findById(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ExpenseDto> {
    return this.service.findById(authCtx, id);
  }

  @Post()
  @HttpCode(201)
  @Permissions("expense.create")
  async create(
    @Body(new ZodValidationPipe(createExpenseSchema)) dto: CreateExpenseInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<ExpenseDto> {
    return this.service.create(authCtx, dto, { ipAddress: ip });
  }

  @Patch(":id")
  @Permissions("expense.update")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) dto: UpdateExpenseInput,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<ExpenseDto> {
    return this.service.update(authCtx, id, dto, { ipAddress: ip });
  }

  @Delete(":id")
  @HttpCode(204)
  @Permissions("expense.delete")
  async delete(
    @Param("id") id: string,
    @CurrentUser() authCtx: AuthContext,
    @Ip() ip: string,
  ): Promise<void> {
    await this.service.delete(authCtx, id, { ipAddress: ip });
  }

  // POST /expenses/:id/receipt — multipart/form-data with a `file` field.
  // Split from create/update (D2 of the plan-first): mixing a multipart file
  // with Zod-validated JSON fields in one request is exactly the complexity
  // NestJS's file-upload story handles badly, so the expense row is created
  // first via plain JSON and the receipt is attached in a second call.
  // Gated by expense.update (mutates the row), audited separately as
  // expense.receipt-upload.
  @Post(":id/receipt")
  @HttpCode(200)
  @Permissions("expense.update")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: EXPENSE_RECEIPT_MAX_FILE_SIZE_BYTES },
    }),
  )
  @UseFilters(new UploadErrorFilter("8 MB"))
  async uploadReceipt(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<ExpenseDto> {
    if (!file) {
      throw new ValidationError(
        "INVALID_UPLOAD",
        "No file uploaded. Use multipart/form-data with a 'file' field.",
      );
    }
    return this.service.uploadReceipt(
      authCtx,
      id,
      { buffer: file.buffer, mimetype: file.mimetype },
      { ipAddress: ip },
    );
  }

  @Get(":id/receipt")
  @Permissions("expense.read")
  async getReceiptUrl(
    @CurrentUser() authCtx: AuthContext,
    @Param("id") id: string,
  ): Promise<ExpenseReceiptUrlDto> {
    return this.service.getReceiptUrl(authCtx, id);
  }
}
