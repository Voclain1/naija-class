import { Injectable } from "@nestjs/common";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, type PlatformOnboardingCallDto } from "@school-kit/types";

import { BOOKING_SELECT, ONBOARDING_CALL_AUDIT, toDto } from "./onboarding-call.service.js";

// SchoolKit's side of setup calls (docs/modules/onboarding-call.md):
// PlatformAdminGuard only. basePrisma reads `schools` (no RLS) and writes the
// platform-admin audit row, which carries no school; every booking is read
// and changed under its own school's GUC through withTenant.
@Injectable()
export class OnboardingCallPlatformService {
  /**
   * Every booking, newest first. Read school by school under each school's own
   * GUC, for the schools holding one (schools has no RLS), like the Smart
   * Import beta results: no SECURITY DEFINER function.
   */
  async listAll(): Promise<PlatformOnboardingCallDto[]> {
    const schools = await basePrisma.school.findMany({
      where: { onboardingCallBookedAt: { not: null } },
      orderBy: { onboardingCallBookedAt: "desc" },
      select: { id: true, name: true, slug: true },
      take: 500,
    });
    const rows: PlatformOnboardingCallDto[] = [];
    for (const school of schools) {
      const bookings = await withTenant(school.id, (db) =>
        db.onboardingCallBooking.findMany({ orderBy: { createdAt: "desc" }, select: BOOKING_SELECT, take: 20 }),
      );
      for (const b of bookings) {
        rows.push({ ...toDto(b), schoolId: school.id, schoolName: school.name, schoolSlug: school.slug, doneAt: b.doneAt?.toISOString() ?? null });
      }
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async markDone(platformAdminUserId: string, schoolId: string, bookingId: string, done: boolean): Promise<void> {
    const school = await basePrisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) throw new NotFoundError("School not found.");
    await withTenant(schoolId, async (db) => {
      const updated = await db.onboardingCallBooking.updateMany({ where: { id: bookingId }, data: { doneAt: done ? new Date() : null } });
      if (updated.count === 0) throw new NotFoundError("Booking not found.");
    });
    // Platform-admin audit rows carry no school id (CLAUDE.md, platform admin).
    await basePrisma.auditLog.create({
      data: { schoolId: null, userId: platformAdminUserId, action: ONBOARDING_CALL_AUDIT.done, entityType: "onboarding_call_booking", entityId: bookingId, metadata: { schoolId, done } },
    });
  }
}
