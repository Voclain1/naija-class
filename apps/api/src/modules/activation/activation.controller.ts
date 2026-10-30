import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import type { PlatformActivationDto } from "@school-kit/types";

import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard.js";
import { ActivationPlatformService } from "./activation-platform.service.js";
import { ActivationService } from "./activation.service.js";
import { stoppedPageHtml } from "./activation.shared.js";

// Getting started (docs/modules/activation.md).

/**
 * The links in a setup reminder. PUBLIC: the signature in the link is the
 * proof, like the unsubscribe link. A click is counted, then redirected to a
 * staff-area path from a fixed list; a link that does not verify goes to the
 * sign-in page and counts nothing.
 */
@Controller("activation")
export class ActivationLinksController {
  constructor(private readonly service: ActivationService) {}

  @Get("c/:schoolId/:emailId/:target/:sig")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async click(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Param("emailId", ParseUUIDPipe) emailId: string,
    @Param("target") target: string,
    @Param("sig") sig: string,
    @Res() res: Response,
  ): Promise<void> {
    res.redirect(302, await this.service.click(schoolId, emailId, target, sig));
  }

  /** The "Stop these emails" link, opened in a browser. */
  @Get("stop/:schoolId/:emailId/:sig")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async stopPage(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Param("emailId", ParseUUIDPipe) emailId: string,
    @Param("sig") sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const ok = await this.service.stop(schoolId, emailId, sig);
    res
      .status(ok ? 200 : 404)
      .type("html")
      .send(stoppedPageHtml(ok));
  }

  /** The same, POSTed by a mail app from the List-Unsubscribe header (RFC 8058). */
  @Post("stop/:schoolId/:emailId/:sig")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async stopOneClick(
    @Param("schoolId", ParseUUIDPipe) schoolId: string,
    @Param("emailId", ParseUUIDPipe) emailId: string,
    @Param("sig") sig: string,
  ): Promise<{ ok: boolean }> {
    return { ok: await this.service.stop(schoolId, emailId, sig) };
  }
}

@Controller("platform-admin/activation")
@UseGuards(PlatformAdminGuard)
export class PlatformActivationController {
  constructor(private readonly platform: ActivationPlatformService) {}

  /** Kept for five minutes; `?fresh=1` reads every school again. */
  @Get()
  list(@Query("fresh") fresh?: string): Promise<PlatformActivationDto> {
    return this.platform.list({ fresh: fresh === "1" });
  }
}
