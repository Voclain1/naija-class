import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitError, type StartMessageInput } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import type { EventNotification } from "../notifications/notification-dispatch.service";
import { MessageAlertsService } from "./message-alerts.service";
import { MessagesCloseService } from "./messages-close.service";
import { MessagesSettingsService } from "./messages-settings.service";
import { MessagesService } from "./messages.service";
import { lagosToday, unreadMessagesFor } from "./messages.shared";
import { PortalMessagesService } from "./portal-messages.service";

// Phase 9 / CP8.1 — private messaging (docs/modules/phase-9.md §17, owner's
// answers §17.8), against real Postgres.
//
// The rule the owner set, first: a parent writes to ONE recipient (the child's
// form or class teacher, the bursar, the principal or head teacher, the school
// admin, or the office), and ONLY that recipient, anyone it is passed to and
// anyone who has written in it see the conversation. No other member of
// staff, admins included. The office may start a conversation with a parent;
// teachers and bursars may not. A reply reaches the parent by push, else
// email, else SMS only with the school's SMS on, capped at 50 a day. Nothing
// anyone typed reaches an audit row.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

class FakeDispatch {
  calls: EventNotification[] = [];
  channel: "PUSH" | "NONE" = "PUSH";
  async notifyOfEvent(req: EventNotification) {
    this.calls.push(req);
    return this.channel;
  }
}
class FakePreferences {
  channels = { email: true, sms: false, push: true };
  async getEnabledChannels() {
    return this.channels;
  }
}
class FakeEmail {
  isConfigured = true;
  sent: { to: string; subject: string; html: string }[] = [];
  async send(m: { to: string; subject: string; html: string }) {
    this.sent.push(m);
  }
}
class FakeTermii {
  isConfigured = true;
  sent: { to: string; message: string }[] = [];
  async sendSms(to: string, message: string) {
    this.sent.push({ to, message });
  }
}

interface Fixture {
  schoolId: string;
  schoolName: string;
  ownerId: string;
  adminId: string;
  formTeacherId: string;
  classTeacherId: string;
  otherTeacherId: string;
  bursarId: string;
  guardianId: string;
  guardianEmail: string;
  jssChildId: string;
  primaryChildId: string;
  otherGuardianId: string;
}

