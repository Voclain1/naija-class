import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  activationStage,
  isStuck,
  nextActivationEmail,
  whatsappDigits,
} from "@school-kit/types";

import type { EmailService } from "../../common/email/email.service.js";
import {
  applyActivationWebhook,
  ActivationService,
} from "./activation.service.js";
import {
  summarise,
  ActivationPlatformService,
} from "./activation-platform.service.js";
import {
  linkSignature,
  linkSignatureValid,
  reminderEmailHtml,
  stopSignature,
  targetPath,
} from "./activation.shared.js";

// Getting started (docs/modules/activation.md): the stages, the reminder
// schedule, the signed links, and the cron, clicks, stop link and platform
// list on a real database.

const DAY = 24 * 60 * 60 * 1000;

describe("activation stage and schedule (pure)", () => {
  const counts = {
    setUp: true,
    students: 0,
    enrolled: 0,
    staff: 0,
    inUse: false,
  };

  it("puts a school at the furthest stage its counts show", () => {
    expect(activationStage({ ...counts, setUp: false })).toBe(1);
    expect(activationStage(counts)).toBe(2);
    expect(activationStage({ ...counts, students: 4 })).toBe(3);
    expect(activationStage({ ...counts, students: 4, enrolled: 4 })).toBe(4);
    expect(
      activationStage({ ...counts, students: 4, enrolled: 4, staff: 1 }),
    ).toBe(5);
    expect(activationStage({ ...counts, inUse: true })).toBe(6);
  });

  it("calls a school stuck after a week without students in classes", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(isStuck(2, new Date(now.getTime() - 8 * DAY), now)).toBe(true);
    expect(isStuck(3, new Date(now.getTime() - 6 * DAY), now)).toBe(false);
    expect(isStuck(4, new Date(now.getTime() - 30 * DAY), now)).toBe(false);
  });

  it("sends a new school its reminders on days 2, 7 and 21", () => {
    const signedUpAt = new Date("2026-11-01T09:00:00Z");
    const at = (d: number) => new Date(signedUpAt.getTime() + d * DAY);
    const base = { stage: 2 as const, signedUpAt, stopped: false };
    expect(nextActivationEmail({ ...base, sent: [], now: at(1) })).toBeNull();
    expect(nextActivationEmail({ ...base, sent: [], now: at(2) })?.kind).toBe(
      "FIRST",
    );
    const first = [{ kind: "FIRST" as const, sentAt: at(2) }];
    expect(
      nextActivationEmail({ ...base, sent: first, now: at(6) }),
    ).toBeNull();
    expect(
      nextActivationEmail({ ...base, sent: first, now: at(7) })?.kind,
    ).toBe("SECOND");
    const two = [...first, { kind: "SECOND" as const, sentAt: at(7) }];
    expect(nextActivationEmail({ ...base, sent: two, now: at(20) })).toBeNull();
    expect(nextActivationEmail({ ...base, sent: two, now: at(21) })?.kind).toBe(
      "THIRD",
    );
    expect(
      nextActivationEmail({
        ...base,
        sent: [...two, { kind: "THIRD", sentAt: at(21) }],
        now: at(60),
      }),
    ).toBeNull();
  });

  it("spaces out a school that signed up long before reminders existed", () => {
    const signedUpAt = new Date("2026-08-01T09:00:00Z");
    const now = new Date("2026-11-01T09:00:00Z");
    const base = { stage: 2 as const, signedUpAt, stopped: false };
    expect(nextActivationEmail({ ...base, sent: [], now })?.kind).toBe("FIRST");
    const first = [{ kind: "FIRST" as const, sentAt: now }];
    expect(
      nextActivationEmail({
        ...base,
        sent: first,
        now: new Date(now.getTime() + 4 * DAY),
      }),
    ).toBeNull();
    expect(
      nextActivationEmail({
        ...base,
        sent: first,
        now: new Date(now.getTime() + 5 * DAY),
      })?.kind,
    ).toBe("SECOND");
  });

  it("sends nothing once students are in classes, or after the owner stops them", () => {
    const signedUpAt = new Date("2026-11-01T09:00:00Z");
    const now = new Date(signedUpAt.getTime() + 3 * DAY);
    expect(
      nextActivationEmail({
        stage: 4,
        signedUpAt,
        stopped: false,
        sent: [],
        now,
      }),
    ).toBeNull();
    expect(
      nextActivationEmail({
        stage: 2,
        signedUpAt,
        stopped: true,
        sent: [],
        now,
      }),
    ).toBeNull();
  });

  it("turns a Nigerian number into wa.me digits", () => {
    expect(whatsappDigits("0803 555 0142")).toBe("2348035550142");
    expect(whatsappDigits("+234 704 967 7393")).toBe("2347049677393");
    expect(whatsappDigits("12")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });
});

