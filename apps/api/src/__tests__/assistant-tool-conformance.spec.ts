import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../common/auth/auth-context";
import { ASSISTANT_TOOLS, buildAssistantToolRegistry } from "../common/ai/tools/assistant-tools";
import {
  amountForms,
  scanFieldNames,
  scanToolOutput,
  type ConformanceFixture,
} from "../common/ai/tools/tool-conformance";
import type { ReadToolDefinition, ToolRegistry } from "../common/ai/tools/tool-registry";

// ---------------------------------------------------------------------------
// FD-3b — the assistant tool conformance gate
// (docs/reviews/agentic-implementation-plan.md §3.3, §4.4). Same idea as
// security-definer-inventory.spec.ts: a standing gate on every CI pass, not a
// review habit.
//
// Every tool in ASSISTANT_TOOLS is run, with each of its conformanceCalls, as
// the OWNER of a fixture school (every permission, so no call is refused for
// lack of one) that holds a student, a guardian, a member of staff, an
// invoice, behaviour records and a health profile. The model-bound output
// must contain none of their planted values, no money, and no behaviour or
// health field (P16; R2 undecided). A refused or failed call fails the gate:
// a tool cannot pass by not running.
//
// The control tools below leak on purpose, each one reading the fixture's own
// rows, and each must be caught. That is what shows the fixture is really
// populated and the scan really bites: an empty table, or a scan that matches
// nothing, cannot pass this spec.
// ---------------------------------------------------------------------------

/**
 * The registered tools, pinned. Adding a tool to ASSISTANT_TOOLS fails here
 * until its name is added: a visible edit in review, and a reminder that the
 * tool now runs through this gate.
 */
const REGISTERED_TOOLS: readonly string[] = [];

const runId = Math.random().toString(36).slice(2, 8);
const digits8 = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999));

// Distinctive, large amounts (kobo). Each form a tool might print, including
// rounded naira, is at least five digits, so it cannot match an ordinary number.
const AMOUNTS = {
  totalAmount: 4_735_251,
  totalDiscount: 1_908_763,
  totalDue: 2_826_488,
  totalPaid: 1_357_913,
} as const;

interface Fixture {
  readonly schoolId: string;
  readonly owner: AuthContext;
  readonly scan: ConformanceFixture;
}

