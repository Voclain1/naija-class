import {
  BadRequestException, Controller, ForbiddenException, HttpCode, Logger, NotFoundException,
  Param, Post, Req, ServiceUnavailableException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";

import { termiiReportSignatureMatches, TermiiReportsService } from "./termii-reports.service";

@Controller("webhooks/termii")
export class TermiiReportsController {
  private readonly logger = new Logger(TermiiReportsController.name);

  constructor(private readonly reports: TermiiReportsService) {}

  @Post(":accountId")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 200 } })
  async report(
    @Param("accountId") accountId: string,
    @Req() req: Request & { rawBody?: Buffer },
  ): Promise<{ ok: true }> {
    const profile = this.reports.profiles().find((item) => item.accountId === accountId);
    if (!profile) throw new NotFoundException();
    const body = req.rawBody;
    if (!body || !termiiReportSignatureMatches(profile, body, req.headers[profile.signatureHeader])) {
      throw new ForbiddenException("Invalid delivery report signature");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid delivery report");
    }
    try {
      await this.reports.ingest(profile, payload);
      return { ok: true };
    } catch {
      this.logger.error("Termii delivery report could not be recorded");
      throw new ServiceUnavailableException("Delivery reports unavailable");
    }
  }
}
