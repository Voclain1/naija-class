import type { withTenant } from "@school-kit/db";
import type { TimetableClashDto } from "@school-kit/types";

// Phase 8 / CP3 — the clash query and the timetable lock.
// docs/modules/phase-8.md §17 D30–D32.
//
// A CLASH (D30): two lessons, for some term τ of one academic year, that share a
// teacher, fall on the same day_of_week and bell_slot_id, belong to DIFFERENT
// classes, and whose timetables are both IN FORCE in τ.
//
// IN FORCE (D3/D13): a class's term-τ timetable if one exists; otherwise its
// year-wide timetable for τ's academic year. A term timetable REPLACES the year
// one entirely — the year-wide lessons are not "also" in force that term.
//
// Because the school has ONE bell schedule (D26), "same time" is "same slot id":
// the query is an identity GROUP BY with no time arithmetic, and editing slot
// times can never create or remove a clash (§17.2).

export type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

interface ClashRow {
  teacher_id: string;
  teacher_name: string;
  day_of_week: number;
  bell_slot_id: string;
  slot_label: string;
  slot_position: number;
  term_id: string;
  term_name: string;
  term_sequence: number;
  class_arms: Array<{ id: string; name: string }>;
}

/**
 * Every clash in one academic year of one school, grouped in SQL — one query,
 * never one per class (D31). Ordered by term, day, slot, teacher so the first
 * clash named in an error is stable.
 *
 * Runs under the caller's tenant transaction, so RLS applies; schoolId is ALSO
 * in every WHERE clause (belt and braces, as elsewhere).
 */
export async function findTimetableClashes(
  db: TenantDb,
  schoolId: string,
  academicYearId: string,
): Promise<TimetableClashDto[]> {
  const rows = await db.$queryRaw<ClashRow[]>`
    WITH year_terms AS (
      SELECT t.id, t.name, t.sequence
      FROM terms t
      WHERE t.school_id = ${schoolId} AND t.academic_year_id = ${academicYearId}
    ),
    -- One row per (term, class): the timetable in force for that class in that term.
    in_force AS (
      SELECT yt.id AS term_id, tt.id AS timetable_id, tt.class_arm_id
      FROM year_terms yt
      JOIN timetables tt
        ON tt.school_id = ${schoolId}
       AND tt.academic_year_id = ${academicYearId}
       AND (
             tt.term_id = yt.id
             OR (
                  tt.term_id IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM timetables repl
                    WHERE repl.school_id = ${schoolId}
                      AND repl.class_arm_id = tt.class_arm_id
                      AND repl.term_id = yt.id
                  )
                )
           )
    ),
    clashes AS (
      SELECT et.teacher_id, e.day_of_week, e.bell_slot_id, f.term_id,
             array_agg(DISTINCT f.class_arm_id) AS class_arm_ids
      FROM in_force f
      JOIN timetable_entries e
        ON e.school_id = ${schoolId} AND e.timetable_id = f.timetable_id
      JOIN timetable_entry_teachers et
        ON et.school_id = ${schoolId} AND et.entry_id = e.id
      GROUP BY et.teacher_id, e.day_of_week, e.bell_slot_id, f.term_id
      HAVING count(DISTINCT f.class_arm_id) > 1
    )
    SELECT c.teacher_id,
           (u.first_name || ' ' || u.last_name) AS teacher_name,
           c.day_of_week::int AS day_of_week,
           c.bell_slot_id,
           bs.label AS slot_label,
           bs.position AS slot_position,
           c.term_id,
           yt.name AS term_name,
           yt.sequence AS term_sequence,
           (
             SELECT json_agg(json_build_object('id', ca.id, 'name', ca.name) ORDER BY ca.name, ca.id)
             FROM class_arms ca
             WHERE ca.school_id = ${schoolId} AND ca.id = ANY(c.class_arm_ids)
           ) AS class_arms
    FROM clashes c
    JOIN users u       ON u.school_id = ${schoolId} AND u.id = c.teacher_id
    JOIN bell_slots bs ON bs.school_id = ${schoolId} AND bs.id = c.bell_slot_id
    JOIN year_terms yt ON yt.id = c.term_id
    ORDER BY yt.sequence, c.day_of_week, bs.position, teacher_name, c.teacher_id
  `;

  return rows.map((r) => ({
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    dayOfWeek: Number(r.day_of_week),
    bellSlotId: r.bell_slot_id,
    slotLabel: r.slot_label,
    termId: r.term_id,
    termName: r.term_name,
    classArms: r.class_arms,
  }));
}

/**
 * D32 — serialise timetable writes per school. Transaction-scoped: released at
 * commit or rollback, so it cannot leak across a pooled connection (safe under
 * PgBouncer transaction pooling, which withTenant's set_config(…, true) already
 * relies on). Different schools never contend; reads are never blocked.
 *
 * The FIRST lock in this codebase (§17.1). timetable-concurrency.spec.ts proves
 * it matters: with it removed, two concurrent writes commit a clash.
 */
export async function lockSchoolTimetables(db: TenantDb, schoolId: string): Promise<void> {
  // pg_advisory_xact_lock returns void, which Prisma cannot deserialise; select a constant around it.
  await db.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${"timetable:" + schoolId}, 0))) AS l`;
}
