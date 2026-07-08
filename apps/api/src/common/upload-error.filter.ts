import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  PayloadTooLargeException,
} from "@nestjs/common";
import type { Response } from "express";

// Multer rejects oversized uploads via PayloadTooLargeException (NestJS
// translates Multer's LIMIT_FILE_SIZE into that exception in
// platform-express's `transformException`). The global HttpExceptionFilter
// would render the default envelope, but callers need a stable
// `FILE_TOO_LARGE` sub-code so clients can branch without parsing the
// message. This filter intercepts the 413 (and any BadRequestException
// Multer throws for a malformed multipart body) and writes the canonical
// envelope. Scoped per-endpoint (not global) because only upload endpoints
// produce a 413, and a global mapping would couple unrelated routes to the
// same code.
//
// Extracted from imports.controller.ts (Phase 1 / Slice 6) when the expense
// receipt upload (Phase 3 / Slice 13) needed the identical shape with a
// different size limit — instantiate with `new UploadErrorFilter("<size
// label>")` via @UseFilters (a class reference alone can't carry the label).
@Catch(PayloadTooLargeException, BadRequestException)
export class UploadErrorFilter implements ExceptionFilter {
  constructor(private readonly sizeLabel: string) {}

  catch(exception: PayloadTooLargeException | BadRequestException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof BadRequestException) {
      res.status(400).json({
        error: {
          code: "INVALID_UPLOAD",
          message: exception.message || "The uploaded file could not be read.",
        },
      });
      return;
    }
    res.status(413).json({
      error: {
        code: "FILE_TOO_LARGE",
        message: `This file is larger than the ${this.sizeLabel} limit. Please use a smaller file.`,
      },
    });
  }
}
