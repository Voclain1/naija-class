import { describe, expect, it } from "vitest";

import type { PreviewLineDto } from "@school-kit/types";

import {
  buildGenerateConfirmation,
  generateReducer,
  initialGenerateState,
  isZeroImpact,
  shouldSendGenerateRequest,
  summariseGeneration,
  zeroImpactReason,
  type GenerateState,
} from "./invoice-generate.js";

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

function line(over: Partial<PreviewLineDto> = {}): PreviewLineDto {
  return {
    studentId: over.studentId ?? "s1",
    studentName: over.studentName ?? "Adaeze Okonkwo",
    admissionNumber: over.admissionNumber ?? "SKA/0001",
    feeItemCount: over.feeItemCount ?? 1,
    totalAmount: over.totalAmount ?? 45_000_00,
    totalDiscount: over.totalDiscount ?? 0,
    totalDue: over.totalDue ?? 45_000_00,
    alreadyInvoiced: over.alreadyInvoiced ?? false,
  };
}

describe("summariseGeneration — the count and total must describe what will ACTUALLY be created", () => {
  it("counts and totals only students who are not already invoiced", () => {
    const scope = summariseGeneration(
      [
        line({ studentId: "a" }),
        line({ studentId: "b" }),
        line({ studentId: "c", alreadyInvoiced: true }),
      ],
      "JSS2 Gold",
      "First Term",
    );
    expect(scope.billableCount).toBe(2);
    expect(scope.skippedCount).toBe(1);
    // NOT 135,000 — summing every preview line is precisely the pre-F-34 bug.
    expect(scope.billableTotalDue).toBe(90_000_00);
  });

  it("an arm that has already been fully billed summarises as zero-impact", () => {
    const scope = summariseGeneration(
      [line({ studentId: "a", alreadyInvoiced: true }), line({ studentId: "b", alreadyInvoiced: true })],
      "JSS2 Gold",
      "First Term",
    );
    expect(scope.billableCount).toBe(0);
    expect(scope.billableTotalDue).toBe(0);
    expect(isZeroImpact(scope)).toBe(true);
    expect(zeroImpactReason(scope)).toBe("all-already-invoiced");
  });

  it("an empty arm is zero-impact for a different, separately-worded reason", () => {
    const scope = summariseGeneration([], "JSS2 Gold", "First Term");
    expect(isZeroImpact(scope)).toBe(true);
    expect(zeroImpactReason(scope)).toBe("no-students");
  });

  it("carries the human arm and term names, never ids", () => {
    const scope = summariseGeneration([line()], "JSS2 Gold", "First Term");
    expect(scope.armName).toBe("JSS2 Gold");
    expect(scope.termName).toBe("First Term");
  });
});

describe("buildGenerateConfirmation — says what will be created, for whom, for which term", () => {
  it("states count, arm, total and term in one sentence", () => {
    const scope = summariseGeneration([line({ studentId: "a" }), line({ studentId: "b" })], "JSS2 Gold", "First Term");
    const c = buildGenerateConfirmation(scope, naira);
    expect(c.subject).toContain("2 students");
    expect(c.subject).toContain("JSS2 Gold");
    expect(c.subject).toContain("First Term");
    expect(c.subject).toContain("90,000.00");
  });

  it("singularises a one-student run", () => {
    const c = buildGenerateConfirmation(summariseGeneration([line()], "JSS1 Silver", "Second Term"), naira);
    expect(c.subject).toContain("1 student ");
    expect(c.confirmLabel).toBe("Create 1 invoice");
  });

  it("the confirm button restates the count rather than saying a bare 'Generate'", () => {
    const scope = summariseGeneration([line({ studentId: "a" }), line({ studentId: "b" })], "A", "T");
    expect(buildGenerateConfirmation(scope, naira).confirmLabel).toBe("Create 2 invoices");
  });

  it("the dismiss button never reads 'Cancel' — in finance that means voiding an invoice", () => {
    const c = buildGenerateConfirmation(summariseGeneration([line()], "A", "T"), naira);
    expect(c.dismissLabel).toBe("Don't create");
    expect(c.dismissLabel.toLowerCase()).not.toContain("cancel");
  });

  it("explains the skip, including that cancelling does not free a student to be re-billed", () => {
    const scope = summariseGeneration(
      [line({ studentId: "a" }), line({ studentId: "b", alreadyInvoiced: true })],
      "A",
      "T",
    );
    const c = buildGenerateConfirmation(scope, naira);
    expect(c.consequence).toContain("1 student already has an invoice");
    expect(c.consequence).toContain("Cancelling an invoice does not undo this");
  });

  it("a zero-impact run is not dressed up as a meaningful bulk action", () => {
    const c = buildGenerateConfirmation(summariseGeneration([], "A", "T"), naira);
    expect(c.title).toBe("Nothing to invoice");
    expect(c.subject).toContain("No invoices will be created");
    expect(c.consequence).toContain("Nothing will be created");
    // No "Create N invoices" affordance at all.
    expect(c.confirmLabel).toBe("Close");
  });
});

