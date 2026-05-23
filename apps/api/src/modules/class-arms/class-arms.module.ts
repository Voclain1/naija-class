import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { ClassArmsController } from "./class-arms.controller";
import { ClassArmsService } from "./class-arms.service";

@Module({
  imports: [AuthModule],
  controllers: [ClassArmsController],
  providers: [ClassArmsService],
  exports: [ClassArmsService],
})
export class ClassArmsModule {}
