import { PATH_METADATA } from "@nestjs/common/constants";
import { ModulesContainer } from "@nestjs/core";
import { Test, type TestingModule } from "@nestjs/testing";
import { SYSTEM_ROLE_SEEDS } from "@school-kit/db";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { PERMISSIONS_METADATA_KEY } from "../common/auth/permissions.decorator";

type RoleKey = "owner" | "admin" | "teacher" | "bursar";
type NamedFunction = { readonly name: string; toString(): string };

type RouteGate = {
  route: string;
  permissions: string[];
  assertedRoles: RoleKey[] | null;
  serviceMethod: string | null;
};

const STAFF_ROLE_KEYS: RoleKey[] = ["owner", "admin", "teacher", "bursar"];

// I2 exceptions are design contracts, not a generic allowlist. Every entry is
// grouped by the narrower authorization rule that justifies it. The test below
// is deliberately two-sided: a disagreement not named here fails as
// undocumented, while an entry that no longer occurs fails as stale.
const I2_DESIGN_EXCEPTIONS = [
  {
    name: "teacher academic context comes from the scoped teacher surface",
    reason:
      "The general academic-structure routes are operator CRUD. Teachers receive only the arms, levels, subjects, and class-subject relationships in their own assignments through GET /teacher-scope/me; allowing these general routes would bypass that Q3a boundary.",
    disagreements: [
      "ClassLevelsController.list -> ClassLevelsService.list: teacher holds class-level.read but is rejected by [owner, admin]",
      "ClassLevelsController.findById -> ClassLevelsService.findById: teacher holds class-level.read but is rejected by [owner, admin]",
      "ClassArmsController.listForLevel -> ClassArmsService.listForLevel: teacher holds class-arm.read but is rejected by [owner, admin, bursar]",
      "ClassArmsController.list -> ClassArmsService.list: teacher holds class-arm.read but is rejected by [owner, admin, bursar]",
      "ClassArmsController.findById -> ClassArmsService.findById: teacher holds class-arm.read but is rejected by [owner, admin, bursar]",
      "SubjectsController.list -> SubjectsService.list: teacher holds subject.read but is rejected by [owner, admin]",
      "SubjectsController.findById -> SubjectsService.findById: teacher holds subject.read but is rejected by [owner, admin]",
      "ClassSubjectsController.listForLevel -> ClassSubjectsService.listForLevel: teacher holds class-subject.read but is rejected by [owner, admin]",
      "ClassSubjectsController.findById -> ClassSubjectsService.findById: teacher holds class-subject.read but is rejected by [owner, admin]",
    ],
  },
  {
    name: "teacher roster reads use the assigned-arm PII-minimised endpoint",
    reason:
      "GET /students is the school-wide admin roster, and GET /students/:id includes guardian phone and email. Teachers instead use GET /teacher-scope/me/arms/:armId/students, which verifies the assigned arm and deliberately omits guardian contacts and other unnecessary PII.",
    disagreements: [
      "StudentsController.list -> StudentsService.list: teacher holds student.read but is rejected by [owner, admin]",
      "StudentsController.findById -> StudentsService.findById: teacher holds student.read but is rejected by [owner, admin]",
    ],
  },
  {
    name: "teacher enrollment reads cannot use unscoped admin routes",
    reason:
      "The general enrollment list permits school-wide filters and the by-id route accepts any enrollment id; neither verifies the caller's assigned arms. A teacher's roster context is delivered through the scoped teacher surface instead.",
    disagreements: [
      "EnrollmentsController.list -> EnrollmentsService.list: teacher holds enrollment.read but is rejected by [owner, admin]",
      "EnrollmentsController.findById -> EnrollmentsService.findById: teacher holds enrollment.read but is rejected by [owner, admin]",
    ],
  },
  {
    name: "teacher assignments use the self-scoped endpoint",
    reason:
      "TeacherAssignmentsController is explicitly the admin 'who teaches what' CRUD surface. Teachers receive only their own assignments through GET /teacher-scope/me, so the general list and arbitrary by-id read correctly remain owner/admin-only.",
    disagreements: [
      "TeacherAssignmentsController.list -> TeacherAssignmentsService.list: teacher holds teacher-assignment.read but is rejected by [owner, admin]",
      "TeacherAssignmentsController.findById -> TeacherAssignmentsService.findById: teacher holds teacher-assignment.read but is rejected by [owner, admin]",
    ],
  },
  {
    name: "principal notes remain principal actions",
    reason:
      "Teachers hold report-card.comment for the separate form-teacher-comment path. The arm-wide principal note is intentionally owner/admin-only, and an existing workflow regression test requires even the form teacher to be rejected.",
    disagreements: [
      "ReportCardsController.principalNote -> ReportCardWorkflowService.editPrincipalNote: teacher holds report-card.comment but is rejected by [owner, admin]",
    ],
  },
  {
    name: "teacher-self endpoints require a teacher principal",
    reason:
      "These endpoints derive their result from the caller's teacher assignments and are intentionally unavailable to a pure owner/admin, who uses the general CRUD surfaces. The role gate is any-of, so an owner/admin who also holds teacher still passes; this exception preserves that dual-role behavior.",
    disagreements: [
      "TeacherScopeController.getMyScope -> TeacherScopeService.getMyScope: owner holds teacher-assignment.read but is rejected by [teacher]",
      "TeacherScopeController.getMyScope -> TeacherScopeService.getMyScope: admin holds teacher-assignment.read but is rejected by [teacher]",
      "TeacherScopeController.getMyArmRoster -> TeacherScopeService.getMyArmRoster: owner holds student.read but is rejected by [teacher]",
      "TeacherScopeController.getMyArmRoster -> TeacherScopeService.getMyArmRoster: admin holds student.read but is rejected by [teacher]",
    ],
  },
] as const;

