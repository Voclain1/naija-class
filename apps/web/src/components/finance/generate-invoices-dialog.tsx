"use client";

// The F-34 review gate for bulk invoice generation.
//
// Deliberately shaped like CancelInvoiceDialog: the render-prop hands the
// caller an `open` function instead of exposing the mutation, so the page has
// no way to reach generateInvoices() except through this component. All phase
// logic lives in lib/finance/invoice-generate.ts, which is unit-tested; this
// file is presentation only.

import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { useCallback, useReducer, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { financeErrorMessage, logFinanceError } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { studentDisplayName } from "@/lib/finance/invoice-identity";
import {
  buildGenerateConfirmation,
  generateReducer,
  initialGenerateState,
  isZeroImpact,
  summariseGeneration,
  zeroImpactReason,
} from "@/lib/finance/invoice-generate";
import { generateInvoices, previewInvoices } from "@/lib/finance/invoices-api";

const ZERO_IMPACT_COPY: Record<string, string> = {
  "no-students": "No students are enrolled in this class for this term, so there is nobody to bill.",
  "all-already-invoiced":
    "Every enrolled student already has an invoice for this term. Re-running would create nothing.",
  "no-fees": "No fees are priced for this class and term, so every invoice would be for ₦0.00.",
};

export interface GenerateTarget {
  termId: string;
  classArmId: string;
  armName: string;
  termName: string;
  dueDate?: string;
}

export function GenerateInvoicesDialog({
  onGenerated,
  children,
}: {
  onGenerated: (result: { created: number; skipped: number }) => void;
  /**
   * Receives `open` — the ONLY way to begin a run — plus `busy` so the trigger
   * can disable itself. The mutation is never handed out.
   */
  children: (open: (target: GenerateTarget) => void, busy: boolean) => ReactNode;
}) {
  const [state, dispatch] = useReducer(generateReducer, initialGenerateState);
  // Held outside reducer state: it is request context, not phase.
  const [target, setTarget] = useReducer(
    (_: GenerateTarget | null, next: GenerateTarget | null) => next,
    null,
  );

  const open = useCallback((next: GenerateTarget) => {
    setTarget(next);
    dispatch({ type: "open" });
    // Opening loads a PREVIEW — a GET. No mutation is possible here.
    previewInvoices({ termId: next.termId, classArmId: next.classArmId })
      .then((rows) =>
        dispatch({
          type: "loaded",
          scope: summariseGeneration(rows, next.armName, next.termName),
        }),
      )
      .catch((e) => {
        logFinanceError("previewInvoices", e);
        dispatch({ type: "error", message: financeErrorMessage(e) });
      });
  }, []);

  const submitting = state.phase === "submitting";
  const scope = state.scope;
  const confirmation = scope ? buildGenerateConfirmation(scope, formatKobo) : null;
  const zeroImpact = scope ? isZeroImpact(scope) : false;

  const onConfirm = useCallback(() => {
    // Double-click safety lives in the reducer: a second `submit` while
    // already submitting is a no-op, so this cannot produce two POSTs.
    if (!target || !scope || isZeroImpact(scope)) return;
    dispatch({ type: "submit" });
    generateInvoices({
      termId: target.termId,
      classArmId: target.classArmId,
      dueDate: target.dueDate || undefined,
    })
      .then((result) => {
        dispatch({ type: "success" });
        onGenerated({ created: result.created, skipped: result.skipped });
      })
      .catch((e) => {
        logFinanceError("generateInvoices", e);
        dispatch({ type: "error", message: financeErrorMessage(e) });
      });
  }, [target, scope, onGenerated]);

  return (
    <>
      {children(open, submitting)}

      <Dialog
        open={state.phase !== "idle"}
        onOpenChange={(next) => {
          if (!next) dispatch({ type: "dismiss" });
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {zeroImpact ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />
              ) : (
                <FileText className="h-5 w-5 text-primary" aria-hidden />
              )}
              {confirmation?.title ?? "Review invoices"}
            </DialogTitle>
          </DialogHeader>

          {state.phase === "loading" && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Working out who would be invoiced…
            </p>
          )}

          {state.phase !== "loading" && (
            <div className="space-y-3">
              {confirmation && (
                <>
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium text-foreground">
                    {confirmation.subject}
                  </p>
                  <p className="text-sm text-muted-foreground">{confirmation.consequence}</p>
                </>
              )}

              {scope && zeroImpact && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {ZERO_IMPACT_COPY[zeroImpactReason(scope) ?? "no-students"]}
                </p>
              )}

              {scope && scope.billableCount > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Will be invoiced ({scope.billableCount})
                    {scope.feeItemCount > 0 && (
                      <> · {scope.feeItemCount} fee item{scope.feeItemCount === 1 ? "" : "s"} each</>
                    )}
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead className="text-right">Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scope.billable.map((line) => (
                          <TableRow key={line.studentId}>
                            {/* studentDisplayName never falls back to a raw or
                                truncated id — that was F-04's whole point. */}
                            <TableCell className="font-medium">
                              {studentDisplayName(line)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatKobo(line.totalDue)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {scope && scope.skippedCount > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Already invoiced — will be skipped ({scope.skippedCount})
                  </p>
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    {scope.skipped.map((l) => studentDisplayName(l)).join(", ")}
                  </p>
                </div>
              )}

              {state.error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {state.error} No invoices have been created.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={submitting}
              onClick={() => dispatch({ type: "dismiss" })}
            >
              {confirmation?.dismissLabel ?? "Close"}
            </Button>
            {!zeroImpact && (
              <Button
                type="button"
                className="flex-1"
                disabled={submitting || state.phase !== "confirming" || !scope}
                onClick={onConfirm}
              >
                {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? "Creating…" : confirmation?.confirmLabel ?? "Create invoices"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
