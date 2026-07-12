import { PATH_METADATA } from "@nestjs/common/constants";
import { SYSTEM_ROLE_SEEDS } from "@school-kit/db";
import {
  PHASE_2_OWNER_ONLY_PERMISSIONS,
  PHASE_2_PERMISSIONS,
  PHASE_2_TEACHER_PERMISSIONS,
  PHASE_3_BURSAR_PERMISSIONS,
  PHASE_3_OWNER_ONLY_PERMISSIONS,
  PHASE_3_PERMISSIONS,
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
import { DiscountRulesController } from "../modules/discounts/discount-rules.controller";
import { ExpenseCategoriesController } from "../modules/expenses/expense-categories.controller";
import { ExpensesController } from "../modules/expenses/expenses.controller";
import { FeeCategoriesController } from "../modules/fee-catalog/fee-categories.controller";
import { FeeItemsController } from "../modules/fee-catalog/fee-items.controller";
import { InvoicesController } from "../modules/invoices/invoices.controller";
import { FinanceController } from "../modules/finance/finance.controller";
import { PaymentPlansController } from "../modules/payments/payment-plans.controller";
import { PaymentsController } from "../modules/payments/payments.controller";
import { PaystackController } from "../modules/payments/paystack.controller";
import { RefundsController } from "../modules/payments/refunds.controller";
import { PayrollController } from "../modules/payroll/payroll.controller";
import { StaffBankAccountController } from "../modules/staff-bank-accounts/staff-bank-account.controller";
import { BvnController } from "../modules/users/bvn.controller";

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

// ---------------------------------------------------------------------------
// Phase 3 RBAC coverage (slice 4 fee catalog). Same fail-closed guard contract
// as Phase 1/2. Verifies all 8 fee-catalog permission strings are declared on
// handlers, are known Phase 3 strings, and that the seeded admin role carries
// all PHASE_3_PERMISSIONS except the owner-only auth.2fa.manage.
// ---------------------------------------------------------------------------

const PHASE_3_FEE_CONTROLLERS: Array<[string, Ctor]> = [
  ["FeeCategoriesController", FeeCategoriesController],
  ["FeeItemsController", FeeItemsController],
];

const PHASE_3_SET = new Set<string>(PHASE_3_PERMISSIONS);

describe("Phase 3 RBAC coverage: fee-catalog route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_FEE_CONTROLLERS);

  it("every Phase 3 fee-catalog @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_FEE_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 5 — discount-rule controller coverage.
// ---------------------------------------------------------------------------

const PHASE_3_DISCOUNT_CONTROLLERS: Array<[string, Ctor]> = [
  ["DiscountRulesController", DiscountRulesController],
];

describe("Phase 3 RBAC coverage: discount-rule route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_DISCOUNT_CONTROLLERS);

  it("every Phase 3 discount-rule @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_DISCOUNT_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 6 — invoice controller coverage.
// ---------------------------------------------------------------------------

const PHASE_3_INVOICE_CONTROLLERS: Array<[string, Ctor]> = [
  ["InvoicesController", InvoicesController],
];

describe("Phase 3 RBAC coverage: invoice route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_INVOICE_CONTROLLERS);

  it("every Phase 3 invoice @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_INVOICE_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 7 — payment controller coverage.
// ---------------------------------------------------------------------------

const PHASE_3_PAYMENT_CONTROLLERS: Array<[string, Ctor]> = [
  ["PaymentsController", PaymentsController],
];

describe("Phase 3 RBAC coverage: payment route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_PAYMENT_CONTROLLERS);

  it("every Phase 3 payment @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_PAYMENT_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 8 — PaystackController coverage.
//
// Cannot use assertCoverage() here: handleWebhook deliberately carries NO
// @Permissions (it is authenticated by PaystackWebhookGuard only — Paystack
// server-to-server calls have no user session). Skipping that handler from the
// all-must-have-permissions rule is intentional and load-bearing; this block
// documents the deliberate exception explicitly.
// ---------------------------------------------------------------------------

describe("Phase 3 RBAC coverage: PaystackController handler permissions", () => {
  it("PaystackController has at least one route handler", () => {
    expect(routeHandlers(PaystackController).length).toBeGreaterThan(0);
  });

  it("initPayment carries @Permissions('payment.record')", () => {
    const proto = PaystackController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["initPayment"] as object);
    expect(perms).toEqual(["payment.record"]);
  });

  it("verifyPayment carries @Permissions('payment.read')", () => {
    const proto = PaystackController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["verifyPayment"] as object);
    expect(perms).toEqual(["payment.read"]);
  });

  it("handleWebhook carries NO @Permissions (webhook has no user session — guard is HMAC only)", () => {
    const proto = PaystackController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["handleWebhook"] as object);
    expect(perms).toBeUndefined();
  });

  it("Paystack @Permissions values ('payment.record', 'payment.read') are known Phase 3 permissions", () => {
    const paystackPerms = ["payment.record", "payment.read"];
    const unknown = paystackPerms.filter((p) => !PHASE_3_SET.has(p));
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 9 — PaymentPlansController coverage.
// ---------------------------------------------------------------------------

const PHASE_3_PAYMENT_PLAN_CONTROLLERS: Array<[string, Ctor]> = [
  ["PaymentPlansController", PaymentPlansController],
];

describe("Phase 3 RBAC coverage: payment-plan route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_PAYMENT_PLAN_CONTROLLERS);

  it("every Phase 3 payment-plan @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_PAYMENT_PLAN_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

describe("Phase 3 RBAC coverage: seeded role grants match the spec", () => {
  it("admin grants every Phase 3 permission EXCEPT the owner-only ones (auth.2fa.manage)", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    const ownerOnly = new Set<string>(PHASE_3_OWNER_ONLY_PERMISSIONS);
    for (const p of PHASE_3_PERMISSIONS) {
      expect(adminPerms.has(p), `admin ${ownerOnly.has(p) ? "should NOT" : "should"} have ${p}`).toBe(
        !ownerOnly.has(p),
      );
    }
  });

  it("all 8 fee-catalog permission strings are granted to admin", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    const feeCatalogPerms = PHASE_3_PERMISSIONS.filter(
      (p) => p.startsWith("fee-category.") || p.startsWith("fee-item."),
    );
    for (const p of feeCatalogPerms) {
      expect(adminPerms.has(p), `admin should have ${p}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 10 — FinanceController coverage (debtor list + reminders).
// Phase 3 / Slice 14 adds the dashboard endpoint to the same controller.
// ---------------------------------------------------------------------------

const PHASE_3_FINANCE_CONTROLLERS: Array<[string, Ctor]> = [
  ["FinanceController", FinanceController],
];

describe("Phase 3 RBAC coverage: finance route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_FINANCE_CONTROLLERS);

  it("getDashboard carries @Permissions('finance.dashboard.read')", () => {
    const proto = FinanceController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["getDashboard"] as object);
    expect(perms).toEqual(["finance.dashboard.read"]);
  });

  it("admin is granted finance.dashboard.read (not a highest-trust surface, no owner-only restriction)", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    expect(adminPerms.has("finance.dashboard.read")).toBe(true);
  });

  it("every Phase 3 finance @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_FINANCE_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 11 — RefundsController coverage.
// ---------------------------------------------------------------------------

const PHASE_3_REFUND_CONTROLLERS: Array<[string, Ctor]> = [
  ["RefundsController", RefundsController],
];

describe("Phase 3 RBAC coverage: refund route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_REFUND_CONTROLLERS);

  it("every Phase 3 refund @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_REFUND_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 12 — BvnController coverage.
//
// Cannot use assertCoverage() here: the three /me/bvn* handlers deliberately
// carry NO @Permissions — every authenticated user manages their own BVN
// regardless of role (same "documented exception" shape as PaystackController's
// handleWebhook above). The three /:id/bvn* handlers (admin/owner acting on
// another staff member) ARE permission-gated and follow the normal rule.
// ---------------------------------------------------------------------------

describe("Phase 3 RBAC coverage: BvnController handler permissions", () => {
  it("BvnController has at least one route handler", () => {
    expect(routeHandlers(BvnController).length).toBeGreaterThan(0);
  });

  it.each([
    "captureOwnBvn",
    "getOwnBvnStatus",
    "revealOwnBvn",
  ])("%s carries NO @Permissions (self-service — no role check needed)", (handlerName) => {
    const proto = BvnController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto[handlerName] as object);
    expect(perms).toBeUndefined();
  });

  it("captureBvnForStaff carries @Permissions('staff-bvn.manage-others')", () => {
    const proto = BvnController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["captureBvnForStaff"] as object);
    expect(perms).toEqual(["staff-bvn.manage-others"]);
  });

  it("getBvnStatusForStaff carries @Permissions('staff-bvn.read')", () => {
    const proto = BvnController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["getBvnStatusForStaff"] as object);
    expect(perms).toEqual(["staff-bvn.read"]);
  });

  it("revealBvnForStaff carries @Permissions('staff-bvn.reveal')", () => {
    const proto = BvnController.prototype as unknown as Record<string, unknown>;
    const perms = Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["revealBvnForStaff"] as object);
    expect(perms).toEqual(["staff-bvn.reveal"]);
  });

  it("BVN @Permissions values are known Phase 3 permissions", () => {
    const bvnPerms = ["staff-bvn.manage-others", "staff-bvn.read", "staff-bvn.reveal"];
    const unknown = bvnPerms.filter((p) => !PHASE_3_SET.has(p));
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });

  it("admin is granted all three staff-bvn.* permissions; bursar is excluded (mirrors payment.refund)", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    expect(adminPerms.has("staff-bvn.manage-others")).toBe(true);
    expect(adminPerms.has("staff-bvn.read")).toBe(true);
    expect(adminPerms.has("staff-bvn.reveal")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 13 — expense tracking controller coverage.
// ---------------------------------------------------------------------------

const PHASE_3_EXPENSE_CONTROLLERS: Array<[string, Ctor]> = [
  ["ExpenseCategoriesController", ExpenseCategoriesController],
  ["ExpensesController", ExpensesController],
];

describe("Phase 3 RBAC coverage: expense route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_EXPENSE_CONTROLLERS);

  it("every Phase 3 expense @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_EXPENSE_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });

  it("admin is granted all 8 expense-tracking permission strings (no owner-only restriction)", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    const expensePerms = PHASE_3_PERMISSIONS.filter(
      (p) => p.startsWith("expense-category.") || p.startsWith("expense."),
    );
    for (const p of expensePerms) {
      expect(adminPerms.has(p), `admin should have ${p}`).toBe(true);
    }
  });

  it("uploadReceipt and getReceiptUrl carry expense.update / expense.read respectively", () => {
    const proto = ExpensesController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["uploadReceipt"] as object)).toEqual([
      "expense.update",
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["getReceiptUrl"] as object)).toEqual([
      "expense.read",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Payroll CP3 — PayrollController coverage. list/findById gate on
// payroll.read; create/update/approve/generatePayslip gate on
// payroll.process (no separate payroll.approve permission — the approve
// transition is covered by payroll.process, same as create/update).
// ---------------------------------------------------------------------------

const PHASE_3_PAYROLL_CONTROLLERS: Array<[string, Ctor]> = [
  ["PayrollController", PayrollController],
];

describe("Phase 3 RBAC coverage: payroll route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_PAYROLL_CONTROLLERS);

  it("every Phase 3 payroll @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_PAYROLL_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });

  it("list/findById carry payroll.read; create/update/approve/generatePayslip carry payroll.process", () => {
    const proto = PayrollController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["list"] as object)).toEqual(["payroll.read"]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["findById"] as object)).toEqual(["payroll.read"]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["create"] as object)).toEqual(["payroll.process"]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["update"] as object)).toEqual(["payroll.process"]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["approve"] as object)).toEqual(["payroll.process"]);
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["generatePayslip"] as object)).toEqual([
      "payroll.process",
    ]);
    // CP4b: transfer carries the separate, higher-trust payroll.transfer
    // permission — not payroll.process — since it's owner+admin only.
    expect(Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto["transfer"] as object)).toEqual([
      "payroll.transfer",
    ]);
  });

  it("admin and bursar are granted payroll.read + payroll.process; bursar lacks payroll.transfer", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    const bursarPerms = new Set(roleSeed("bursar").permissions);
    expect(adminPerms.has("payroll.read")).toBe(true);
    expect(adminPerms.has("payroll.process")).toBe(true);
    expect(adminPerms.has("payroll.transfer")).toBe(true);
    expect(bursarPerms.has("payroll.read")).toBe(true);
    expect(bursarPerms.has("payroll.process")).toBe(true);
    expect(bursarPerms.has("payroll.transfer")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payroll CP4a — StaffBankAccountController coverage. Gated by
// payroll.process throughout (not a new permission string) — setting up
// WHERE a staff member's salary goes is routine payroll administration, the
// same tier as creating/approving a PayrollItem; only payroll.transfer (the
// actual money movement) is admin+owner only.
// ---------------------------------------------------------------------------

const PHASE_3_STAFF_BANK_ACCOUNT_CONTROLLERS: Array<[string, Ctor]> = [
  ["StaffBankAccountController", StaffBankAccountController],
];

describe("Phase 3 RBAC coverage: staff bank account route handlers declare @Permissions", () => {
  assertCoverage(PHASE_3_STAFF_BANK_ACCOUNT_CONTROLLERS);

  it("every staff bank account @Permissions value is a known Phase 3 permission", () => {
    const unknown: string[] = [];
    for (const [name, ctor] of PHASE_3_STAFF_BANK_ACCOUNT_CONTROLLERS) {
      for (const p of handlerPermissions(ctor)) {
        if (!PHASE_3_SET.has(p)) unknown.push(`${name}:${p}`);
      }
    }
    expect(unknown, `unknown Phase 3 permission(s): ${unknown.join(", ")}`).toEqual([]);
  });

  it("verify/create/findByUser/deactivate all carry payroll.process", () => {
    const proto = StaffBankAccountController.prototype as unknown as Record<string, unknown>;
    for (const handler of ["verify", "create", "findByUser", "deactivate"]) {
      expect(
        Reflect.getMetadata(PERMISSIONS_METADATA_KEY, proto[handler] as object),
        `${handler} @Permissions`,
      ).toEqual(["payroll.process"]);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 / Slice 15 — RBAC close-out. The bursar role's exact grant, a
// re-assertion that admin still holds every Phase 3 permission except the
// owner-only set, and a mechanical audit that every PHASE_3_PERMISSIONS
// string is accounted for by exactly one of the three buckets below (owner-
// only, bursar-and-admin, admin-only-not-bursar). A permission added to
// PHASE_3_PERMISSIONS in a future slice without a bursar decision fails this
// audit loudly, instead of silently defaulting to "bursar doesn't have it"
// or "bursar has it" by accident — the same fail-closed discipline the
// SECURITY DEFINER inventory spec established for that table.
// ---------------------------------------------------------------------------

const PHASE_3_BURSAR_SET = new Set<string>(PHASE_3_BURSAR_PERMISSIONS);
const PHASE_3_OWNER_ONLY_SET = new Set<string>(PHASE_3_OWNER_ONLY_PERMISSIONS);

describe("Phase 3 RBAC close-out: seeded role grants", () => {
  it("owner is still the wildcard role", () => {
    expect(roleSeed("owner").permissions).toEqual(["*"]);
  });

  it("admin grants every Phase 3 permission EXCEPT the owner-only ones (unchanged by the bursar wire-up)", () => {
    const adminPerms = new Set(roleSeed("admin").permissions);
    for (const p of PHASE_3_PERMISSIONS) {
      expect(adminPerms.has(p), `admin ${PHASE_3_OWNER_ONLY_SET.has(p) ? "should NOT" : "should"} have ${p}`).toBe(
        !PHASE_3_OWNER_ONLY_SET.has(p),
      );
    }
  });

  it("bursar grants exactly PHASE_3_BURSAR_PERMISSIONS (no more, no less)", () => {
    const bursarPerms = new Set(roleSeed("bursar").permissions);
    for (const p of PHASE_3_BURSAR_PERMISSIONS) {
      expect(bursarPerms.has(p), `bursar should have ${p}`).toBe(true);
    }
    for (const p of PHASE_3_PERMISSIONS) {
      if (!PHASE_3_BURSAR_SET.has(p)) {
        expect(bursarPerms.has(p), `bursar should NOT have ${p}`).toBe(false);
      }
    }
  });

  it("bursar holds no Phase 0/1/2 permission (finance-only role, no academic/roster/staff/settings access)", () => {
    const bursarPerms = new Set(roleSeed("bursar").permissions);
    expect(bursarPerms.size).toBe(PHASE_3_BURSAR_PERMISSIONS.length);
  });

  it("bursar is excluded from payment.refund and all three staff-bvn.* permissions", () => {
    const bursarPerms = new Set(roleSeed("bursar").permissions);
    expect(bursarPerms.has("payment.refund")).toBe(false);
    expect(bursarPerms.has("staff-bvn.manage-others")).toBe(false);
    expect(bursarPerms.has("staff-bvn.read")).toBe(false);
    expect(bursarPerms.has("staff-bvn.reveal")).toBe(false);
    expect(bursarPerms.has("auth.2fa.manage")).toBe(false);
    expect(bursarPerms.has("auth.2fa.read")).toBe(false);
  });

  it("a permission is never both owner-only and bursar-granted", () => {
    const overlap = PHASE_3_PERMISSIONS.filter(
      (p) => PHASE_3_OWNER_ONLY_SET.has(p) && PHASE_3_BURSAR_SET.has(p),
    );
    expect(overlap).toEqual([]);
  });

  // The mechanical audit itself: every PHASE_3_PERMISSIONS string bursar does
  // NOT hold must appear on this named, reasoned exclusion list. A future
  // slice that adds a permission to PHASE_3_PERMISSIONS without an explicit
  // bursar decision fails this test (the new string is "unaccounted for")
  // instead of silently defaulting to excluded-and-forgotten.
  const KNOWN_BURSAR_EXCLUSIONS = new Set<string>([
    "auth.2fa.manage", // owner-only, auth surface
    "auth.2fa.read", // admin oversight of other users' 2FA, auth surface
    "payment.refund", // highest-trust mutation, owner+admin only
    "staff-bvn.manage-others", // HR-adjacent staff-payroll surface
    "staff-bvn.read",
    "staff-bvn.reveal",
    "payroll.transfer", // highest-trust money-movement mutation, owner+admin only
  ]);

  it("every Phase 3 permission bursar lacks is on the named, reasoned exclusion list", () => {
    const unaccounted = PHASE_3_PERMISSIONS.filter(
      (p) => !PHASE_3_BURSAR_SET.has(p) && !KNOWN_BURSAR_EXCLUSIONS.has(p),
    );
    expect(unaccounted, `permission(s) excluded from bursar with no recorded reason: ${unaccounted.join(", ")}`).toEqual(
      [],
    );
  });
});