async function buildFixture(): Promise<Fixture> {
  const school = await basePrisma.school.create({
    data: { name: `Conformance School ${runId}`, slug: `tool-conf-${runId}` },
    select: { id: true },
  });
  const schoolId = school.id;

  const staff = {
    firstName: `Ifeoluwa${runId}`,
    lastName: `Okonkwo${runId}`,
    email: `conf-owner-${runId}@example.test`,
    phone: `+23480${digits8()}`,
  };
  const student = {
    firstName: `Zebulon${runId}`,
    middleName: `Chidera${runId}`,
    lastName: `Adeyemi${runId}`,
    admissionNumber: `CONF/${runId}/001`,
    email: `conf-student-${runId}@example.test`,
    phone: `+23481${digits8()}`,
    address: `14 Conformance Close ${runId}`,
  };
  const guardian = {
    firstName: `Ngozika${runId}`,
    lastName: `Balogun${runId}`,
    email: `conf-guardian-${runId}@example.test`,
    phone: `+23490${digits8()}`,
  };
  const behaviour = {
    category: `Kindness-${runId}`,
    commendation: `Shared lunch quietly ${runId}`,
    concern: `Pushed in the queue ${runId}`,
  };
  const health = {
    allergies: `Peanut-${runId}`,
    conditions: `Asthma-${runId}`,
    medication: `Inhaler-${runId}`,
    teacherNote: `Sit near the door ${runId}`,
    emergencyNotes: `Call clinic first ${runId}`,
  };

  const ownerId = await withTenant(schoolId, async (db) => {
    const u = await db.user.create({
      data: { schoolId, ...staff, passwordHash: "argon2id$placeholder" },
      select: { id: true },
    });
    const role = await db.role.findFirst({ where: { schoolId: null, key: "owner", isSystem: true }, select: { id: true } });
    if (!role) throw new Error("system role 'owner' not seeded — run pnpm db:seed");
    await db.userRole.create({ data: { userId: u.id, roleId: role.id } });

    const s = await db.student.create({
      data: { schoolId, ...student, dateOfBirth: new Date("2013-04-17"), gender: "FEMALE" },
      select: { id: true },
    });
    const g = await db.guardian.create({ data: { schoolId, ...guardian, relationship: "MOTHER" }, select: { id: true } });
    await db.studentGuardian.create({ data: { schoolId, studentId: s.id, guardianId: g.id, isPrimary: true } });

    const year = await db.academicYear.create({
      data: { schoolId, label: `C${runId}`, startDate: new Date("2026-09-07"), endDate: new Date("2027-07-23"), isCurrent: true },
      select: { id: true },
    });
    const term = await db.term.create({
      data: {
        schoolId,
        academicYearId: year.id,
        sequence: 1,
        name: "First Term",
        startDate: new Date("2026-09-07"),
        endDate: new Date("2026-12-11"),
        isCurrent: true,
      },
      select: { id: true },
    });
    await db.invoice.create({
      data: {
        schoolId,
        studentId: s.id,
        termId: term.id,
        academicYearId: year.id,
        items: [{ label: "Tuition", amount: AMOUNTS.totalAmount, discount: AMOUNTS.totalDiscount }],
        ...AMOUNTS,
      },
    });

    const cat = await db.behaviourCategory.create({
      data: { schoolId, name: behaviour.category, kind: "COMMENDATION", points: 7 },
      select: { id: true },
    });
    await db.behaviourRecord.create({
      data: {
        schoolId,
        studentId: s.id,
        kind: "COMMENDATION",
        note: behaviour.commendation,
        occurredOn: new Date("2026-10-01"),
        recordedBy: u.id,
        categoryId: cat.id,
        points: 7,
      },
    });
    await db.behaviourRecord.create({
      data: { schoolId, studentId: s.id, kind: "CONCERN", note: behaviour.concern, occurredOn: new Date("2026-10-02"), recordedBy: u.id },
    });

    await db.healthProfile.create({ data: { schoolId, studentId: s.id, bloodGroup: "O+", ...health } });
    return u.id;
  });

  const p = (label: string, value: string) => ({ label, value });
  return {
    schoolId,
    owner: { sessionId: "conformance", userId: ownerId, schoolId },
    scan: {
      personal: [
        p("staff first name", staff.firstName),
        p("staff last name", staff.lastName),
        p("staff email", staff.email),
        p("student first name", student.firstName),
        p("student middle name", student.middleName),
        p("student last name", student.lastName),
        p("student admission number", student.admissionNumber),
        p("student email", student.email),
        p("student address", student.address),
        p("guardian first name", guardian.firstName),
        p("guardian last name", guardian.lastName),
        p("guardian email", guardian.email),
        p("student date of birth", "2013-04-17"),
        p("student date of birth", "17/04/2013"),
        p("student date of birth", "04/17/2013"),
        p("student date of birth", "17 April 2013"),
        p("student date of birth", "April 17, 2013"),
      ],
      phones: [p("staff phone", staff.phone), p("student phone", student.phone), p("guardian phone", guardian.phone)],
      koboAmounts: Object.entries(AMOUNTS).map(([label, kobo]) => ({ label: `invoice ${label}`, kobo })),
      behaviour: [
        p("category name", behaviour.category),
        p("commendation note", behaviour.commendation),
        p("concern note", behaviour.concern),
      ],
      health: Object.entries(health).map(([label, value]) => p(label, value)),
    },
  };
}

async function dropFixture(schoolId: string): Promise<void> {
  await withTenant(schoolId, async (db) => {
    await db.healthProfile.deleteMany({});
    await db.behaviourRecord.deleteMany({});
    await db.behaviourCategory.deleteMany({});
    await db.invoice.deleteMany({});
    await db.term.deleteMany({});
    await db.academicYear.deleteMany({});
    await db.studentGuardian.deleteMany({});
    await db.guardian.deleteMany({});
    await db.student.deleteMany({});
    await db.userRole.deleteMany({ where: { user: { schoolId } } });
    await db.user.deleteMany({});
  }).catch(() => undefined);
  await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

/**
 * The gate. For every registered tool: its access declaration, its read class,
 * its declared field names, and every conformance call's model-bound output.
 * Returns the findings per tool; a conforming registry gives an empty list
 * for every tool.
 */
async function runGate(registry: ToolRegistry, actor: AuthContext, scan: ConformanceFixture): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const name of registry.names()) {
    const findings: string[] = [];
    const access = registry.accessOf(name);
    const conf = registry.conformanceOf(name)!;
    if (!access) findings.push("no access declaration");
    else if (access.kind === "permissions" && access.permissions.length === 0) findings.push("empty permission list");
    else if (access.kind === "anyActiveStaff" && access.reason.trim().length < 20) findings.push("anyActiveStaff without a reason");
    if (conf.effect !== "read") findings.push(`effect "${conf.effect}" is not read`);
    findings.push(...scanFieldNames(conf.outputFields).map((f) => `declares ${f}`));
    if (conf.calls.length === 0) findings.push("no conformance calls");

    for (const [i, input] of conf.calls.entries()) {
      try {
        const res = await registry.execute(actor, { id: `toolu_conf_${i}`, name, input });
        if (res.isError) findings.push(`call ${i} did not run: ${res.content}`);
        else findings.push(...scanToolOutput(res.content, scan).map((f) => `call ${i}: ${f}`));
      } catch {
        findings.push(`call ${i} threw`);
      }
    }
    result[name] = findings;
  }
  return result;
}

