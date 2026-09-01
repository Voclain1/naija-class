import { describe, expect, it } from "vitest";

import {
  buildDeactivateConfirmation,
  deactivateReducer,
  initialDeactivateState,
  shouldSendDeactivateRequest,
  type DeactivateState,
  type DeactivateTarget,
} from "./discount-deactivate";

// Unit half of the discount-rule deactivation gate. The browser half is
// e2e/tests/discount-rule-deactivation.spec.ts.
//
// The property that matters most: a deactivate REQUEST is unreachable without
// passing through the confirmation phase. The bug this replaced dispatched
// straight from a row button — verified in a real browser on 2026-09-01 to
// deactivate a rule on one click, with zero dialogs open and the server
// already reporting active=false.

const target: DeactivateTarget = {
  id: "0f8b6c21-3a44-4d15-9a77-1c2e5b90d3aa",
  name: "Staff child discount",
  valueLabel: "50.00%",
  scopeLabel: "Item: Term tuition",
};

function confirming(): DeactivateState {
  return deactivateReducer(initialDeactivateState, { type: "open", target });
}

describe("deactivateReducer — the confirmation gate", () => {
  it("REFUSES to submit from idle, so a single click cannot deactivate a discount", () => {
    const afterSubmit = deactivateReducer(initialDeactivateState, { type: "submit" });

    expect(afterSubmit.phase).toBe("idle");
    expect(shouldSendDeactivateRequest(afterSubmit)).toBe(false);
  });

  it("requires open -> submit before a request may be sent", () => {
    const opened = confirming();
    expect(opened.phase).toBe("confirming");
    expect(shouldSendDeactivateRequest(opened)).toBe(false);

    const submitted = deactivateReducer(opened, { type: "submit" });
    expect(submitted.phase).toBe("submitting");
    expect(shouldSendDeactivateRequest(submitted)).toBe(true);
  });

  it("ignores a second submit while one is already in flight (no duplicate DELETE)", () => {
    const submitted = deactivateReducer(confirming(), { type: "submit" });
    const doubleClicked = deactivateReducer(submitted, { type: "submit" });

    expect(doubleClicked).toBe(submitted);
  });

  it("dismisses without deactivating, leaving no target and no request", () => {
    const dismissed = deactivateReducer(confirming(), { type: "dismiss" });

    expect(dismissed).toEqual(initialDeactivateState);
    expect(dismissed.target).toBeNull();
    expect(shouldSendDeactivateRequest(dismissed)).toBe(false);
  });

  it("refuses to dismiss while submitting, so an in-flight outcome cannot be escaped", () => {
    const submitted = deactivateReducer(confirming(), { type: "submit" });
    expect(deactivateReducer(submitted, { type: "dismiss" })).toBe(submitted);
  });

  it("refuses to retarget a different rule mid-flight", () => {
    const submitted = deactivateReducer(confirming(), { type: "submit" });
    const other: DeactivateTarget = { ...target, id: "other", name: "Sibling discount" };

    const retargeted = deactivateReducer(submitted, { type: "open", target: other });
    expect(retargeted).toBe(submitted);
    expect(retargeted.target?.name).toBe("Staff child discount");
  });
});

describe("deactivateReducer — failure must stay visible and truthful", () => {
  it("keeps the dialog open with the reason when the request fails", () => {
    const failed = deactivateReducer(
      deactivateReducer(confirming(), { type: "submit" }),
      { type: "error", message: "Could not reach the server." },
    );

    expect(failed.phase).toBe("confirming");
    expect(failed.error).toBe("Could not reach the server.");
    expect(failed.target).toEqual(target);
    expect(shouldSendDeactivateRequest(failed)).toBe(false);
  });

  it("allows a retry after a failure, and clears the stale error", () => {
    const failed = deactivateReducer(
      deactivateReducer(confirming(), { type: "submit" }),
      { type: "error", message: "Something went wrong." },
    );
    const retried = deactivateReducer(failed, { type: "submit" });

    expect(retried.phase).toBe("submitting");
    expect(retried.error).toBeNull();
  });

  it("never reports success unless a request was actually in flight", () => {
    // The row must only show "Inactive" because the server said so.
    expect(deactivateReducer(initialDeactivateState, { type: "success" })).toBe(
      initialDeactivateState,
    );
    const opened = confirming();
    expect(deactivateReducer(opened, { type: "success" })).toBe(opened);
  });
});

describe("buildDeactivateConfirmation", () => {
  const copy = buildDeactivateConfirmation(target, "Adaeze Okonkwo");

  it("identifies the rule by name, value and scope — not by a UUID", () => {
    expect(copy.subject).toContain("Staff child discount");
    expect(copy.subject).toContain("50.00%");
    expect(copy.subject).toContain("Item: Term tuition");
    expect(copy.subject).toContain("Adaeze Okonkwo");
    expect(copy.subject).not.toContain(target.id);
  });

  it("states what happens to invoices in both directions", () => {
    // The single most misunderstandable part of this action: already-issued
    // invoices do NOT change, future ones do.
    expect(copy.consequence).toContain("already issued");
    expect(copy.consequence).toContain("do not change");
    expect(copy.consequence).toContain("full amount");
  });

  it("does not promise an undo, because there is no reactivate endpoint", () => {
    expect(copy.consequence).toContain("cannot be undone");
  });

  it("never labels the dismiss button 'Cancel'", () => {
    // On a screen about removing a discount, "Cancel" reads as both "cancel
    // the discount" and "close this dialog".
    expect(copy.dismissLabel).toBe("Keep discount");
    expect(copy.dismissLabel.toLowerCase()).not.toBe("cancel");
    expect(copy.confirmLabel).not.toBe(copy.dismissLabel);
  });
});
