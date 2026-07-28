"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import type { AssessmentFeedResponse, GradingSchemeDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  aggregateScores,
  bulkSaveScores,
  getAggregateStatus,
  getGradebookFeed,
  signOffColumn,
} from "@/lib/assessment/assessment-api";
import { cn } from "@/lib/utils";

import {
  buildDefaultValues,
  collectDirtyRows,
  columnSignedOffAt,
  isColumnFullyScored,
  makeGradebookSchema,
  type GradebookFormValues,
} from "./gradebook-form";

interface Props {
  scheme: GradingSchemeDto;
  initialFeed: AssessmentFeedResponse;
  termId: string;
  classArmId: string;
  subjectId: string;
  // The form teacher of the arm may recompute positions (slice 4).
  canAggregate: boolean;
}

function formatStamp(stamp: string | Date): string {
  return new Date(stamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(stamp: string | Date): string {
  return new Date(stamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// cp2: editable grid with an atomic Save (dirty cells only → bulk endpoint),
// per-cell server-error binding, a "Sign off column" action (gated + lock +
// Re-open), and a beforeunload guard for unsaved edits. Total / Grade / Position
// stay READ-ONLY from the server-materialized feed — never summed in the browser
// (acceptance #7).
export function GradebookGrid({
  scheme,
  initialFeed,
  termId,
  classArmId,
  subjectId,
  canAggregate,
}: Props) {
  const components = scheme.components; // ordered by orderIndex from the API

  const [feed, setFeed] = useState(initialFeed);
  const [saving, setSaving] = useState(false);
  const [signingOff, setSigningOff] = useState(false);
  const [aggregating, setAggregating] = useState(false);
  const [positionsAt, setPositionsAt] = useState<string | Date | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [reopened, setReopened] = useState(false);

  const form = useForm<GradebookFormValues>({
    resolver: zodResolver(makeGradebookSchema(components)),
    defaultValues: buildDefaultValues(feed.data, components),
    mode: "onChange",
  });
  const { fields } = useFieldArray({ control: form.control, name: "rows" });

  // Read every formState field we need DURING RENDER so RHF's proxy subscribes
  // to them — `dirtyFields` in particular is only populated for fields read in
  // render; reading it lazily inside the submit handler returns a partial map.
  const { isDirty, isValid, dirtyFields } = form.formState;

  const signedOffStamp = columnSignedOffAt(feed);
  const isSignedOff = signedOffStamp !== null;
  const fullyScored = isColumnFullyScored(feed, components);
  const locked = isSignedOff && !reopened;

  // Re-seed both the read-only feed and the form when the server returns fresh
  // data (after a save or sign-off). form.reset clears dirty + errors.
  function applyFeed(next: AssessmentFeedResponse): void {
    setFeed(next);
    form.reset(buildDefaultValues(next.data, components));
  }

  // beforeunload guard — warn before leaving with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // When were THIS subject's positions last computed (for the status line)?
  const loadPositionsStatus = useCallback(async () => {
    try {
      const status = await getAggregateStatus(termId, classArmId);
      setPositionsAt(status.perSubject.find((p) => p.subjectId === subjectId)?.lastComputedAt ?? null);
    } catch {
      // Non-fatal: the status line just shows "never computed".
    }
  }, [termId, classArmId, subjectId]);

  useEffect(() => {
    void loadPositionsStatus();
  }, [loadPositionsStatus]);

  // Form-teacher "Recompute positions" — a SUBJECT-NARROWED pass (this column).
  async function onRecompute(): Promise<void> {
    setAggregating(true);
    setBanner(null);
    try {
      await aggregateScores({ termId, classArmId, subjectId });
      const refreshed = await getGradebookFeed(termId, classArmId, subjectId);
      applyFeed(refreshed); // positions now visible in the read-only column
      await loadPositionsStatus();
      toast.success("Positions recomputed.");
    } catch (e) {
      setBanner(
        e instanceof ApiError ? e.message : "Couldn't recompute positions — try again.",
      );
    } finally {
      setAggregating(false);
    }
  }

  const onSave = form.handleSubmit(async (values) => {
    const { rows, cellByIndex } = collectDirtyRows(values, dirtyFields);
    if (rows.length === 0) return;

    setSaving(true);
    setBanner(null);
    try {
      const refreshed = await bulkSaveScores({ termId, subjectId, rows });
      applyFeed(refreshed);
      setReopened(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const issues =
          (e.details as { issues?: { path?: unknown[]; message?: string }[] } | undefined)?.issues ??
          [];
        let bound = 0;
        for (const issue of issues) {
          const path = issue.path;
          if (Array.isArray(path) && path[0] === "rows" && typeof path[1] === "number") {
            const cell = cellByIndex[path[1]];
            if (!cell) continue;
            const formRowIndex = feed.data.findIndex((r) => r.student.id === cell.studentId);
            if (formRowIndex >= 0) {
              form.setError(`rows.${formRowIndex}.scores.${cell.componentId}`, {
                type: "server",
                message: issue.message ?? "Invalid",
              });
              bound += 1;
            }
          }
        }
        setBanner(
          bound > 0
            ? `Couldn't save — ${bound} cell${bound === 1 ? "" : "s"} need fixing.`
            : e.message || "Couldn't save.",
        );
      } else {
        setBanner("Couldn't save — try again.");
      }
    } finally {
      setSaving(false);
    }
  });

  async function onSignOff(): Promise<void> {
    setSigningOff(true);
    setBanner(null);
    try {
      await signOffColumn({ termId, classArmId, subjectId });
      const refreshed = await getGradebookFeed(termId, classArmId, subjectId);
      applyFeed(refreshed);
      setReopened(false);
      toast.success("Column signed off.");
    } catch (e) {
      setBanner(
        e instanceof ApiError && e.status === 400
          ? "Sign-off failed — the column has missing scores."
          : "Couldn't sign off — try again.",
      );
    } finally {
      setSigningOff(false);
    }
  }

  const busy = saving || signingOff || aggregating;
  const canSave = isDirty && isValid && !busy;
  const signOffReason = isDirty
    ? "Save your changes first"
    : !fullyScored
      ? "Fill in all scores to sign off"
      : null;
  const canSignOff = !isSignedOff && signOffReason === null && !busy;

  return (
    <div className="flex flex-col gap-4">
      {/* Action bar — always visible above the (potentially tall) grid. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          {isSignedOff && (
            <Badge variant="success" className="gap-1.5 py-1">
              <Check className="h-4 w-4" />
              Signed off {formatStamp(signedOffStamp)}
            </Badge>
          )}
          {reopened && (
            <span className="text-xs text-amber-700">Sign-off will clear on save.</span>
          )}
          {savedFlash && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <Check className="h-4 w-4" />
              Saved
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Positions:{" "}
            {positionsAt ? `computed ${formatDateTime(positionsAt)}` : "never computed"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {canAggregate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onRecompute}
              title="Recompute this subject's positions for the arm"
            >
              {aggregating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              {aggregating ? "Recomputing…" : "Recompute positions"}
            </Button>
          )}
          {isSignedOff ? (
            !reopened && (
              <Button type="button" variant="outline" size="sm" onClick={() => setReopened(true)}>
                <RotateCcw className="mr-1 h-4 w-4" />
                Re-open to edit
              </Button>
            )
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canSignOff}
              title={signOffReason ?? undefined}
              onClick={onSignOff}
            >
              {signingOff && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {signingOff ? "Signing off…" : "Sign off column"}
            </Button>
          )}

          <Button type="button" disabled={!canSave} onClick={onSave}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {banner && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {banner}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader className="[&_tr]:bg-muted/40">
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-muted/40">Student</TableHead>
              {components.map((c) => (
                <TableHead key={c.id}>
                  {c.label}
                  <span className="ml-1 font-normal normal-case text-muted-foreground/70">/{c.weight}</span>
                </TableHead>
              ))}
              <TableHead>Total</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Position</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field, i) => {
              const row = feed.data[i];
              if (!row) return null; // fields and feed.data are built in lockstep
              const assessment = row.assessment;
              const rowErrors = form.formState.errors.rows?.[i]?.scores;
              return (
                <TableRow key={field.id}>
                  <TableCell className="sticky left-0 z-10 bg-background">
                    <div className="font-medium">
                      {row.student.lastName}, {row.student.firstName}
                    </div>
                    <div className="text-xs text-muted-foreground">{row.student.admissionNumber}</div>
                  </TableCell>

                  {components.map((c) => {
                    const cellErr = rowErrors?.[c.id];
                    return (
                      <TableCell key={c.id} className="align-top">
                        <Input
                          aria-label={`${row.student.lastName} ${c.label}`}
                          inputMode="numeric"
                          disabled={locked || busy}
                          className={cn(
                            "w-16",
                            cellErr && "border-destructive focus-visible:ring-destructive",
                          )}
                          aria-invalid={Boolean(cellErr)}
                          {...form.register(`rows.${i}.scores.${c.id}`)}
                        />
                        {cellErr && <p className="mt-1 text-xs text-destructive">{cellErr.message}</p>}
                      </TableCell>
                    );
                  })}

                  {/* Read-only, server-computed — never summed client-side. */}
                  <TableCell className="font-medium tabular-nums">
                    {assessment ? assessment.totalScore : "—"}
                  </TableCell>
                  <TableCell>{assessment?.letterGrade ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{assessment?.subjectPosition ?? "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
