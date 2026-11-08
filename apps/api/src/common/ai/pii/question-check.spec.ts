import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { deleteSchoolRows } from "../../../modules/platform-admin/school-deletion";
import {
  MAX_QUESTION_CHARS,
  checkConversation,
  checkQuestion,
  loadQuestionRoster,
  nameParts,
  type QuestionRoster,
} from "./question-check";

// G-PII (docs/reviews/agentic-implementation-plan.md §3.6; owner's decision
// 2026-11-08). A blocked question returns categories only; a passed question
// is NOT proven free of personal data, and the "known misses" block below
// records what passes today as a measurement, not as coverage.

const roster: QuestionRoster = {
  nameParts: new Set([
    ...nameParts("Chiamaka", "Adaeze", "Okonkwo"),
    ...nameParts("Adebayo", null, "Bello"),
    ...nameParts("Grace", null, "Eze"),
    ...nameParts("Ngozi", null, "Balogun"),
  ]),
  admissionNumbers: new Set(["sk/2024/017", "2025-0042"]),
};

const blocked = (q: string) => checkQuestion(q, roster).categories;

describe("question check: each detector", () => {
  it("a name on the school's roster, in any case, and one edit away when written as a name", () => {
    expect(blocked("Why can't I add Chiamaka to JSS2B?")).toEqual(["roster-name"]);
    expect(blocked("why can't i add chiamaka to jss2b")).toEqual(["roster-name"]);
    expect(blocked("Mrs Balogun says she was charged twice")).toEqual(["roster-name"]);
    expect(blocked("Can you move Chimaka to another class")).toEqual(["roster-name"]); // one letter missing
    expect(blocked("Ádaeze's mum called")).toEqual(["roster-name"]); // accent folded
  });

  it("the school's admission numbers", () => {
    expect(blocked("result for SK/2024/017 is missing")).toEqual(["admission-number"]);
    expect(blocked("2025-0042 has no class")).toEqual(["admission-number"]);
  });

  it("contact and identity patterns", () => {
    expect(blocked("email her at mum.of.ada@gmail.com")).toEqual(["email"]);
    expect(blocked("her number is 0803 123 4567")).toEqual(["phone"]);
    expect(blocked("call +234-803-123-4567")).toEqual(["phone"]);
    expect(blocked("BVN 22123456789 was rejected")).toEqual(["long-number"]);
    expect(blocked("born 05/03/2014")).toEqual(["full-date"]);
    expect(blocked("born 2014-03-05")).toEqual(["full-date"]);
    expect(blocked("born on the 5th of March 2014")).toEqual(["full-date"]);
    expect(blocked("born March 5, 2014")).toEqual(["full-date"]);
  });

  it("size and shape: too long, or pasted rows, regardless of content", () => {
    expect(blocked("a".repeat(MAX_QUESTION_CHARS + 1))).toEqual(["too-long"]);
    expect(blocked("name,class,fees\nx,JSS1,1000\ny,JSS2,2000")).toEqual(["pasted-rows"]);
    expect(blocked("name\tclass\nx\tJSS1")).toEqual(["pasted-rows"]);
  });

  it("several at once are all reported, sorted, and never the matched text", () => {
    const r = checkQuestion("Chiamaka Okonkwo, 0803 123 4567, born 05/03/2014", roster);
    expect(r).toEqual({ blocked: true, categories: ["full-date", "phone", "roster-name"] });
    expect(JSON.stringify(r)).not.toMatch(/chiamaka|okonkwo|0803|2014/i);
  });

  it("every earlier turn is checked again: one bad turn blocks the conversation", () => {
    expect(checkConversation(["how do I add parents", "and Ngozi's dad too?"], roster).categories).toEqual(["roster-name"]);
    expect(checkConversation(["how do I add parents", "and their dads too?"], roster).blocked).toBe(false);
  });
});

describe("question check: names that are ordinary words (decision recorded both ways)", () => {
  it("'Grace' blocks when written as a name mid-sentence, not as a word", () => {
    expect(blocked("is there a grace period for late fees")).toEqual([]);
    expect(blocked("Grace period for fees: how do I set one?")).toEqual([]); // sentence start: read as the word
    expect(blocked("can you tell me why Grace in JSS 2 cannot sign in")).toEqual(["roster-name"]);
  });

  it("product words are never names, whatever the roster holds", () => {
    const r: QuestionRoster = { nameParts: new Set(["class", "term", "grade"]), admissionNumbers: new Set() };
    expect(checkQuestion("Which Class and Term does the Grade show?", r).blocked).toBe(false);
  });

  it("a lowercase near-miss of a name is not matched (it would catch ordinary words)", () => {
    expect(blocked("hello, how do I print receipts")).toEqual([]); // 'hello' is one edit from Bello
  });
});

