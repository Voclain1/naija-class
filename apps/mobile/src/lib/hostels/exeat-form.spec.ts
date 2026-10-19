import { describe, expect, it } from "vitest";

import { blankExeatForm, exeatFormInput, type ExeatFormValues } from "./exeat-form";

const NOW = new Date("2026-10-18T10:00:00+01:00");
const filled = (over: Partial<ExeatFormValues> = {}): ExeatFormValues => ({
  ...blankExeatForm(NOW),
  reason: "Family wedding",
  collectorName: "Ngozi Okafor",
  collectorRelationship: "Mother",
  collectorPhone: "+234 803 000 0000",
  ...over,
});

describe("exeatFormInput (CP6b.3, shared in CP11.2)", () => {
  it("builds the request from the boxes, in Lagos time", () => {
    const r = exeatFormInput(filled());
    expect(r).toEqual({
      input: {
        outAt: "2026-10-18T08:00:00.000Z",
        backBy: "2026-10-18T17:00:00.000Z",
        reason: "Family wedding",
        collectorName: "Ngozi Okafor",
        collectorRelationship: "Mother",
        collectorPhone: "+234 803 000 0000",
      },
    });
  });

  it("says what to fix, one thing at a time", () => {
    expect(exeatFormInput(filled({ outDay: { day: "", month: "10", year: "2026" } }))).toEqual({ error: "Enter the days out and back in full." });
    expect(exeatFormInput(filled({ outTime: "9am" }))).toEqual({ error: "Enter the times like 09:00 or 18:30." });
    expect(exeatFormInput(filled({ collectorPhone: " " }))).toEqual({ error: "Fill in the reason and who will collect the child, with their phone number." });
    expect(exeatFormInput(filled({ backTime: "08:00" }))).toEqual({ error: "The time back must be after the time out." });
  });
});
