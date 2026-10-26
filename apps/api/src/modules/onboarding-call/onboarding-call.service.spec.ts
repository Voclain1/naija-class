import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { onboardingCallDays } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { EmailService } from "../../common/email/email.service.js";
import { sendWhatsappAlert } from "../../common/whatsapp/whatsapp-cloud.js";
import { OnboardingCallPlatformService } from "./onboarding-call-platform.service.js";
import { OnboardingCallService, buildBookingEmailHtml } from "./onboarding-call.service.js";

// Setup calls (docs/modules/onboarding-call.md), on a real database: the page
// shows once to the owner of a set-up school, booking or skipping closes it,
// the day and time must be offered ones, the team is emailed, each school's
// bookings stay its own, and the platform admin sees them all.

const sent: { to: string; subject: string; html: string }[] = [];
const email = { send: vi.fn(async (p: { to: string; subject: string; html: string }) => void sent.push(p)) } as unknown as EmailService;
const service = new OnboardingCallService(email);
const platform = new OnboardingCallPlatformService();
const runId = Math.random().toString(36).slice(2, 8);

async function makeSchool(tag: string) {
  const school = await basePrisma.school.create({
    data: { name: `Call ${tag} ${runId}`, slug: `call-${tag}-${runId}`, status: "ACTIVE" },
    select: { id: true },
  });
  return withTenant(school.id, async (db) => {
    const mk = async (key: string, first: string) => {
      const user = await db.user.create({
        data: { schoolId: school.id, email: `call-${tag}-${key}-${runId}@t.test`, firstName: first, lastName: "Okafor", phone: `+23480${runId.length}${tag === "a" ? 1 : 2}${key.length}55501` },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { key, isSystem: true }, select: { id: true } });
      if (!role) throw new Error(`system \`${key}\` role missing — run \`pnpm db:seed\``);
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { schoolId: school.id, userId: user.id } as unknown as AuthContext;
    };
    return { schoolId: school.id, owner: await mk("owner", "Chika"), teacher: await mk("teacher", "Tunde") };
  });
}

