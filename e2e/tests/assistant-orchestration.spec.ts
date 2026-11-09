import { fileURLToPath } from "node:url";

import { basePrisma, withTenant } from "@school-kit/db";
import { expect, test, type Browser, type Page, type Route } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiListInvoices, setupFinanceScaffold } from "../fixtures/finance.js";

// The SchoolKit Assistant with MODEL ORCHESTRATION, in the browser against the
// real API (docs/modules/assistant-workspace.md, "Model orchestration").
//
// THE MODEL IS FAKED AT THE HTTP BOUNDARY: POST /assistant/workspace/turn is
// answered by this test with actions that point at REAL server objects (a
// billing run this test prepared through the real API). Everything after that
// is real: the card reads the run, shows the server's figures, and approval
// goes through the existing endpoint. The model's own understanding is the live
// eval's job, and the server's tool loop is tested against PostgreSQL in
// apps/api; this spec tests what the PANEL does with a turn, and that what it
// sends carries no names.
//
// Capabilities are patched to report model routing available, because CI has
// no model key (and the gate also needs AI configured for the school).

const SHOTS = fileURLToPath(new URL("../../docs/reviews/assistant-workspace/", import.meta.url));
const ON = { "assistant-workspace": true, "assistant-model-routing": true, "assistant-billing": true, "reminder-campaigns": true, "student-intake": true, "student-corrections": true };

type Turn = { messages: { role: string; text: string }[]; tasks: Record<string, unknown>[] };
type Reply = Record<string, unknown>;

async function setup(browser: Browser) {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, { arms: [{ name: "JSS 2B", code: `b-${suffix}`.slice(0, 20) }] });
  const scaffold = await setupFinanceScaffold(admin.api, { suffix, ...structure, classArmId: structure.arms[0]!.id });
  await basePrisma.school.update({ where: { id: admin.schoolId }, data: { featureSwitches: ON } });
  return { admin, structure, scaffold, page: admin.page };
}

