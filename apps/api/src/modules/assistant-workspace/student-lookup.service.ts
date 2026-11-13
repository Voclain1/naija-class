import { Injectable } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  PERMISSION_WILDCARD,
  UnauthorizedError,
  type StudentLookupQuery,
  type StudentLookupResultDto,
  type StudentMatchDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { nameParts, stripPossessive } from "../../common/ai/pii/question-check";
import { StudentsService } from "../students/students.service";
import { TeacherScopeService } from "../teacher-scope/teacher-scope.service";

// Named student lookup for the SchoolKit Assistant (docs/modules/
// assistant-workspace.md, "Named student lookup"). "Samuel in JSS 2" becomes
// the students the caller may already see, through the services that already
// decide that:
//   - owner/admin with student.read: StudentsService.list (the Students page);
//   - teacher with student.read: TeacherScopeService (their own classes only,
//     the trimmed roster: no contacts, DOB or health).
// Anyone else is refused. Matching never guesses: exact name matches first;
// close spellings only when nothing is exact, marked "similar"; more than one
// match is a choice for the person. No model is involved here, and the
// matches (names, admission numbers) go to the browser only.

const MAX_MATCHES = 10;

export const STUDENT_LOOKUP_AUDIT_ACTION = "assistant.student.lookup";
/** Where a lookup came from: the panel's own search box, or the model's find_student tool. */
export type LookupVia = "panel" | "conversation";
/** The Students list's own maximum page. */
const PAGE_SIZE = 200;
/** Pages read for one lookup before it is refused as too broad (20,000 students). */
const MAX_PAGES = 100;

type Candidate = { id: string; firstName: string; middleName: string | null; lastName: string; admissionNumber: string; status: string; armId: string | null; armLabel: string | null };

@Injectable()
export class StudentLookupService {
  /** Pages one lookup may read before it is refused as too broad. A field so a test can lower it. */
  maxPages = MAX_PAGES;

  constructor(private readonly students: StudentsService, private readonly teacherScope: TeacherScopeService) {}

  /** Who may look students up, re-read now. */
  async access(auth: AuthContext): Promise<"admin" | "teacher" | null> {
    return withTenant(auth.schoolId, async (db) => {
      const user = await db.user.findFirst({ where: { id: auth.userId, schoolId: auth.schoolId }, select: { isActive: true } });
      if (!user?.isActive) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
      const grants = await db.userRole.findMany({ where: { userId: auth.userId }, select: { role: { select: { key: true, permissions: true } } } });
      const perms = new Set(grants.flatMap((g) => (Array.isArray(g.role.permissions) ? (g.role.permissions as unknown[]) : []).filter((p): p is string => typeof p === "string")));
      if (!perms.has(PERMISSION_WILDCARD) && !perms.has("student.read")) return null;
      const roles = grants.map((g) => g.role.key);
      if (roles.includes("owner") || roles.includes("admin")) return "admin";
      if (roles.includes("teacher")) return "teacher";
      return null;
    });
  }

  async find(auth: AuthContext, query: StudentLookupQuery, via: LookupVia = "panel"): Promise<StudentLookupResultDto> {
    const result = await this.search(auth, query);
    await this.audit(auth, query, result, via);
    return result;
  }

  /**
   * One audit row per lookup (DPIA measure R9, 2026-11-13): who looked, when,
   * from where, what came back, and WHICH students by id. Never the name that
   * was typed, and never a student's name: the ids are enough to answer
   * "who looked up this child", and the audit log is read by people who need
   * not see the query. A search that found nobody is still recorded.
   */
  private async audit(auth: AuthContext, query: StudentLookupQuery, result: StudentLookupResultDto, via: LookupVia): Promise<void> {
    const ids = result.matches.map((m) => m.studentId);
    await withTenant(auth.schoolId, (db) =>
      db.auditLog.create({
        data: {
          schoolId: auth.schoolId,
          userId: auth.userId,
          action: STUDENT_LOOKUP_AUDIT_ACTION,
          entityType: "student",
          // The one student shown, when there was exactly one.
          entityId: result.status === "found" ? (ids[0] ?? null) : null,
          metadata: { via, status: result.status, matchCount: ids.length, studentIds: ids, classScoped: Boolean(query.classArmIds?.length) },
        },
      }),
    );
  }

