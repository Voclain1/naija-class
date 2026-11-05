import type { ReportCardBoardResponse, ReportCardStatusDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { fullStudentName } from "@/lib/report-cards/format";

export function ReportCardRoster({
  roster, cardCount, status, canManage, isOwner, busy, onBuild,
}: {
  // Allow the previous API response during a rolling deploy.
  roster: ReportCardBoardResponse["roster"] | null;
  cardCount: number;
  status: ReportCardStatusDto | "MIXED" | null;
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  onBuild: () => void;
}) {
  const missing = roster?.missingStudents ?? [];
  const canRebuild = canManage && status === "DRAFT" && cardCount > 0;
  if (!roster && !canRebuild) return null;

  return (
    <section aria-label="Report-card roster" className={`rounded-md p-4 text-sm ${missing.length ? "bg-amber-50 text-amber-900" : "bg-muted/20"}`}>
      {roster && (
        <p>{roster.enrolledCount} enrolled student{roster.enrolledCount === 1 ? "" : "s"} · {cardCount} report card{cardCount === 1 ? "" : "s"}. Existing cards are kept when enrollment changes.</p>
      )}
      {missing.length > 0 && (
        <>
          <p className="mt-2 font-medium">{missing.length} enrolled student{missing.length === 1 ? " is" : "s are"} missing a report card:</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((student) => <li key={student.id}>{fullStudentName(student)} ({student.admissionNumber})</li>)}
          </ul>
          <p className="mt-2">
            {status === null || status === "DRAFT"
              ? canManage ? "Build report cards to include these students." : "Ask an administrator to build report cards for these students."
              : status === "MIXED"
                ? "Ask the school owner to resolve the workflow states before rebuilding."
                : isOwner
                  ? "Use Reopen arm with a reason, then rebuild the draft cards. Review and release them again when ready."
                  : "Ask the school owner to reopen this class, then have an administrator rebuild the draft cards."}
          </p>
        </>
      )}
      {canRebuild && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <p>Rebuilding adds missing enrolled students and refreshes scores and attendance. Existing comments are kept.</p>
          <Button type="button" variant="outline" onClick={onBuild} disabled={busy}>
            {busy ? "Building…" : "Rebuild draft report cards"}
          </Button>
        </div>
      )}
    </section>
  );
}
