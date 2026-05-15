import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { BaseError } from "@school-kit/types";
import type { Request, Response } from "express";

// Global error filter. Three branches:
//   1. BaseError subclass → use its httpStatus + code + message + details
//   2. NestJS HttpException → preserve its status; coerce its body shape into
//      our { error: { code, message } } envelope
//   3. Anything else → 500 INTERNAL_ERROR; full stack logged, generic body
//
// Never leak stack traces, internal error messages, or DB errors to the
// client. The exception body on the wire is always the same shape, always
// safe to render in the UI.
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof BaseError) {
      res.status(exception.httpStatus).json({ error: exception.toBody() });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      const message = typeof resp === "string" ? resp : (resp as { message?: string }).message ?? exception.message;
      res.status(status).json({
        error: {
          code: defaultCodeForStatus(status),
          message,
        },
      });
      return;
    }

    // Unknown error — log everything, return nothing useful to the caller.
    this.logger.error(
      `Unhandled exception on ${req.method} ${req.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again.",
      },
    });
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "INTERNAL_ERROR" : "ERROR";
  }
}
