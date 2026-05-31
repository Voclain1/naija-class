import type { PrismaClient } from "@school-kit/db";
import type {
  TeacherScopeArmDto,
  TeacherScopeSubjectDto,
} from "@school-kit/types";

// Phase 1 / Slice 11 cp2 — the teacher-scope filter.
//
// Resolves which class arms a teacher may see and which subjects they teach
// in each. This is the load-bearing authorization primitive that closes
// acceptance #9: a teacher sees ONLY their assigned arms + subjects, plus the
// arm(s) where they are the form (homeroom) teacher.
//
// CRITICAL — this is authorization layered ON TOP of tenancy, not tenancy
// itself. RLS already isolated the tenant (this runs inside withTenant); the
// scope filter is an ADDITIONAL in-school filter. A bug here leaks WITHIN a
// school (one teacher seeing another's roster), not across schools. Treat
// every caller as a security-review surface (CLAUDE.md risk note).
//
// Pure read, no N+1: exactly two queries (subject assignments + homeroom
// arms), unioned in code. The function takes a tenant-scoped `db` (the caller
// owns the withTenant boundary) and never touches AuthContext — it is pure
// over (db, teacherId, year?).
//
// `classArms` = subject-assignment arms ∪ homeroom arms (deduped by id). A
// homeroom-only arm (the teacher is form teacher but teaches no subject
// there) appears in `classArms` with NO key in `subjectsByArm`.
//
// Enriched in cp2: each arm/subject carries { id, name, code } pulled from the
// SAME two queries (a select widening, not extra round-trips) so the cp3
// portal renders names from one /me call. subjectsByArm stays a Map here (the
// service converts it to the wire Record) — same Map-in-helper / Record-on-
// wire split cp2 already used for the id-only shape.
//
// `academicYearId` (optional) restricts the SUBJECT assignments to that year.
// Homeroom arms are NOT year-scoped (ClassArm carries no year), so they are
// always included regardless of the year filter — matching "restricts subject
// assignments to that academicYearId".
export interface TeacherScope {
  classArms: TeacherScopeArmDto[];
  subjectsByArm: Map<string, TeacherScopeSubjectDto[]>;
}

export async function getTeacherScope(
  db: PrismaClient,
  teacherId: string,
  academicYearId?: string,
): Promise<TeacherScope> {
  // 1. Subject assignments — active only. A deactivated assignment must NOT
  //    grant scope (it is the soft-unassign path — see cp1). Select the arm +
  //    subject display fields inline so we never re-query for names.
  const assignments = await db.teacherAssignment.findMany({
    where: {
      teacherId,
      isActive: true,
      ...(academicYearId ? { academicYearId } : {}),
    },
    select: {
      classArm: { select: { id: true, name: true, code: true } },
      subject: { select: { id: true, name: true, code: true } },
    },
  });

  // 2. Homeroom arms — the teacher is the form teacher (ClassArm.classTeacherId).
  //    Active arms only; a deactivated arm shouldn't appear in scope.
  const homeroomArms = await db.classArm.findMany({
    where: { classTeacherId: teacherId, isActive: true },
    select: { id: true, name: true, code: true },
  });

  // Build subjectsByArm from the subject assignments (deduping subjects per
  // arm by id — a teacher could hold both a whole-year and a term-specific
  // assignment for the same arm+subject).
  const subjectsByArm = new Map<string, TeacherScopeSubjectDto[]>();
  for (const a of assignments) {
    const existing = subjectsByArm.get(a.classArm.id) ?? [];
    if (!existing.some((s) => s.id === a.subject.id)) {
      existing.push({ id: a.subject.id, name: a.subject.name, code: a.subject.code });
    }
    subjectsByArm.set(a.classArm.id, existing);
  }

  // Union the arms (subject-assignment arms ∪ homeroom arms), deduped by id.
  // Insertion order: assignment arms first, then homeroom — same order as the
  // id-only cp2 shape.
  const armsById = new Map<string, TeacherScopeArmDto>();
  for (const a of assignments) {
    if (!armsById.has(a.classArm.id)) {
      armsById.set(a.classArm.id, {
        id: a.classArm.id,
        name: a.classArm.name,
        code: a.classArm.code,
      });
    }
  }
  for (const h of homeroomArms) {
    if (!armsById.has(h.id)) {
      armsById.set(h.id, { id: h.id, name: h.name, code: h.code });
    }
  }
  const classArms = [...armsById.values()];

  return { classArms, subjectsByArm };
}
