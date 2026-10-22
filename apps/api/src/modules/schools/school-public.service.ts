import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { NotFoundError, type SchoolPublicDto } from "@school-kit/types";

import { resolveSchoolCode } from "../../common/slug/school-code.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { signSchoolLogoUrl } from "../../common/storage/school-logo.js";
import { loadAdmissionSettings, openClassLevels } from "../admissions/admissions.shared.js";

// The school's public front page, "<code>.schoolkit.ng"
// (docs/modules/school-addresses.md slice 2). PUBLIC, so it returns the
// school's own public details only: its name, motto, logo and contacts, and
// which of its public pages are open. Nothing about a child, a parent or the
// staff, and no counts.
//
// The phone, email and address are the ones the school typed in Settings →
// School for families to reach it; they are already printed on its report
// cards and receipts.

const NOT_FOUND = "There is no school at this address.";

@Injectable()
export class SchoolPublicService {
  constructor(private readonly storage: StorageService) {}

  async get(rawCode: string): Promise<SchoolPublicDto> {
    const found = await resolveSchoolCode(rawCode);
    if (!found) throw new NotFoundError(NOT_FOUND);
    return withTenant(found.schoolId, async (db) => {
      const school = await db.school.findUnique({
        where: { id: found.schoolId },
        select: { slug: true, name: true, motto: true, logoUrl: true, address: true, phone: true, email: true, suspendedAt: true },
      });
      // A suspended school has no front door, like every other public surface.
      if (!school || school.suspendedAt) throw new NotFoundError(NOT_FOUND);

      const settings = await loadAdmissionSettings(db, found.schoolId);
      const admissionsOpen =
        settings.enabled && (await openClassLevels(db, found.schoolId, settings.closedClassLevelIds)).length > 0;
      const resultChecker =
        (await db.reportCard.findFirst({ where: { status: "RELEASED", accessMode: "PIN" }, select: { id: true } })) !== null;
      const logoUrl = await signSchoolLogoUrl(this.storage, found.schoolId, school.logoUrl).catch(() => null);

      return {
        code: school.slug,
        name: school.name,
        motto: school.motto,
        logoUrl,
        address: school.address?.trim() || null,
        phone: school.phone?.trim() || null,
        email: school.email?.trim() || null,
        admissionsOpen,
        resultChecker,
      };
    });
  }
}
