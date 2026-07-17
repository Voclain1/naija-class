import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { GuardianAuthContext } from "./guardian-auth-context";

// Injects the GuardianAuthContext attached by GuardianAuthGuard. Mirrors
// CurrentUser (current-user.decorator.ts) exactly, for guardians.
//
// Usage:
//   @UseGuards(GuardianAuthGuard)
//   @Get('me')
//   me(@CurrentGuardian() ctx: GuardianAuthContext) { ... }
export const CurrentGuardian = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GuardianAuthContext => {
    const req = ctx.switchToHttp().getRequest<{ guardian?: GuardianAuthContext }>();
    if (!req.guardian) {
      throw new Error(
        "CurrentGuardian used on a handler without GuardianAuthGuard; req.guardian is not populated.",
      );
    }
    return req.guardian;
  },
);
