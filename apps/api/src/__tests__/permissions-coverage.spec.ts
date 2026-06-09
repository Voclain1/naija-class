import { PATH_METADATA } from "@nestjs/common/constants";
import { SYSTEM_ROLE_SEEDS } from "@school-kit/db";
import {
  PHASE_2_OWNER_ONLY_PERMISSIONS,
  PHASE_2_PERMISSIONS,
  PHASE_2_TEACHER_PERMISSIONS,
} from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { PERMISSIONS_METADATA_KEY } from "../common/auth/permissions.decorator";

import { AcademicYearsController } from "../modules/academic-years/academic-years.controller";
import { AssessmentScoresController, AssessmentsController } from "../modules/assessment/assessment.controller";
import { AttendanceController } from "../modules/attendance/attendance.controller";
import { ClassArmsController } from "../modules/class-arms/class-arms.controller";
import { ClassLevelsController } from "../modules/class-levels/class-levels.controller";
import { ClassSubjectsController } from "../modules/class-subjects/class-subjects.controller";
import { EnrollmentsController } from "../modules/enrollments/enrollments.controller";
import { GradeBoundariesController, GradingSchemeController } from "../modules/grading/grading.controller";
import { GuardiansController } from "../modules/guardians/guardians.controller";
import { ImportsController } from "../modules/imports/imports.controller";
import { ReportCardsController } from "../modules/report-cards/report-card.controller";
import { StudentsController } from "../modules/students/students.controller";
import { SubjectAttendanceController } from "../modules/subject-attendance/subject-attendance.controller";
import { SubjectsController } from "../modules/subjects/subjects.controller";
import { TeacherAssignmentsController } from "../modules/teacher-assignments/teacher-assignments.controller";
import { TeacherProfilesController } from "../modules/teacher-profiles/teacher-profiles.controller";
import { TeacherScopeController } from "../modules/teacher-scope/teacher-scope.controller";
import { TermsController } from "../modules/terms/terms.controller";

// Static RBAC safety net (slice 13). Every route handler on a Phase 1
// controller MUST declare @Permissions — the PermissionsGuard fails closed,
// so a forgotten decorator would 403 at runtime; this catches it at build
// time instead. Phase 0 controllers are intentionally out of scope (they keep
// their service-layer asserts; guard retrofit is deferred).
//
// A "route handler" is any prototype method carrying PATH_METADATA (set by
// @Get/@Post/@Patch/@Delete).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctor = new (...args: any[]) => object;

const PHASE_1_CONTROLLERS: Array<[string, Ctor]> = [
  ["AcademicYearsController", AcademicYearsController],
  ["TermsController", TermsController],
  ["ClassLevelsController", ClassLevelsController],
  ["ClassArmsController", ClassArmsController],
  ["SubjectsController", SubjectsController],
  ["ClassSubjectsController", ClassSubjectsController],
  ["TeacherAssignmentsController", TeacherAssignmentsController],
  ["StudentsController", StudentsController],
  ["GuardiansController", GuardiansController],
  ["EnrollmentsController", EnrollmentsController],
  ["TeacherProfilesController", TeacherProfilesController],
  ["TeacherScopeController", TeacherScopeController],
  ["ImportsController", ImportsController],
];

function routeHandlers(ctor: Ctor): string[] {
  const proto = ctor.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === "constructor") return false;
    const fn = proto[name];
    if (typeof fn !== "function") return false;
    return Reflect.getMetadata(PATH_METADATA, fn) !== undefined;
  });
}

function handlerPermissions(ctor: Ctor): string[] {
  const proto = ctor.prototype as Record<string, unknown>;
  const out: string[] = [];
  for (const handler of routeHandlers(ctor)) {
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto[handler] as object);
    if (Array.isArray(perms)) out.push(...(perms as string[]));
  }
  return out;
}

