"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import type {
  AssessmentFeedResponse,
  AssessmentFeedRowDto,
  GradingSchemeDto,
  ScorePreviewRowDto,
} from "@school-kit/types";

import { ExportCsvButton } from "@/components/shared/export-csv-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { isAuthForcedNavigation } from "@/lib/auth/session-end-navigation";
import {
  aggregateScores,
  bulkSaveScores,
  getAggregateStatus,
  getGradebookFeed,
  previewScores,
  signOffColumn,
} from "@/lib/assessment/assessment-api";
import { exportRowsAsCsv, type CsvColumn } from "@/lib/csv-export";
import { cn } from "@/lib/utils";

import {
  buildDefaultValues,
  collectDirtyRows,
  columnSignedOffAt,
  isColumnFullyScored,
  inferColumnOutOf,
  makeGradebookSchema,
  parseOutOfInput,
  toSaveRows,
  type ColumnOutOf,
  type GradebookFormValues,
  type SaveRow,
} from "./gradebook-form";
import { PrintButton } from "@/components/shared/print-button";

// Export reuses the read-only, server-computed feed already held in state —
// Total/Grade/Position are never recomputed client-side (same rule the grid
// itself follows, see the cp2 comment above this component).
function buildExportColumns(components: GradingSchemeDto["components"]): CsvColumn<AssessmentFeedRowDto>[] {
  return [
    { header: "Admission Number", accessor: (r) => r.student.admissionNumber },
    { header: "Last Name", accessor: (r) => r.student.lastName },
    { header: "First Name", accessor: (r) => r.student.firstName },
    ...components.map((c): CsvColumn<AssessmentFeedRowDto> => ({
      header: c.label,
      accessor: (r) => r.scores.find((s) => s.componentId === c.id)?.score ?? "",
    })),
    { header: "Total", accessor: (r) => r.assessment?.totalScore ?? "" },
    { header: "Grade", accessor: (r) => r.assessment?.letterGrade ?? "" },
    { header: "Position", accessor: (r) => r.assessment?.subjectPosition ?? "" },
  ];
}

type DirtyCellRef = { studentId: string; componentId: string };

interface Props {
  scheme: GradingSchemeDto;
  initialFeed: AssessmentFeedResponse;
  termId: string;
  classArmId: string;
  subjectId: string;
  // Whether to offer "Recompute positions" (slice 4): the arm's form teacher in
  // the teacher gradebook; always for owner/admin in the admin gradebook. The
  // API re-checks either way.
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

  // CP5a (D60): columns entered "out of" some total. Seeded from the feed so a
  // column saved that way reopens with the marks as typed. The resolver reads
  // it through a ref, so validation follows the CURRENT totals.
  const [outOf, setOutOf] = useState<ColumnOutOf>(() =>
    Object.fromEntries(components.map((c) => [c.id, inferColumnOutOf(initialFeed.data, c.id)])),
  );
  const outOfRef = useRef(outOf);
  outOfRef.current = outOf;
  const [outOfDraft, setOutOfDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(components.map((c) => [c.id, outOf[c.id] === undefined ? "" : String(outOf[c.id])])),
  );
  const [outOfError, setOutOfError] = useState<Record<string, string | undefined>>({});
  // The confirmation step: what the SERVER will store for each converted cell.
  const [pending, setPending] = useState<{
    rows: SaveRow[];
    preview: ScorePreviewRowDto[];
    cellByIndex: DirtyCellRef[];
  } | null>(null);

