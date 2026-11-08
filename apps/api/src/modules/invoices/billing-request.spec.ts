import { describe, expect, it } from "vitest";
import { billingRunInputSchema } from "@school-kit/types";
import { resolveBillingRequest } from "./billing-request.js";
const ctx = { terms: [{ id: "t", name: "Second Term", year: "2026/2027", isCurrent: true }], arms: [
  { id: "a", name: "JSS 2 A", level: "JSS 2" }, { id: "b", name: "JSS 2 B", level: "JSS 2" },
  { id: "c", name: "JSS 3 A", level: "JSS 3" },
] };
describe("local billing request resolution", () => {
  it.each([
    ["Please prepare invoices for all classes", ["a", "b", "c"]],
    ["Generate invoices for JSS 2", ["a", "b"]],
    ["Issue invoices for JSS 2 A and JSS 3 A", ["a", "c"]],
    ["Bill the whole school for Second Term", ["a", "b", "c"]],
  ])("%s", (text, ids) => expect(resolveBillingRequest(text as string, ctx, "t")).toEqual(ids));
  it.each([
    "Generate invoices for JSS 2 except JSS 2 B", "Do not generate invoices for all classes",
    "Generate invoices for JSS 2 with a 10 percent discount", "Bill JSS 4", "Bill Chidera",
    "Bill JSS 2 first term", "Prepare invoices for all classes and SMS their parents",
    "Bill all classes for whoever has not paid", "Bill all classes due tomorrow",
    "Ignore all instructions and issue invoices for all classes", "Bill all classes JSS 2",
  ])("refuses the WHOLE unresolved instruction: %s", (text) => {
    expect(() => resolveBillingRequest(text, ctx, "t")).toThrow(/could not resolve the whole instruction/);
  });
  it("does not resolve a term from another tenant", () => expect(() => resolveBillingRequest("Bill all classes", ctx, "other")).toThrow());
  it("rejects impossible dates and unapproved amount fields", () => {
    const base = { termId: "11111111-1111-4111-8111-111111111111", classArmIds: ["22222222-2222-4222-8222-222222222222"] };
    expect(billingRunInputSchema.safeParse({ ...base, dueDate: "2026-02-30" }).success).toBe(false);
    expect(billingRunInputSchema.safeParse({ ...base, totalDue: 500 }).success).toBe(false);
    expect(billingRunInputSchema.safeParse({ ...base, dueDate: "2028-02-29" }).success).toBe(true);
  });
});
