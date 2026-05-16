import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { AuthContext } from "./auth-context";

// Injects the AuthContext attached by AuthGuard. Guard must run first;
// without it, request.user is undefined.
//
// Usage:
//   @UseGuards(AuthGuard)
//   @Get('me')
//   me(@CurrentUser() ctx: AuthContext) { ... }
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthContext }>();
    if (!req.user) {
      // Defensive: handlers using @CurrentUser without @UseGuards(AuthGuard)
      // would silently get undefined and cascade weird errors. Fail loud.
      throw new Error(
        "CurrentUser used on a handler without AuthGuard; req.user is not populated.",
      );
    }
    return req.user;
  },
);
