import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service";
import { SessionSweeperService } from "./session-sweeper.service.js";

// Integration: real Postgres, real RLS. The sweep runs per school under
// withTenant, so these also prove it only ever touches the school it is in.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("SessionSweeperService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const sweeper = new SessionSweeperService();
  const schoolIds: string[] = [];
  let phone = 0;

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  async function schoolWithSessions(suffix: string) {
    phone += 1;
    const signed = await auth.signupOwner(
      {
        schoolName: `Sweep ${suffix} ${runId}`,
        schoolSlug: `sweep-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `sweep-${suffix}-${runId}@example.test`,
        ownerPhone: `+2348${String(phone).padStart(2, "0")}${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.push(schoolId);
    const now = Date.now();

    const ids = await withTenant(schoolId, async (db) => {
      const guardian = await db.guardian.create({
        data: { schoolId, firstName: "Grace", lastName: "Guardian", relationship: "MOTHER", phone: `+23470${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `SW-${suffix}-${runId}`,
          firstName: "Sam",
          lastName: "Student",
          dateOfBirth: new Date("2012-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      const staff = (label: string, expiresAt: number) =>
        db.session.create({
          data: { userId: signed.user.id, tokenHash: `sw-${suffix}-${label}-${runId}`, expiresAt: new Date(expiresAt) },
          select: { id: true },
        });
      return {
        staffOld: (await staff("old", now - 2 * DAY)).id,
        staffGrace: (await staff("grace", now - HOUR)).id,
        staffLive: (await staff("live", now + DAY)).id,
        guardianOld: (
          await db.guardianSession.create({
            data: { guardianId: guardian.id, tokenHash: `sw-${suffix}-g-${runId}`, expiresAt: new Date(now - 3 * DAY) },
            select: { id: true },
          })
        ).id,
        studentOld: (
          await db.studentSession.create({
            data: { studentId: student.id, tokenHash: `sw-${suffix}-s-${runId}`, expiresAt: new Date(now - 3 * DAY) },
            select: { id: true },
          })
        ).id,
      };
    });
    return { schoolId, ids };
  }

  async function remaining(schoolId: string) {
    return withTenant(schoolId, async (db) => ({
      staff: (await db.session.findMany({ select: { id: true } })).map((r) => r.id),
      guardian: await db.guardianSession.count(),
      student: await db.studentSession.count(),
    }));
  }

  it("deletes sessions more than a day past expiry, keeps recent and live ones, and stays in its school", async () => {
    const a = await schoolWithSessions("a");
    const b = await schoolWithSessions("b");

    const result = await sweeper.sweepExpiredSessions([a.schoolId]);
    expect(result).toEqual({ schools: 1, staff: 1, guardian: 1, student: 1 });

    const left = await remaining(a.schoolId);
    expect(left.staff).not.toContain(a.ids.staffOld);
    expect(left.staff).toEqual(expect.arrayContaining([a.ids.staffGrace, a.ids.staffLive]));
    expect(left).toMatchObject({ guardian: 0, student: 0 });

    // School B was not in the sweep: its expired rows are untouched.
    const other = await remaining(b.schoolId);
    expect(other.staff).toContain(b.ids.staffOld);
    expect(other).toMatchObject({ guardian: 1, student: 1 });
  });

  it("is a no-op the second time", async () => {
    const c = await schoolWithSessions("c");
    await sweeper.sweepExpiredSessions([c.schoolId]);
    expect(await sweeper.sweepExpiredSessions([c.schoolId])).toEqual({ schools: 1, staff: 0, guardian: 0, student: 0 });
  });
});
