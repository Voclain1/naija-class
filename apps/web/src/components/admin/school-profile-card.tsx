import Link from "next/link";

import type { DashboardSchoolProfileDto, DashboardSetupBlockerType } from "@school-kit/types";

// School profile card.
//
// There is deliberately NO status light on this card. A green "all systems
// operational" dot could only ever render when the API is already up, so it
// would be tautological — and tautology shaped like assurance is worse than no
// indicator at all. There is also no "last synced" line, because this codebase
// has no sync concept to report on; inventing a timestamp for a process that
// does not exist is the same failure wearing a technical costume.
//
// What is here instead: plain facts, ratios that always show their
// denominator, timestamps of activity that actually happened, and setup
// blockers that name a real unmet precondition with a link to fix it.

const BLOCKER_COPY: Record<DashboardSetupBlockerType, { title: string; action: string }> = {
  no_academic_year: {
    title: "No academic year has been set up yet.",
    action: "Set one up in Settings → Academic",
  },
  no_current_academic_year: {
    title: "No academic year is marked as current.",
    action: "Mark one current in Settings → Academic",
  },
  no_current_term: {
    // The highest-value line on this card. isCurrent is set by hand, never
    // derived from dates, and when it is unset the finance dashboard, the
    // student roster and enrollment all go quietly empty with no error.
    title: "No term is marked as current.",
    action: "Mark one current in Settings → Academic",
  },
  no_fee_structure: {
    title: "No fees are set up for this term.",
    action: "Add fee items in Finance → Fees",
  },
};

/** "6 of 9", or an em dash when the denominator itself is missing. */
function Ratio({ done, total }: { done: number; total: number }) {
  if (total === 0) {
    // Never 0% or 100% of nothing — both would assert something the data does
    // not support.
    return <span className="font-serif text-2xl text-muted-foreground">—</span>;
  }
  return (
    <span className="font-serif text-2xl text-foreground">
      {done} <span className="text-base text-muted-foreground">of {total}</span>
    </span>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SchoolProfileCard({ profile }: { profile: DashboardSchoolProfileDto }) {
  const { academicYear, term, completeness, lastActivity, setupBlockers } = profile;

  return (
    <div className="space-y-5">
      {/* ─── Facts ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Academic year</p>
          <p className="font-medium text-foreground">{academicYear?.label ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current term</p>
          <p className="font-medium text-foreground">{term?.name ?? "Not set"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Staff</p>
          <p className="font-medium text-foreground">{profile.staffCount}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Active classes</p>
          <p className="font-medium text-foreground">{profile.activeClassCount}</p>
        </div>
      </div>

      {/* ─── Completeness ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Classes marked today</p>
          <Ratio {...completeness.attendanceToday} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Students invoiced this term</p>
          <Ratio {...completeness.studentsInvoiced} />
        </div>
      </div>

      {/* ─── Last real activity ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
        <p className="text-muted-foreground">
          Attendance last marked{" "}
          <span className="font-medium text-foreground">
            {relativeTime(lastActivity.attendanceMarkedAt)}
          </span>
        </p>
        <p className="text-muted-foreground">
          Payment last recorded{" "}
          <span className="font-medium text-foreground">
            {relativeTime(lastActivity.paymentRecordedAt)}
          </span>
        </p>
      </div>

      {/* ─── Setup blockers — only when genuinely unmet ────────────────── */}
      {setupBlockers.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          {setupBlockers.map((b) => {
            const copy = BLOCKER_COPY[b.type];
            return (
              <div key={b.type} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{copy.title}</p>
                <Link
                  href={b.href}
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {copy.action}
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
