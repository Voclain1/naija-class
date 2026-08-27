import { describe, expect, it } from "vitest";

import {
  buildCancelConfirmation,
  cancelReducer,
  canCancelInvoice,
  initialCancelState,
  shouldSendCancelRequest,
  type CancelState,
  type CancelTarget,
} from "./invoice-cancel";

// F-01 regression suite.
//
// The single most important property here is that a cancel REQUEST is
// unreachable without passing through the confirmation phase. If someone
// wires a row button straight to the mutation again — the exact shape of the
// original bug — `submit` gets dispatched from `idle`, the machine refuses
// it, `shouldSendCancelRequest` stays false, and the first test below fails.

const target: CancelTarget = {
  id: "9f2c1b7e-0f21-4a3a-9c88-2b0d51ee77aa",
  studentId: "3d1b9c40-7a55-4a11-bd21-0c4f9a2e1a33",
  studentName: "Chinwe Okafor",
  admissionNumber: "SKA/2024/0412",
  totalDue: 15_750_00, // ₦15,750.00 in kobo
  totalPaid: 0,
  status: "ISSUED",
};

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG")}`;

function confirming(): CancelState {
  return cancelReducer(initialCancelState, { type: "open", target });
}

describe("canCancelInvoice", () => {
  it("offers cancellation only for statuses the server will actually accept", () => {
    expect(canCancelInvoice("DRAFT")).toBe(true);
    expect(canCancelInvoice("ISSUED")).toBe(true);
    expect(canCancelInvoice("OVERDUE")).toBe(true);
  });

  it("never offers cancellation for an invoice with money against it", () => {
    // These four map 1:1 onto InvoiceGenerationService.cancel's ConflictErrors.
    // Offering the action here would guarantee a failed request and, worse,
    // suggest to a bursar that voiding a paid invoice is a normal thing to do.
    expect(canCancelInvoice("PAID")).toBe(false);
    expect(canCancelInvoice("PARTIALLY_PAID")).toBe(false);
    expect(canCancelInvoice("REFUNDED")).toBe(false);
    expect(canCancelInvoice("CANCELLED")).toBe(false);
  });
});

describe("cancelReducer — the confirmation gate", () => {
  it("REFUSES to submit from idle, so a single click cannot cancel an invoice", () => {
    const afterSubmit = cancelReducer(initialCancelState, { type: "submit" });

    expect(afterSubmit.phase).toBe("idle");
    expect(shouldSendCancelRequest(afterSubmit)).toBe(false);
  });

  it("requires open -> submit before a request may be sent", () => {
    const opened = confirming();
    expect(opened.phase).toBe("confirming");
    expect(shouldSendCancelRequest(opened)).toBe(false); // confirming is not sending

    const submitted = cancelReducer(opened, { type: "submit" });
    expect(submitted.phase).toBe("submitting");
    expect(shouldSendCancelRequest(submitted)).toBe(true);
  });

  it("ignores a second submit while one is already in flight (no duplicate POST)", () => {
    const submitted = cancelReducer(confirming(), { type: "submit" });
    const doubleClicked = cancelReducer(submitted, { type: "submit" });

    expect(doubleClicked).toBe(submitted); // identical reference: nothing changed
    expect(doubleClicked.phase).toBe("submitting");
  });

  it("dismisses without cancelling, leaving no target and no request", () => {
    const dismissed = cancelReducer(confirming(), { type: "dismiss" });

    expect(dismissed).toEqual(initialCancelState);
    expect(dismissed.target).toBeNull();
    expect(shouldSendCancelRequest(dismissed)).toBe(false);
  });

  it("refuses to dismiss while submitting, so an in-flight outcome cannot be escaped", () => {
    const submitted = cancelReducer(confirming(), { type: "submit" });
    expect(cancelReducer(submitted, { type: "dismiss" })).toBe(submitted);
  });

  it("refuses to retarget a different invoice mid-flight", () => {
    const submitted = cancelReducer(confirming(), { type: "submit" });
    const other: CancelTarget = { ...target, id: "other-id", studentName: "Musa Bello" };

    const retargeted = cancelReducer(submitted, { type: "open", target: other });
    expect(retargeted).toBe(submitted);
    expect(retargeted.target?.studentName).toBe("Chinwe Okafor");
  });
});

describe("cancelReducer — failure must stay visible and truthful", () => {
  it("keeps the dialog open with the reason when the request fails", () => {
    const submitted = cancelReducer(confirming(), { type: "submit" });
    const failed = cancelReducer(submitted, {
      type: "error",
      message: "Could not reach the server.",
    });

    // Not idle: silently closing is how the original bug hid its failures.
    expect(failed.phase).toBe("confirming");
    expect(failed.error).toBe("Could not reach the server.");
    expect(failed.target).toEqual(target);
    expect(shouldSendCancelRequest(failed)).toBe(false);
  });

  it("allows a retry after a failure, and clears the stale error on the retry", () => {
    const failed = cancelReducer(
      cancelReducer(confirming(), { type: "submit" }),
      { type: "error", message: "Something went wrong on our side." },
    );

    const retried = cancelReducer(failed, { type: "submit" });
    expect(retried.phase).toBe("submitting");
    expect(retried.error).toBeNull();
  });

  it("never reports success unless a request was actually in flight", () => {
    // Guards against an optimistic 'success' being dispatched before (or
    // instead of) the backend confirming — the invoice's displayed state
    // must only change on a real server response.
    expect(cancelReducer(initialCancelState, { type: "success" })).toBe(initialCancelState);

    const opened = confirming();
    expect(cancelReducer(opened, { type: "success" })).toBe(opened);
  });

  it("closes cleanly only after a real success", () => {
    const submitted = cancelReducer(confirming(), { type: "submit" });
    expect(cancelReducer(submitted, { type: "success" })).toEqual(initialCancelState);
  });
});

describe("buildCancelConfirmation", () => {
  const confirmation = buildCancelConfirmation(target, naira, "Chinwe Okafor");

  it("identifies the invoice by student, admission number and amount — not by a UUID", () => {
    expect(confirmation.subject).toContain("Chinwe Okafor");
    expect(confirmation.subject).toContain("SKA/2024/0412");
    expect(confirmation.subject).toContain("15,750");
    // The raw id must never be the thing a bursar is asked to recognise.
    expect(confirmation.subject).not.toContain(target.id);
    expect(confirmation.subject).not.toContain(target.studentId);
  });

  it("never labels the dismiss button 'Cancel'", () => {
    // In a cancel-an-invoice dialog, "Cancel" means both "void the invoice"
    // and "close this dialog". The two buttons must not be confusable.
    expect(confirmation.dismissLabel).toBe("Keep invoice");
    expect(confirmation.dismissLabel.toLowerCase()).not.toBe("cancel");
    expect(confirmation.confirmLabel).not.toBe(confirmation.dismissLabel);
  });

  it("states the consequence in plain language and does not promise an undo", () => {
    expect(confirmation.consequence).toContain("cannot be undone");
    expect(confirmation.consequence).toContain("payment link");
    expect(confirmation.consequence.toLowerCase()).not.toContain("undo the");
  });

  it("falls back gracefully when there is no admission number", () => {
    const noAdmission = buildCancelConfirmation(
      { ...target, admissionNumber: null },
      naira,
      "Chinwe Okafor",
    );
    expect(noAdmission.subject).toContain("Chinwe Okafor");
    expect(noAdmission.subject).not.toContain("(");
  });
});
