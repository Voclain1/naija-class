import { type APIRequestContext, type APIResponse } from "@playwright/test";

// Finance setup helpers for the bursar invoice journey.
//
// Same principle as the rest of e2e/fixtures: API-FIRST SETUP, UI-ONLY
// ASSERTIONS. Students, enrolments and the fee catalog are built over HTTP;
// the browser is reserved for the invoice screens under test.
//
// Every school these run against is provisioned fresh by loginAsAdmin, so
// the invoices created (and cancelled) here belong to a throwaway tenant on
// the LOCAL docker Postgres — never a real school's financial records.

async function unwrap<T>(res: APIResponse, label: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(
      `${label} failed: ${res.status()} ${res.statusText()} — ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

export interface SeededStudent {
  id: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
}

// Realistic Nigerian names, deliberately including a very long double-barrelled
// one — the invoice list's Student column has to wrap it rather than push the
// naira columns off screen.
export const ROSTER: Array<{ firstName: string; lastName: string }> = [
  { firstName: "Adaeze", lastName: "Okonkwo" },
  { firstName: "Oluwaseun", lastName: "Adebayo-Ogundimu" },
  { firstName: "Ibrahim", lastName: "Danjuma" },
];

export async function apiCreateStudent(
  api: APIRequestContext,
  input: {
    admissionNumber: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    gender: "MALE" | "FEMALE" | "OTHER";
  },
): Promise<{ id: string }> {
  return unwrap(await api.post("students", { data: input }), "createStudent");
}

export async function apiCreateEnrollment(
  api: APIRequestContext,
  input: { studentId: string; termId: string; classArmId: string },
): Promise<{ id: string }> {
  return unwrap(
    await api.post("enrollments", { data: { ...input, status: "ENROLLED" } }),
    "createEnrollment",
  );
}

export async function apiCreateFeeCategory(
  api: APIRequestContext,
  input: { name: string },
): Promise<{ id: string }> {
  return unwrap(await api.post("fee-categories", { data: input }), "createFeeCategory");
}

export async function apiCreateFeeItem(
  api: APIRequestContext,
  input: {
    categoryId: string;
    name: string;
    amount: number; // kobo
    classLevelId?: string;
    termId?: string;
    academicYearId?: string;
  },
): Promise<{ id: string }> {
  return unwrap(await api.post("fee-items", { data: input }), "createFeeItem");
}

export async function apiListInvoices(
  api: APIRequestContext,
  query: { termId?: string; classArmId?: string } = {},
): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  return unwrap(await api.get(`invoices?${params.toString()}`), "listInvoices");
}

export interface FinanceScaffold {
  students: SeededStudent[];
  feeItemAmount: number;
}

/**
 * Seed a class arm with an enrolled roster and one term fee, so the Generate
 * tab has something real to bill.
 *
 * `feeAmountKobo` defaults to ₦45,000.00 — a plausible Nigerian private-school
 * term fee, so the naira formatting is exercised at a realistic magnitude
 * rather than at ₦1.00.
 */
export async function setupFinanceScaffold(
  api: APIRequestContext,
  input: {
    suffix: string;
    termId: string;
    classArmId: string;
    classLevelId: string;
    academicYearId: string;
    feeAmountKobo?: number;
  },
): Promise<FinanceScaffold> {
  const feeItemAmount = input.feeAmountKobo ?? 45_000_00;

  const students: SeededStudent[] = [];
  for (const [index, person] of ROSTER.entries()) {
    const admissionNumber = `SKA/${input.suffix}/${String(index + 1).padStart(4, "0")}`;
    const created = await apiCreateStudent(api, {
      admissionNumber,
      firstName: person.firstName,
      lastName: person.lastName,
      dateOfBirth: "2012-05-14T00:00:00.000Z",
      gender: index % 2 === 0 ? "FEMALE" : "MALE",
    });
    await apiCreateEnrollment(api, {
      studentId: created.id,
      termId: input.termId,
      classArmId: input.classArmId,
    });
    students.push({ id: created.id, admissionNumber, ...person });
  }

  const category = await apiCreateFeeCategory(api, { name: `Tuition ${input.suffix}` });
  await apiCreateFeeItem(api, {
    categoryId: category.id,
    name: "Term tuition",
    amount: feeItemAmount,
    classLevelId: input.classLevelId,
    termId: input.termId,
    academicYearId: input.academicYearId,
  });

  return { students, feeItemAmount };
}
