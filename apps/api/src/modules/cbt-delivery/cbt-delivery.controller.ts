import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, type RawBodyRequest } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import {
  CBT_SIGNATURE_HEADER,
  cbtSyncBatchSchema,
  type CbtPackDownloadDto,
  type CbtSyncBatch,
  type CbtSyncResultDto,
} from "@school-kit/types";

import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { CbtDeliveryService } from "./cbt-delivery.service.js";

// Online exams (CBT2) — the lab machine's two calls (docs/modules/cbt.md D9).
// No guard: lab students have no accounts (D5). What protects each route is
// in the service's header.
//
// Throttles are per client address, and a whole computer lab reaches us from
// ONE address (the school's router). So they are sized for a lab, not for a
// person: a 200-machine lab downloads once each and syncs about twice a
// minute each. A wrong access code reveals nothing (the pack is encrypted), so
// the download limit is not an enumeration defence the way the Result
// Checker's is.

@Controller("cbt-delivery")
export class CbtDeliveryController {
  constructor(private readonly delivery: CbtDeliveryService) {}

  @Get(":slug/packs/:accessCode")
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  async pack(@Param("slug") slug: string, @Param("accessCode") accessCode: string): Promise<CbtPackDownloadDto> {
    return this.delivery.downloadPack(slug, accessCode);
  }

  @Post(":slug/sittings/:sittingId/answers")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 1200 } })
  async answers(
    @Param("slug") slug: string,
    @Param("sittingId") sittingId: string,
    @Body(new ZodValidationPipe(cbtSyncBatchSchema)) batch: CbtSyncBatch,
    @Headers(CBT_SIGNATURE_HEADER) signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<CbtSyncResultDto> {
    return this.delivery.sync(slug, sittingId, batch, req.rawBody, signature);
  }
}
