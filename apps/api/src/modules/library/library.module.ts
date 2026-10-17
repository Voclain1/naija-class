import { Module } from "@nestjs/common";

import { StudentChargeService } from "../finance/student-charge.service.js";
import { LibraryResourcesController, StudentLibraryResourcesController } from "./library-resources.controller.js";
import { LibraryResourcesService } from "./library-resources.service.js";
import { LibraryController, PortalLibraryController, StudentLibraryController } from "./library.controller.js";
import { LibraryService } from "./library.service.js";

// Phase 9 / CP6 — the library. StudentChargeService is stateless and provided
// here too, as in TransportModule, for fines and lost books (CP6.2). Digital
// resources (CP6.3) use the global StorageService.
@Module({
  controllers: [LibraryController, PortalLibraryController, StudentLibraryController, LibraryResourcesController, StudentLibraryResourcesController],
  providers: [LibraryService, LibraryResourcesService, StudentChargeService],
  exports: [LibraryService],
})
export class LibraryModule {}