  private async search(auth: AuthContext, query: StudentLookupQuery): Promise<StudentLookupResultDto> {
    const who = await this.access(auth);
    if (!who) throw new ForbiddenError("STUDENT_LOOKUP_NOT_PERMITTED", "Your account can't look up students.");
    const asked = nameParts(stripPossessive(query.name));
    if (asked.length === 0) return { status: "none", matches: [] };
    const scope = query.classArmIds ? new Set(query.classArmIds) : null;

    const candidates = who === "admin" ? await this.adminCandidates(auth, asked, scope) : await this.teacherCandidates(auth, scope);
    const termId = await this.currentTermId(auth);
    const toDto = (c: Candidate, match: StudentMatchDto["match"]): StudentMatchDto => ({
      studentId: c.id,
      name: [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" "),
      admissionNumber: c.admissionNumber,
      classArmId: c.armId,
      classLabel: c.armLabel,
      termId: c.armId ? termId : null,
      status: c.status,
      match,
    });

    const exact = candidates.filter((c) => matches(asked, c, "exact"));
    if (exact.length) return { status: exact.length === 1 ? "found" : "several", matches: sort(exact).slice(0, MAX_MATCHES).map((c) => toDto(c, "exact")) };
    const similar = candidates.filter((c) => matches(asked, c, "similar"));
    if (similar.length) return { status: "similar", matches: sort(similar).slice(0, MAX_MATCHES).map((c) => toDto(c, "similar")) };
    return { status: "none", matches: [] };
  }

