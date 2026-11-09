import { randomUUID } from "node:crypto";

import { basePrisma, withTenant } from "@school-kit/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PersonRefs, loadQuestionRoster, redactRosterNames } from "../../common/ai/pii/question-check";
import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { StudentsService } from "../students/students.service";
import { TeacherScopeService } from "../teacher-scope/teacher-scope.service";
import { StudentLookupService } from "./student-lookup.service";

// Named lookup over a roster larger than one page of the Students list
// (200), against real PostgreSQL. The Students list pages by id, so ids are
// set here: 450 "Samson" fillers sort first and the students being looked for
// sort onto the LAST page (one Okoro is deliberately on page one). A lookup
// that reads only page one sees none of them, or sees one of two namesakes
// and calls it unique.

const lookup = new StudentLookupService(new StudentsService(), new TeacherScopeService());
const FILLERS = 450;
let schoolId = "";

async function build() {
  const s = await basePrisma.school.create({ data: { name: "Lookup pages", slug: `lookup-pages-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "assistant-workspace": true } } });
  schoolId = s.id;
  return withTenant(s.id, async (db) => {
    const u = await db.user.create({ data: { schoolId: s.id, firstName: "Staff", lastName: "Admin", isActive: true } });
    const role = await db.role.create({ data: { schoolId: s.id, key: "admin", name: "Admin", permissions: ["student.read"] } });
    await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
    const year = await db.academicYear.create({ data: { schoolId: s.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const term = await db.term.create({ data: { schoolId: s.id, academicYearId: year.id, name: "First Term", sequence: 1, isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") } });
    const level = await db.classLevel.create({ data: { schoolId: s.id, name: "JSS 2", code: "jss2", orderIndex: 1, stage: "JSS" } });
    const arm = (name: string, code: string) => db.classArm.create({ data: { schoolId: s.id, classLevelId: level.id, name, code } });
    const a = await arm("JSS 2A", "2a");
    const b = await arm("JSS 2B", "2b");
    const big = await arm("JSS 2 Big", "2big");
    const base = { schoolId: s.id, dateOfBirth: new Date("2013-04-17"), gender: "MALE" as const };
    const tail = s.id.replace(/-/g, "").slice(0, 6); // ids are global: keep them unique per run
    const sid = (n: number, page: "first" | "last") => `${page === "first" ? "00" : "ff"}${tail}-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await db.student.createMany({ data: Array.from({ length: FILLERS }, (_, i) => ({ ...base, id: sid(i + 10, "first"), firstName: "Samson", lastName: `Filler${i}`, admissionNumber: `F-${i}` })) });
    // The whole filler crowd is in one class, larger than a page.
    await db.enrollment.createMany({ data: Array.from({ length: FILLERS }, (_, i) => ({ schoolId: s.id, studentId: sid(i + 10, "first"), termId: term.id, academicYearId: year.id, classArmId: big.id, status: "ENROLLED" as const })) });
    const pupil = async (sidValue: string, first: string, last: string, adm: string, armId: string) => {
      await db.student.create({ data: { ...base, id: sidValue, firstName: first, lastName: last, admissionNumber: adm } });
      await db.enrollment.create({ data: { schoolId: s.id, studentId: sidValue, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" } });
      return sidValue;
    };
    return {
      auth: { schoolId: s.id, userId: u.id, sessionId: "t" },
      arms: { a, b, big },
      okoroFirstPage: await pupil(sid(1, "first"), "Samuel", "Okoro", "T-1", a.id),
      okoroLastPage: await pupil(sid(1, "last"), "Samuel", "Okoro", "T-2", b.id),
      pagetwo: await pupil(sid(2, "last"), "Samuel", "Pagetwo", "T-3", b.id),
      lastInBig: await pupil(sid(3, "last"), "Samira", "Lastinbig", "T-4", big.id),
    };
  }, { timeoutMs: 60_000 });
}

describe("named student lookup over more than one page (PostgreSQL)", () => {
  let fx: Awaited<ReturnType<typeof build>>;
  beforeAll(async () => { fx = await build(); }, 120_000);
  afterAll(async () => {
    await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
      await deleteSchoolRows(tx, schoolId);
    }, { timeout: 120_000 });
  });
  const ids = (r: { matches: { studentId: string }[] }) => r.matches.map((m) => m.studentId).sort();

  it("finds a student beyond page one, with and without a class", async () => {
    expect(await lookup.find(fx.auth, { name: "Samuel Pagetwo" })).toMatchObject({ status: "found", matches: [{ studentId: fx.pagetwo }] });
    expect(await lookup.find(fx.auth, { name: "Pagetwo", classArmIds: [fx.arms.b.id] })).toMatchObject({ status: "found", matches: [{ studentId: fx.pagetwo }] });
    // A class bigger than a page: the last student in it is still found.
    expect(await lookup.find(fx.auth, { name: "Samira", classArmIds: [fx.arms.big.id] })).toMatchObject({ status: "found", matches: [{ studentId: fx.lastInBig }] });
  });

  it("refuses a search it cannot read completely, rather than answering from part of it", async () => {
    const limited = new StudentLookupService(new StudentsService(), new TeacherScopeService());
    limited.maxPages = 1; // the "Sam…" search needs three pages
    await expect(limited.find(fx.auth, { name: "Samuel Pagetwo" })).rejects.toMatchObject({ code: "STUDENT_LOOKUP_TOO_BROAD" });
    await expect(limited.find(fx.auth, { name: "Samira", classArmIds: [fx.arms.big.id] })).rejects.toMatchObject({ code: "STUDENT_LOOKUP_TOO_BROAD" });
    // A scope that fits is still answered.
    expect((await limited.find(fx.auth, { name: "Pagetwo", classArmIds: [fx.arms.b.id] })).status).toBe("found");
  });

  it("never calls a match unique when a namesake is on a later page", async () => {
    const r = await lookup.find(fx.auth, { name: "Samuel Okoro" });
    expect(r.status).toBe("several");
    expect(ids(r)).toEqual([fx.okoroFirstPage, fx.okoroLastPage].sort());
    // Scoped to the two small classes: both, and with the third Samuel when only the first name is given.
    const scoped = await lookup.find(fx.auth, { name: "Samuel", classArmIds: [fx.arms.a.id, fx.arms.b.id] });
    expect(scoped.status).toBe("several");
    expect(ids(scoped)).toEqual([fx.okoroFirstPage, fx.okoroLastPage, fx.pagetwo].sort());
    // Scoped to one class: genuinely unique.
    expect(await lookup.find(fx.auth, { name: "Samuel Okoro", classArmIds: [fx.arms.b.id] })).toMatchObject({ status: "found", matches: [{ studentId: fx.okoroLastPage }] });
  });

  it("a full name with one part exact and one misspelt suggests the student, as 'similar' (a choice, never auto-selected)", async () => {
    for (const typed of ["Samual Okoro", "Samuel Okorro", "Okoro Samual"]) {
      const r = await lookup.find(fx.auth, { name: typed });
      expect(r.status, typed).toBe("similar");
      expect(ids(r), typed).toEqual([fx.okoroFirstPage, fx.okoroLastPage].sort());
      expect(r.matches.every((m) => m.match === "similar")).toBe(true);
    }
    // A misspelling in the first letters of the longer part is still found through the other, exact part.
    expect(ids(await lookup.find(fx.auth, { name: "Smauel Pagetwo" }))).toEqual([fx.pagetwo]);
    // Both parts wrong beyond a close spelling: none, not a guess.
    expect(await lookup.find(fx.auth, { name: "Zamual Okafor" })).toEqual({ status: "none", matches: [] });
  });

  it("possessives resolve to the same student, directly and through redaction to lookup", async () => {
    expect(ids(await lookup.find(fx.auth, { name: "Samuel Pagetwo's" }))).toEqual([fx.pagetwo]);
    expect(ids(await lookup.find(fx.auth, { name: "Samuel Pagetwo’s" }))).toEqual([fx.pagetwo]);
    // The real path: the turn redacts the message, then looks up the marker's name.
    const roster = await loadQuestionRoster(fx.auth.schoolId);
    const refs = new PersonRefs();
    const first = redactRosterNames("Show Samuel Pagetwo's attendance", roster, refs);
    const later = redactRosterNames("and Samuel Pagetwo again", roster, refs);
    expect(first).toBe("Show ⟨P1⟩ attendance");
    expect(later).toBe("and ⟨P1⟩ again"); // the same person, the same marker
    expect(refs.values.get("P1")).toBe("Samuel Pagetwo");
    expect(await lookup.find(fx.auth, { name: refs.values.get("P1")! })).toMatchObject({ status: "found", matches: [{ studentId: fx.pagetwo }] });
    // A possessive on a single name, curly apostrophe.
    const refs2 = new PersonRefs();
    expect(redactRosterNames("What is Pagetwo’s class?", roster, refs2)).toBe("What is ⟨P1⟩ class?");
    expect(refs2.values.get("P1")).toBe("Pagetwo");
  });
});
