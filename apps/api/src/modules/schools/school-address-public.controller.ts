import { Controller, Get, Param, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { SchoolAddressPreviewDto, SchoolPublicDto, SchoolSitemapIndexDto } from "@school-kit/types";

import { schoolSeoUrls } from "../../common/school-site-url";
import { listPublicSchoolCodes } from "../../common/slug/school-code";

import { SchoolAddressService } from "./school-address.service";
import { SchoolPublicService } from "./school-public.service";

// PUBLIC: the sign-up form's "Your school's address will be …" line
// (docs/modules/school-addresses.md). No guard, like the admission form; it
// reveals only that a code is taken, which the address itself already would.
@Controller("school-addresses")
export class SchoolAddressPublicController {
  constructor(
    private readonly address: SchoolAddressService,
    private readonly publicSchool: SchoolPublicService,
  ) {}

  @Get("preview")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  preview(@Query("name") name: string | undefined): Promise<SchoolAddressPreviewDto> {
    return this.address.preview((name ?? "").slice(0, 120));
  }

  // Each live school's sitemap, for the index search engines are given
  // (docs/modules/school-website.md, "Search"). Codes and dates only. Declared
  // before ":code"; "sitemap-index" is a reserved code.
  @Get("sitemap-index")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async sitemapIndex(): Promise<SchoolSitemapIndexDto> {
    const schools = await listPublicSchoolCodes();
    return { sitemaps: schools.map((s) => ({ url: schoolSeoUrls(s.slug).sitemap, lastModified: s.updatedAt.toISOString() })) };
  }

  // The school's front page ("<code>.schoolkit.ng"): its public details only.
  // Declared after "preview", which is reserved and so never a school's code.
  @Get(":code")
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  school(@Param("code") code: string, @Query("preview") preview: string | undefined): Promise<SchoolPublicDto> {
    return this.publicSchool.get(code, preview?.slice(0, 200));
  }
}
