import type { withTenant } from "@school-kit/db";
import { TERM_HEALTH_HREFS, type TermHealthSignalCode, type TermHealthSignalDto } from "@school-kit/types";

// Phase 8 / CP2 — term health signals (docs/modules/phase-8.md §16 D32).
//
// ONE raw query, taking the CALLER'S tenant transaction handle. Two callers:
//   * CompletenessService (the report);
//   * DashboardService (§16 Q33's alert), which runs every read inside exactly
//     ONE transaction — dashboard-transaction.spec.ts gates that, because a
//     second pooled connection once deadlocked production. So this must never
//     open its own withTenant, and must stay a single round trip.
//
// Runs inside withTenant, so RLS applies; every subquery ALSO filters school_id
// explicitly (CLAUDE.md raw-SQL rule — belt and braces).
//
// Two kinds of signal, deliberately:
//   * about the SCHOOL'S CURRENT TERM, whichever term is being viewed —
//     NO_CURRENT_TERM, CURRENT_TERM_ENDED, NEXT_TERM_NOT_CURRENT. A stale
//     "current" term breaks attendance, invoicing and the dashboard for every
//     view, so it is shown even when browsing a past term.
//   * about the SELECTED term (the current one by default) — enrollment and
//     teacher coverage for the arms that have students in it.

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

interface HealthRow {
  has_current: number;
  current_ended: boolean | null;
  current_end: string | null;
  later_term_exists: boolean;
  has_selected: number;
  active_students: number;
  enrolled: number;
  prev_enrolled: number;
  arms_no_form: string[];
  arms_no_subject: string[];
}

const HEALTH_SQL = `
WITH cur AS (
  SELECT id, end_date FROM terms WHERE school_id = $1 AND is_current LIMIT 1
),
sel AS (
  SELECT t.id, t.start_date, t.academic_year_id
  FROM terms t
  WHERE t.school_id = $1 AND t.id = COALESCE($2::text, (SELECT id FROM cur))
),
prev AS (
  SELECT p.id FROM terms p, sel
  WHERE p.school_id = $1 AND p.end_date < sel.start_date
  ORDER BY p.end_date DESC
  LIMIT 1
),
enr AS (
  SELECT e.class_arm_id, count(*) AS n
  FROM enrollments e, sel
  WHERE e.school_id = $1 AND e.term_id = sel.id AND e.status = 'ENROLLED'
  GROUP BY e.class_arm_id
)
SELECT
  (SELECT count(*) FROM cur)::int                                             AS has_current,
  (SELECT end_date < $3::date FROM cur)                                       AS current_ended,
  (SELECT end_date::text FROM cur)                                            AS current_end,
  EXISTS (SELECT 1 FROM terms t, cur WHERE t.school_id = $1 AND t.start_date > cur.end_date) AS later_term_exists,
  (SELECT count(*) FROM sel)::int                                             AS has_selected,
  (SELECT count(*) FROM students WHERE school_id = $1 AND status = 'ACTIVE')::int AS active_students,
  (SELECT COALESCE(sum(n), 0) FROM enr)::int                                  AS enrolled,
  (SELECT count(*) FROM enrollments e, prev
     WHERE e.school_id = $1 AND e.term_id = prev.id AND e.status = 'ENROLLED')::int AS prev_enrolled,
  (SELECT COALESCE(json_agg(a.name ORDER BY a.name), '[]'::json)
     FROM enr JOIN class_arms a ON a.id = enr.class_arm_id AND a.school_id = $1
     WHERE a.class_teacher_id IS NULL)                                        AS arms_no_form,
  (SELECT COALESCE(json_agg(a.name ORDER BY a.name), '[]'::json)
     FROM enr JOIN class_arms a ON a.id = enr.class_arm_id AND a.school_id = $1, sel
     WHERE NOT EXISTS (
       SELECT 1 FROM teacher_assignments ta
       WHERE ta.school_id = $1 AND ta.class_arm_id = a.id AND ta.is_active
         AND (ta.term_id = sel.id OR (ta.term_id IS NULL AND ta.academic_year_id = sel.academic_year_id))
     ))                                                                       AS arms_no_subject
`;

function signal(code: TermHealthSignalCode, message: string, arms: string[] = []): TermHealthSignalDto {
  return { code, message, href: TERM_HEALTH_HREFS[code], arms };
}

/**
 * @param termId the term being viewed; null → the school's current term
 * @param today  YYYY-MM-DD in Lagos
 */
export async function computeTermHealth(
  db: TenantDb,
  schoolId: string,
  termId: string | null,
  today: string,
): Promise<TermHealthSignalDto[]> {
  const [r] = await db.$queryRawUnsafe<HealthRow[]>(HEALTH_SQL, schoolId, termId, today);
  const out: TermHealthSignalDto[] = [];

  if (r.has_current === 0) {
    out.push(signal("NO_CURRENT_TERM", "No term is set as current, so registers, invoices and the dashboard have no term to work in."));
  } else if (r.current_ended) {
    out.push(
      signal(
        "CURRENT_TERM_ENDED",
        `The current term ended on ${r.current_end}. Registers and scores are still being filed against a finished term.`,
      ),
    );
    if (r.later_term_exists) {
      out.push(signal("NEXT_TERM_NOT_CURRENT", "A later term already exists but hasn't been made the current term."));
    }
  }

  if (r.has_selected > 0) {
    if (r.active_students > 0 && r.enrolled === 0) {
      out.push(
        r.prev_enrolled > 0
          ? signal(
              "ENROLLMENT_NOT_ROLLED_OVER",
              `Students were enrolled last term (${r.prev_enrolled}) but no one is enrolled in this term, so class registers and gradebooks are empty.`,
            )
          : signal(
              "NO_ENROLLMENT_THIS_TERM",
              "The school has students, but none are enrolled in this term, so class registers and gradebooks are empty.",
            ),
      );
    }
    if (r.arms_no_form.length > 0) {
      out.push(
        signal(
          "ARMS_WITHOUT_FORM_TEACHER",
          `${r.arms_no_form.length} class${r.arms_no_form.length === 1 ? " has" : "es have"} students but no form teacher, so no teacher can take the daily register.`,
          r.arms_no_form,
        ),
      );
    }
    if (r.arms_no_subject.length > 0) {
      out.push(
        signal(
          "ARMS_WITHOUT_SUBJECT_TEACHERS",
          `${r.arms_no_subject.length} class${r.arms_no_subject.length === 1 ? " has" : "es have"} students but no subject teacher assigned this term, so no teacher can enter scores.`,
          r.arms_no_subject,
        ),
      );
    }
  }

  return out;
}
