import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { StudentAuthContext } from "./student-auth-context";

// Injects the StudentAuthContext attached by StudentAuthGuard. Mirrors
// CurrentGuardian exactly, for students.
export const CurrentStudent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): StudentAuthContext => {
    const req = ctx.switchToHttp().getRequest<{ student?: StudentAuthContext }>();
    if (!req.student) {
      throw new Error(
        "CurrentStudent used on a handler without StudentAuthGuard; req.student is not populated.",
      );
    }
    return req.student;
  },
);
