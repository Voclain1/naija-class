import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { SchoolWebsitePlatformService } from "./school-website-platform.service.js";
import { SchoolWebsitePublicService } from "./school-website-public.service.js";
import {
  SchoolWebsiteController,
  SchoolWebsitePlatformController,
  SchoolWebsitePublicController,
} from "./school-website.controller.js";
import { SchoolWebsiteService } from "./school-website.service.js";

// The school's public website (docs/modules/school-website.md). The front
// page itself is SchoolPublicService in the schools module, which builds the
// website's sections with buildPublicWebsite.
@Module({
  imports: [AuthModule],
  controllers: [SchoolWebsiteController, SchoolWebsitePublicController, SchoolWebsitePlatformController],
  providers: [SchoolWebsiteService, SchoolWebsitePublicService, SchoolWebsitePlatformService],
})
export class SchoolWebsiteModule {}
