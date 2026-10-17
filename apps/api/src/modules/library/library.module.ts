import { Module } from "@nestjs/common";

import { LibraryController } from "./library.controller.js";
import { LibraryService } from "./library.service.js";

// Phase 9 / CP6.1 — the library. CP6.2 adds StudentChargeService here for
// fines and lost books, as TransportModule does.
@Module({
  controllers: [LibraryController],
  providers: [LibraryService],
  exports: [LibraryService],
})
export class LibraryModule {}