// --- Control tools: each leaks one thing on purpose, from the fixture's rows. --

type NoArgs = z.ZodObject<Record<string, never>, "strict">;
const reason = "Conformance control tool, never registered in the app.";
function control(name: string, outputFields: string[], run: (schoolId: string) => Promise<Record<string, unknown>>): ReadToolDefinition<NoArgs> {
  return {
    name,
    description: `Control tool ${name} for the FD-3b gate.`,
    access: { kind: "anyActiveStaff", reason },
    effect: "read",
    args: z.object({}).strict(),
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputFields,
    conformanceCalls: [{}],
    run: (ctx) => run(ctx.authCtx.schoolId),
  };
}
const read = <T>(schoolId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant<T>(schoolId, fn);

const CONTROLS = {
  leaky_roster: control("leaky_roster", ["students"], async (id) => ({
    students: (await read(id, (db) => db.student.findMany({ select: { firstName: true, lastName: true } }))).map(
      (s) => `${s.firstName} ${s.lastName}`,
    ),
  })),
  leaky_guardian_phone: control("leaky_guardian_phone", ["contact"], async (id) => {
    const g = await read(id, (db) => db.guardian.findFirstOrThrow({ select: { phone: true } }));
    const d = g.phone.replace(/\D/g, "").slice(-10);
    return { contact: `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` };
  }),
  leaky_balance: control("leaky_balance", ["outstanding"], async (id) => {
    const inv = await read(id, (db) => db.invoice.findFirstOrThrow({ select: { totalDue: true } }));
    return { outstanding: `₦${(inv.totalDue / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` };
  }),
  leaky_rounded_total: control("leaky_rounded_total", ["fees"], async (id) => {
    const inv = await read(id, (db) => db.invoice.findFirstOrThrow({ select: { totalAmount: true } }));
    return { fees: `about ₦${Math.round(inv.totalAmount / 100).toLocaleString("en-NG")}` };
  }),
  leaky_dob: control("leaky_dob", ["born"], async (id) => {
    const s = await read(id, (db) => db.student.findFirstOrThrow({ select: { dateOfBirth: true } }));
    return { born: s.dateOfBirth.toLocaleDateString("en-GB", { timeZone: "UTC" }) };
  }),
  leaky_behaviour_count: control("leaky_summary", ["summary"], async (id) => ({
    summary: { behaviourCount: await read(id, (db) => db.behaviourRecord.count()) },
  })),
  leaky_behaviour_note: control("leaky_recent", ["recent"], async (id) => ({
    recent: (await read(id, (db) => db.behaviourRecord.findMany({ select: { note: true } }))).map((r) => r.note),
  })),
  leaky_health_note: control("leaky_notes", ["notes"], async (id) => ({
    notes: (await read(id, (db) => db.healthProfile.findFirstOrThrow({ select: { teacherNote: true } }))).teacherNote,
  })),
  leaky_declared_health: control("leaky_declared", ["medicalSummary"], async () => ({})),
  clean_term: control("clean_term", ["schoolName", "term", "weeks"], async (id) => {
    const school = await basePrisma.school.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const term = await read(id, (db) => db.term.findFirstOrThrow({ select: { name: true } }));
    return { schoolName: school.name, term: term.name, weeks: 14 };
  }),
} as const;

describe("assistant tool conformance gate (FD-3b)", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await buildFixture();
  });

  afterAll(async () => {
    if (fx) await dropFixture(fx.schoolId);
  });

  it("the registered tools are exactly the pinned list", () => {
    expect(buildAssistantToolRegistry().names()).toEqual([...REGISTERED_TOOLS].sort());
    expect(ASSISTANT_TOOLS.map((t) => t.name).sort()).toEqual([...REGISTERED_TOOLS].sort());
  });

  it("the fixture really holds what the scan looks for, so an empty table cannot pass", async () => {
    const counts = await withTenant(fx.schoolId, async (db) => ({
      students: await db.student.count(),
      guardians: await db.guardian.count(),
      invoices: await db.invoice.count(),
      behaviour: await db.behaviourRecord.count(),
      health: await db.healthProfile.count({ where: { teacherNote: { not: null } } }),
    }));
    expect(counts).toEqual({ students: 1, guardians: 1, invoices: 1, behaviour: 2, health: 1 });
    for (const a of fx.scan.koboAmounts) {
      for (const form of amountForms(a.kobo)) expect(form.replace(/\D/g, "").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("every registered tool conforms: declared access, read only, and no PII, money, behaviour or health in its output", async () => {
    const result = await runGate(buildAssistantToolRegistry(), fx.owner, fx.scan);
    expect(Object.keys(result).sort()).toEqual([...REGISTERED_TOOLS].sort());
    for (const [name, findings] of Object.entries(result)) expect({ name, findings }).toEqual({ name, findings: [] });
  });

  it("each leaky control is caught, for the reason it leaks; a clean tool passes", async () => {
    const result = await runGate(buildAssistantToolRegistry(Object.values(CONTROLS) as never), fx.owner, fx.scan);
    const has = (tool: string, pattern: RegExp) =>
      expect(result[tool]!.some((f) => pattern.test(f)), `${tool}: ${JSON.stringify(result[tool])}`).toBe(true);

    has("leaky_roster", /student first name/);
    has("leaky_roster", /student last name/);
    has("leaky_guardian_phone", /guardian phone/);
    has("leaky_balance", /money: invoice totalDue/);
    has("leaky_rounded_total", /money: invoice totalAmount/);
    has("leaky_dob", /student date of birth/);
    has("leaky_summary", /behaviour field "behaviourCount"/);
    has("leaky_recent", /behaviour: commendation note/);
    has("leaky_recent", /behaviour: concern note/);
    has("leaky_notes", /health: teacherNote/);
    has("leaky_declared", /declares health field "medicalSummary"/);
    expect(result.clean_term).toEqual([]);
  });

  it("a tool that does not run fails the gate rather than passing with no output", async () => {
    await withTenant(fx.schoolId, (db) => db.user.update({ where: { id: fx.owner.userId }, data: { isActive: false } }));
    try {
      const result = await runGate(buildAssistantToolRegistry([CONTROLS.clean_term] as never), fx.owner, fx.scan);
      expect(result.clean_term).toEqual([expect.stringMatching(/^call 0 did not run/)]);
    } finally {
      await withTenant(fx.schoolId, (db) => db.user.update({ where: { id: fx.owner.userId }, data: { isActive: true } }));
    }
  });
});

describe("the conformance scan itself", () => {
  const empty: ConformanceFixture = { personal: [], phones: [], koboAmounts: [], behaviour: [], health: [] };

  it("finds an amount as kobo, naira with or without separators, and rounded naira, but not inside a longer number", () => {
    const fx = { ...empty, koboAmounts: [{ label: "due", kobo: 2_826_488 }] };
    for (const text of ['{"a":2826488}', '{"a":"₦28,264.88"}', '{"a":"28264.88"}', '{"a":"28 265 naira"}', '{"a":"28,265"}']) {
      expect(scanToolOutput(text, fx), text).toEqual([expect.stringMatching(/^money: due \(/)]);
    }
    for (const text of ['{"a":128264881}', '{"a":"28264.881"}', '{"a":"328,265"}']) {
      expect(scanToolOutput(text, fx), text).toEqual([]);
    }
  });

  it("finds a phone through any separators", () => {
    const fx = { ...empty, phones: [{ label: "phone", value: "+2348031234567" }] };
    for (const text of ["0803 123 4567", "+234-803-123-4567", "(0803) 1234567"]) expect(scanToolOutput(text, fx)).toEqual(["phone"]);
  });

  it("names behaviour and health fields in nested and truncated output", () => {
    expect(scanToolOutput('{"x":{"incidents":2,"pupil":{"bloodGroup":"O+"', empty)).toEqual([
      'behaviour field "incidents"',
      'health field "bloodGroup"',
    ]);
    expect(scanFieldNames(["meritPoints", "allergyNotes", "termName"])).toEqual([
      'behaviour field "meritPoints"',
      'health field "allergyNotes"',
    ]);
  });
});
