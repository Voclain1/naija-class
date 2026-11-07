import { expect, test } from "@playwright/test";
import {
  loginAsAdmin,
  setupAcademicStructure,
  uniqueSuffix,
} from "../fixtures/index.js";

test("Free report details save through the staff editor and survive a draft rebuild", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser);
  try {
    const structure = await setupAcademicStructure(admin.api);
    const input = {
      termId: structure.termId,
      classArmId: structure.arms[0]!.id,
    };
    const added = await admin.api.post("students/bulk", {
      data: {
        enrollment: input,
        students: [
          {
            admissionNumber: `RP-${uniqueSuffix()}`,
            firstName: "Sample",
            lastName: "Pupil",
            dateOfBirth: "2015-01-01",
            gender: "FEMALE",
          },
        ],
      },
    });
    expect(added.ok(), await added.text()).toBe(true);
    const built = await admin.api.post("report-cards/arm/build", {
      data: input,
    });
    expect(built.ok(), await built.text()).toBe(true);
    const board = await admin.api.get(
      `report-cards?termId=${input.termId}&classArmId=${input.classArmId}`,
    );
    const id = (await board.json()).data[0].reportCard.id as string;
    await admin.page.goto(`/report-cards/${input.classArmId}/${id}`);
    await admin.page
      .getByLabel("Report level", { exact: true })
      .selectOption("PRIMARY");
    await admin.page
      .getByLabel("Character & attitude: Honesty", { exact: true })
      .selectOption("5");
    await admin.page
      .getByLabel("Practical skills: Handwriting", { exact: true })
      .selectOption("4");
    await admin.page
      .getByLabel("Next term begins", { exact: true })
      .fill("2027-01-11");
    await admin.page
      .getByLabel("Form teacher’s name", { exact: true })
      .fill("Sample Teacher");
    await admin.page
      .getByRole("button", { name: "Save report details", exact: true })
      .click();
    await expect(
      admin.page.getByRole("button", {
        name: "Save report details",
        exact: true,
      }),
    ).toBeDisabled();
    await admin.page.reload();
    await expect(
      admin.page.getByLabel("Character & attitude: Honesty", { exact: true }),
    ).toHaveValue("5");
    await expect(
      admin.page.getByLabel("Practical skills: Handwriting", { exact: true }),
    ).toHaveValue("4");
    const rebuilt = await admin.api.post("report-cards/arm/build", {
      data: input,
    });
    expect(rebuilt.ok(), await rebuilt.text()).toBe(true);
    const detail = await admin.api.get(`report-cards/${id}`);
    expect((await detail.json()).reportCard.reportProfile).toMatchObject({
      level: "PRIMARY",
      affective: { Honesty: 5 },
      psychomotor: { Handwriting: 4 },
      nextTermDate: "2027-01-11",
      teacherName: "Sample Teacher",
    });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