describe("activation links (pure)", () => {
  const school = "11111111-1111-4111-8111-111111111111";
  const email = "22222222-2222-4222-8222-222222222222";

  it("verifies its own signature only, for a known target only", () => {
    const sig = linkSignature(school, email, "next-step");
    expect(linkSignatureValid(school, email, "next-step", sig)).toBe(true);
    expect(linkSignatureValid(school, email, "setup-call", sig)).toBe(false);
    expect(
      linkSignatureValid(
        "33333333-3333-4333-8333-333333333333",
        email,
        "next-step",
        sig,
      ),
    ).toBe(false);
    expect(linkSignatureValid(school, email, "https://evil.example", sig)).toBe(
      false,
    );
    expect(linkSignatureValid(school, email, "next-step", "zz")).toBe(false);
    expect(stopSignature(school, email)).not.toBe(sig);
  });

  it("sends each target to a fixed staff path, the next step by stage", () => {
    expect(targetPath("next-step", 1)).toBe("/onboarding");
    expect(targetPath("next-step", 2)).toBe("/students");
    expect(targetPath("next-step", 3)).toBe("/enrollments");
    expect(targetPath("setup-call", 2)).toBe("/welcome?book=1");
    expect(targetPath("smart-import", 2)).toBe("/students/scan");
  });

  it("escapes the school's name and offers the setup call and a way to stop", () => {
    const links = {
      "next-step": "N",
      "setup-call": "C",
      "smart-import": "S",
      help: "H",
    };
    const html = reminderEmailHtml({
      kind: "FIRST",
      stage: 2,
      schoolName: "A <b>School</b>",
      ownerFirstName: "Chika",
      links,
      stop: "STOP",
    });
    expect(html).not.toContain("<b>School</b>");
    expect(html).toContain("Add students");
    expect(html).toContain('href="C"');
    expect(html).toContain('href="STOP"');
    expect(html).toContain("Smart Import");
  });
});

