import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { StaffPhotosController, StudentPhotosController } from "./photos.controller.js";
import { PhotosService } from "./photos.service.js";

// Passport photos for students and staff (docs/modules/id-cards-and-store.md §2).
@Module({
  imports: [AuthModule],
  controllers: [StudentPhotosController, StaffPhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
