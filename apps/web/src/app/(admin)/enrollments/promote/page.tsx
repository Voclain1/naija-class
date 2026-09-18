"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Loader2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type {
  AcademicYearDto,
  ClassArmDto,
  PromotionAction,
  PromotionArmGapDto,
  PromotionCandidateDto,
  PromotionCommitResultDto,
  PromotionPreviewDto,
  TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import {
  listAcademicYears,
  listTerms,
} from "@/lib/academic-years/academic-years-api";
import { createClassArm, listClassArms } from "@/lib/class-arms/class-arms-api";
import {
  commitPromotion,
  previewPromotion,
} from "@/lib/promotions/promotions-api";
import {
  initialPlan,
  resolveArmGap,
  setAction,
  setActionForArm,
  setClassArm,
  summarise,
  toDecisions,
  type PromotionPlan,
} from "@/lib/promotions/promotion-plan";

// /enrollments/promote — the promotion engine (docs/modules/promotion-engine.md).
//
// ONE screen, ONE approval, the whole school. It replaces the per-arm
// carry-over wizard at /enrollments/bulk, which has been switched off since the
// 2026-08-25 incident and is not coming back: an admin rolling fourteen classes
// one arm at a time is how a half-finished roll happens, and a half-finished
// roll is what made that incident unrecoverable from the UI.
//
// Everything on this page comes from the server's preview. The page never
// decides who moves — it only lets an admin change what the server proposed,
// and the commit re-validates every row against the source term anyway.

const FIELD =
  "h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const ACTION_LABELS: Record<PromotionAction, string> = {
  PROMOTE: "Promote",
  REPEAT: "Repeat",
  GRADUATE: "Graduate",
  EXCLUDE: "Leave out",
};

