import { fileURLToPath } from "node:url";

import { basePrisma, withTenant } from "@school-kit/db";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

// PR #523 review fixes, in the browser against the real API
// (docs/modules/assistant-workspace.md):
//   1. a conversational revision makes an open preview unapprovable and needs
//      a fresh server preview (intake and corrections; races with confirming);
//   4. named student lookup: on the model path (the model faked at the HTTP
//      boundary, the matches from the REAL server resolver) and on the device.
// As in assistant-orchestration.spec.ts, the model's own understanding is the
// live eval's job; these test what the panel and the server do.

const SHOTS = fileURLToPath(new URL("../../docs/reviews/assistant-workspace/", import.meta.url));
const ON = { "assistant-workspace": true, "assistant-model-routing": true, "assistant-billing": true, "reminder-campaigns": true, "student-intake": true, "student-corrections": true };
type Turn = { messages: { role: string; text: string }[]; tasks: Record<string, unknown>[]; students: Record<string, unknown>[] };

async function setup(browser: Browser, switches: Record<string, boolean> = ON) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2B", code: `b-${suffix}`.slice(0, 20) }, { name: "JSS 2C", code: `c-${suffix}`.slice(0, 20) }] });
  const scaffold = await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id });
  await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: switches } });
  return { admin, structure, scaffold, page: admin.page };
}

async function fakeModel(page: Page, respond: (body: Turn, n: number) => Promise<Record<string, unknown>> | Record<string, unknown>, delayMs = 0) {
  const sent: Turn[] = [];
  await page.route("**/assistant/workspace/capabilities", async (route: Route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), modelRouting: { available: true, reason: null } } });
  });
  await page.route("**/assistant/workspace/turn", async (route: Route) => {
    const body = route.request().postDataJSON() as Turn;
    sent.push(body);
    const reply = await respond(body, sent.length);
    if (delayMs && sent.length > 1) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ json: { outcome: "answered", reply: "", actions: [], blockedCategories: [], toolsUsed: [], ...reply } });
  });
  return sent;
}