describe("Messaging (integration)", () => {
  const dispatch = new FakeDispatch();
  const preferences = new FakePreferences();
  const email = new FakeEmail();
  const termii = new FakeTermii();
  const alerts = new MessageAlertsService(dispatch as never, preferences as never, email as never, termii as never);
  const staff = new MessagesService(alerts);
  const portal = new PortalMessagesService(alerts);
  const settings = new MessagesSettingsService();
  const closer = new MessagesCloseService();
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;

  async function setUp(label: string): Promise<Fixture> {
    const slug = `msg-${label}-${runId}`;
    const schoolName = `Messages ${label} ${runId}`;
    const signed = await new AuthService().signupOwner(
      {
        schoolName,
        schoolSlug: slug,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `msg-${label}-${runId}@example.test`,
        ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return withTenant(schoolId, async (db) => {
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staffUser = async (key: string, first: string) => {
        const user = await db.user.create({ data: { schoolId, email: `msg-${label}-${first}-${runId}@example.test`, firstName: first, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      const adminId = await staffUser("admin", "Ada");
      const formTeacherId = await staffUser("teacher", "Funke");
      const classTeacherId = await staffUser("teacher", "Chika");
      const otherTeacherId = await staffUser("teacher", "Tunde");
      const bursarId = await staffUser("bursar", "Bola");
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "This Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const jss = await db.classLevel.findFirstOrThrow({ where: { schoolId, stage: "JSS" }, orderBy: { orderIndex: "asc" } });
      const primary = await db.classLevel.findFirstOrThrow({ where: { schoolId, stage: "PRIMARY" }, orderBy: { orderIndex: "asc" } });
      const jssArm = await db.classArm.create({ data: { schoolId, classLevelId: jss.id, name: "JSS1 Blue", code: `mj-${label}-${runId}`, classTeacherId: formTeacherId } });
      const priArm = await db.classArm.create({ data: { schoolId, classLevelId: primary.id, name: "Primary 1 Red", code: `mp-${label}-${runId}`, classTeacherId } });
      const student = async (first: string, n: number) =>
        (await db.student.create({ data: { schoolId, admissionNumber: `M-${label}-${n}-${runId}`, firstName: first, lastName: "Okafor", dateOfBirth: day("2014-01-01"), gender: "FEMALE" } })).id;
      const jssChildId = await student("Ada", 1);
      const primaryChildId = await student("Ebere", 2);
      for (const [studentId, armId] of [[jssChildId, jssArm.id], [primaryChildId, priArm.id]] as const) {
        await db.enrollment.create({ data: { schoolId, studentId, termId: term.id, academicYearId: year.id, classArmId: armId } });
      }
      const guardianEmail = `parent-${label}-${runId}@example.test`;
      const guardian = await db.guardian.create({ data: { schoolId, firstName: "Ngozi", lastName: "Okafor", relationship: "MOTHER", phone: "08031234567", email: guardianEmail } });
      for (const studentId of [jssChildId, primaryChildId]) await db.studentGuardian.create({ data: { schoolId, studentId, guardianId: guardian.id, isPrimary: true } });
      const other = await db.guardian.create({ data: { schoolId, firstName: "Emeka", lastName: "Obi", relationship: "FATHER", phone: "08037654321" } });
      return {
        schoolId,
        schoolName,
        ownerId: signed.user.id,
        adminId,
        formTeacherId,
        classTeacherId,
        otherTeacherId,
        bursarId,
        guardianId: guardian.id,
        guardianEmail,
        jssChildId,
        primaryChildId,
        otherGuardianId: other.id,
      };
    });
  }

  const g = (f: Fixture, guardianId = f.guardianId) => ({ sessionId: `gs-${runId}`, schoolId: f.schoolId, guardianId });
  const write = (f: Fixture, input: Partial<StartMessageInput> & Pick<StartMessageInput, "recipient">) =>
    portal.start(g(f), { studentId: null, subject: "About homework", body: "Good morning. Please help.", ...input }, reqCtx);
  const sees = async (f: Fixture, userId: string, threadId: string) =>
    (await staff.list(ctx(f.schoolId, userId), { box: "OPEN" })).items.some((t) => t.id === threadId);

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  beforeEach(async () => {
    // Each test starts with today's 5-a-day allowance: earlier conversations
    // are moved to yesterday (their last message keeps its time).
    for (const f of [A, B]) {
      await withTenant(f.schoolId, (db) => db.messageThread.updateMany({ where: { schoolId: f.schoolId }, data: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } }));
    }
    dispatch.calls = [];
    dispatch.channel = "PUSH";
    preferences.channels = { email: true, sms: false, push: true };
    email.sent = [];
    termii.sent = [];
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  // ── Recipients ───────────────────────────────────────────────────────────

  describe("whom a parent can write to", () => {
    it("a JSS child: the form teacher by name, the bursar, the school admin and the office; no principal until one is appointed", async () => {
      const options = await portal.recipients(g(A), A.jssChildId);
      expect(options.map((o) => o.recipient)).toEqual(["CLASS_TEACHER", "BURSAR", "ADMIN", "OFFICE"]);
      expect(options[0]).toMatchObject({ label: "Form teacher", name: "Funke Staff" });
      expect(options.find((o) => o.recipient === "OFFICE")!.label).toBe(`${A.schoolName} office`);
    });

    it("once appointed: the principal for a JSS child, the head teacher for a primary child, and both in general", async () => {
      await settings.setRoles(ctx(A.schoolId, A.adminId), { principalIds: [A.otherTeacherId], headTeacherIds: [A.adminId], inboxOfficerIds: [] }, reqCtx);
      try {
        expect((await portal.recipients(g(A), A.jssChildId)).map((o) => o.recipient)).toContain("PRINCIPAL");
        expect((await portal.recipients(g(A), A.jssChildId)).map((o) => o.recipient)).not.toContain("HEAD_TEACHER");
        const primary = await portal.recipients(g(A), A.primaryChildId);
        expect(primary[0]).toMatchObject({ recipient: "CLASS_TEACHER", label: "Class teacher", name: "Chika Staff" });
        expect(primary.map((o) => o.recipient)).toEqual(["CLASS_TEACHER", "BURSAR", "HEAD_TEACHER", "ADMIN", "OFFICE"]);
        expect((await portal.recipients(g(A), null)).map((o) => o.recipient)).toEqual(["BURSAR", "PRINCIPAL", "HEAD_TEACHER", "ADMIN", "OFFICE"]);
      } finally {
        await settings.setRoles(ctx(A.schoolId, A.adminId), { principalIds: [], headTeacherIds: [], inboxOfficerIds: [] }, reqCtx);
      }
    });

    it("a child who is not theirs, or another school's, is not found", async () => {
      await expect(portal.recipients(g(A), B.jssChildId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(portal.recipients(g(A, A.otherGuardianId), A.jssChildId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(write(A, { recipient: "CLASS_TEACHER", studentId: B.jssChildId })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // ── Who sees what ────────────────────────────────────────────────────────

  it("a message to the form teacher is seen by that teacher ONLY: not another teacher, the bursar, the admin or the owner", async () => {
    const t = await write(A, { recipient: "CLASS_TEACHER", studentId: A.jssChildId });
    expect(t.withLabel).toBe("Funke Staff, Form teacher");
    expect(await sees(A, A.formTeacherId, t.id)).toBe(true);
    for (const other of [A.otherTeacherId, A.bursarId, A.adminId, A.ownerId]) {
      expect(await sees(A, other, t.id), other).toBe(false);
      await expect(staff.get(ctx(A.schoolId, other), t.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Only the form teacher is pushed, with no name on the lock screen.
    expect(dispatch.calls.map((c) => (c.principal as { userId: string }).userId)).toEqual([A.formTeacherId]);
    expect(dispatch.calls[0]!.body).toBe("New message from a parent.");
  });

  it("the teacher replies; the family sees who answered and 'Seen'; the reply is pushed, never its text", async () => {
    const t = await write(A, { recipient: "CLASS_TEACHER", studentId: A.primaryChildId, body: "Is there homework?" });
    expect((await portal.get(g(A), t.id)).seen).toBe(false);
    await staff.get(ctx(A.schoolId, A.classTeacherId), t.id);
    expect((await portal.get(g(A), t.id)).seen).toBe(true);
    dispatch.calls = [];
    await staff.reply(ctx(A.schoolId, A.classTeacherId), t.id, { body: "Yes, page 12." }, reqCtx);
    const fam = await portal.get(g(A), t.id);
    expect(fam.messages.map((m) => [m.author, m.body])).toEqual([
      ["You", "Is there homework?"],
      ["Chika Staff, Class teacher", "Yes, page 12."],
    ]);
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0]!.principal).toEqual({ type: "GUARDIAN", guardianId: A.guardianId });
    expect(JSON.stringify(dispatch.calls[0])).not.toContain("page 12");
    expect(email.sent).toHaveLength(0);
  });

  it("passing on: the bursar then sees all of it, and the teacher who passed it keeps it; nobody else", async () => {
    const t = await write(A, { recipient: "CLASS_TEACHER", studentId: A.jssChildId, body: "Why is the fee higher?" });
    const passed = await staff.pass(ctx(A.schoolId, A.formTeacherId), t.id, { recipient: "BURSAR" }, reqCtx);
    expect(passed.addressedTo).toEqual(["Class teacher (Funke Staff)", "Bursar"]);
    expect(await sees(A, A.bursarId, t.id)).toBe(true);
    expect(await sees(A, A.formTeacherId, t.id)).toBe(true);
    expect(await sees(A, A.adminId, t.id)).toBe(false);
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "The bus fee was added." }, reqCtx);
    expect((await portal.get(g(A), t.id)).messages.at(-1)!.author).toBe("Bola Staff, Bursar");
    // A parent's next message reaches both.
    dispatch.calls = [];
    await portal.reply(g(A), t.id, { body: "Thank you." }, reqCtx);
    expect(dispatch.calls.map((c) => (c.principal as { userId: string }).userId).sort()).toEqual([A.bursarId, A.formTeacherId].sort());
  });

  it("the office: the owner and admins while no Inbox officer is appointed; only the officers once one is", async () => {
    const before = await write(A, { recipient: "OFFICE" });
    expect(await sees(A, A.adminId, before.id)).toBe(true);
    expect(await sees(A, A.ownerId, before.id)).toBe(true);
    await settings.setRoles(ctx(A.schoolId, A.adminId), { principalIds: [], headTeacherIds: [], inboxOfficerIds: [A.otherTeacherId] }, reqCtx);
    try {
      expect(await sees(A, A.otherTeacherId, before.id)).toBe(true);
      expect(await sees(A, A.adminId, before.id)).toBe(false);
      expect(await sees(A, A.ownerId, before.id)).toBe(false);
      const t = await staff.officeStart(ctx(A.schoolId, A.otherTeacherId), { guardianId: A.guardianId, studentId: A.jssChildId, subject: "PTA meeting", body: "Can you come on Friday?" }, reqCtx);
      const fam = await portal.get(g(A), t.id);
      expect(fam.messages[0]).toMatchObject({ author: `${A.schoolName} office`, body: "Can you come on Friday?" });
      expect(fam.withLabel).toBe(`${A.schoolName} office`);
    } finally {
      await settings.setRoles(ctx(A.schoolId, A.adminId), { principalIds: [], headTeacherIds: [], inboxOfficerIds: [] }, reqCtx);
    }
  });

  it("the school admin recipient reaches the owner and admins, not the office officers", async () => {
    const t = await write(A, { recipient: "ADMIN" });
    expect(await sees(A, A.ownerId, t.id)).toBe(true);
    expect(await sees(A, A.adminId, t.id)).toBe(true);
    expect(await sees(A, A.formTeacherId, t.id)).toBe(false);
  });

  it("teachers and bursars cannot start a conversation; only the office can", async () => {
    await expect(staff.officeStart(ctx(A.schoolId, A.formTeacherId), { guardianId: A.guardianId, studentId: null, subject: "Hi", body: "Hello" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.officeStart(ctx(A.schoolId, A.bursarId), { guardianId: A.guardianId, studentId: null, subject: "Hi", body: "Hello" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(staff.officeStart(ctx(A.schoolId, A.adminId), { guardianId: B.guardianId, studentId: null, subject: "Hi", body: "Hello" }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a guardian sees only their own conversations; another school sees nothing", async () => {
    const t = await write(A, { recipient: "BURSAR" });
    expect((await portal.list(g(A, A.otherGuardianId))).items.some((i) => i.id === t.id)).toBe(false);
    await expect(portal.get(g(A, A.otherGuardianId), t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(staff.get(ctx(B.schoolId, B.bursarId), t.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  // ── Reaching the parent ──────────────────────────────────────────────────

  it("no app: the reply goes by email, saying nothing of the text", async () => {
    const t = await write(A, { recipient: "BURSAR" });
    dispatch.channel = "NONE";
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "Secret fee detail" }, reqCtx);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe(A.guardianEmail);
    expect(email.sent[0]!.html).not.toContain("Secret fee detail");
    expect(termii.sent).toHaveLength(0);
  });

  it("no app and no email: SMS only when the school's SMS is on, and never past 50 a day", async () => {
    const t = await write(A, { recipient: "BURSAR" });
    dispatch.channel = "NONE";
    preferences.channels = { email: false, sms: false, push: true };
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "One" }, reqCtx);
    expect(termii.sent).toHaveLength(0);
    preferences.channels = { email: false, sms: true, push: true };
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "Two" }, reqCtx);
    expect(termii.sent).toHaveLength(1);
    expect(termii.sent[0]!.message).not.toContain("Two");
    await withTenant(A.schoolId, (db) => db.messageSmsCounter.update({ where: { schoolId_day: { schoolId: A.schoolId, day: lagosToday() } }, data: { sent: 50 } }));
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "Three" }, reqCtx);
    expect(termii.sent).toHaveLength(1);
  });

  // ── Read state, closing, limits, records ─────────────────────────────────

  it("unread counts on both sides, and the dashboard line", async () => {
    const t = await write(A, { recipient: "CLASS_TEACHER", studentId: A.jssChildId });
    const before = await withTenant(A.schoolId, (db) => unreadMessagesFor(db, A.schoolId, A.formTeacherId));
    expect(before).toBeGreaterThanOrEqual(1);
    await staff.get(ctx(A.schoolId, A.formTeacherId), t.id);
    expect(await withTenant(A.schoolId, (db) => unreadMessagesFor(db, A.schoolId, A.formTeacherId))).toBe(before - 1);
    await staff.reply(ctx(A.schoolId, A.formTeacherId), t.id, { body: "Noted." }, reqCtx);
    expect((await portal.list(g(A))).items.find((i) => i.id === t.id)!.unread).toBe(true);
    await portal.get(g(A), t.id);
    expect((await portal.list(g(A))).items.find((i) => i.id === t.id)!.unread).toBe(false);
  });

  it("a closed conversation takes no more messages; quiet ones close after 30 days", async () => {
    const t = await write(A, { recipient: "BURSAR" });
    await staff.close(ctx(A.schoolId, A.bursarId), t.id, reqCtx);
    await expect(portal.reply(g(A), t.id, { body: "Hello?" }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    await expect(staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "Hi" }, reqCtx)).rejects.toBeInstanceOf(ConflictError);

    const quiet = await write(B, { recipient: "BURSAR" });
    const fresh = await write(B, { recipient: "ADMIN" });
    await withTenant(B.schoolId, (db) => db.messageThread.update({ where: { id: quiet.id }, data: { lastMessageAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } }));
    expect(await closer.closeQuiet(new Date())).toBeGreaterThanOrEqual(1);
    expect((await portal.get(g(B), quiet.id)).status).toBe("CLOSED");
    expect((await portal.get(g(B), fresh.id)).status).toBe("OPEN");
  });

  it("a parent may start 5 conversations a day", async () => {
    for (let i = 0; i < 5; i += 1) await write(B, { recipient: "ADMIN" });
    await expect(write(B, { recipient: "ADMIN" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("marking handled shows who is on it", async () => {
    const t = await write(A, { recipient: "ADMIN" });
    const done = await staff.markHandled(ctx(A.schoolId, A.adminId), t.id, { handled: true }, reqCtx);
    expect(done.handledBy).toBe("Ada Staff");
    expect((await staff.markHandled(ctx(A.schoolId, A.adminId), t.id, { handled: false }, reqCtx)).handledBy).toBeNull();
  });

  it("nothing anyone typed reaches an audit row", async () => {
    const t = await write(A, { recipient: "BURSAR", subject: "SubjectXYZ", body: "BodyXYZ" });
    await staff.reply(ctx(A.schoolId, A.bursarId), t.id, { body: "ReplyXYZ" }, reqCtx);
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { entityId: t.id } }));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(rows)).not.toMatch(/XYZ/);
  });

  it("appointing is the admin's; a teacher cannot appoint", async () => {
    await expect(settings.staff(ctx(A.schoolId, A.formTeacherId))).rejects.toBeInstanceOf(ForbiddenError);
    const list = await settings.staff(ctx(A.schoolId, A.adminId));
    expect(list.find((s) => s.id === A.formTeacherId)).toMatchObject({ roles: ["Teacher"], principal: false });
  });
});
