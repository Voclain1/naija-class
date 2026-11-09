import { Module } from "@nestjs/common";

import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { AuthModule } from "../auth/auth.module";
import { StudentCorrectionsController } from "./student-corrections.controller";
import { StudentCorrectionsService } from "./student-corrections.service";

// No AiModule, deliberately: nothing here calls a model.
@Module({
  imports: [AuthModule, FeatureSwitchesModule],
  controllers: [StudentCorrectionsController],
  providers: [StudentCorrectionsService],
})
export class StudentCorrectionsModule {}