  /**
   * Students already found this conversation, re-checked against the caller's
   * tenant and scope now. Another school's id, or a student outside a
   * teacher's classes, is simply absent.
   */
  async describe(auth: AuthContext, ids: readonly string[]): Promise<Map<string, StudentMatchDto>> {
    const out = new Map<string, StudentMatchDto>();
    if (ids.length === 0) return out;
    const who = await this.access(auth);
    if (!who) return out;
    const termId = await this.currentTermId(auth);
    const rows = await withTenant(auth.schoolId, (db) =>
      db.student.findMany({
        where: { schoolId: auth.schoolId, id: { in: [...ids] } },
        select: {
          id: true, firstName: true, middleName: true, lastName: true, admissionNumber: true, status: true,
          enrollments: { where: { term: { isCurrent: true } }, take: 1, select: { classArm: { select: { id: true, name: true, classLevel: { select: { name: true } } } } } },
        },
      }),
    );
    let allowed: Set<string> | null = null;
    if (who === "teacher") {
      const scope = await this.teacherScope.getMyScope(auth);
      allowed = new Set(scope.classArms.map((a) => a.id));
    }
    for (const r of rows) {
      const arm = r.enrollments[0]?.classArm;
      if (allowed && (!arm || !allowed.has(arm.id))) continue;
      out.set(r.id, {
        studentId: r.id, name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" "), admissionNumber: r.admissionNumber,
        classArmId: arm?.id ?? null, classLabel: arm ? `${arm.classLevel.name} · ${arm.name}` : null, termId: arm ? termId : null,
        status: r.status, match: "exact",
      });
    }
    return out;
  }

  /**
   * Every student who could match, read to the END of the Students list's
   * pages (it pages by cursor, 200 at a time). A match is only ever reported
   * from a complete candidate set: "none" and "the only one" are claims about
   * the whole scope, not about page one.
   *   - With a class scope: every student of each requested class, whatever
   *     their name, so close spellings are found too.
   *   - Without one: the Students page's own search, once per name part typed
   *     (by its first three letters), so a full name with one misspelt part is
   *     still found through the other.
   * If a search is too broad to read completely, it is refused with
   * STUDENT_LOOKUP_TOO_BROAD rather than answered from part of it.
   */
  private async adminCandidates(auth: AuthContext, asked: string[], scope: Set<string> | null): Promise<Candidate[]> {
    const found = new Map<string, Candidate>();
    let pages = 0;
    const readAll = async (query: { search?: string; classArmId?: string }) => {
      let cursor: string | undefined;
      do {
        if (++pages > this.maxPages) {
          throw new ConflictError("STUDENT_LOOKUP_TOO_BROAD", "That matches too many students to search completely. Add the class, or more of the name.");
        }
        const res = await this.students.list(auth, { ...query, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
        for (const s of res.data) {
          const armId = s.currentEnrollment?.classArm.id ?? null;
          if (scope && (armId === null || !scope.has(armId))) continue;
          found.set(s.id, {
            id: s.id, firstName: s.firstName, middleName: s.middleName ?? null, lastName: s.lastName, admissionNumber: s.admissionNumber, status: s.status,
            armId,
            armLabel: s.currentEnrollment ? `${s.currentEnrollment.classArm.classLevel.name} · ${s.currentEnrollment.classArm.name}` : null,
          });
        }
        cursor = res.meta.cursor;
      } while (cursor);
    };
    if (scope) {
      for (const classArmId of scope) await readAll({ classArmId });
    } else {
      for (const prefix of new Set(asked.map((part) => part.slice(0, 3)))) await readAll({ search: prefix });
    }
    return [...found.values()];
  }

  private async teacherCandidates(auth: AuthContext, scope: Set<string> | null): Promise<Candidate[]> {
    // The teacher's own classes only, through their roster (the trimmed one).
    const mine = await this.teacherScope.getMyScope(auth);
    const arms = mine.classArms.filter((a) => !scope || scope.has(a.id));
    const out: Candidate[] = [];
    for (const arm of arms) {
      const roster = await this.teacherScope.getMyArmRoster(auth, arm.id);
      for (const s of roster.data) {
        out.push({ id: s.id, firstName: s.firstName, middleName: s.middleName, lastName: s.lastName, admissionNumber: s.admissionNumber, status: s.status, armId: arm.id, armLabel: `${arm.classLevelName} · ${arm.name}` });
      }
    }
    return out;
  }

  private currentTermId(auth: AuthContext): Promise<string | null> {
    return withTenant(auth.schoolId, async (db) => (await db.term.findFirst({ where: { schoolId: auth.schoolId, isCurrent: true }, select: { id: true } }))?.id ?? null);
  }
}

function within(a: string, b: string, edits: number): boolean {
  if (Math.abs(a.length - b.length) > edits) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Two adjacent letters swapped ("Smauel") is one slip, not two.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
    }
  }
  return dp[a.length]![b.length]! <= edits;
}

/** A close spelling of a name part: one or two letters off, or its beginning. */
function close(a: string, o: string): boolean {
  return (a.length >= 4 && within(a, o, a.length >= 7 ? 2 : 1)) || (a.length >= 3 && o.startsWith(a));
}

/**
 * exact: every part the person typed is one of the student's names.
 * similar: every part is one of the student's names OR a close spelling of
 * one, and at least one is only close ("Samual Okoro" for Samuel Okoro). A
 * similar match is a suggestion for the person to choose, never a selection.
 */
function matches(asked: string[], c: Candidate, how: "exact" | "similar"): boolean {
  const own = nameParts(c.firstName, c.middleName, c.lastName);
  const allExact = asked.every((a) => own.includes(a));
  if (how === "exact") return allExact;
  return !allExact && asked.every((a) => own.includes(a) || own.some((o) => close(a, o)));
}

function sort(list: Candidate[]): Candidate[] {
  return [...list].sort((x, y) => (x.armLabel ?? "").localeCompare(y.armLabel ?? "") || x.lastName.localeCompare(y.lastName) || x.firstName.localeCompare(y.firstName));
}
