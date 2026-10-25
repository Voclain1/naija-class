import { Module } from "@nestjs/common";

import { AiModule } from "../../common/ai/ai.module.js";
import { SmartImportBetaService } from "./smart-import-beta.service.js";
import { SmartImportBetaController, StudentScanController } from "./student-scan.controller.js";
import { StudentScanService } from "./student-scan.service.js";

// Smart Student Import — camera-captured student registers.
// See docs/modules/smart-student-import.md.
//
// AiModule is imported explicitly rather than being @Global(), matching
// LessonPlansModule and every other AI-calling module: "who can call Claude"
// stays greppable, which matters most for the ONE feature permitted to send
// student PII to the model (CLAUDE.md's PII-bearing prompt allowlist).
//
// No StorageModule import, deliberately — and its absence is a design
// statement, not an oversight. The captured image is never persisted (D3),
// so this module has no business holding a handle to object storage. If a
// future change needs one, that change is re-opening D3 and needs sign-off.
@Module({
  imports: [AiModule],
  controllers: [StudentScanController, SmartImportBetaController],
  providers: [StudentScanService, SmartImportBetaService],
  exports: [StudentScanService],
})
export class StudentScanModule {}
