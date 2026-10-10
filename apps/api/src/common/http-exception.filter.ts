import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { BaseError, ValidationError } from "@school-kit/types";
import type { Request, Response } from "express";

import { Sentry } from "../observability/sentry";
import { validationFailureMonitor } from "../observability/validation-failure-monitor";

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
      // A 429 that knows when it ends says so in the standard header too
      // (login lockout, 2026-10-02), so clients and proxies need not parse
      // the body to back off.
      const retryAfter = (exception.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
      if (exception.httpStatus === 429 && typeof retryAfter === "number") {
        res.setHeader("Retry-After", String(retryAfter));
      }
      // A single validation failure is not an incident, so none is captured
      // here. Repeats of one failure on one route are: the monitor counts
      // them and raises one Sentry warning when a form keeps rejecting people
      // (it reads only the route template and issue paths, never the body).
      if (exception instanceof ValidationError) {
        validationFailureMonitor.record({
          method: req.method,
          route: routeTemplate(req),
          errorCode: exception.code,
          details: exception.details,
        });
      }
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
    // BaseError and HttpException return above without reaching here, so by
    // construction every exception captured to Sentry is an unexpected one.
    // Sending modelled 4xx errors would flood the dashboard with normal
    // validation / not-found noise; we want only what genuinely surprised us.
    // captureException is a documented no-op when SENTRY_DSN_API is unset.
    Sentry.captureException(exception, {
      extra: {
        method: req.method,
        url: req.originalUrl,
      },
    });
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

// The matched route's template ("/api/v1/students/:id"), never the URL itself,
// which carries ids and query strings. A request that matched no route has
// no template, and a validation failure there is not a form anyone uses.
function routeTemplate(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === "string" ? `${req.baseUrl ?? ""}${path}` : "(unmatched)";
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
