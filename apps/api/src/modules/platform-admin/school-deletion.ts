import { basePrisma } from "@school-kit/db";
import type { SchoolDeletionBlocker } from "@school-kit/types";

// Deleting a school from the platform-admin surface (docs/modules/platform-
// admin.md slice 2). Kept out of platform-admin.service.ts on purpose: that
// file's import-boundary spec holds it away from financial tables, and this
// file has to COUNT payments to decide whether a delete is allowed. It reads
// nothing else about them — one count, under the school's own GUC, so RLS
// still bounds it to that school.
//
// Rules (owner's decision, 2026-10-05):
//   * a school that has EVER recorded a payment is never deleted here;
//   * neither is a school holding a platform admin (deleting it would delete
//     the operator, and suspending it would lock its other staff out of a
//     school the operator still works from);
//   * the operator types the slug — checked by the service.

type TxClient = Parameters<Parameters<typeof basePrisma.$transaction>[0]>[0];

export interface SchoolDeletionFacts {
  blockers: SchoolDeletionBlocker[];
  paymentCount: number;
  studentCount: number;
  staffCount: number;
  guardianCount: number;
}

// Must run inside a transaction that has already set the school's GUC.
export async function readDeletionFacts(tx: TxClient, schoolId: string): Promise<SchoolDeletionFacts> {
  const [row] = await tx.$queryRaw<
    { payments: bigint; students: bigint; staff: bigint; guardians: bigint; platform_admins: bigint }[]
  >`
    SELECT
      (SELECT count(*) FROM payments  WHERE school_id = ${schoolId}) AS payments,
      (SELECT count(*) FROM students  WHERE school_id = ${schoolId}) AS students,
      (SELECT count(*) FROM users     WHERE school_id = ${schoolId}) AS staff,
      (SELECT count(*) FROM guardians WHERE school_id = ${schoolId}) AS guardians,
      (SELECT count(*) FROM users     WHERE school_id = ${schoolId} AND is_platform_admin) AS platform_admins
  `;
  const blockers: SchoolDeletionBlocker[] = [];
  if (Number(row!.payments) > 0) blockers.push("HAS_PAYMENTS");
  if (Number(row!.platform_admins) > 0) blockers.push("HAS_PLATFORM_ADMIN");
  return {
    blockers,
    paymentCount: Number(row!.payments),
    studentCount: Number(row!.students),
    staffCount: Number(row!.staff),
    guardianCount: Number(row!.guardians),
  };
}

// Whether the school holds a platform admin. Must run under the school's GUC.
export async function holdsPlatformAdmin(tx: TxClient, schoolId: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users WHERE school_id = ${schoolId} AND is_platform_admin
  `;
  return Number(row!.n) > 0;
}

// Deletes every row the school owns, then the school. Must run inside a
// transaction that has set the school's GUC — every delete below is an
// ordinary app_user DELETE that RLS bounds to that one school, so a bug here
// cannot reach another tenant's rows.
//
// Order: child-before-parent over the foreign-key graph, computed from the
// catalog at run time — the same approach as scripts/prune-smoke-schools.sql
// (see its header for why: several FKs are RESTRICT, and a plain cascade from
// `schools` trips them). Tables without a school_id (sessions, user_roles,
// guardian_sessions…) go by cascade from their parents.
export async function deleteSchoolRows(tx: TxClient, schoolId: string): Promise<number> {
  // Lets exam_paper_frozen_guard step aside for FINAL papers. Gone with the
  // row at the end of this function.
  await tx.$executeRaw`UPDATE schools SET deletion_started_at = now() WHERE id = ${schoolId}`;

  const tables = await tx.$queryRaw<{ name: string }[]>`
    WITH RECURSIVE fk AS (
      SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'public' AND c.conrelid <> c.confrelid
    ),
    tbl AS (
      SELECT t.table_name::text AS name
      FROM information_schema.tables t
      JOIN information_schema.columns col
        ON col.table_schema = t.table_schema AND col.table_name = t.table_name AND col.column_name = 'school_id'
      WHERE t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND t.table_name <> 'schools'
        AND t.table_name NOT IN (SELECT i.inhrelid::regclass::text FROM pg_inherits i)
    ),
    depth AS (
      SELECT name, 0 AS d, ARRAY[name] AS path FROM tbl
      UNION ALL
      SELECT f.child, dep.d + 1, dep.path || f.child
      FROM fk f
      JOIN depth dep ON dep.name = f.parent
      WHERE f.child IN (SELECT name FROM tbl) AND NOT f.child = ANY(dep.path) AND dep.d < 25
    )
    SELECT name FROM depth GROUP BY name ORDER BY max(d) DESC, name
  `;

  let total = 0;
  for (const { name } of tables) {
    // Table names come from the catalog, never from a caller; quoted anyway.
    total += await tx.$executeRawUnsafe(`DELETE FROM "${name.replace(/"/g, '""')}" WHERE school_id = $1`, schoolId);
  }
  total += await tx.$executeRaw`DELETE FROM schools WHERE id = ${schoolId}`;
  return total;
}
