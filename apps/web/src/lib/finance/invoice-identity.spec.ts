import { describe, expect, it } from "vitest";

import {
  invoiceReference,
  studentDisplayName,
  studentSecondaryLabel,
  type InvoiceIdentityFields,
} from "./invoice-identity";

// F-04 regression suite: the invoice list must never identify a child by a
// UUID, in any state — including the degraded ones.

const uuid = "3d1b9c40-7a55-4a11-bd21-0c4f9a2e1a33";

function row(overrides: Partial<InvoiceIdentityFields> = {}): InvoiceIdentityFields {
  return {
    studentId: uuid,
    studentName: "Oluwaseun Adebayo-Ogundimu",
    admissionNumber: "SKA/2024/0118",
    ...overrides,
  };
}

describe("studentDisplayName", () => {
  it("shows the student's full name", () => {
    expect(studentDisplayName(row())).toBe("Oluwaseun Adebayo-Ogundimu");
  });

  it("never falls back to the student id, even when the name is missing", () => {
    const unnamed = studentDisplayName(row({ studentName: null }));

    expect(unnamed).not.toContain(uuid);
    expect(unnamed).not.toContain(uuid.slice(0, 8));
    expect(unnamed).toBe("Unnamed student (SKA/2024/0118)");
  });

  it("never falls back to the student id when name AND admission number are missing", () => {
    const unknown = studentDisplayName(row({ studentName: null, admissionNumber: null }));

    expect(unknown).toBe("Unknown student");
    expect(unknown).not.toContain(uuid);
    expect(unknown).not.toContain(uuid.slice(0, 8));
  });

  it("treats a whitespace-only name as missing rather than rendering a blank cell", () => {
    expect(studentDisplayName(row({ studentName: "   " }))).toBe(
      "Unnamed student (SKA/2024/0118)",
    );
  });
});

describe("studentSecondaryLabel", () => {
  it("returns the admission number as secondary identity", () => {
    expect(studentSecondaryLabel(row())).toBe("SKA/2024/0118");
  });

  it("returns null when there is no admission number, so no empty line is rendered", () => {
    expect(studentSecondaryLabel(row({ admissionNumber: null }))).toBeNull();
  });

  it("does not repeat the admission number already shown in the primary label", () => {
    expect(studentSecondaryLabel(row({ studentName: null }))).toBeNull();
  });
});

describe("invoiceReference", () => {
  it("produces a short upper-cased reference a bursar can read aloud", () => {
    expect(invoiceReference("9f2c1b7e-0f21-4a3a-9c88-2b0d51ee77aa")).toBe("9F2C1B7E");
  });
});
