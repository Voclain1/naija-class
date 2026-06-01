import { PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";

import { PERMISSIONS_METADATA_KEY } from "../common/auth/permissions.decorator";

import { AcademicYearsController } from "../modules/academic-years/academic-years.controller";
import { ClassArmsController } from "../modules/class-arms/class-arms.controller";
import { ClassLevelsController } from "../modules/class-levels/class-levels.controller";
import { ClassSubjectsController } from "../modules/class-subjects/class-subjects.controller";
import { EnrollmentsController } from "../modules/enrollments/enrollments.controller";
import { GuardiansController } from "../modules/guardians/guardians.controller";
import { ImportsController } from "../modules/imports/imports.controller";
import { StudentsController } from "../modules/students/students.controller";
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

describe("Phase 1 RBAC coverage: every route handler declares @Permissions", () => {
  for (const [name, ctor] of PHASE_1_CONTROLLERS) {
    it(`${name} has at least one route handler`, () => {
      // Guards against a controller import that silently resolves to nothing.
      expect(routeHandlers(ctor).length).toBeGreaterThan(0);
    });

    it(`${name}: all route handlers carry a non-empty @Permissions`, () => {
      const proto = ctor.prototype as Record<string, unknown>;
      const missing: string[] = [];
      for (const handler of routeHandlers(ctor)) {
        const perms = Reflect.getMetadata(
          PERMISSIONS_METADATA_KEY,
          proto[handler] as object,
        );
        if (!Array.isArray(perms) || perms.length === 0) {
          missing.push(handler);
        }
      }
      expect(missing, `${name} handlers missing @Permissions: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