  const form = useForm<GradebookFormValues>({
    resolver: (values, context, options) =>
      zodResolver(makeGradebookSchema(components, outOfRef.current))(values, context, options),
    defaultValues: buildDefaultValues(feed.data, components, outOf),
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
    form.reset(buildDefaultValues(next.data, components, outOfRef.current));
  }

  // Changing a column's "Out of" changes what its cells MEAN, so it is only
  // offered with nothing unsaved — the cells then reload in the new units.
  function commitOutOf(componentId: string, weight: number): void {
    const parsed = parseOutOfInput(outOfDraft[componentId] ?? "", weight);
    if ("error" in parsed) {
      setOutOfError((e) => ({ ...e, [componentId]: parsed.error }));
      return;
    }
    setOutOfError((e) => ({ ...e, [componentId]: undefined }));
    if (parsed.outOf === outOf[componentId]) return;
    const next = { ...outOf, [componentId]: parsed.outOf };
    outOfRef.current = next;
    setOutOf(next);
    form.reset(buildDefaultValues(feed.data, components, next));
  }

  // beforeunload guard — warn before leaving with unsaved edits.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      // Stand down for a forced sign-out: the credential is already gone, so
      // "Stay" cannot save this column. See lib/auth/session-end-navigation.ts.
      if (isAuthForcedNavigation()) return;
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

  // Save. Cells in an "out of" column go to the server as raw marks, and the
  // server's own conversion is shown for confirmation first — the browser
  // never scales a mark (the same rule as Total/Grade/Position).
  const onSave = form.handleSubmit(async (values) => {
    const { rows: dirty, cellByIndex } = collectDirtyRows(values, dirtyFields);
    if (dirty.length === 0) return;
    const rows = toSaveRows(dirty, outOfRef.current);

    if (!rows.some((r) => "raw" in r)) {
      await commitSave(rows, cellByIndex);
      return;
    }
    setSaving(true);
    setBanner(null);
    try {
      const { rows: preview } = await previewScores({ termId, subjectId, rows });
      setPending({ rows, preview, cellByIndex });
    } catch (e) {
      handleSaveError(e, cellByIndex);
    } finally {
      setSaving(false);
    }
  });

  async function commitSave(rows: SaveRow[], cellByIndex: DirtyCellRef[]): Promise<void> {
    setSaving(true);
    setBanner(null);
    try {
      const refreshed = await bulkSaveScores({ termId, subjectId, rows });
      setPending(null);
      applyFeed(refreshed);
      setReopened(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch (e) {
      setPending(null);
      handleSaveError(e, cellByIndex);
    } finally {
      setSaving(false);
    }
  }

  function handleSaveError(e: unknown, cellByIndex: DirtyCellRef[]): void {
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
  }

  const studentName = (id: string) => {
    const s = feed.data.find((r) => r.student.id === id)?.student;
    return s ? `${s.lastName}, ${s.firstName}` : "Student";
  };
  const componentById = new Map(components.map((c) => [c.id, c]));

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
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
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
            <span className="inline-flex animate-in items-center gap-1.5 fade-in text-emerald-700 duration-200 motion-reduce:animate-none">
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
          <ExportCsvButton
            onExport={() => exportRowsAsCsv("gradebook.csv", feed.data, buildExportColumns(components))}
            disabled={feed.data.length === 0}
          />
          <PrintButton disabled={feed.data.length === 0} />
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
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive print:hidden">
          {banner}
        </div>
      )}

      {/* Print-only static table — the live grid below is a form (editable
          <Input> cells), which prints poorly; this mirrors the same rows as
          plain text instead. Hidden on screen, shown only in print media. */}
      <div className="hidden print:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/20">
              <th className="p-2 text-left">Student</th>
              {components.map((c) => (
                <th key={c.id} className="p-2 text-left">
                  {c.label} /{c.weight}
                </th>
              ))}
              <th className="p-2 text-left">Total</th>
              <th className="p-2 text-left">Grade</th>
              <th className="p-2 text-left">Position</th>
            </tr>
          </thead>
          <tbody>
            {feed.data.map((row) => (
              <tr key={row.student.id} className="border-b border-black/10">
                <td className="p-2">
                  {row.student.lastName}, {row.student.firstName}
                  <div className="text-xs">{row.student.admissionNumber}</div>
                </td>
                {components.map((c) => (
                  <td key={c.id} className="p-2">
                    {row.scores.find((s) => s.componentId === c.id)?.score ?? "—"}
                  </td>
                ))}
                <td className="p-2">{row.assessment?.totalScore ?? "—"}</td>
                <td className="p-2">{row.assessment?.letterGrade ?? "—"}</td>
                <td className="p-2">{row.assessment?.subjectPosition ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-hidden rounded-md border print:hidden">
        <Table>
          <TableHeader className="[&_tr]:bg-muted/40">
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-muted/40">Student</TableHead>
              {components.map((c) => (
                <TableHead key={c.id} className="align-top">
                  {c.label}
                  <span className="ml-1 font-normal normal-case text-muted-foreground/70">/{c.weight}</span>
                  <label className="mt-1 flex items-center gap-1 text-xs font-normal normal-case text-muted-foreground">
                    Out of
                    <Input
                      aria-label={`${c.label} out of`}
                      inputMode="numeric"
                      placeholder={String(c.weight)}
                      disabled={locked || busy || isDirty}
                      title={isDirty ? "Save your changes first" : `Type marks out of another total; they are converted to /${c.weight}`}
                      className="h-7 w-14 px-1.5 text-xs"
                      value={outOfDraft[c.id] ?? ""}
                      onChange={(e) => setOutOfDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                      onBlur={() => commitOutOf(c.id, c.weight)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitOutOf(c.id, c.weight);
                      }}
                    />
                  </label>
                  {outOfError[c.id] && <p className="mt-1 text-xs font-normal normal-case text-destructive">{outOfError[c.id]}</p>}
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
                        {!cellErr && outOf[c.id] !== undefined && savedScore(row, c.id) !== undefined && (
                          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                            Saved {savedScore(row, c.id)}/{c.weight}
                          </p>
                        )}
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

      <Dialog open={pending !== null} onOpenChange={(open) => !open && !saving && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check the converted marks</DialogTitle>
            <DialogDescription>
              Marks typed out of another total are converted to each component&apos;s weight, rounding half
              up. This is what will be saved.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Student</TableHead>
                  <TableHead>Component</TableHead>
                  <TableHead>Typed</TableHead>
                  <TableHead>Saved as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pending?.preview ?? [])
                  .filter((p) => p.raw !== null)
                  .map((p) => {
                    const component = componentById.get(p.componentId);
                    return (
                      <TableRow key={`${p.studentId}:${p.componentId}`}>
                        <TableCell>{studentName(p.studentId)}</TableCell>
                        <TableCell>{component?.label}</TableCell>
                        <TableCell className="tabular-nums">
                          {p.raw!.mark}/{p.raw!.outOf}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {p.score}/{component?.weight}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setPending(null)}>
              Back to editing
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => pending && void commitSave(pending.rows, pending.cellByIndex)}
            >
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save these marks"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function savedScore(row: AssessmentFeedRowDto, componentId: string): number | undefined {
  return row.scores.find((s) => s.componentId === componentId)?.score;
}
