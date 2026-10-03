import { Module } from "@nestjs/common";

import { RESULT_PIN_KEY, resolveResultPinKey } from "./result-pin-key";
import { ResultPinService } from "./result-pin.service";

// The PIN key and the one redemption path, shared by the public checker and
// both portals (§21.4). Deliberately NOT imported by ReportCardsModule: the
// render worker boots that module, and must keep starting even if this key
// were missing — rendering PDFs has nothing to do with PINs.
@Module({
  providers: [{ provide: RESULT_PIN_KEY, useFactory: () => resolveResultPinKey() }, ResultPinService],
  exports: [ResultPinService],
})
export class ResultPinModule {}
