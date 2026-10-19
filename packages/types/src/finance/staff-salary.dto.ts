import { z } from "zod";

// Staff salaries (2026-10-19, the owner: "when adding or inviting staff, add a
// salary field and link it with payroll under finance"). One current monthly
// gross per staff member, in kobo (CLAUDE.md's money rule); payroll's "Add to
// payroll" fills each month's gross from it. Read and written under
// payroll.process — a salary is payroll information, so an admin who could
// invite staff but held no payroll permission would not see it.

/** Ceiling on a monthly salary: ₦100,000,000.00, far above any school wage, below INTEGER's limit. */
export const MAX_MONTHLY_GROSS_KOBO = 10_000_000_000;

export const monthlyGrossSchema = z
  .number()
  .int("Salary must be a whole number of kobo")
  .positive("Salary must be more than zero")
  .max(MAX_MONTHLY_GROSS_KOBO, "That salary is too large");

// PUT /payroll/salaries/:userId
export const setStaffSalarySchema = z.object({ monthlyGross: monthlyGrossSchema }).strict();
export type SetStaffSalaryInput = z.infer<typeof setStaffSalarySchema>;

export interface StaffSalaryDto {
  userId: string;
  /** Kobo. */
  monthlyGross: number;
  updatedAt: string | Date;
}

/** The audit action for every change to a saved salary, wherever it is made. */
export const STAFF_SALARY_SET_AUDIT_ACTION = "staff-salary.set";