describe("ActivationService (database)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const sendBatch = vi.fn(async () => [
    `re_${Math.random().toString(36).slice(2)}`,
  ]);
  const email = { isConfigured: true, sendBatch } as unknown as EmailService;
  const service = new ActivationService(email);
  const platform = new ActivationPlatformService();
  const now = new Date();
  const ids: string[] = [];
  // users.phone is unique across schools, so each run and school gets its own.
  const phoneFor = () =>
    `080${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  async function makeSchool(
    tag: string,
    opts: { daysAgo: number; students?: number; withOwner?: boolean },
  ) {
    const school = await basePrisma.school.create({
      data: {
        name: `Act ${tag} ${runId}`,
        slug: `act-${tag}-${runId}`,
        status: "ACTIVE",
        createdAt: new Date(now.getTime() - opts.daysAgo * DAY),
      },
      select: { id: true },
    });
    ids.push(school.id);
    await withTenant(school.id, async (db) => {
      if (opts.withOwner !== false) {
        const user = await db.user.create({
          data: {
            schoolId: school.id,
            email: `act-${tag}-${runId}@t.test`,
            firstName: "Chika",
            lastName: "Okafor",
            phone: phoneFor(),
          },
          select: { id: true },
        });
        const role = await db.role.findFirst({
          where: { key: "owner", isSystem: true },
          select: { id: true },
        });
        if (!role)
          throw new Error("system `owner` role missing — run `pnpm db:seed`");
        await db.userRole.create({
          data: { userId: user.id, roleId: role.id },
        });
      }
      for (let i = 0; i < (opts.students ?? 0); i++) {
        await db.student.create({
          data: {
            schoolId: school.id,
            firstName: `S${i}`,
            lastName: "Test",
            admissionNumber: `ACT-${runId}-${tag}-${i}`,
            gender: "FEMALE",
            dateOfBirth: new Date("2015-01-01"),
            status: "ACTIVE",
          },
        });
      }
    });
    return school.id;
  }

  let fresh: string;
  let withStudents: string;
  let tooNew: string;
  let noOwner: string;

  beforeAll(async () => {
    fresh = await makeSchool("fresh", { daysAgo: 3 });
    withStudents = await makeSchool("stud", { daysAgo: 3, students: 2 });
    tooNew = await makeSchool("new", { daysAgo: 1 });
    noOwner = await makeSchool("none", { daysAgo: 3, withOwner: false });
  });

  beforeEach(() => sendBatch.mockClear());

  afterAll(async () => {
    for (const id of ids) {
      await withTenant(id, (db) => db.activationEmail.deleteMany({}));
      await withTenant(id, (db) =>
        db.auditLog.deleteMany({ where: { schoolId: id } }),
      );
      await withTenant(id, (db) => db.student.deleteMany({}));
      await withTenant(id, async (db) => {
        await db.userRole.deleteMany({});
        await db.user.deleteMany({});
      });
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it("sends the first reminder to the owner once it is due, tagged, and audits it without the address", async () => {
    await service.sendDue(now, [fresh, withStudents, tooNew, noOwner]);
    expect(sendBatch).toHaveBeenCalledTimes(2);
    const calls = sendBatch.mock.calls as unknown as [
      {
        to: string;
        subject: string;
        html: string;
        tags: { name: string; value: string }[];
        headers: Record<string, string>;
      }[],
    ][];
    const toFresh = calls
      .map((c) => c[0][0])
      .find((i) => i.to.startsWith("act-fresh"))!;
    expect(toFresh.subject).toContain("Add your students");
    expect(toFresh.tags).toEqual(
      expect.arrayContaining([
        { name: "stream", value: "activation" },
        { name: "school", value: fresh },
      ]),
    );
    expect(toFresh.headers["List-Unsubscribe"]).toContain("/activation/stop/");
    const toStud = calls
      .map((c) => c[0][0])
      .find((i) => i.to.startsWith("act-stud"))!;
    expect(toStud.subject).toContain("classes");

    const row = await withTenant(fresh, (db) =>
      db.activationEmail.findFirst({ where: { kind: "FIRST" } }),
    );
    expect(row).toMatchObject({
      status: "SENT",
      stageAtSend: 2,
      clickCount: 0,
    });
    expect(row?.providerId).toMatch(/^re_/);
    const audit = await withTenant(fresh, (db) =>
      db.auditLog.findFirst({ where: { action: "activation_email.sent" } }),
    );
    expect(audit?.metadata).toEqual({ kind: "FIRST", stage: 2 });
    expect(JSON.stringify(audit)).not.toContain("@t.test");
  });

  it("sends nothing twice on the same day", async () => {
    await service.sendDue(now, [fresh, withStudents]);
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it("records a failed send as FAILED and tries it again next time", async () => {
    const other = await makeSchool("fail", { daysAgo: 3 });
    sendBatch.mockRejectedValueOnce(new Error("Resend down"));
    await service.sendDue(now, [other]);
    await expect(
      withTenant(other, (db) =>
        db.activationEmail.findFirst({
          where: { kind: "FIRST" },
          select: { status: true },
        }),
      ),
    ).resolves.toEqual({ status: "FAILED" });
    await service.sendDue(now, [other]);
    await expect(
      withTenant(other, (db) =>
        db.activationEmail.findFirst({
          where: { kind: "FIRST" },
          select: { status: true },
        }),
      ),
    ).resolves.toEqual({ status: "SENT" });
  });

  it("counts a click and sends the owner to the school's next step; a bad link counts nothing", async () => {
    const row = await withTenant(fresh, (db) =>
      db.activationEmail.findFirstOrThrow({
        where: { kind: "FIRST" },
        select: { id: true },
      }),
    );
    const to = await service.click(
      fresh,
      row.id,
      "next-step",
      linkSignature(fresh, row.id, "next-step"),
    );
    expect(to).toMatch(/\/students$/);
    await service.click(
      fresh,
      row.id,
      "setup-call",
      linkSignature(fresh, row.id, "setup-call"),
    );
    const bad = await service.click(fresh, row.id, "next-step", "00");
    expect(bad).toMatch(/\/login$/);
    const after = await withTenant(fresh, (db) =>
      db.activationEmail.findUniqueOrThrow({ where: { id: row.id } }),
    );
    expect(after.clickCount).toBe(2);
    expect(after.firstClickedAt).not.toBeNull();
  });

  it("records Resend's delivered and bounced, and delivered never overwrites a bounce", async () => {
    const row = await withTenant(withStudents, (db) =>
      db.activationEmail.findFirstOrThrow({ where: { kind: "FIRST" } }),
    );
    await withTenant(withStudents, (db) =>
      applyActivationWebhook(db, withStudents, row.providerId!, "BOUNCED"),
    );
    await withTenant(withStudents, (db) =>
      applyActivationWebhook(db, withStudents, row.providerId!, "DELIVERED"),
    );
    await expect(
      withTenant(withStudents, (db) =>
        db.activationEmail.findUniqueOrThrow({
          where: { id: row.id },
          select: { status: true },
        }),
      ),
    ).resolves.toEqual({ status: "BOUNCED" });
  });

  it("stops every later reminder from the stop link, and refuses a forged one", async () => {
    const row = await withTenant(fresh, (db) =>
      db.activationEmail.findFirstOrThrow({
        where: { kind: "FIRST" },
        select: { id: true },
      }),
    );
    await expect(service.stop(fresh, row.id, "ab")).resolves.toBe(false);
    await expect(
      service.stop(fresh, row.id, stopSignature(fresh, row.id)),
    ).resolves.toBe(true);
    await expect(
      service.stop(fresh, row.id, stopSignature(fresh, row.id)),
    ).resolves.toBe(true);
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: fresh },
      select: { setupEmailsStoppedAt: true },
    });
    expect(school.setupEmailsStoppedAt).not.toBeNull();
    await service.sendDue(new Date(now.getTime() + 10 * DAY), [fresh]);
    expect(sendBatch).not.toHaveBeenCalled();
    const stops = await withTenant(fresh, (db) =>
      db.auditLog.count({ where: { action: "activation_email.stopped" } }),
    );
    expect(stops).toBe(1);
  });

  it("lists every school for the platform admin with its stage, owner contacts and reminders", async () => {
    const all = await platform.sweep(now, ids);
    const mine = all.schools.filter((s) => ids.includes(s.schoolId));
    const f = mine.find((s) => s.schoolId === fresh)!;
    expect(f).toMatchObject({
      stage: 2,
      stuck: false,
      emailsStopped: true,
      movedSinceEmail: false,
    });
    expect(f.owner).toMatchObject({
      name: "Chika Okafor",
      invitePending: false,
    });
    expect(f.owner?.phone).toMatch(/^080\d{8}$/);
    expect(f.emails[0]).toMatchObject({ kind: "FIRST", clickCount: 2 });
    const n = mine.find((s) => s.schoolId === noOwner)!;
    expect(n.owner).toBeNull();
    expect(n.emails).toEqual([]);
    expect(mine.find((s) => s.schoolId === withStudents)).toMatchObject({
      stage: 3,
      students: 2,
    });

    const summary = summarise(mine);
    expect(summary.schools).toBe(mine.length);
    expect(summary.emailsStopped).toBe(1);
    expect(summary.emailsClicked).toBe(1);
    expect(summary.byStage[2] + summary.byStage[3]).toBe(mine.length);
  });
});
