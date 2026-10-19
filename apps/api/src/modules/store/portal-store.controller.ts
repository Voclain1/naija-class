import { Controller, Get, UseGuards } from "@nestjs/common";
import type { PortalStorePriceListDto } from "@school-kit/types";

import { CurrentGuardian } from "../../common/auth/current-guardian.decorator.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { GuardianAuthGuard } from "../../common/auth/guardian-auth.guard.js";
import { StorePricesService } from "./store-prices.service.js";

// The store's price list, for a parent of the school (2026-10-19). Read-only;
// nothing here is about a child, so it is school-wide, not per student.
@Controller("portal/store")
@UseGuards(GuardianAuthGuard)
export class PortalStoreController {
  constructor(private readonly prices: StorePricesService) {}

  @Get("prices")
  list(@CurrentGuardian() g: GuardianAuthContext): Promise<PortalStorePriceListDto> {
    return this.prices.forParent(g);
  }
}
