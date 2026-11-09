import { describe, expect, it } from "vitest";
import type { StudentDto } from "@school-kit/types";
import { correctionDraft, correctionChanges, displayCorrectionValue } from "./draft";
const student = { id: "student", admissionNumber: "A1", firstName: "Ada", middleName: "Mid", lastName: "Example", dateOfBirth: "2012-05-04T00:00:00.000Z", gender: "FEMALE", email: "ada@example.test" } as StudentDto;
describe("explicit correction patches", () => {
  it("starts with no changes and isolates the original snapshot", () => { const d = correctionDraft(student); d.values.firstName = "Adaeze"; expect(d.before.firstName).toBe("Ada"); expect(correctionChanges(correctionDraft(student))).toEqual({ changes: null, errors: [] }); });
  it("only sends changed fields and normalises email", () => { const d = correctionDraft(student); d.values.firstName = "Adaeze"; d.values.email = " NEW@EXAMPLE.TEST "; expect(correctionChanges(d)).toEqual({ changes: { firstName: "Adaeze", email: "new@example.test" }, errors: [] }); });
  it("does not turn a blank optional input into an implicit clear", () => { const d = correctionDraft(student); d.values.email = ""; expect(correctionChanges(d).errors).toEqual(["Tick Clear email to remove its current value."]); });
  it("explicit clears are null; unaffected fields are absent", () => { const d = correctionDraft(student); d.clearEmail = true; d.clearMiddleName = true; expect(correctionChanges(d).changes).toEqual({ middleName: null, email: null }); });
  it("does not clear a field that was already empty", () => { const d = correctionDraft({ ...student, email: null, middleName: null }); d.clearEmail = true; expect(correctionChanges(d).changes).toBeNull(); });
  it.each(["2013-02-29", "2012-02-31", "", "31/12/2012"])("rejects invalid calendar date %s", (date) => { const d = correctionDraft(student); d.values.dateOfBirth = date; expect(correctionChanges(d).errors.length).toBeGreaterThan(0); });
  it.each(["firstName", "lastName"] as const)("required %s cannot be cleared", (field) => { const d = correctionDraft(student); d.values[field] = ""; expect(correctionChanges(d).errors.length).toBeGreaterThan(0); });
  it("renders calendar dates and empty values clearly", () => { expect(displayCorrectionValue("dateOfBirth", "2012-05-04")).toBe("04/05/2012"); expect(displayCorrectionValue("email", null)).toBe("Not recorded"); });
});
