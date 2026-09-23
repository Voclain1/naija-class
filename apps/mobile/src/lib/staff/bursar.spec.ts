import type { DebtorDto, FinanceDashboardDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { filterDebtors, moneyBand, quickActions, showsMoneyBand } from "./bursar";
import { visibleStaffTabs } from "./tabs";

// The bursar's home (docs/modules/phone-for-every-role.md D1).

const BURSAR_PERMISSIONS = [
  "finance.dashboard.read",
  "finance.debtors.read",
  "finance.debtors.remind",
  "payment.read",
  "payment.record",
  "expense.create",
  "expense-category.read",
];

const DASHBOARD: FinanceDashboardDto = {
  termId: "t1",
  termName: "First Term 2026/2027",
  totalInvoiced: 5_000_000_00,
  totalCollected: 3_500_000_00,
  collectionRatePercent: 70,
  outstandingBalance: 1_500_000_00,
  debtorCount: 42,
  totalExpenses: 900_000_00,
  netPosition: 2_600_000_00,
};

describe("who gets the money band", () => {
  it("is someone whose day is money and who has no school dashboard", () => {
    expect(showsMoneyBand([{ key: "bursar" }], BURSAR_PERMISSIONS)).toBe(true);
  });

  it("is NOT an owner or admin — they already have the school band", () => {
    expect(showsMoneyBand([{ key: "owner" }], ["*"])).toBe(false);
    expect(showsMoneyBand([{ key: "admin" }], ["dashboard.read", "finance.dashboard.read"])).toBe(false);
  });

  it("is NOT a teacher", () => {
    expect(showsMoneyBand([{ key: "teacher" }], ["timetable.own.read"])).toBe(false);
  });

  it("keeps the bursar's tab bar to the dashboard — they teach nothing and approve nothing", () => {
    expect([...visibleStaffTabs([{ key: "bursar" }], BURSAR_PERMISSIONS)]).toEqual(["index"]);
  });
});

describe("the money band — only figures the server sent", () => {
  const band = moneyBand(DASHBOARD);

  it("leads with what was collected this term, against what was invoiced", () => {
    expect(band[0]).toMatchObject({
      key: "collected",
      value: "₦3,500,000.00",
      label: "Collected this term · 70% of ₦5,000,000.00",
      route: "/staff/collections",
    });
  });

  it("warns about what is outstanding, and says how many families", () => {
    expect(band[1]).toMatchObject({
      key: "outstanding",
      tone: "warning",
      value: "₦1,500,000.00",
      label: "Outstanding · 42 families owing",
      route: "/staff/collections/debtors",
    });
    expect(moneyBand({ ...DASHBOARD, debtorCount: 1 }).find((s) => s.key === "outstanding")?.label).toContain(
      "1 family owing",
    );
  });

  it("says so plainly when nothing is owed, with no warning tone and nowhere to go", () => {
    const settled = moneyBand({ ...DASHBOARD, debtorCount: 0, outstandingBalance: 0 });
    const outstanding = settled.find((s) => s.key === "outstanding");
    expect(outstanding).toMatchObject({ value: "Nothing owed" });
    expect(outstanding?.tone).toBeUndefined();
    expect(outstanding?.route).toBeUndefined();
  });

  it("shows expenses and the net position, and adds nothing up itself", () => {
    expect(band[2]).toMatchObject({ value: "₦900,000.00", label: "Expenses this term · ₦2,600,000.00 net" });
    // Every naira on the band is a field of the DTO, never a sum computed here.
    const values = band.map((s) => `${s.value} ${s.label}`).join(" ");
    for (const figure of ["₦3,500,000.00", "₦5,000,000.00", "₦1,500,000.00", "₦900,000.00", "₦2,600,000.00"]) {
      expect(values).toContain(figure);
    }
  });
});

describe("quick actions — the four things a bursar does all day", () => {
  it("are in the order they are done", () => {
    expect(quickActions(BURSAR_PERMISSIONS).map((a) => a.key)).toEqual([
      "record",
      "debtors",
      "receipts",
      "expense",
    ]);
  });

  it("drop anything the person cannot do", () => {
    expect(quickActions(["payment.read"]).map((a) => a.key)).toEqual(["receipts"]);
    expect(quickActions([])).toEqual([]);
  });

  it("start a payment from the debtor list — the one roster a bursar may read", () => {
    // The staff student directory is owner/admin only (StudentsService), so
    // "Record a payment" must not route there.
    const record = quickActions(BURSAR_PERMISSIONS).find((a) => a.key === "record");
    expect(record?.route).toBe("/staff/collections/debtors");
  });
});

describe("finding the family at the counter", () => {
  const rows = [
    { studentName: "Adaeze Okafor", admissionNumber: "GFA/2021/041", classArm: "JSS2 Blue" },
    { studentName: "David Issa", admissionNumber: "2026/JSS3/050", classArm: "JSS3 Main" },
  ] as unknown as DebtorDto[];

  it("matches a name, an admission number or a class, in any case", () => {
    expect(filterDebtors(rows, "okafor")).toHaveLength(1);
    expect(filterDebtors(rows, "2026/JSS3")).toHaveLength(1);
    expect(filterDebtors(rows, "jss")).toHaveLength(2);
    expect(filterDebtors(rows, "  ")).toHaveLength(2);
    expect(filterDebtors(rows, "nobody")).toHaveLength(0);
  });
});