describe("generateReducer — the confirmation gate", () => {
  const scope = summariseGeneration([line({ studentId: "a" })], "JSS2 Gold", "First Term");
  const confirming: GenerateState = { phase: "confirming", scope, error: null };

  it("submit is unreachable from idle — a component cannot wire the button to the request", () => {
    expect(generateReducer(initialGenerateState, { type: "submit" })).toEqual(initialGenerateState);
    expect(shouldSendGenerateRequest(initialGenerateState)).toBe(false);
  });

  it("submit is unreachable from loading", () => {
    const loading = generateReducer(initialGenerateState, { type: "open" });
    expect(loading.phase).toBe("loading");
    expect(generateReducer(loading, { type: "submit" }).phase).toBe("loading");
  });

  it("opening never authorises a request — only a preview load", () => {
    const opened = generateReducer(initialGenerateState, { type: "open" });
    expect(shouldSendGenerateRequest(opened)).toBe(false);
  });

  it("submit from confirming is the ONLY path that authorises the request", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    expect(submitting.phase).toBe("submitting");
    expect(shouldSendGenerateRequest(submitting)).toBe(true);
  });

  it("a second submit while submitting is a no-op — double-click cannot produce two POSTs", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    const again = generateReducer(submitting, { type: "submit" });
    expect(again).toBe(submitting);
  });

  it("a zero-impact scope can never authorise a request even from confirming", () => {
    const empty = summariseGeneration([], "A", "T");
    const state: GenerateState = { phase: "confirming", scope: empty, error: null };
    expect(generateReducer(state, { type: "submit" }).phase).toBe("confirming");
    expect(shouldSendGenerateRequest({ ...state, phase: "submitting" })).toBe(false);
  });

  it("dismiss is refused mid-flight so the outcome must be seen", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    expect(generateReducer(submitting, { type: "dismiss" })).toBe(submitting);
  });

  it("dismiss from confirming resets without any request having been authorised", () => {
    expect(generateReducer(confirming, { type: "dismiss" })).toEqual(initialGenerateState);
  });

  it("open is refused mid-flight so a run cannot be retargeted at another arm", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    expect(generateReducer(submitting, { type: "open" })).toBe(submitting);
  });

  it("a failed generation returns to confirming with the reason and never reports success", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    const failed = generateReducer(submitting, { type: "error", message: "Paystack is down." });
    expect(failed.phase).toBe("confirming");
    expect(failed.error).toBe("Paystack is down.");
    // Retryable: still one submit away from a request, never optimistic.
    expect(shouldSendGenerateRequest(failed)).toBe(false);
    expect(generateReducer(failed, { type: "submit" }).phase).toBe("submitting");
  });

  it("a failed preview keeps the dialog open with the reason and no scope to submit", () => {
    const loading = generateReducer(initialGenerateState, { type: "open" });
    const failed = generateReducer(loading, { type: "error", message: "Could not reach the server." });
    expect(failed.phase).toBe("confirming");
    expect(failed.scope).toBeNull();
    expect(generateReducer(failed, { type: "submit" }).phase).toBe("confirming");
  });

  it("success clears back to idle", () => {
    const submitting = generateReducer(confirming, { type: "submit" });
    expect(generateReducer(submitting, { type: "success" })).toEqual(initialGenerateState);
  });
});
