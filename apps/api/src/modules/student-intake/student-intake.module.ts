import { Module } from "@nestjs/common";

import { FeatureSwitchesModule } from "../../common/features/feature-switches.module";
import { AuthModule } from "../auth/auth.module";
import { StudentIntakeController } from "./student-intake.controller";
import { StudentIntakeService } from "./student-intake.service";

// No AiModule, deliberately: nothing here calls a model.
@Module({
  imports: [AuthModule, FeatureSwitchesModule],
  controllers: [StudentIntakeController],
  providers: [StudentIntakeService],
})
export class StudentIntakeModule {}