describe("OnboardingCallService", () => {
  let a: Awaited<ReturnType<typeof makeSchool>>;
  let b: Awaited<ReturnType<typeof makeSchool>>;
  const day = onboardingCallDays()[0]!;

  beforeAll(async () => {
    a = await makeSchool("a");
    b = await makeSchool("b");
  });

  afterAll(async () => {
    for (const s of [a, b]) {
      if (!s) continue;
      await withTenant(s.schoolId, async (db) => {
        await db.onboardingCallBooking.deleteMany({});
        await db.auditLog.deleteMany({ where: { schoolId: s.schoolId } });
      });
      await basePrisma.school.delete({ where: { id: s.schoolId } }).catch(() => undefined);
    }
  });

  it("shows the page to the owner of a set-up school only, pre-filled with their name and phone", async () => {
    const owner = await service.state(a.owner);
    expect(owner).toMatchObject({ show: true, booking: null, suggestedName: "Chika Okafor" });
    expect(owner.suggestedPhone).toMatch(/^\+234/);
    await expect(service.state(a.teacher)).resolves.toMatchObject({ show: false });
    await basePrisma.school.update({ where: { id: b.schoolId }, data: { status: "ONBOARDING" } });
    await expect(service.state(b.owner)).resolves.toMatchObject({ show: false });
    await basePrisma.school.update({ where: { id: b.schoolId }, data: { status: "ACTIVE" } });
  });

  it("refuses a day or a time that was not offered, and a teacher", async () => {
    const input = { date: day, startMinute: 600, contactName: "Chika Okafor", contactPhone: "0803 555 0142" };
    await expect(service.book(a.owner, { ...input, date: "2020-01-06" }, null)).rejects.toMatchObject({ code: "ONBOARDING_CALL_DAY" });
    await expect(service.book(a.owner, { ...input, startMinute: 610 }, null)).rejects.toMatchObject({ code: "ONBOARDING_CALL_TIME" });
    await expect(service.book(a.owner, { ...input, startMinute: 17 * 60 }, null)).rejects.toMatchObject({ code: "ONBOARDING_CALL_TIME" });
    await expect(service.book(a.teacher, input, null)).rejects.toThrow();
    await expect(withTenant(a.schoolId, (db) => db.onboardingCallBooking.count())).resolves.toBe(0);
  });

  it("books: saves it, closes the page, audits the slot without the phone, and emails the team", async () => {
    sent.length = 0;
    const booking = await service.book(a.owner, { date: day, startMinute: 600, contactName: "Chika Okafor", contactPhone: "0803 555 0142", note: "  We have 300 pupils  " }, "127.0.0.1");
    expect(booking).toMatchObject({ date: day, startMinute: 600, note: "We have 300 pupils" });

    const state = await service.state(a.owner);
    expect(state).toMatchObject({ show: false, booking: { id: booking.id } });

    const audit = await withTenant(a.schoolId, (db) => db.auditLog.findFirst({ where: { action: "onboarding_call.booked" } }));
    expect(audit?.metadata).toEqual({ date: day, startMinute: 600 });
    expect(JSON.stringify(audit)).not.toContain("0803");

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("hello@schoolkit.ng");
    expect(sent[0]!.subject).toContain(`Call a ${runId}`);
    expect(sent[0]!.html).toContain("10:00 am");
    expect(sent[0]!.html).toContain("0803 555 0142");
  });

  it("a booking still stands when the email fails", async () => {
    const failing = new OnboardingCallService({ send: vi.fn(async () => { throw new Error("Resend down"); }) } as unknown as EmailService);
    await expect(
      failing.book(b.owner, { date: day, startMinute: 9 * 60, contactName: "Chika Okafor", contactPhone: "08035550199" }, null),
    ).resolves.toMatchObject({ startMinute: 540 });
  });

  it("skipping closes the page once; skipping again changes nothing", async () => {
    await basePrisma.school.update({ where: { id: a.schoolId }, data: { onboardingCallPromptClosedAt: null } });
    await service.skip(a.owner, null);
    await service.skip(a.owner, null);
    await expect(service.state(a.owner)).resolves.toMatchObject({ show: false });
    const skips = await withTenant(a.schoolId, (db) => db.auditLog.count({ where: { action: "onboarding_call.skipped" } }));
    expect(skips).toBe(1);
  });

  it("keeps each school's bookings to itself", async () => {
    const seenFromB = await withTenant(b.schoolId, (db) => db.onboardingCallBooking.findMany({ select: { schoolId: true } }));
    expect(seenFromB.every((r) => r.schoolId === b.schoolId)).toBe(true);
    await expect(withTenant(b.schoolId, (db) => db.onboardingCallBooking.count({ where: { schoolId: a.schoolId } }))).resolves.toBe(0);
  });

  it("lists every school's bookings for the platform admin, newest first, and marks one done", async () => {
    const all = (await platform.listAll()).filter((r) => [a.schoolId, b.schoolId].includes(r.schoolId));
    expect(all.map((r) => r.schoolId)).toEqual([b.schoolId, a.schoolId]);
    const target = all[1]!;
    await platform.markDone(a.owner.userId, target.schoolId, target.id, true);
    const after = (await platform.listAll()).find((r) => r.id === target.id);
    expect(after?.doneAt).not.toBeNull();
    await expect(platform.markDone(a.owner.userId, b.schoolId, target.id, true)).rejects.toThrow("Booking not found");
    await basePrisma.auditLog.deleteMany({ where: { action: "onboarding_call.done", entityId: target.id } });
  });
});

describe("booking email", () => {
  it("escapes what the school typed", () => {
    const html = buildBookingEmailHtml({
      schoolName: "A <b>School</b>",
      schoolSlug: "a-school",
      booking: { id: "x", date: "2026-10-28", startMinute: 630, contactName: "<script>", contactPhone: "0803", note: "a & b", createdAt: "" },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;School&lt;/b&gt;");
    expect(html).toContain("Wed 28 Oct 2026 at 10:30 am");
  });
});

describe("sendWhatsappAlert", () => {
  const env = {
    WHATSAPP_CLOUD_TOKEN: "t",
    WHATSAPP_PHONE_NUMBER_ID: "123",
    WHATSAPP_ALERT_TO: "+234 704 967 7393",
  };

  it("is off until every setting is there, and sends nothing", async () => {
    const fetchImpl = vi.fn();
    await expect(sendWhatsappAlert({}, { template: "t", parameters: [], purpose: "x" }, fetchImpl)).resolves.toBe("off");
    await expect(sendWhatsappAlert(env, { template: undefined, parameters: [], purpose: "x" }, fetchImpl)).resolves.toBe("off");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the template to our number, with parameters flattened to one line", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      sendWhatsappAlert(env, { template: "setup_call_booked", parameters: ["School\nName", ""], purpose: "x" }, fetchImpl as unknown as typeof fetch),
    ).resolves.toBe("sent");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/123/messages");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: "2347049677393", type: "template", template: { name: "setup_call_booked", language: { code: "en" } } });
    expect(body.template.components[0].parameters).toEqual([
      { type: "text", text: "School Name" },
      { type: "text", text: "-" },
    ]);
  });

  it("reports a refusal as failed, never throws", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    await expect(sendWhatsappAlert(env, { template: "t", parameters: ["a"], purpose: "x" }, fetchImpl as unknown as typeof fetch)).resolves.toBe("failed");
  });
});
