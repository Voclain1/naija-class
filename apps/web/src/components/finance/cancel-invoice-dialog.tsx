"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useReducer } from "react";
import { toast } from "sonner";

import type { InvoiceDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { cancelInvoice } from "@/lib/finance/invoices-api";
import {
  buildCancelConfirmation,
  cancelReducer,
  initialCancelState,
  type CancelTarget,
} from "@/lib/finance/invoice-cancel";
import { studentDisplayName } from "@/lib/finance/invoice-identity";

// The ONE confirmation surface for voiding an invoice, shared by the invoice
// list and the invoice detail page — which previously had two different
// no-confirmation implementations of the same destructive action.
//
// Follows the StudentStatusActions pattern (shadcn Dialog + a submitting
// flag + a sonner toast on the outcome) rather than introducing a fourth
// confirmation style. The differences from that component are deliberate and
// all point the same way — this action is irreversible and StudentStatusActions'
// are not:
//   * the confirm button is `variant="destructive"`, not the default;
//   * the dismiss button says "Keep invoice", never "Cancel" (in a
//     cancel-an-invoice dialog "Cancel" means both things at once);
//   * a failure keeps the dialog OPEN with the reason in it, instead of
//     closing and leaving only a toast that a bursar may not have seen.
//
// All phase transitions live in the pure reducer in lib/finance/invoice-cancel.ts,
// which is where the "cannot submit without confirming" invariant is tested.

interface Props {
  /**
   * Render prop for the trigger, so callers control placement (a table-row
   * button, a detail-page footer button) while the confirmation stays identical.
   */
  children: (open: (invoice: InvoiceDto) => void, busy: boolean) => React.ReactNode;
  /** Called with the server's updated invoice after a confirmed cancellation. */
  onCancelled: (updated: InvoiceDto) => void;
}

export function CancelInvoiceDialog({ children, onCancelled }: Props) {
  const [state, dispatch] = useReducer(cancelReducer, initialCancelState);

  const target: CancelTarget | null = state.target;
  const submitting = state.phase === "submitting";

  async function onConfirm() {
    if (!target) return;
    // Guard is in the reducer, not here: a `submit` dispatched from any phase
    // other than `confirming` is ignored, so a double-click (or a component
    // rewired to skip the dialog) cannot reach the request.
    if (state.phase !== "confirming") return;
    dispatch({ type: "submit" });
    try {
      const updated = await cancelInvoice(target.id);
      // Only now — after the server confirmed — is the row allowed to change.
      // Nothing is updated optimistically, so a failure leaves the displayed
      // status exactly as truthful as it was before the click.
      onCancelled(updated);
      dispatch({ type: "success" });
      toast.success(
        `Invoice ${target.id.slice(0, 8).toUpperCase()} cancelled for ${studentDisplayName(target)}.`,
      );
    } catch (error) {
      logFinanceError("cancelInvoice", error);
      dispatch({ type: "error", message: financeErrorMessage(error) });
    }
  }

  const confirmation = target
    ? buildCancelConfirmation(target, formatKobo, studentDisplayName(target))
    : null;

  return (
    <>
      {children((invoice) => dispatch({ type: "open", target: invoice }), submitting)}

      <Dialog
        open={state.phase !== "idle"}
        onOpenChange={(next) => {
          if (!next) dispatch({ type: "dismiss" });
        }}
      >
        <DialogContent className="max-w-md">
          {confirmation && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
                  {confirmation.title}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                {/* Identity + amount: what makes this recognisably the right row. */}
                <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
                  {confirmation.subject}
                </p>
                <p className="text-sm text-muted-foreground">{confirmation.consequence}</p>

                {state.error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {state.error} The invoice has <strong>not</strong> been cancelled.
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => dispatch({ type: "dismiss" })}
                >
                  {confirmation.dismissLabel}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="flex-1"
                  disabled={submitting}
                  onClick={onConfirm}
                >
                  {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                  {submitting ? "Cancelling…" : confirmation.confirmLabel}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
