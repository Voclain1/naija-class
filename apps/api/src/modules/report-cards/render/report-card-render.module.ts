import { Module } from "@nestjs/common";

import { ReportCardsModule } from "../report-cards.module";
import { BrowserPool } from "./browser-pool";
import { ReportCardRenderProcessor } from "./render.processor";
import { RenderService } from "./render.service";

// ReportCardRenderModule (Phase 2 / Slice 5 cp2) — the PDF render side of
// report cards, kept SEPARATE from ReportCardsModule so the HTTP surface and
// the Chromium worker have distinct lifecycles.
//
// Imports ReportCardsModule for two reasons:
//   1. ReportCardService — RenderService composes its getRenderData() to build
//      the template data from the frozen rollup.
//   2. The re-exported BullModule — so this module resolves the same
//      REPORT_CARDS_QUEUE token the producer registered.
//
// StorageService is global (StorageModule @Global), so it needs no import.
//
// Providers:
//   - BrowserPool: the singleton Chromium holder (memory-budget control).
//   - RenderService: card → HTML → PDF → storage → status.
//   - ReportCardRenderProcessor: the sole @Processor on REPORT_CARDS_QUEUE
//     (concurrency 1).
@Module({
  imports: [ReportCardsModule],
  providers: [BrowserPool, RenderService, ReportCardRenderProcessor],
})
export class ReportCardRenderModule {}
