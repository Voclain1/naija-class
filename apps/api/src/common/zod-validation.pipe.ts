import { PipeTransform, Injectable, ArgumentMetadata } from "@nestjs/common";
import { ValidationError } from "@school-kit/types";
import type { ZodSchema, ZodError } from "zod";

// Generic Nest pipe that validates a payload against a Zod schema and
// translates ZodError into our domain ValidationError. The global
// HttpExceptionFilter then renders it as { error: { code, message, details } }.
//
// Usage:
//   @Body(new ZodValidationPipe(signupOwnerSchema)) dto: SignupOwnerInput
//
// We intentionally pass the schema per-call rather than wiring a global pipe
// that introspects DTO classes. Nest's class-validator world doesn't apply
// here — we are Zod-first.
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new ValidationError("Invalid request payload", formatZodIssues(parsed.error));
  }
}

function formatZodIssues(err: ZodError) {
  return {
    issues: err.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    })),
  };
}
