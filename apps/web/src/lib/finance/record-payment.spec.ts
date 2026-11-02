import type { InvoiceDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { billLabel, groupBillsByStudent, nairaInput, parseAmount } from "./record-payment";

function bill(over: Partial<InvoiceDto>): InvoiceDto {
  return {
    id: "inv",
    schoolId: "s",
    studentId: "st1",
    studentName: "Adaeze Okafor",
    admissionNumber: "ADM/001",
    termId: "t",
    academicYearId: "y",
    classArmId: null,
    status: "ISSUED",
    sequence: 0,
    kind: "TERM",
    items: [],
    totalAmount: 0,
    totalDiscount: 0,
    totalDue: 5_000_000,
    totalPaid: 0,
    dueDate: null,
    issuedAt: null,
    issuedBy: null,
    issuedByName: null,
    createdAt: new Date("2026-09-01"),
    updatedAt: new Date("2026-09-01"),
    ...over,
  } as InvoiceDto;
}

describe("groupBillsByStudent", () => {
  it("puts a student's bills together, oldest first, and sums what is owed", () => {
    const groups = groupBillsByStudent([
      bill({ id: "b", sequence: 1, createdAt: new Date("2026-10-01"), totalDue: 1_000_000 }),
      bill({ id: "a", createdAt: new Date("2026-09-01"), totalPaid: 2_000_000 }),
      bill({ id: "c", studentId: "st2", studentName: "Bayo Bello", admissionNumber: "ADM/002" }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Adaeze Okafor", "Bayo Bello"]);
    expect(groups[0]!.bills.map((b) => b.id)).toEqual(["a", "b"]);
    expect(groups[0]!.owed).toBe(3_000_000 + 1_000_000);
  });

  it("leaves out bills with nothing left to pay", () => {
    const groups = groupBillsByStudent([bill({ totalPaid: 5_000_000 })]);
    expect(groups).toEqual([]);
  });

  it("never shows a raw id when the name is missing", () => {
    const [g] = groupBillsByStudent([bill({ studentName: null })]);
    expect(g!.name).toBe("Unknown student");
  });
});

describe("billLabel", () => {
  it("names the term bill and numbered extra bills", () => {
    expect(billLabel({ sequence: 0 })).toBe("Term bill");
    expect(billLabel({ sequence: 2 })).toBe("Extra bill 2");
  });
});

describe("parseAmount", () => {
  it("accepts naira with commas and a ₦ sign", () => {
    expect(parseAmount("₦25,000", 5_000_000)).toEqual({ kobo: 2_500_000 });
    expect(parseAmount("25000.50", 5_000_000)).toEqual({ kobo: 2_500_050 });
  });

  it("refuses empty, zero, odd input and more than the balance", () => {
    expect(parseAmount("", 100)).toHaveProperty("error");
    expect(parseAmount("0", 100)).toHaveProperty("error");
    expect(parseAmount("12.345", 5_000_000)).toHaveProperty("error");
    expect(parseAmount("abc", 5_000_000)).toHaveProperty("error");
    expect(parseAmount("50001", 5_000_000)).toEqual({ error: "That is more than this bill's balance." });
  });

  it("accepts exactly the balance (Paid in full)", () => {
    expect(parseAmount(nairaInput(5_000_050), 5_000_050)).toEqual({ kobo: 5_000_050 });
  });
});

describe("nairaInput", () => {
  it("drops .00 and keeps kobo", () => {
    expect(nairaInput(2_500_000)).toBe("25000");
    expect(nairaInput(2_500_050)).toBe("25000.50");
  });
});
