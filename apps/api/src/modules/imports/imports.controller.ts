import { Controller, Get, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../common/auth/auth.guard";
import { ImportsService } from "./imports.service";

// cp1 stub controller. Only exposes a wiring describe endpoint so we can
// verify at boot that the module composed correctly. cp2 replaces this
// with the real upload / mapping / get / delete endpoints.
//
// The describe endpoint is auth-gated like the rest of /api/v1 — even
// though it returns no tenant data, leaving an unauthenticated route in
// place would be a wart we'd forget to remove.
@Controller("imports")
@UseGuards(AuthGuard)
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Get("_wiring")
  describeWiring() {
    return { data: this.service.describeWiring() };
  }
}
