import { Controller, Get } from "@nestjs/common";

// Dev-only verification surface for Sentry. The route exists solely to
// produce an uncaught error that the global HttpExceptionFilter forwards to
// Sentry, so we can confirm DSN wiring end-to-end without manufacturing a
// real bug.
//
// The DebugModule that mounts this controller is conditionally imported in
// AppModule guarded by NODE_ENV !== "production", so the route is absent
// from production builds entirely — not just gated.
@Controller("debug")
export class DebugController {
  @Get("sentry-test")
  throwIntentional(): never {
    throw new Error("Slice 8a Sentry verification: intentional error");
  }
}
