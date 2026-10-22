import { Controller, Get, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { SchoolAddressPreviewDto } from "@school-kit/types";

import { SchoolAddressService } from "./school-address.service";

// PUBLIC: the sign-up form's "Your school's address will be …" line
// (docs/modules/school-addresses.md). No guard, like the admission form; it
// reveals only that a code is taken, which the address itself already would.
@Controller("school-addresses")
export class SchoolAddressPublicController {
  constructor(private readonly address: SchoolAddressService) {}

  @Get("preview")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  preview(@Query("name") name: string | undefined): Promise<SchoolAddressPreviewDto> {
    return this.address.preview((name ?? "").slice(0, 120));
  }
}