/** Model routing reported available; every turn answered by `respond`, which also sees what the panel sent. */
async function fakeModel(page: Page, respond: (body: Turn, n: number) => Promise<Reply> | Reply) {
  const sent: Turn[] = [];
  await page.route("**/assistant/workspace/capabilities", async (route: Route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, modelRouting: { available: true, reason: null } } });
  });
  await page.route("**/assistant/workspace/turn", async (route: Route) => {
    const body = route.request().postDataJSON() as Turn;
    sent.push(body);
    const reply = await respond(body, sent.length);
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

const SERVER_PREVIEW = /^Show the server['’]s preview$/;

test("a model turn prepares invoices, a follow-up revises the same card, 'yes' approves nothing, and the person approves the new preview", async ({ browser }) => {
  const { admin, page, structure, scaffold } = await setup(browser);
  const names = scaffold.students.flatMap((s) => [s.firstName, s.lastName, s.admissionNumber]);
  try {
    // Two real previews, as the server's prepare_invoices tool would make them.
    const prepare = async () => {
      const res = await admin.api.post("assistant/billing/runs", { data: { termId: structure.termId, classArmIds: [structure.arms[0]!.id] } });
      expect(res.ok()).toBe(true);
      return (await res.json()) as { id: string };
    };
    const runs: string[] = [];
    const sent = await fakeModel(page, async (_body, n) => {
      if (n === 1 || n === 2) {
        const run = await prepare();
        runs.push(run.id);
        return {
          reply: n === 1 ? "The preview for JSS 2B is ready in the card. Check it and approve there." : "Updated: a fresh preview is in the card. Review it again.",
          actions: [{ kind: "invoices", handle: "t1", termId: structure.termId, classArmIds: [structure.arms[0]!.id], runId: run.id, problem: null }],
          toolsUsed: ["prepare_invoices"],
        };
      }
      return { reply: "I can't approve anything. Tick the box on the card and press the button." };
    });

    await page.goto("/finance/invoices");
    const panel = await open(page);
    await expect(panel.getByText(/sent to SchoolKit’s AI model/)).toBeVisible();
    await ask(page, "Bill my JSS two class for this term");
    const card = panel.getByRole("region", { name: "Term invoices" });
    await expect(card.getByText("Awaiting your approval")).toBeVisible();
    await expect(panel.getByText("The preview for JSS 2B is ready in the card.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Approve and issue invoices" })).toBeDisabled();
    expect((await apiListInvoices(admin.api, { termId: structure.termId })).total).toBe(0);
    await page.screenshot({ path: `${SHOTS}desktop-model-invoice.png` });

    // A follow-up revises the SAME task: one card, a new run, the box unticked again.
    await card.getByRole("checkbox", { name: /I checked this preview/ }).check();
    await ask(page, "Actually use the term's default due date");
    await expect(panel.getByText("Updated: a fresh preview is in the card.")).toBeVisible();
    await expect(card.getByRole("checkbox", { name: /I checked this preview/ })).not.toBeChecked();
    await expect(panel.getByRole("region", { name: "Term invoices" })).toHaveCount(1);
    expect(sent[1]!.tasks).toEqual([expect.objectContaining({ handle: "t1", workflow: "invoices", status: "review", runId: runs[0] })]);
    expect(sent[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);

    // Conversational wording is not approval.
    await ask(page, "yes, go ahead and issue them");
    await expect(panel.getByText(/Tick the box on the card/)).toBeVisible();
    expect((await apiListInvoices(admin.api, { termId: structure.termId })).total).toBe(0);

    // The person approves the NEW preview with the card's own control.
    await card.getByRole("checkbox", { name: /I checked this preview/ }).check();
    await card.getByRole("button", { name: "Approve and issue invoices" }).click();
    await expect(card.getByText(/Done: 3 invoices issued/)).toBeVisible();
    const done = await admin.api.get(`assistant/billing/runs/${runs[1]}`);
    expect((await done.json()).status).toBe("COMPLETED");
    expect((await admin.api.get(`assistant/billing/runs/${runs[0]}`).then((r) => r.json())).status).toBe("PENDING");
    expect((await apiListInvoices(admin.api, { termId: structure.termId })).total).toBe(3);

    // What the panel sent: text and structure, never a student's name or number.
    const wire = JSON.stringify(sent);
    for (const n of names) expect(wire).not.toContain(n);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("a reminders plan selects the matching families and asks the server for its preview; confirming stays the person's", async ({ browser }) => {
  const { admin, page, structure, scaffold } = await setup(browser);
  try {
    expect((await admin.api.post("invoices/arm/generate", { data: { termId: structure.termId, classArmId: structure.arms[0]!.id } })).ok()).toBe(true);
    expect((await admin.api.put("notification-preferences", { data: { emailEnabled: false, smsEnabled: false, pushEnabled: true } })).ok()).toBe(true);
    expect((await admin.api.post(`students/${scaffold.students[0]!.id}/guardians/new`, { data: { firstName: "Test", lastName: "Guardian", relationship: "MOTHER", phone: "+2348000000000", isPrimary: true } })).ok()).toBe(true);
    await fakeModel(page, () => ({
      reply: "I've asked the server for a preview of families who owe. Check it and confirm in the card.",
      actions: [{ kind: "reminders", handle: "t1", termId: structure.termId, classArmId: null, className: null, overdueOnly: false, includePaymentPlans: false, autoPreview: true }],
      toolsUsed: ["plan_reminders"],
    }));
    await page.goto("/finance/debtors");
    const panel = await open(page);
    await ask(page, "Chase the families who still owe this term, leave out anyone on a payment plan");
    const card = panel.getByRole("region", { name: "Fee reminders" });
    await expect(card.getByText("Awaiting your confirmation")).toBeVisible();
    const count = () => withTenant(admin.schoolId, (db) => db.reminderCampaign.count({ where: { schoolId: admin.schoolId } }));
    expect(await count()).toBe(0);
    await card.getByRole("checkbox", { name: /I checked this preview/ }).check();
    await card.getByRole("button", { name: "Confirm and start sending" }).click();
    await expect(panel.getByRole("region", { name: "Fee reminder campaign" })).toBeVisible();
    expect(await count()).toBe(1);
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("pasted rows never reach the model; intake and correction plans prefill the forms and the panel sends counts, not names", async ({ browser }) => {
  const { admin, page, structure, scaffold } = await setup(browser);
  try {
    const sent = await fakeModel(page, (body) => {
      const corrections = body.tasks.find((t) => t.workflow === "corrections");
      if (corrections) return { reply: "The card will change the email. Type the new address there.", actions: [{ kind: "corrections", handle: corrections.handle, fields: ["email"] }] };
      return { reply: "Students go into the form below.", actions: [{ kind: "intake", handle: "t2", termId: structure.termId, classArmId: structure.arms[0]!.id, placeLater: false }] };
    });
    await page.goto("/students");
    const panel = await open(page);

    // Rows pasted into the chat go to the intake form on this device.
    const box = page.getByRole("textbox", { name: "Describe a task" });
    await box.fill("Amaka,Nwosu,2014-02-03,F\nTunde,Bello,2013-11-20,M");
    await box.press("Enter");
    const intake = panel.getByRole("region", { name: "Add and enrol students" });
    await expect(intake.getByRole("textbox", { name: "Student 2 first name" })).toHaveValue("Tunde");
    expect(sent).toHaveLength(0);
    await expect(panel.getByText("(pasted rows: kept on this device)")).toBeVisible();

    // A correction: the person picks the student in the card; the turn only learns "1 selected".
    await panel.getByRole("button", { name: "Correct student records" }).first().click();
    const corr = panel.getByRole("region", { name: "Correct student records" });
    const target = scaffold.students[0]!;
    await corr.getByRole("textbox", { name: /Find a student/ }).fill(target.admissionNumber);
    await corr.getByRole("button", { name: new RegExp(target.admissionNumber) }).click();
    await ask(page, "Correct the email for this selected student");
    await expect(panel.getByText("The card will change the email.")).toBeVisible();
    await expect(corr.getByRole("textbox", { name: /New email for/ })).toBeVisible();
    const last = sent.at(-1)!;
    expect(last.tasks).toEqual(expect.arrayContaining([expect.objectContaining({ workflow: "corrections", studentCount: 1, status: "editing" })]));
    const wire = JSON.stringify(sent);
    for (const s of scaffold.students) for (const v of [s.firstName, s.lastName, s.admissionNumber]) expect(wire).not.toContain(v);
    expect(wire).not.toContain("Tunde");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${SHOTS}phone-model-conversation.png` });
  } finally { await admin.context.close(); await admin.api.dispose(); }
});

test("blocked text, an outage and a lost answer: nothing approved, nothing replayed, and the person is told plainly", async ({ browser }) => {
  const { admin, page } = await setup(browser);
  try {
    let calls = 0;
    await page.route("**/assistant/workspace/capabilities", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), modelRouting: { available: true, reason: null } } });
    });
    await page.route("**/assistant/workspace/turn", async (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ json: { outcome: "blocked", reply: "", actions: [], blockedCategories: ["roster-name"], toolsUsed: [] } });
      if (calls === 2) return route.fulfill({ status: 503, json: { error: { code: "X", message: "down" } } });
      return route.abort("failed");
    });
    await page.goto("/dashboard");
    const panel = await open(page);
    await ask(page, "Correct the surname for Adaeze");
    await expect(panel.getByText(/didn’t send that to the AI because it seems to include a name of someone at your school/)).toBeVisible();
    await expect(panel.getByRole("region", { name: "Correct student records" })).toBeVisible();
    await ask(page, "Prepare invoices");
    await expect(panel.getByText(/Nothing was approved or changed/).first()).toBeVisible();
    await ask(page, "Prepare invoices again");
    await expect(panel.getByText(/Nothing was approved or changed/)).toHaveCount(2);
    expect(calls).toBe(3); // one request per send: nothing retried
  } finally { await admin.context.close(); await admin.api.dispose(); }
});
