import { createHmac, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { createAnnouncementSchema, NotFoundError, UnauthorizedError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { lagosToday, unsubscribeToken } from "./announcement-email.shared";
import { AnnouncementEmailService } from "./announcement-email.service";
import { AnnouncementsService } from "./announcements.service";
import { EmailPreferencesService } from "./email-preferences.service";

// Phase 9 / CP8.3 — emailing announcements to families (docs/modules/
// phase-9.md §17.11), against real Postgres.
//
// The owner's rules: every parent linked to a child enrolled this term (in the
// class, for a class announcement), each address once; never a parent whose
// portal access the school switched off; never an address that unsubscribed,
// bounced or complained; at most the plan's daily allowance; and a retried job
// never emails anyone twice. Nothing anyone typed, and no address, reaches an
// audit row.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const WEBHOOK_KEY = Buffer.from(`webhook-key-${runId}-0123456789abcdef`);
const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString("base64")}`;

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

class FakeEmail {
  isConfigured = true;
  fail = false;
  batches: { to: string; subject: string; html: string; headers?: Record<string, string>; tags?: { name: string; value: string }[] }[][] = [];
  async sendBatch(items: FakeEmail["batches"][number]) {
    if (this.fail) throw new Error("Resend is down");
    this.batches.push(items);
    return items.map(() => `re_${randomUUID()}`);
  }
  get sent() {
    return this.batches.flat();
  }
}
class FakePreferences {
  channels = { email: true, sms: false, push: true };
  async getEnabledChannels() {
    return this.channels;
  }
}

function signed(payload: string) {
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", WEBHOOK_KEY).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

describe("Announcement emails (integration)", () => {
  const email = new FakeEmail();
  const preferences = new FakePreferences();
  const emails = new AnnouncementEmailService(email as never, preferences as never);
  const announcements = new AnnouncementsService(undefined, emails);
  const prefs = new EmailPreferencesService();
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    slug: string;
    ownerId: string;
    armId: string;
    mail: { inClass: string; elsewhere: string; disabled: string; unsubscribed: string; bounced: string };
    guardians: { inClass: string; noEmail: string };
  };
  let B: { schoolId: string; slug: string; ownerId: string };

  async function makeSchool(suffix: string) {
    const slug = `annmail-${suffix}-${runId}`;
    const s = await new AuthService().signupOwner(
      {
        schoolName: `Mail ${suffix} ${runId}`,
        schoolSlug: slug,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `annmail-${suffix}-${runId}@example.test`,
        ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.add(s.school.id);
    await basePrisma.school.update({ where: { id: s.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: s.school.id, slug, ownerId: s.user.id };
  }

  beforeAll(async () => {
    process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const a = await makeSchool("a");
    B = await makeSchool("b");
    A = await withTenant(a.schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId: a.schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId: a.schoolId, academicYearId: year.id, sequence: 1, name: "Now", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId: a.schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId: a.schoolId, classLevelId: level.id, name: "JSS1A", code: `ma-${runId}` } });
      const other = await db.classArm.create({ data: { schoolId: a.schoolId, classLevelId: level.id, name: "JSS1B", code: `mb-${runId}` } });
      let n = 0;
      const family = async (armId: string, mail: string | null, extra: { portalDisabledAt?: Date } = {}) => {
        n += 1;
        const student = await db.student.create({
          data: { schoolId: a.schoolId, admissionNumber: `M-${n}-${runId}`, firstName: `Child${n}`, lastName: "Okafor", dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
        });
        await db.enrollment.create({ data: { schoolId: a.schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: armId } });
        const g = await db.guardian.create({
          data: { schoolId: a.schoolId, firstName: `Parent${n}`, lastName: "Okafor", relationship: "MOTHER", phone: `0803000${String(n).padStart(4, "0")}`, email: mail, ...extra },
        });
        await db.studentGuardian.create({ data: { schoolId: a.schoolId, studentId: student.id, guardianId: g.id, isPrimary: true } });
        return g.id;
      };
      const m = (k: string) => `${k}-${runId}@example.test`;
      const inClass = await family(arm.id, `Mixed.${m("inclass")}`.replace("Mixed.", "MiXeD."));
      const noEmail = await family(arm.id, null);
      await family(arm.id, m("disabled"), { portalDisabledAt: new Date() });
      await family(arm.id, m("unsub"));
      await family(arm.id, m("bounced"));
      await family(other.id, m("elsewhere"));
      await db.emailSuppression.create({ data: { schoolId: a.schoolId, email: m("unsub"), reason: "UNSUBSCRIBED", scope: "ANNOUNCEMENTS" } });
      await db.emailSuppression.create({ data: { schoolId: a.schoolId, email: m("bounced"), reason: "BOUNCED", scope: "ALL" } });
      return {
        schoolId: a.schoolId,
        slug: a.slug,
        ownerId: a.ownerId,
        armId: arm.id,
        mail: { inClass: `mixed.${m("inclass")}`, elsewhere: m("elsewhere"), disabled: m("disabled"), unsubscribed: m("unsub"), bounced: m("bounced") },
        guardians: { inClass, noEmail },
      };
    });
  });

  beforeEach(async () => {
    email.batches = [];
    email.fail = false;
    preferences.channels = { email: true, sms: false, push: true };
    await withTenant(A.schoolId, (db) => db.announcementEmailCounter.deleteMany({ where: { schoolId: A.schoolId } }));
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const send = (input: { audience: "EVERYONE" | "PARENTS" | "CLASS" | "STAFF"; classArmId?: string; emailFamilies?: boolean; body?: string }) =>
    announcements.create(ctx(A.schoolId, A.ownerId), { title: "Gate closed", body: input.body ?? "The gate is closed tomorrow.", emailFamilies: true, ...input }, reqCtx);
  const rows = (announcementId: string) =>
    withTenant(A.schoolId, (db) => db.announcementEmail.findMany({ where: { announcementId }, select: { email: true, status: true, skipReason: true, providerId: true } }));
  const summary = async (id: string) => (await announcements.list(ctx(A.schoolId, A.ownerId))).data.find((a) => a.id === id)!.email!;

  it("previews the addresses and today's allowance", async () => {
    const p = await emails.preview(ctx(A.schoolId, A.ownerId), { audience: "CLASS", classArmId: A.armId });
    // inClass only: no-email has none, disabled is left out, unsub and bounced are blocked.
    expect(p).toMatchObject({ addresses: 1, noAddress: 1, remainingToday: 200, dailyLimit: 200, emailEnabled: true });
    expect((await emails.preview(ctx(A.schoolId, A.ownerId), { audience: "EVERYONE" })).addresses).toBe(2);
  });

  it("a class announcement emails that class's families once each, lower-cased, never the switched-off, unsubscribed or bounced", async () => {
    const a = await send({ audience: "CLASS", classArmId: A.armId });
    expect(email.sent.map((e) => e.to)).toEqual([A.mail.inClass]);
    const byEmail = new Map((await rows(a.id)).map((r) => [r.email, r]));
    expect(byEmail.get(A.mail.inClass)).toMatchObject({ status: "SENT" });
    expect(byEmail.get(A.mail.inClass)!.providerId).toMatch(/^re_/);
    expect(byEmail.get(A.mail.unsubscribed)).toMatchObject({ status: "SKIPPED", skipReason: "UNSUBSCRIBED" });
    expect(byEmail.get(A.mail.bounced)).toMatchObject({ status: "SKIPPED", skipReason: "SUPPRESSED" });
    expect(byEmail.has(A.mail.disabled)).toBe(false);
    expect(byEmail.has(A.mail.elsewhere)).toBe(false);
    expect(await summary(a.id)).toMatchObject({ sent: 1, unsubscribed: 1, suppressed: 1, noAddress: 1, capped: 0, waiting: 0 });
  });

  it("the email carries the full text escaped, a one-click unsubscribe header and the school's tag", async () => {
    await send({ audience: "EVERYONE", body: "Bring <b>£5</b>.\n\nThanks & see you." });
    const e = email.sent[0]!;
    expect(e.subject).toBe("Gate closed");
    expect(e.html).toContain("Bring &lt;b&gt;£5&lt;/b&gt;.");
    expect(e.html).toContain("Thanks &amp; see you.");
    expect(e.html).toContain("Stop announcement emails");
    expect(e.headers!["List-Unsubscribe"]).toMatch(/^<.*\/api\/email\/unsubscribe\?s=.*&e=.*&t=[0-9a-f]{64}>$/);
    expect(e.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(e.tags).toContainEqual({ name: "school", value: A.schoolId });
  });

  it("not unless asked, and never for staff", async () => {
    await announcements.create(ctx(A.schoolId, A.ownerId), { title: "No mail", body: "x", audience: "EVERYONE" }, reqCtx);
    expect(email.sent).toHaveLength(0);
    expect(createAnnouncementSchema.safeParse({ title: "t", body: "b", audience: "STAFF", emailFamilies: true }).success).toBe(false);
    const staff = await send({ audience: "STAFF" });
    expect(email.sent).toHaveLength(0);
    expect(staff.email).toBeNull();
  });

  it("a retried job emails nobody twice", async () => {
    const a = await send({ audience: "EVERYONE" });
    expect(email.sent).toHaveLength(2);
    await emails.run(A.schoolId, a.id);
    await emails.run(A.schoolId, a.id);
    expect(email.sent).toHaveLength(2);
  });

  it("the school's email channel off: nothing is sent, and the outbox says why", async () => {
    preferences.channels = { email: false, sms: false, push: true };
    const a = await send({ audience: "EVERYONE" });
    expect(email.sent).toHaveLength(0);
    expect(await summary(a.id)).toMatchObject({ sent: 0, emailOff: 4, unsubscribed: 0 });
  });

  it("the plan's daily limit holds; the rest are recorded as not sent, and not sent later", async () => {
    await withTenant(A.schoolId, (db) => db.announcementEmailCounter.create({ data: { schoolId: A.schoolId, day: lagosToday(), sent: 199 } }));
    const a = await send({ audience: "EVERYONE" });
    expect(email.sent).toHaveLength(1);
    expect(await summary(a.id)).toMatchObject({ sent: 1, capped: 1 });
    await emails.run(A.schoolId, a.id);
    expect(email.sent).toHaveLength(1);
    expect((await emails.preview(ctx(A.schoolId, A.ownerId), { audience: "EVERYONE" })).remainingToday).toBe(0);
  });

  it("a failed batch is marked failed and not retried", async () => {
    email.fail = true;
    const a = await send({ audience: "EVERYONE" });
    expect(await summary(a.id)).toMatchObject({ failed: 2, sent: 0 });
    email.fail = false;
    await emails.run(A.schoolId, a.id);
    expect(email.sent).toHaveLength(0);
  });

  describe("unsubscribe", () => {
    it("the link works for its own school and address only", async () => {
      const t = unsubscribeToken(A.schoolId, A.mail.inClass);
      await expect(prefs.status({ s: A.slug, e: A.mail.inClass, t })).resolves.toMatchObject({ subscribed: true });
      await expect(prefs.status({ s: B.slug, e: A.mail.inClass, t })).rejects.toBeInstanceOf(NotFoundError);
      await expect(prefs.status({ s: A.slug, e: A.mail.elsewhere, t })).rejects.toBeInstanceOf(NotFoundError);
      await expect(prefs.status({ s: A.slug, e: A.mail.inClass, t: "0".repeat(64) })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("unsubscribing stops the next announcement's email; undo turns it back on; the parent can switch it in the portal", async () => {
      const t = unsubscribeToken(A.schoolId, A.mail.inClass);
      await prefs.set({ s: A.slug, e: A.mail.inClass.toUpperCase(), t: unsubscribeToken(A.schoolId, A.mail.inClass.toUpperCase()), subscribe: false }, reqCtx);
      await send({ audience: "CLASS", classArmId: A.armId });
      expect(email.sent).toHaveLength(0);
      const g = { sessionId: "gs", schoolId: A.schoolId, guardianId: A.guardians.inClass };
      expect(await prefs.portalGet(g)).toMatchObject({ email: A.mail.inClass, announcements: false, blocked: false });
      await prefs.set({ s: A.slug, e: A.mail.inClass, t, subscribe: true }, reqCtx);
      expect((await prefs.portalGet(g)).announcements).toBe(true);
      await prefs.portalSet(g, { announcements: false }, reqCtx);
      expect((await prefs.status({ s: A.slug, e: A.mail.inClass, t })).subscribed).toBe(false);
      await prefs.portalSet(g, { announcements: true }, reqCtx);
      // A parent with no address cannot switch anything.
      await expect(prefs.portalSet({ ...g, guardianId: A.guardians.noEmail }, { announcements: true }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("the Resend webhook", () => {
    const event = (type: string, providerId: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: providerId, tags: { school: A.schoolId }, ...extra } });

    it("a bad signature changes nothing", async () => {
      const a = await send({ audience: "CLASS", classArmId: A.armId });
      const [row] = (await rows(a.id)).filter((r) => r.status === "SENT");
      const body = event("email.bounced", row!.providerId!, { bounce: { type: "Permanent" } });
      await expect(prefs.webhook(Buffer.from(body), { ...signed(body), "svix-signature": "v1,AAAA" })).rejects.toBeInstanceOf(UnauthorizedError);
      expect((await rows(a.id)).find((r) => r.providerId === row!.providerId)!.status).toBe("SENT");
    });

    it("delivered, then a hard bounce suppresses the address and the next announcement skips it", async () => {
      const a = await send({ audience: "CLASS", classArmId: A.armId });
      const [row] = (await rows(a.id)).filter((r) => r.status === "SENT");
      const delivered = event("email.delivered", row!.providerId!);
      await prefs.webhook(Buffer.from(delivered), signed(delivered));
      expect(await summary(a.id)).toMatchObject({ sent: 1, delivered: 1 });
      const bounced = event("email.bounced", row!.providerId!, { bounce: { type: "Permanent" } });
      await prefs.webhook(Buffer.from(bounced), signed(bounced));
      expect(await summary(a.id)).toMatchObject({ bounced: 1 });
      expect(await emails.bounced(ctx(A.schoolId, A.ownerId), a.id)).toEqual([
        expect.objectContaining({ email: A.mail.inClass, status: "BOUNCED", guardianName: expect.stringContaining("Okafor"), children: [expect.stringContaining("Okafor")] }),
      ]);
      const next = await send({ audience: "CLASS", classArmId: A.armId });
      expect((await rows(next.id)).find((r) => r.email === A.mail.inClass)).toMatchObject({ status: "SKIPPED", skipReason: "SUPPRESSED" });
      const g = { sessionId: "gs", schoolId: A.schoolId, guardianId: A.guardians.inClass };
      expect(await prefs.portalGet(g)).toMatchObject({ blocked: true, announcements: false });
      await withTenant(A.schoolId, (db) => db.emailSuppression.deleteMany({ where: { email: A.mail.inClass } }));
    });

    it("a webhook for another school's email id changes nothing here", async () => {
      const a = await send({ audience: "CLASS", classArmId: A.armId });
      const [row] = (await rows(a.id)).filter((r) => r.status === "SENT");
      const body = JSON.stringify({ type: "email.complained", data: { email_id: row!.providerId, tags: { school: B.schoolId } } });
      await prefs.webhook(Buffer.from(body), signed(body));
      expect((await rows(a.id)).find((r) => r.providerId === row!.providerId)!.status).toBe("SENT");
    });
  });

  it("no address and no text reach an audit row", async () => {
    await send({ audience: "EVERYONE", body: "SecretBodyXYZ" });
    await prefs.set({ s: A.slug, e: A.mail.elsewhere, t: unsubscribeToken(A.schoolId, A.mail.elsewhere), subscribe: false }, reqCtx);
    await prefs.set({ s: A.slug, e: A.mail.elsewhere, t: unsubscribeToken(A.schoolId, A.mail.elsewhere), subscribe: true }, reqCtx);
    const audit = await withTenant(A.schoolId, (db) =>
      db.auditLog.findMany({ where: { schoolId: A.schoolId, OR: [{ action: { startsWith: "email." } }, { action: { startsWith: "announcement." } }] } }),
    );
    const text = JSON.stringify(audit);
    expect(text).not.toMatch(/SecretBodyXYZ/);
    expect(text).not.toMatch(/@example\.test/);
    expect(audit.some((r) => r.action === "email.announcements-off")).toBe(true);
  });
});