describe("question check: ordinary questions pass (false-block measurement)", () => {
  const ordinary = [
    "my teacher cannot log in",
    "how do I add a new pupil",
    "upload my students from an excel sheet",
    "send bills to parents for second term",
    "list of debtors who are owing",
    "scratch cards for checking results",
    "what grade is a 59",
    "when does this term end",
    "promote students to the next class",
    "do we send SMS to parents",
    "how do I set the fees for JSS 3 to 150,000 naira",
    "Hello, the dashboard is slow in the morning",
    "Can parents pay with their ATM card?",
    "How many PINs should I generate for 120 students?",
    "the receipt shows 12/2026 instead of the right month",
  ];
  it.each(ordinary)("%s", (q) => expect(blocked(q)).toEqual([]));
});

describe("question check: known misses (recorded as measurements, §3.6 limitations)", () => {
  // Each line records what the detectors do TODAY. These pass, and that is the
  // residual CLAUDE.md's third allowlist row accepts. If a change starts
  // catching one, update the record here and in §3.6; do not delete the case.
  const misses: Array<[string, string]> = [
    ["a name not on this school's roster", "Can I add Tobiloba, a new boy starting Monday"],
    ["a nickname", "Ade's mum wants his report"],
    ["a misspelling beyond one edit", "Can you move Chimka to JSS 3"],
    ["a lowercase misspelling", "can you move chimaka to jss 3"],
    ["a description that identifies", "the only boy in JSS1B who uses a wheelchair"],
    ["a partial number", "her line ends in 4421"],
    ["an address", "lives behind the filling station on Aba Road"],
    ["health in words", "the girl with sickle cell in SS2 missed the exam"],
  ];
  it.each(misses)("passes today: %s", (_label, q) => expect(blocked(q)).toEqual([]));
});

describe("question check: the roster comes from the school's own rows (real Postgres)", () => {
  // Letters only: a digit would split the name into two words.
  const runId = Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
  const schoolIds: string[] = [];
  let a = "";
  let b = "";

  async function school(label: string, student: { first: string; last: string; adm: string }, guardian: string, staff: string) {
    const s = await basePrisma.school.create({
      data: { name: `${label} ${runId}`, slug: `q-check-${runId}-${schoolIds.length}` },
      select: { id: true },
    });
    schoolIds.push(s.id);
    await withTenant(s.id, async (db) => {
      await db.student.create({
        data: { schoolId: s.id, firstName: student.first, lastName: student.last, admissionNumber: student.adm, dateOfBirth: new Date("2014-03-05"), gender: "FEMALE" },
      });
      await db.guardian.create({ data: { schoolId: s.id, firstName: guardian, lastName: "Parentname", phone: "08030000000", relationship: "MOTHER" } });
      await db.user.create({
        data: { schoolId: s.id, firstName: staff, lastName: "Stafflast", email: `${staff}-${runId}@example.test`, passwordHash: "x" },
      });
    });
    return s.id;
  }

  beforeAll(async () => {
    a = await school("Check A", { first: `Zinachi${runId}`, last: "Okoro", adm: `A/${runId}/1` }, "Ifeyinwa", "Tolulope");
    b = await school("Check B", { first: `Oluwaseun${runId}`, last: "Adekunle", adm: `B/${runId}/1` }, "Kelechi", "Babatunde");
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma
        .$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
            await deleteSchoolRows(tx, id);
          },
          { timeout: 60_000 },
        )
        .catch(() => undefined);
    }
  });

  it("school A's students, guardians, staff and admission numbers are detected at A", async () => {
    const r = await loadQuestionRoster(a);
    expect(checkQuestion(`why is Zinachi${runId} not in a class`, r).categories).toEqual(["roster-name"]);
    expect(checkQuestion("Ifeyinwa did not get the invite", r).categories).toEqual(["roster-name"]);
    expect(checkQuestion("Tolulope cannot sign in", r).categories).toEqual(["roster-name"]);
    expect(checkQuestion(`result for A/${runId}/1`, r).categories).toEqual(["admission-number"]);
  });

  it("school B's people are not detected at school A (detection is per school: documented residual)", async () => {
    const r = await loadQuestionRoster(a);
    expect(checkQuestion(`why is Oluwaseun${runId} not in a class`, r).blocked).toBe(false);
    expect(checkQuestion("Kelechi did not get the invite", r).blocked).toBe(false);
    expect(checkQuestion(`result for B/${runId}/1`, r).blocked).toBe(false);
    const rb = await loadQuestionRoster(b);
    expect(checkQuestion("Kelechi did not get the invite", rb).blocked).toBe(true);
  });
});