async function open(page: Page) {
  await page.getByRole("button", { name: "Open SchoolKit Assistant" }).click();
  const panel = page.getByRole("dialog", { name: "SchoolKit Assistant" });
  await expect(panel).toBeVisible();
  return panel;
}
async function ask(page: Page, text: string) {
  const box = page.getByRole("textbox", { name: "Describe a task" });
  await box.fill(text);
  await box.press("Enter");
}
const PREVIEW = /^Show the server['’]s preview$/;
const BEFORE_AFTER = /^Show the server['’]s before and after$/;

async function fillStudent(card: ReturnType<Page["getByRole"]>, first: string, last: string) {
  await card.getByRole("textbox", { name: "Student 1 first name" }).fill(first);
  await card.getByRole("textbox", { name: "Student 1 last name" }).fill(last);
  await card.getByLabel("Student 1 date of birth").fill("2014-02-03");
  await card.getByRole("combobox", { name: "Student 1 gender" }).selectOption("FEMALE");
  await card.getByRole("textbox", { name: "Student 1 admission number (optional)" }).fill(`RV-${uniqueSuffix()}`);
}

test("intake: a revised class makes the open preview unconfirmable (even ticked); rows are kept and a fresh preview is needed", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser);
  try {
    const [b, c] = structure.arms;
    await fakeModel(page, (_body, n) => ({
      reply: n === 1 ? "Type the students into the form." : "Moved to JSS 2C. Check the new preview.",
      actions: [{ kind: "intake", handle: "t1", termId: structure.termId, classArmId: n === 1 ? b!.id : c!.id, placeLater: false }],
    }));
    await page.goto("/students");
    const panel = await open(page);
    await ask(page, "Add a new student to JSS 2B");
    const card = panel.getByRole("region", { name: "Add and enrol students" });
    await fillStudent(card, "Nneka", `Revision${uniqueSuffix()}`);
    await card.getByRole("button", { name: PREVIEW }).click();
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    await expect(card.getByText(/JSS 2B/)).toBeVisible();
    await card.getByRole("checkbox", { name: /I checked these 1 students/ }).check();

    // The revision: the old preview and its tick are gone; the typed row is kept.
    await ask(page, "Actually put her in JSS 2C");
    await expect(panel.getByText("Moved to JSS 2C.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Confirm and save students" })).toHaveCount(0);
    await expect(card.getByRole("textbox", { name: "Student 1 first name" })).toHaveValue("Nneka");
    await card.getByRole("button", { name: PREVIEW }).click();
    await expect(card.getByText(/JSS 2C/)).toBeVisible();
    await expect(card.getByRole("checkbox", { name: /I checked these 1 students/ })).not.toBeChecked();
    await card.getByRole("checkbox", { name: /I checked these 1 students/ }).check();
    await card.getByRole("button", { name: "Confirm and save students" }).click();
    await expect(panel.getByText(/Saved 1 student, 1 placed in their class/)).toBeVisible();
    const enrolled = await withTenant(admin.schoolId, (db) => db.enrollment.findFirst({ where: { schoolId: admin.schoolId, student: { firstName: "Nneka" } }, select: { classArmId: true } }));
    expect(enrolled?.classArmId).toBe(c!.id);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("intake race: confirming first, then the revision arrives: the reviewed preview is saved and the late change is not applied", async ({ browser }) => {
  const { admin, page, structure } = await setup(browser);
  try {
    const [b, c] = structure.arms;
    await fakeModel(page, (_body, n) => ({
      reply: n === 1 ? "Type the students into the form." : "Moved to JSS 2C.",
      actions: [{ kind: "intake", handle: "t1", termId: structure.termId, classArmId: n === 1 ? b!.id : c!.id, placeLater: false }],
    }), 2_500);
    await page.goto("/students");
    const panel = await open(page);
    await ask(page, "Add a new student to JSS 2B");
    const card = panel.getByRole("region", { name: "Add and enrol students" });
    await fillStudent(card, "Ifunanya", `Race${uniqueSuffix()}`);
    await card.getByRole("button", { name: PREVIEW }).click();
    await card.getByRole("checkbox", { name: /I checked these 1 students/ }).check();
    await ask(page, "Actually put her in JSS 2C"); // answered after 2.5 s
    await card.getByRole("button", { name: "Confirm and save students" }).click();
    await expect(panel.getByText(/Saved 1 student/)).toBeVisible();
    await expect(panel.getByText(/so that change was not applied/)).toBeVisible();
    const enrolled = await withTenant(admin.schoolId, (db) => db.enrollment.findFirst({ where: { schoolId: admin.schoolId, student: { firstName: "Ifunanya" } }, select: { classArmId: true } }));
    expect(enrolled?.classArmId).toBe(b!.id);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("corrections: revising the fields while the before-and-after is open needs a new review; picked students are kept", async ({ browser }) => {
  const { admin, page, scaffold } = await setup(browser);
  try {
    const target = scaffold.students[0]!;
    await fakeModel(page, (body, n) => {
      const t = body.tasks.find((x) => x.workflow === "corrections");
      return { reply: n === 1 ? "Find the student and type the new email." : "The card now changes the last name instead.", actions: [{ kind: "corrections", handle: t?.handle ?? "t1", fields: n === 1 ? ["email"] : ["email", "lastName"] }] };
    });
    await page.goto("/students");
    const panel = await open(page);
    await ask(page, "Correct a student's email");
    const card = panel.getByRole("region", { name: "Correct student records" });
    await card.getByRole("textbox", { name: /Find a student/ }).fill(target.admissionNumber);
    await card.getByRole("button", { name: new RegExp(target.admissionNumber) }).click();
    await card.getByRole("textbox", { name: /New email for/ }).fill("fixed@example.test");
    await card.getByRole("button", { name: BEFORE_AFTER }).click();
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    await card.getByRole("checkbox", { name: /I checked the before and after/ }).check();

    await ask(page, "Also fix the last name");
    await expect(panel.getByText("The card now changes the last name instead.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Confirm corrections" })).toHaveCount(0);
    await expect(card.getByText(new RegExp(target.admissionNumber))).toBeVisible(); // still picked
    await card.getByRole("textbox", { name: /New last name for/ }).fill(`${target.lastName}x`);
    await card.getByRole("button", { name: BEFORE_AFTER }).click();
    await expect(card.getByRole("checkbox", { name: /I checked the before and after/ })).not.toBeChecked();
    await card.getByRole("checkbox", { name: /I checked the before and after/ }).check();
    await card.getByRole("button", { name: "Confirm corrections" }).click();
    await expect(card.getByText(/Applied: 1 record corrected/)).toBeVisible();
    const after = await withTenant(admin.schoolId, (db) => db.student.findUniqueOrThrow({ where: { id: target.id } }));
    expect(after).toMatchObject({ lastName: `${target.lastName}x`, email: "fixed@example.test" });
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("named lookup with the model: the server resolves the name, the card shows the student, records come from their own endpoints; names stay off the wire", async ({ browser }) => {
  const { admin, page, scaffold } = await setup(browser);
  try {
    const target = scaffold.students[0]!; // Adaeze Okonkwo, in JSS 2B
    const sent = await fakeModel(page, async (_body, n) => {
      if (n === 1) {
        // What the server's find_student does, through the REAL resolver.
        const found = await (await admin.api.post("assistant/workspace/students/find", { data: { name: target.firstName } })).json();
        return { reply: "Here she is.", actions: [{ kind: "students", asked: target.firstName, status: found.status, matches: found.matches.map((m: Record<string, unknown>, i: number) => ({ ...m, handle: `s${i + 1}` })) }] };
      }
      return { reply: "Her attendance is in the card.", actions: [{ kind: "student-record", handle: "s1", studentId: target.id, section: "attendance" }] };
    });
    await page.goto("/dashboard");
    const panel = await open(page);
    await ask(page, `Show ${target.firstName} in JSS 2B`);
    await expect(panel.getByRole("region", { name: "Students" }).getByText(`${target.firstName} ${target.lastName}`)).toBeVisible();
    const record = panel.getByRole("region", { name: "Student record" }).last();
    await expect(record.getByText(`Admission no. ${target.admissionNumber}`)).toBeVisible();
    await ask(page, "Show her attendance");
    await expect(panel.getByRole("region", { name: "Student record" }).last().getByText(/No attendance has been recorded|Days marked/)).toBeVisible();
    await panel.getByRole("region", { name: "Student record" }).last().getByRole("button", { name: "Released results" }).click();
    await expect(panel.getByText(/No released results for this student this term yet/)).toBeVisible();
    await expect(panel.getByText("Behaviour, health and contact details are not shown here.").first()).toBeVisible();
    // Later turns carried handles; the rendered last name and admission number never went back.
    expect(sent[1]!.students).toEqual([expect.objectContaining({ handle: "s1", studentId: target.id, selected: true })]);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(target.lastName);
    expect(wire).not.toContain(target.admissionNumber);
    await page.screenshot({ path: `${SHOTS}desktop-student-lookup.png` });
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("named lookup on the device (no model): the request opens a search, the server finds the student, the record opens", async ({ browser }) => {
  const { admin, page, scaffold } = await setup(browser, { ...ON, "assistant-model-routing": false });
  try {
    const target = scaffold.students[0]!;
    let turns = 0;
    await page.route("**/assistant/workspace/turn", (r) => { turns += 1; return r.abort(); });
    await page.goto("/dashboard");
    const panel = await open(page);
    await ask(page, `Show ${target.firstName} in JSS 2B`);
    const search = panel.getByRole("region", { name: "Find a student" });
    await expect(search.getByRole("textbox", { name: "Student’s name" })).toHaveValue(target.firstName);
    await search.getByRole("button", { name: "Search" }).click();
    await expect(panel.getByRole("region", { name: "Student record" }).getByText(`${target.firstName} ${target.lastName}`)).toBeVisible();
    expect(turns).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}phone-student-lookup.png` });
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