export default function PromotePage() {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [termsByYear, setTermsByYear] = useState<Map<string, TermDto[]>>(
    new Map(),
  );
  const [arms, setArms] = useState<ClassArmDto[]>([]);

  const [sourceTermId, setSourceTermId] = useState<string>("");
  const [targetTermId, setTargetTermId] = useState<string>("");

  const [loadingShell, setLoadingShell] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [preview, setPreview] = useState<PromotionPreviewDto | null>(null);
  const [plan, setPlan] = useState<PromotionPlan>(new Map());

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [graduationsConfirmed, setGraduationsConfirmed] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<PromotionCommitResultDto | null>(null);

  // ---------- shell: years, all terms, levels, arms ----------
  const loadShell = useCallback(async () => {
    setLoadingShell(true);
    setShellError(null);
    try {
      const [yearList, armList] = await Promise.all([
        listAcademicYears(),
        listClassArms({ includeInactive: true }),
      ]);
      const termLists = await Promise.all(
        yearList.map((y) => listTerms(y.id).catch(() => [] as TermDto[])),
      );
      const map = new Map<string, TermDto[]>();
      yearList.forEach((y, i) => map.set(y.id, termLists[i] ?? []));

      setYears(yearList);
      setTermsByYear(map);
      setArms(armList);

      // Defaults: the current term as the TARGET, and the last term of the
      // previous year as the SOURCE. Shown in the pickers, never applied
      // silently — the admin reads both before any row is fetched.
      const flat = yearList.flatMap((y) => map.get(y.id) ?? []);
      const current = flat.find((t) => t.isCurrent);
      if (current) {
        setTargetTermId(current.id);
        const currentYearStart = yearList.find(
          (y) => y.id === current.academicYearId,
        )?.startDate;
        const previousYear = [...yearList]
          .filter(
            (y) =>
              currentYearStart !== undefined &&
              new Date(y.startDate).getTime() <
                new Date(currentYearStart).getTime(),
          )
          .sort(
            (a, b) =>
              new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
          )[0];
        const previousTerms = previousYear
          ? [...(map.get(previousYear.id) ?? [])].sort(
              (a, b) => b.sequence - a.sequence,
            )
          : [];
        if (previousTerms[0]) setSourceTermId(previousTerms[0].id);
      }
    } catch (e) {
      setShellError(
        e instanceof ApiError ? e.message : "Could not load your school year.",
      );
    } finally {
      setLoadingShell(false);
    }
  }, []);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  const armsByLevelId = useMemo(() => {
    const map = new Map<string, ClassArmDto[]>();
    for (const arm of arms) {
      if (!arm.isActive) continue;
      const list = map.get(arm.classLevelId) ?? [];
      list.push(arm);
      map.set(arm.classLevelId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    return map;
  }, [arms]);

  // ---------- preview ----------
  const loadPreview = useCallback(async () => {
    if (!sourceTermId || !targetTermId) return;
    setLoadingPreview(true);
    setPreviewError(null);
    // Deliberately does NOT clear `result`. A commit refreshes the preview so
    // the rows come back as "already placed", and clearing here wiped the
    // "Done" summary in the same tick it appeared — the admin saw a list reset
    // itself with no confirmation that anything had happened. A fresh preview
    // the ADMIN asked for clears it; this reload does not.
    try {
      const data = await previewPromotion({ sourceTermId, targetTermId });
      setPreview(data);
      setPlan(initialPlan(data));
      setGraduationsConfirmed(false);
    } catch (e) {
      setPreview(null);
      setPlan(new Map());
      setPreviewError(
        e instanceof ApiError
          ? e.message
          : "Could not work out who would move. Try again.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, [sourceTermId, targetTermId]);

  const candidates = useMemo(
    () => preview?.candidates ?? [],
    [preview],
  );
  const summary = useMemo(
    () => summarise(plan, candidates),
    [plan, candidates],
  );

  // Rows grouped by source arm, in the order the server sorted them.
  const groups = useMemo(() => {
    const map = new Map<string, PromotionCandidateDto[]>();
    for (const row of candidates) {
      const list = map.get(row.sourceClassArmId) ?? [];
      list.push(row);
      map.set(row.sourceClassArmId, list);
    }
    return [...map.entries()];
  }, [candidates]);

  // ---------- gap resolution ----------
  async function handleCreateArm(gap: PromotionArmGapDto) {
    try {
      await createClassArm(gap.destinationClassLevelId, {
        name: gap.suggestedArmName,
        code: gap.suggestedArmCode,
      });
      toast.success(`${gap.suggestedArmName} created.`);
      // Re-read arms AND the preview: the new arm changes the mapping for
      // every row in that source arm, and the server is the one that decides
      // the mapping.
      setArms(await listClassArms({ includeInactive: true }));
      await loadPreview();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "Could not create the class.",
      );
    }
  }

  function handleSendGapTo(gap: PromotionArmGapDto, destinationArmId: string) {
    setPlan((current) =>
      resolveArmGap(current, candidates, gap.sourceClassArmId, destinationArmId),
    );
  }

  // ---------- commit ----------
  async function handleCommit() {
    if (!preview) return;
    const decisions = toDecisions(plan, candidates);
    if (!decisions || decisions.length === 0) {
      toast.error("Nothing to apply yet.");
      return;
    }
    setCommitting(true);
    try {
      const outcome = await commitPromotion({
        sourceTermId: preview.sourceTerm.id,
        targetTermId: preview.targetTerm.id,
        decisions,
        ...(summary.graduate > 0 ? { confirmGraduations: true } : {}),
      });
      setResult(outcome);
      setConfirmOpen(false);
      toast.success(
        `${outcome.enrolled} student${outcome.enrolled === 1 ? "" : "s"} moved into ${preview.targetTerm.name}.`,
      );
      await loadPreview();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : "The promotion could not be applied.",
      );
    } finally {
      setCommitting(false);
    }
  }

  const commitBlocked =
    summary.actionable === 0 ||
    summary.unplaced > 0 ||
    (summary.graduate > 0 && !graduationsConfirmed);

  // ---------- render ----------
  if (loadingShell) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your school year…
      </div>
    );
  }

  if (shellError) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <p className="text-sm text-destructive">{shellError}</p>
        <Button variant="outline" className="w-fit" onClick={() => void loadShell()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/enrollments"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to enrollments
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Promote students
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Move every class up at once at the start of a new year — Primary 1
          into Primary 2, and so on, keeping each arm in order. Check the list,
          change anyone who is repeating or leaving, then approve it once.
        </p>
      </header>

      {/* ---------- term pickers ---------- */}
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Move students from</span>
          <select
            value={sourceTermId}
            onChange={(e) => setSourceTermId(e.target.value)}
            className={FIELD}
          >
            <option value="">Choose a term…</option>
            {years.map((year) => (
              <optgroup key={year.id} label={year.label}>
                {(termsByYear.get(year.id) ?? []).map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="font-medium">Into</span>
          <select
            value={targetTermId}
            onChange={(e) => setTargetTermId(e.target.value)}
            className={FIELD}
          >
            <option value="">Choose a term…</option>
            {years.map((year) => (
              <optgroup key={year.id} label={year.label}>
                {(termsByYear.get(year.id) ?? []).map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name}
                    {term.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <Button
          onClick={() => {
            setResult(null);
            void loadPreview();
          }}
          disabled={!sourceTermId || !targetTermId || loadingPreview}
        >
          {loadingPreview ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Show me the list
        </Button>
      </section>

      {previewError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {previewError}
        </p>
      ) : null}

      {result ? (
        <section className="flex flex-col gap-1 rounded-md border border-emerald-600/30 bg-emerald-600/5 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" /> Done
          </h2>
          <p className="text-sm text-muted-foreground">
            {result.enrolled} enrolled · {result.promoted} promoted ·{" "}
            {result.repeated} repeating · {result.graduated} graduated
            {result.skipped > 0
              ? ` · ${result.skipped} already had a place and were left alone`
              : ""}
          </p>
          {result.errors.length > 0 ? (
            <p className="text-sm text-destructive">
              {result.errors.length} row(s) could not be applied:{" "}
              {result.errors[0]?.reason}
            </p>
          ) : null}
        </section>
      ) : null}

      {preview ? (
        <>
          <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card p-4 text-sm">
            <span className="font-medium">
              {preview.sourceTerm.academicYearName} · {preview.sourceTerm.name}
              <ArrowRight className="mx-2 inline h-4 w-4" />
              {preview.targetTerm.academicYearName} · {preview.targetTerm.name}
            </span>
            <span className="text-muted-foreground">
              {preview.mode === "YEAR_PROMOTION"
                ? "New academic year — students move up a class."
                : "Same academic year — students stay in their class."}
            </span>
          </section>

          {preview.gaps.length > 0 ? (
            <section className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="h-4 w-4" />
                {preview.gaps.length} class
                {preview.gaps.length === 1 ? " has" : "es have"} nowhere to go
              </h2>
              {preview.gaps.map((gap) => (
                <div
                  key={gap.sourceClassArmId}
                  className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm">
                    <strong>{gap.sourceClassArmName}</strong> ({gap.studentCount}{" "}
                    student{gap.studentCount === 1 ? "" : "s"}) —{" "}
                    {gap.destinationClassLevelName} has no matching arm.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCreateArm(gap)}
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      Create {gap.suggestedArmName}
                    </Button>
                    <span className="text-xs text-muted-foreground">or</span>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) handleSendGapTo(gap, e.target.value);
                      }}
                      className={FIELD}
                    >
                      <option value="">Put them in an existing class…</option>
                      {gap.existingDestinationArms.map((arm) => (
                        <option key={arm.id} value={arm.id}>
                          {arm.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {candidates.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nobody was enrolled in {preview.sourceTerm.name}, so there is
              nobody to move. Enrol students in that term first, or pick a
              different term to move from.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {groups.map(([armId, rows]) => {
                const first = rows[0];
                if (!first) return null;
                return (
                  <section
                    key={armId}
                    className="flex flex-col gap-3 rounded-md border bg-card p-4"
                  >
                    <header className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base font-semibold">
                          {first.sourceClassArmName}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {first.sourceClassLevelName} · {rows.length} student
                          {rows.length === 1 ? "" : "s"}
                          {first.destinationClassLevelName
                            ? ` → ${first.destinationClassLevelName}`
                            : " · top class"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          Whole class:
                        </span>
                        {(
                          ["PROMOTE", "REPEAT", "EXCLUDE"] as PromotionAction[]
                        ).map((action) => (
                          <Button
                            key={action}
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setPlan((current) =>
                                setActionForArm(
                                  current,
                                  candidates,
                                  armId,
                                  action,
                                ),
                              )
                            }
                          >
                            {ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    </header>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase text-muted-foreground">
                          <tr>
                            <th className="py-2 pr-3 font-medium">Student</th>
                            <th className="py-2 pr-3 font-medium">Admission no.</th>
                            <th className="py-2 pr-3 font-medium">What happens</th>
                            <th className="py-2 pr-3 font-medium">Goes into</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const decision = plan.get(row.studentId);
                            const needsArm =
                              decision?.action === "PROMOTE" ||
                              decision?.action === "REPEAT";
                            const armOptionsLevelId =
                              decision?.action === "REPEAT"
                                ? row.sourceClassLevelId
                                : row.destinationClassLevelId;
                            const armOptions = armOptionsLevelId
                              ? (armsByLevelId.get(armOptionsLevelId) ?? [])
                              : [];
                            return (
                              <tr
                                key={row.studentId}
                                className="border-t align-middle"
                              >
                                <td className="py-2 pr-3">
                                  {row.displayName}
                                  {row.blockReason === "ALREADY_ENROLLED" ? (
                                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                      already placed
                                    </span>
                                  ) : null}
                                  {row.studentStatus !== "ACTIVE" ? (
                                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                                      {row.studentStatus.toLowerCase()}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-3 text-muted-foreground">
                                  {row.admissionNumber}
                                </td>
                                <td className="py-2 pr-3">
                                  <select
                                    value={decision?.action ?? "EXCLUDE"}
                                    onChange={(e) =>
                                      setPlan((current) =>
                                        setAction(
                                          current,
                                          row,
                                          e.target.value as PromotionAction,
                                        ),
                                      )
                                    }
                                    className={FIELD}
                                  >
                                    {(
                                      Object.keys(
                                        ACTION_LABELS,
                                      ) as PromotionAction[]
                                    ).map((action) => (
                                      <option key={action} value={action}>
                                        {ACTION_LABELS[action]}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-2 pr-3">
                                  {needsArm ? (
                                    <select
                                      value={decision?.classArmId ?? ""}
                                      onChange={(e) =>
                                        setPlan((current) =>
                                          setClassArm(
                                            current,
                                            row.studentId,
                                            e.target.value,
                                          ),
                                        )
                                      }
                                      className={`${FIELD} ${
                                        decision?.classArmId
                                          ? ""
                                          : "border-destructive"
                                      }`}
                                    >
                                      <option value="">Choose a class…</option>
                                      {armOptions.map((arm) => (
                                        <option key={arm.id} value={arm.id}>
                                          {arm.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* ---------- summary + approve ---------- */}
          {candidates.length > 0 ? (
            <section className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span>
                  <strong>{summary.promote}</strong> promoted
                </span>
                <span>
                  <strong>{summary.repeat}</strong> repeating
                </span>
                <span>
                  <strong>{summary.graduate}</strong> graduating
                </span>
                <span>
                  <strong>{summary.exclude}</strong> left out
                </span>
                {summary.unplaced > 0 ? (
                  <span className="text-destructive">
                    {summary.unplaced} still need a class
                  </span>
                ) : null}
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={summary.actionable === 0 || summary.unplaced > 0}
              >
                Review and approve
              </Button>
            </section>
          ) : null}
        </>
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply this promotion?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {summary.promote} student{summary.promote === 1 ? "" : "s"} will be
              promoted, {summary.repeat} will repeat, and {summary.exclude} will
              be left exactly as they are, in{" "}
              <strong>
                {preview?.targetTerm.academicYearName} ·{" "}
                {preview?.targetTerm.name}
              </strong>
              .
            </p>
            {summary.graduate > 0 ? (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <input
                  type="checkbox"
                  checked={graduationsConfirmed}
                  onChange={(e) => setGraduationsConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <GraduationCap className="mr-1 inline h-4 w-4" />
                  <strong>{summary.graduate}</strong> student
                  {summary.graduate === 1 ? "" : "s"} will be marked as having
                  left the school. They will come off your roster.
                </span>
              </label>
            ) : null}
            <p className="text-muted-foreground">
              You can run this again afterwards — students who already have a
              place are left alone.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCommit()}
              disabled={commitBlocked || committing}
            >
              {committing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Apply to {summary.actionable} student
              {summary.actionable === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
