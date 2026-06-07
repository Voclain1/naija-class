"use client";

import { ArrowLeft, Download, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { ReportCardDetailDto } from "@school-kit/types";

import { PdfStatusBadge, WorkflowStatusBadge } from "@/components/report-cards/status-badges";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import {
  getReportCardById,
  getReportCardPdfUrl,
  renderReportCards,
  updateFormTeacherComment,
  updatePrincipalNote,
} from "@/lib/report-cards/report-card-api";
import { formatAverage, formatInt, formatOrdinal, fullStudentName } from "@/lib/report-cards/format";
import { openInNewTab } from "@/lib/report-cards/open-in-new-tab";

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "not-found" }
  | { kind: "ready"; data: ReportCardDetailDto };

const POLL_MS = 4000;

export default function ReportCardDetailPage() {
  const params = useParams<{ armId: string; reportCardId: string }>();
  const { armId, reportCardId } = params;
  const { roles } = useAuth();
  const canManage = useMemo(() => roles.some((r) => r.key === "owner" || r.key === "admin"), [roles]);

  const [status, setStatus] = useState<Status>({ kind: "loading" });

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setStatus({ kind: "loading" });
      try {
        const data = await getReportCardById(reportCardId);
        setStatus({ kind: "ready", data });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setStatus({ kind: "not-found" });
          return;
        }
        setStatus({
          kind: "error",
          message: e instanceof ApiError ? e.message : "Could not load the report card.",
        });
      }
    },
    [reportCardId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a render is active: GENERATING, or RELEASED+PENDING (just-released,
  // awaiting the worker) so the badge + download action update.
  const card = status.kind === "ready" ? status.data.reportCard : null;
  const shouldPoll = card
    ? card.pdfStatus === "GENERATING" || (card.pdfStatus === "PENDING" && card.status === "RELEASED")
    : false;
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll, load]);

  const onDownload = useCallback(async () => {
    try {
      const { signedUrl } = await getReportCardPdfUrl(reportCardId);
      // Anchor-click, NOT window.open(): the await above broke the synchronous
      // user-gesture chain, so window.open() gets silently popup-blocked.
      openInNewTab(signedUrl);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't get download link — try again.");
    }
  }, [reportCardId]);

  const onRegenerate = useCallback(async () => {
    if (status.kind !== "ready") return;
    const { termId, classArmId } = status.data.reportCard;
    try {
      await renderReportCards(termId, classArmId, reportCardId);
      toast.success("Regenerating PDF…");
      setStatus((prev) =>
        prev.kind === "ready"
          ? { ...prev, data: { ...prev.data, reportCard: { ...prev.data.reportCard, pdfStatus: "GENERATING" } } }
          : prev,
      );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not regenerate the PDF.");
    }
  }, [status, reportCardId]);

  const onSaveFormComment = useCallback(
    async (value: string | null) => {
      try {
        await updateFormTeacherComment(reportCardId, value);
        toast.success("Comment saved.");
        await load(true);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not save the comment.");
      }
    },
    [reportCardId, load],
  );

  const onSavePrincipalNote = useCallback(
    async (value: string | null) => {
      if (status.kind !== "ready") return;
      const { termId, classArmId } = status.data.reportCard;
      try {
        await updatePrincipalNote(termId, classArmId, value);
        toast.success("Principal's note saved — it applies to every card in this arm.");
        await load(true);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : "Could not save the principal's note.");
      }
    },
    [status, load],
  );

  // Component columns (CA1/CA2/Exam…) from the first subject — consistent across
  // subjects, mirroring how the PDF template derives its header.
  const componentLabels = useMemo(() => {
    if (status.kind !== "ready") return [];
    return status.data.subjects[0]?.components.map((c) => c.label) ?? [];
  }, [status]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link
        href={`/report-cards/${armId}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to board
      </Link>

      {status.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : status.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {status.message}
        </div>
      ) : status.kind === "not-found" ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Report card not found.</p>
          <p className="mt-1">It may have been removed, or it isn&apos;t one of your classes.</p>
        </div>
      ) : (
        <ReportCardDetail
          data={status.data}
          componentLabels={componentLabels}
          canManage={canManage}
          onDownload={onDownload}
          onRegenerate={onRegenerate}
          onSaveFormComment={onSaveFormComment}
          onSavePrincipalNote={onSavePrincipalNote}
        />
      )}
    </div>
  );
}

function ReportCardDetail({
  data,
  componentLabels,
  canManage,
  onDownload,
  onRegenerate,
  onSaveFormComment,
  onSavePrincipalNote,
}: {
  data: ReportCardDetailDto;
  componentLabels: string[];
  canManage: boolean;
  onDownload: () => void;
  onRegenerate: () => void;
  onSaveFormComment: (value: string | null) => Promise<void>;
  onSavePrincipalNote: (value: string | null) => Promise<void>;
}) {
  const { reportCard, student, subjects } = data;
  // Form comment: editable in DRAFT/SUBJECT_REVIEWED by anyone who can open the
  // card (owner/admin or the arm's form teacher — the read gate already ensures
  // that). Principal note: owner/admin, FORM_REVIEWED only.
  const formEditable = reportCard.status === "DRAFT" || reportCard.status === "SUBJECT_REVIEWED";
  const principalEditable = canManage && reportCard.status === "FORM_REVIEWED";

  return (
    <>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{fullStudentName(student)}</h1>
            <p className="text-sm text-muted-foreground">{student.admissionNumber}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WorkflowStatusBadge status={reportCard.status} />
            <PdfStatusBadge status={reportCard.pdfStatus} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {reportCard.pdfStatus === "GENERATED" && (
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
          )}
          {canManage && (reportCard.pdfStatus === "GENERATED" || reportCard.pdfStatus === "FAILED") && (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </button>
          )}
        </div>
      </header>

      {subjects.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">No scores entered for this student.</p>
          <p className="mt-1">The card has no content yet — enter and sign off scores first.</p>
        </div>
      ) : (
        <>
          {/* Per-subject breakdown */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Subject</th>
                  {componentLabels.map((label) => (
                    <th key={label} className="px-3 py-2 font-medium text-center">
                      {label}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium text-center">Total</th>
                  <th className="px-3 py-2 font-medium text-center">Grade</th>
                  <th className="px-3 py-2 font-medium text-center">Position</th>
                  <th className="px-3 py-2 font-medium">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {subjects.map((subject) => (
                  <tr key={subject.subjectId} className="hover:bg-accent/20">
                    <td className="px-3 py-2 font-medium">{subject.subjectName}</td>
                    {subject.components.map((c) => (
                      <td key={c.componentId} className="px-3 py-2 text-center tabular-nums">
                        {formatInt(c.score)}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center font-semibold tabular-nums">{subject.totalScore}</td>
                    <td className="px-3 py-2 text-center">{subject.letterGrade ?? "—"}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{formatOrdinal(subject.subjectPosition)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{subject.subjectComment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rollup */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RollupBox label="Subjects" value={formatInt(reportCard.subjectsCount)} />
            <RollupBox label="Total score" value={formatInt(reportCard.overallTotal)} />
            <RollupBox label="Average" value={formatAverage(reportCard.overallAverage)} />
            <RollupBox label="Position in class" value={formatOrdinal(reportCard.overallPosition)} />
          </section>
        </>
      )}

      {/* Comments — editable in the state windows the workflow allows (slice 6). */}
      <section className="flex flex-col gap-4">
        <EditableComment
          title="Form teacher's comment"
          body={reportCard.formTeacherComment}
          editable={formEditable}
          placeholder="Write a comment about this student's term…"
          onSave={onSaveFormComment}
        />
        <EditableComment
          title="Principal's remark"
          body={reportCard.principalNote}
          editable={principalEditable}
          placeholder="Write the principal's remark for this arm…"
          explanation="This note appears on all report cards in this arm. Editing here updates all cards."
          onSave={onSavePrincipalNote}
        />
      </section>
    </>
  );
}

// A comment field that is an editable textarea (with a change-gated Save) in the
// allowed states, and a read-only display otherwise. Save is disabled until the
// content differs from the server value (no no-op writes). Empty → null (clear).
function EditableComment({
  title,
  body,
  editable,
  placeholder,
  explanation,
  onSave,
}: {
  title: string;
  body: string | null;
  editable: boolean;
  placeholder: string;
  explanation?: string;
  onSave: (value: string | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(body ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(body ?? "");
  }, [body]);

  if (!editable) return <CommentBlock title={title} body={body} />;

  const normalized = draft.trim() === "" ? null : draft;
  const changed = normalized !== (body ?? null);
  const save = async () => {
    if (!changed || saving) return;
    setSaving(true);
    try {
      await onSave(normalized);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {explanation && <p className="text-xs text-muted-foreground">{explanation}</p>}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={3}
        placeholder={placeholder}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!changed || saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </button>
      </div>
    </div>
  );
}

function RollupBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CommentBlock({ title, body }: { title: string; body: string | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      <div className="min-h-[2.5rem] whitespace-pre-wrap rounded-md border bg-muted/10 px-3 py-2 text-sm">
        {body ? body : <span className="italic text-muted-foreground">Not yet written</span>}
      </div>
    </div>
  );
}
