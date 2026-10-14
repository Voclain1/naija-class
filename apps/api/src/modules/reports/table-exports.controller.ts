import {
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { TABLE_EXPORT_MAX_FILE_BYTES, type ReportExportStatusDto, type ReportPdfAcceptedDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { AuthGuard } from "../../common/auth/auth.guard.js";
import { CurrentUser } from "../../common/auth/current-user.decorator.js";
import { Permissions } from "../../common/auth/permissions.decorator.js";
import { PermissionsGuard } from "../../common/auth/permissions.guard.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { TableExportsService } from "./table-exports.service.js";

// Phase 9 / CP1.3 — Excel and PDF of a list the person is already looking at
// (docs/modules/phase-9.md §8.9 CP1-D10). See TableExportsService for why one
// permission, held by every staff role, is enough: it grants no data.
@Controller("exports")
@UseGuards(AuthGuard, PermissionsGuard)
export class TableExportsController {
  constructor(private readonly service: TableExportsService) {}

  @Post("table/xlsx")
  @HttpCode(200)
  @Permissions("export.table")
  @UseInterceptors(FileInterceptor("table", { limits: { fileSize: TABLE_EXPORT_MAX_FILE_BYTES } }))
  @UseFilters(new UploadErrorFilter("3 MB"))
  async tableXlsx(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    const out = await this.service.xlsx(authCtx, TableExportsService.parse(file?.buffer), { ipAddress: ip });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(out.body);
  }

  @Post("table/pdf")
  @HttpCode(202)
  @Permissions("export.table")
  @UseInterceptors(FileInterceptor("table", { limits: { fileSize: TABLE_EXPORT_MAX_FILE_BYTES } }))
  @UseFilters(new UploadErrorFilter("3 MB"))
  async tablePdf(
    @CurrentUser() authCtx: AuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Ip() ip: string,
  ): Promise<ReportPdfAcceptedDto> {
    return this.service.pdf(authCtx, TableExportsService.parse(file?.buffer), { ipAddress: ip });
  }

  @Get(":exportId")
  @Permissions("export.table")
  async exportStatus(
    @CurrentUser() authCtx: AuthContext,
    @Param("exportId", new ParseUUIDPipe()) exportId: string,
  ): Promise<ReportExportStatusDto> {
    return this.service.status(authCtx, exportId);
  }
}