function assertCoverage(controllers: Array<[string, Ctor]>) {
  for (const [name, ctor] of controllers) {
    it(`${name} has at least one route handler`, () => {
      // Guards against a controller import that silently resolves to nothing.
      expect(routeHandlers(ctor).length).toBeGreaterThan(0);
    });

    it(`${name}: all route handlers carry a non-empty @Permissions`, () => {
      const proto = ctor.prototype as Record<string, unknown>;
      const missing: string[] = [];
      for (const handler of routeHandlers(ctor)) {
        const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto[handler] as object);
        if (!Array.isArray(perms) || perms.length === 0) {
          missing.push(handler);
        }
      }
      expect(missing, `${name} handlers missing @Permissions: ${missing.join(", ")}`).toEqual([]);
    });
  }
}

describe("Phase 1 RBAC coverage: every route handler declares @Permissions", () => {
  assertCoverage(PHASE_1_CONTROLLERS);
});

// ---------------------------------------------------------------------------
// Phase 2 RBAC coverage (slice 9 rollup). Same fail-closed guard contract as
// Phase 1, plus: every Phase 2 @Permissions value must be a known Phase 2
// permission (typo guard), and the seeded role grants must match the spec
// (owner = wildcard; admin = all-but-owner-only; teacher = the documented
// subset). Schools (Phase 0) stays out — its toggle keeps the service-layer
// gate (WS4 / cp2 tightens GET /schools/me separately).
// ---------------------------------------------------------------------------

const PHASE_2_CONTROLLERS: Array<[string, Ctor]> = [
  ["AssessmentScoresController", AssessmentScoresController],
  ["AssessmentsController", AssessmentsController],
  ["GradingSchemeController", GradingSchemeController],
  ["GradeBoundariesController", GradeBoundariesController],
  ["ReportCardsController", ReportCardsController],
  ["AttendanceController", AttendanceController],
  ["SubjectAttendanceController", SubjectAttendanceController],
];

const PHASE_2_SET = new Set<string>(PHASE_2_PERMISSIONS);

function roleSeed(key: string) {
  const seed = SYSTEM_ROLE_SEEDS.find((r) => r.key === key);
  if (!seed) throw new Error(`role seed '${key}' not found`);
  return seed;
}

describe("Phase 2 RBAC coverage: every route handler declares @Permissions", () => {
  assertCoverage(PHASE_2_CONTROLLERS);

  it("every Phase 2 @Permissions value is a known Phase 2 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_2_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_2_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 2 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

describe("Phase 2 RBAC coverage: seeded role grants match the spec", () => {
  it("owner is the wildcard role (covers all Phase 2 permissions)", () => {
    expect(roleSeed("owner").permissions).toEqual(["*"]);
  });

  it("admin grants every Phase 2 permission EXCEPT the owner-only ones", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    const ownerOnly = new Set<string>(PHASE_2_OWNER_ONLY_PERMISSIONS);
    for (const p of PHASE_2_PERMISSIONS) {
      expect(adminPerms.has(p), `admin ${ownerOnly.has(p) ? "should NOT" : "should"} have ${p}`).toBe(
        !ownerOnly.has(p),
      );
    }
  });

  it("teacher grants exactly the documented Phase 2 subset (no more, no less)", () => {
    const teacherPerms = new Set(roleSeed("teacher").permissions);
    const teacherSubset = new Set<string>(PHASE_2_TEACHER_PERMISSIONS);
    // Every documented teacher permission is granted...
    for (const p of PHASE_2_TEACHER_PERMISSIONS) {
      expect(teacherPerms.has(p), `teacher should have ${p}`).toBe(true);
    }
    // ...and the teacher holds NO Phase 2 permission outside that subset
    // (e.g. no grading-*, report-card.build/release/reopen/principal-approve).
    for (const p of PHASE_2_PERMISSIONS) {
      if (!teacherSubset.has(p)) {
        expect(teacherPerms.has(p), `teacher should NOT have ${p}`).toBe(false);
      }
    }
  });
});