function routeMethods(instance: object): string[] {
  const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter((name) => {
    const fn = proto[name];
    return typeof fn === "function" && Reflect.getMetadata(PATH_METADATA, fn) !== undefined;
  });
}

function permissionsFor(instance: object, method: string): string[] {
  const fn = (Object.getPrototypeOf(instance) as Record<string, unknown>)[method] as object;
  const permissions = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, fn);
  return Array.isArray(permissions) ? permissions.filter((value): value is string => typeof value === "string") : [];
}

const sourceFiles = new Map<string, ts.SourceFile>();

function indexSourceFiles(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      indexSourceFiles(path);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const statement of source.statements) {
        if (ts.isClassDeclaration(statement) && statement.name) sourceFiles.set(statement.name.text, source);
      }
    }
  }
}

function sourceFileFor(ctor: NamedFunction): ts.SourceFile {
  const source = sourceFiles.get(ctor.name);
  if (!source) throw new Error(`Could not locate source for ${ctor.name}`);
  return source;
}

function stringArray(node: ts.Expression, source: ts.SourceFile): string[] | null {
  let value = node;
  if (ts.isIdentifier(value)) {
    const identifier = value.text;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === identifier && declaration.initializer) {
          value = declaration.initializer;
        }
      }
    }
  }
  while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) {
    value = value.expression;
  }
  if (!ts.isArrayLiteralExpression(value)) return null;
  const values = value.elements.map((element) => (ts.isStringLiteral(element) ? element.text : null));
  return values.every((item): item is string => item !== null) ? values : null;
}

