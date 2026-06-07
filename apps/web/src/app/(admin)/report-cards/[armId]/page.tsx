"use client";

import { ArrowLeft, CheckCircle2, Download, FileText, Loader2, RefreshCw, RotateCcw, Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { ReportCardBoardRowDto, ReportCardStatusDto } from "@school-kit/types";

import { PdfStatusBadge, WorkflowStatusBadge } from "@/components/report-cards/status-badges";
import { ReopenModal } from "@/components/report-cards/reopen-modal";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import {
  approveArm,
  buildReportCards,
  formReviewArm,
  getReportCardBoard,
  getReportCardPdfUrl,
  releaseArm,
  renderReportCards,
  reopenArm,
} from "@/lib/report-cards/report-card-api";
import { formatAverage, formatInt, formatOrdinal, formatStamp, fullStudentName } from "@/lib/report-cards/format";
import { openInNewTab } from "@/lib/report-cards/open-in-new-tab";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "out-of-scope" }
  | { kind: "no-term" }
  | { kind: "ready"; armName: string; termId: string; termName: string };

const POLL_MS = 4000;

export default function ReportCardBoardPage() {
  const params = useParams<{ armId: string }>();
  const armId = params.armId;
  const search = useSearchParams();
  const queryTermId = search.get("termId");
  const { roles } = useAuth();
  const canManage = useMemo(() => roles.some((r) => r.key === "owner" || r.key === "admin"), [roles]);
  const isOwner = useMemo(() => roles.some((r) => r.key === "owner"), [roles]);

  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [rows, setRows] = useState<ReportCardBoardRowDto[]>([]);
  const [building, setBuilding] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  // Resolve the arm name + term (manager: arms/terms APIs; form teacher: scope),
  // then load the board feed.
  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      let armName: string | null = null;
      let termId = queryTermId;
      let termName = "";

      if (canManage) {
        const arms = await listClassArms();
        armName = arms.find((a) => a.id === armId)?.name ?? null;
        if (!termId || !termName) {
          const years = await listAcademicYears();
          const currentYear = years.find((y) => y.isCurrent) ?? years[0] ?? null;
          const terms = currentYear ? await listTerms(currentYear.id) : [];
          const term = (termId ? terms.find((t) => t.id === termId) : null) ?? terms.find((t) => t.isCurrent) ?? terms[0] ?? null;
          termId = term?.id ?? null;
          termName = term?.name ?? "";
        }
      } else {
        const scope = await getMyScope();
        // Flag-B gate: a form teacher may only open arms they form-teach.
        if (!scope.formTeacherArmIds.includes(armId)) {
          setStatus({ kind: "out-of-scope" });
          return;
        }
        armName = scope.classArms.find((a) => a.id === armId)?.name ?? null;
        termId = scope.currentTerm?.id ?? null;
        termName = scope.currentTerm?.name ?? "";
      }

      if (armName === null) {
        setStatus({ kind: "out-of-scope" });
        return;
      }
      if (!termId) {
        setStatus({ kind: "no-term" });
        return;
      }

      const board = await getReportCardBoard(termId, armId);
      setRows(board.data);
      setStatus({ kind: "ready", armName, termId, termName });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setStatus({ kind: "out-of-scope" });
        return;
      }
      setStatus({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load the report-card board.",
      });
    }
  }, [armId, queryTermId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh just the board feed (used by polling + after actions), keeping the
  // resolved header context.
  const refreshRows = useCallback(
    async (termId: string) => {
      try {
        const board = await getReportCardBoard(termId, armId);
        setRows(board.data);
      } catch {
        // Transient; the next poll tick (or a manual reload) recovers.
      }
    },
    [armId],
  );

  // The arm's single workflow status (invariant: all cards share it). "MIXED" is
  // a defensive case that shouldn't occur by the batch-transition invariant.
  const armStatus = useMemo<ReportCardStatusDto | "MIXED" | null>(() => {
    if (rows.length === 0) return null;
    const set = new Set(rows.map((r) => r.reportCard.status));
    return set.size === 1 ? ([...set][0] as ReportCardStatusDto) : "MIXED";
  }, [rows]);

  // Cards with an active render: GENERATING, OR a RELEASED card still PENDING
  // (just-released, awaiting the worker → GENERATING → GENERATED). A PENDING card
  // in a non-RELEASED arm is un-rendered-by-design, not pending work.
  const ready = status.kind === "ready" ? status : null;
  const renderingCount = rows.filter((r) => {
    const p = r.reportCard.pdfStatus;
    return p === "GENERATING" || (p === "PENDING" && r.reportCard.status === "RELEASED");
  }).length;
  const failedCount = rows.filter((r) => r.reportCard.pdfStatus === "FAILED").length;
  // Drives the polling loop, the "Rendering…" banner, and the workflow-button
  // disable. True the instant release flips cards to GENERATING (optimistic).
  const shouldPoll = renderingCount > 0;
  const refreshRef = useRef(refreshRows);
  refreshRef.current = refreshRows;
  useEffect(() => {
    if (!ready || !shouldPoll) return;
    const id = setInterval(() => void refreshRef.current(ready.termId), POLL_MS);
    return () => clearInterval(id);
  }, [ready, shouldPoll]);

  const onBuild = useCallback(async () => {
    if (!ready) return;
    setBuilding(true);
    try {
      const result = await buildReportCards(ready.termId, armId);
      toast.success(`Built ${result.cardCount} report card${result.cardCount === 1 ? "" : "s"} for ${result.studentCount} student${result.studentCount === 1 ? "" : "s"}.`);
      await refreshRows(ready.termId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not build report cards.");
    } finally {
      setBuilding(false);
    }
  }, [ready, armId, refreshRows]);

  const onRenderAll = useCallback(async () => {
    if (!ready) return;
    setRendering(true);
    try {
      const result = await renderReportCards(ready.termId, armId);
      toast.success(`Generating ${result.enqueuedCount} PDF${result.enqueuedCount === 1 ? "" : "s"}…`);
      // Optimistically flip every card to GENERATING so polling starts.
      setRows((prev) => prev.map((r) => ({ ...r, reportCard: { ...r.reportCard, pdfStatus: "GENERATING" } })));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start PDF generation.");
    } finally {
      setRendering(false);
    }
  }, [ready, armId]);

  const onRegenerate = useCallback(
    async (reportCardId: string) => {
      if (!ready) return;
      try {
        await renderReportCards(ready.termId, armId, reportCardId);
        toast.success("Regenerating PDF…");
        setRows((prev) =>
          prev.map((r) =>
            r.reportCard.id === reportCardId
              ? { ...r, reportCard: { ...r.reportCard, pdfStatus: "GENERATING" } }
              : r,
          ),
        );
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not regenerate the PDF.");
      }
    },
    [ready, armId],
  );

  const onDownload = useCallback(async (reportCardId: string) => {
    try {
      const { signedUrl } = await getReportCardPdfUrl(reportCardId);
      // Anchor-click, NOT window.open(): the await above broke the synchronous
      // user-gesture chain, so window.open() gets silently popup-blocked. A
      // programmatic <a target=_blank>.click() inside the handler is treated as
      // direct user navigation by all major browsers.
      openInNewTab(signedUrl);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't get download link — try again.");
    }
  }, []);

  // Run an arm-level workflow transition, then refresh the board. On release we
  // optimistically flip cards to RELEASED+GENERATING so the rendering banner +
  // spinners show immediately (polling reconciles against server truth).
  const runWorkflow = useCallback(
    async (action: () => Promise<void>, optimisticRelease = false) => {
      if (!ready) return;
      setWorkflowBusy(true);
      try {
        await action();
        if (optimisticRelease) {
          // GENERATING (not PENDING): the server briefly shows PENDING before the
          // worker picks up, but GENERATING gives immediate "working" feedback
          // (spinner + "Generating…" badge + the rendering banner); polling
          // reconciles within a tick. Mirrors Render-all's optimism.
          setRows((prev) => prev.map((r) => ({ ...r, reportCard: { ...r.reportCard, status: "RELEASED", pdfStatus: "GENERATING" } })));
        }
        await refreshRows(ready.termId);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Action failed — try again.");
      } finally {
        setWorkflowBusy(false);
      }
    },
    [ready, refreshRows],
  );

  const onFormReview = useCallback(() => {
    if (!ready) return;
    const termId = ready.termId;
    void runWorkflow(async () => {
      await formReviewArm(termId, armId);
      toast.success("Arm submitted for form review.");
    });
  }, [ready, armId, runWorkflow]);

  const onApprove = useCallback(() => {
    if (!ready) return;
    const termId = ready.termId;
    void runWorkflow(async () => {
      await approveArm(termId, armId);
      toast.success("Arm approved.");
    });
  }, [ready, armId, runWorkflow]);

  const onRelease = useCallback(() => {
    if (!ready) return;
    const termId = ready.termId;
    void runWorkflow(async () => {
      const r = await releaseArm(termId, armId);
      toast.success(`Released ${r.cardCount} report card${r.cardCount === 1 ? "" : "s"} — generating PDFs…`);
    }, true);
  }, [ready, armId, runWorkflow]);

  // Reopen is its own handler (modal-driven, reason required). Kept open on error
  // so the user can retry (e.g. the ARM_RENDER_IN_FLIGHT race guard).
  const onReopen = useCallback(
    async (reason: string) => {
      if (!ready) return;
      try {
        await reopenArm(ready.termId, armId, reason);
        toast.success("Arm reopened to draft.");
        setReopenOpen(false);
        await refreshRows(ready.termId);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not reopen — try again.");
      }
    },
    [ready, armId, refreshRows],
  );

  const lastBuilt = useMemo(() => {
    if (rows.length === 0) return null;
    return rows
      .map((r) => new Date(r.reportCard.createdAt).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
  }, [rows]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link
        href="/report-cards"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All classes
      </Link>

      {status.kind === "loading" ? (
        <BoardSkeleton />
      ) : status.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {status.message}
        </div>
      ) : status.kind === "out-of-scope" ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">This isn&apos;t one of your classes.</p>
          <p className="mt-1">You can only open report cards for a class you are the form teacher of.</p>
        </div>
      ) : status.kind === "no-term" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 p-8 text-sm text-amber-800">
          <p className="font-medium">No active term.</p>
          <p className="mt-1">Ask an administrator to set the current term before building report cards.</p>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{status.armName}</h1>
              <p className="text-sm text-muted-foreground">
                {status.termName} · {rows.length} report card{rows.length === 1 ? "" : "s"}
                {lastBuilt ? ` · last built ${formatStamp(new Date(lastBuilt))}` : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Build — only when the board is empty (owner/admin). */}
              {canManage && rows.length === 0 && (
                <button
                  type="button"
                  onClick={onBuild}
                  disabled={building}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {building ? "Building…" : "Build report cards"}
                </button>
              )}

              {armStatus === "MIXED" && (
                <p className="inline-flex items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <TriangleAlert className="h-4 w-4" />
                  Arm cards are in inconsistent states — contact administrator.
                </p>
              )}

              {/* Form-review — DRAFT / SUBJECT_REVIEWED. owner/admin OR form teacher
                  (anyone who can open this board), gated server-side. */}
              {(armStatus === "DRAFT" || armStatus === "SUBJECT_REVIEWED") && (
                <button
                  type="button"
                  onClick={onFormReview}
                  disabled={workflowBusy || shouldPoll}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {workflowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Form-review arm
                </button>
              )}

              {/* Approve — FORM_REVIEWED (owner/admin). */}
              {armStatus === "FORM_REVIEWED" && canManage && (
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={workflowBusy || shouldPoll}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {workflowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve arm
                </button>
              )}

              {/* Release — PRINCIPAL_APPROVED (owner/admin). */}
              {armStatus === "PRINCIPAL_APPROVED" && canManage && (
                <button
                  type="button"
                  onClick={onRelease}
                  disabled={workflowBusy || shouldPoll}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {workflowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Release arm
                </button>
              )}

              {/* Render all PDFs — RELEASED, re-render existing artifacts (owner/admin). */}
              {armStatus === "RELEASED" && canManage && (
                <button
                  type="button"
                  onClick={onRenderAll}
                  disabled={rendering || shouldPoll}
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {rendering ? "Enqueueing…" : "Render all PDFs"}
                </button>
              )}

              {/* Reopen — OWNER only (admin excluded), from any finalised state. */}
              {isOwner && (armStatus === "FORM_REVIEWED" || armStatus === "PRINCIPAL_APPROVED" || armStatus === "RELEASED") && (
                <button
                  type="button"
                  onClick={() => setReopenOpen(true)}
                  disabled={workflowBusy || shouldPoll}
                  className="inline-flex items-center gap-2 rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reopen arm
                </button>
              )}
            </div>

            {/* Persistent render-progress feedback — survives fast batches that
                finish before the first poll tick, and slow 40-card batches. */}
            {renderingCount > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                <Loader2 className="h-4 w-4 animate-spin" />
                Rendering {renderingCount} report card{renderingCount === 1 ? "" : "s"}…
                {failedCount > 0 ? ` · ${failedCount} failed` : ""}
              </div>
            ) : failedCount > 0 && armStatus === "RELEASED" ? (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <TriangleAlert className="h-4 w-4" />
                {failedCount} report card{failedCount === 1 ? "" : "s"} failed to render — use Regenerate on the affected
                rows below.
              </div>
            ) : null}
          </header>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No report cards yet.</p>
              <p className="mt-1">
                {canManage
                  ? "Click “Build report cards” to generate them from the scores already entered."
                  : "No report cards have been built for this class yet."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Student</th>
                    <th className="px-3 py-2 font-medium text-center">Subjects</th>
                    <th className="px-3 py-2 font-medium text-center">Total</th>
                    <th className="px-3 py-2 font-medium text-center">Average</th>
                    <th className="px-3 py-2 font-medium text-center">Position</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">PDF</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(({ student, reportCard }) => (
                    <tr key={reportCard.id} className="hover:bg-accent/20">
                      <td className="px-3 py-2">
                        <div className="font-medium">{fullStudentName(student)}</div>
                        <div className="text-xs text-muted-foreground">{student.admissionNumber}</div>
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatInt(reportCard.subjectsCount)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatInt(reportCard.overallTotal)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatAverage(reportCard.overallAverage)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatOrdinal(reportCard.overallPosition)}</td>
                      <td className="px-3 py-2">
                        <WorkflowStatusBadge status={reportCard.status} />
                      </td>
                      <td className="px-3 py-2">
                        <PdfStatusBadge status={reportCard.pdfStatus} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/report-cards/${armId}/${reportCard.id}`}
                            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            View
                          </Link>
                          {reportCard.pdfStatus === "GENERATED" && (
                            <button
                              type="button"
                              onClick={() => void onDownload(reportCard.id)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                            >
                              <Download className="h-3.5 w-3.5" />
                              PDF
                            </button>
                          )}
                          {canManage && (reportCard.pdfStatus === "GENERATED" || reportCard.pdfStatus === "FAILED") && (
                            <button
                              type="button"
                              onClick={() => void onRegenerate(reportCard.id)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                              Regenerate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <ReopenModal open={reopenOpen} onClose={() => setReopenOpen(false)} onSubmit={onReopen} />
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="overflow-hidden rounded-md border">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-3 py-3 last:border-b-0">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
