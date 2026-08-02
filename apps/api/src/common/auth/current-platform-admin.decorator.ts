import { createParamDecorator, ExecutionContext } from "@nestjs/common";

import type { PlatformAdminContext } from "./platform-admin-context";

// Injects the PlatformAdminContext attached by PlatformAdminGuard. Mirrors
// CurrentUser / CurrentGuardian exactly, for platform admins.
//
// Usage:
//   @UseGuards(PlatformAdminGuard)
//   @Get('schools')
//   schools(@CurrentPlatformAdmin() ctx: PlatformAdminContext) { ... }
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminContext => {
    const req = ctx.switchToHttp().getRequest<{ platformAdmin?: PlatformAdminContext }>();
    if (!req.platformAdmin) {
      throw new Error(
        "CurrentPlatformAdmin used on a handler without PlatformAdminGuard; req.platformAdmin is not populated.",
      );
    }
    return req.platformAdmin;
  },
);