function assertedRoles(ctor: NamedFunction, methodName: string): RoleKey[] | null {
  const source = sourceFileFor(ctor);
  const result: { found: boolean; roles: string[] | null } = { found: false, roles: null };
  const visit = (node: ts.Node) => {
    if (
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === methodName &&
      node.body
    ) {
      const inspect = (child: ts.Node) => {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === "assertUserActiveAndHasOneOf" &&
          child.arguments[1]
        ) {
          result.found = true;
          result.roles = stringArray(child.arguments[1], source);
        }
        ts.forEachChild(child, inspect);
      };
      inspect(node.body);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (result.found && !result.roles) {
    throw new Error(`${ctor.name}.${methodName} has a role gate whose allowed roles could not be resolved`);
  }
  const roles = result.roles;
  if (!roles) return null;
  const invalid = roles.filter((role) => !STAFF_ROLE_KEYS.includes(role as RoleKey));
  if (invalid.length > 0) throw new Error(`${ctor.name}.${methodName} asserts unknown role(s): ${invalid.join(", ")}`);
  return roles as RoleKey[];
}

function serviceCalls(controller: object, methodName: string): Array<{ ctor: NamedFunction; method: string }> {
  const fn = (Object.getPrototypeOf(controller) as Record<string, unknown>)[methodName] as NamedFunction;
  const text = fn.toString();
  const calls: Array<{ ctor: NamedFunction; method: string }> = [];
  for (const match of text.matchAll(/this\.(\w+)\.(\w+)\s*\(/g)) {
    const dependency = (controller as Record<string, unknown>)[match[1]];
    if (dependency && typeof dependency === "object") {
      calls.push({ ctor: dependency.constructor as NamedFunction, method: match[2] });
    }
  }
  return calls;
}

function roleHoldsPermission(role: RoleKey, permission: string): boolean {
  const seed = SYSTEM_ROLE_SEEDS.find((candidate) => candidate.key === role);
  if (!seed) throw new Error(`Missing system role seed: ${role}`);
  return seed.permissions.includes("*") || seed.permissions.includes(permission);
}

describe("staff RBAC two-gate conformance", () => {
  let moduleRef: TestingModule;
  const routes: RouteGate[] = [];

  beforeAll(async () => {
    indexSourceFiles(join(process.cwd(), "src"));
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const modules = moduleRef.get(ModulesContainer);

    for (const module of modules.values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.instance as object | null;
        if (!controller) continue;
        const controllerName = controller.constructor.name;
        for (const method of routeMethods(controller)) {
          const permissions = permissionsFor(controller, method);
          if (permissions.length === 0) continue;
          const calls = serviceCalls(controller, method);
          const gated = calls
            .map((call) => ({ ...call, roles: assertedRoles(call.ctor, call.method) }))
            .filter((call) => call.roles !== null);
          routes.push({
            route: `${controllerName}.${method}`,
            permissions,
            assertedRoles: gated[0]?.roles ?? null,
            serviceMethod: gated[0] ? `${gated[0].ctor.name}.${gated[0].method}` : null,
          });
        }
      }
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it("I1: every enforced permission is held by at least one seeded staff role", () => {
    const orphaned = routes.flatMap((route) =>
      route.permissions
        .filter((permission) => !STAFF_ROLE_KEYS.some((role) => roleHoldsPermission(role, permission)))
        .map((permission) => `${route.route}: ${permission}`),
    );
    expect(orphaned, `orphaned permission enforcement:\n${orphaned.join("\n")}`).toEqual([]);
  });

  it("I2: every seeded-grant/service-role disagreement has one current, reasoned design exception", () => {
    const disagreements = routes.flatMap((route) => {
      if (!route.assertedRoles) return [];
      return route.permissions.flatMap((permission) =>
        STAFF_ROLE_KEYS
          .filter((role) => roleHoldsPermission(role, permission) && !route.assertedRoles!.includes(role))
          .map(
            (role) =>
              `${route.route} -> ${route.serviceMethod}: ${role} holds ${permission} but is rejected by [${route.assertedRoles!.join(", ")}]`,
          ),
      );
    });

    const documented = I2_DESIGN_EXCEPTIONS.flatMap((group) =>
      group.disagreements.map((disagreement) => ({ disagreement, group: group.name, reason: group.reason })),
    );
    const documentedSet = new Set(documented.map((entry) => entry.disagreement));
    const actualSet = new Set(disagreements);
    const duplicateExceptions = documented
      .filter((entry, index) => documented.findIndex((candidate) => candidate.disagreement === entry.disagreement) !== index)
      .map((entry) => `${entry.group}: ${entry.disagreement}`);
    const undocumented = disagreements.filter((disagreement) => !documentedSet.has(disagreement));
    const stale = documented
      .filter((entry) => !actualSet.has(entry.disagreement))
      .map((entry) => `${entry.group}: ${entry.disagreement}`);

    expect(duplicateExceptions, `I2 exceptions documented more than once:\n${duplicateExceptions.join("\n")}`).toEqual([]);
    expect(undocumented, `undocumented permission/role disagreements:\n${undocumented.join("\n")}`).toEqual([]);
    expect(stale, `stale I2 design exceptions:\n${stale.join("\n")}`).toEqual([]);
  });
});
