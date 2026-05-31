// Low-level API client for E2E setup. The design principle for cp4's fixtures
// is API-FIRST SETUP, UI-ONLY ASSERTIONS: we never click through the admin UI
// to build academic structure or assignments — the admin endpoints from
// slices 1–3 and 11 cp1 already exist, so we call them directly over HTTP and
// reserve the browser for the thing under test (the teacher portal).
//
// Everything here is a thin, typed wrapper over Playwright's APIRequestContext
// pointed at the NestJS API (global prefix /api/v1, port 4000 — see
// apps/api/src/main.ts). CORS already allows the web origin; these calls go
// straight to the API, bypassing the browser entirely.
//
// PATH NOTE: Playwright resolves a request path with `new URL(path, baseURL)`.
// A leading-slash path ("/auth/x") would drop the base's "/api/v1" segment, so
// the base URL carries a TRAILING slash and every path below is PREFIX-RELATIVE
// (no leading slash) — "auth/x" against ".../api/v1/" → ".../api/v1/auth/x".

import {
  type APIRequestContext,
  type APIResponse,
  request as playwrightRequest,
} from "@playwright/test";

// The API base, WITH a trailing slash (see PATH NOTE above). Overridable for
// non-default ports.
export const API_BASE_URL =
  process.env.E2E_API_URL ?? "http://localhost:4000/api/v1/";

// A standalone request context carrying the bearer (or anonymous, for the
// public signup call). Caller owns disposal via `.dispose()`.
export async function createApiContext(
  token?: string,
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function unwrap<T>(res: APIResponse, label: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(
      `${label} failed: ${res.status()} ${res.statusText()} — ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Response shapes — only the fields the fixtures actually read. The API
// returns more; keeping these narrow documents what cp4 depends on.
// ---------------------------------------------------------------------------

export interface SignupOwnerResponse {
  user: { id: string; schoolId: string };
  school: { id: string; status: string; slug: string };
  token: string;
}

export interface LoginResponse {
  user: { id: string; schoolId: string };
  token: string;
}

interface CreatedRow {
  id: string;
}

interface ClassLevelRow {
  id: string;
  code: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Auth + onboarding
// ---------------------------------------------------------------------------

export interface SignupOwnerInput {
  schoolName: string;
  schoolSlug: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhone: string;
  password: string;
}

export async function apiSignupOwner(
  api: APIRequestContext,
  input: SignupOwnerInput,
): Promise<SignupOwnerResponse> {
  return unwrap(
    await api.post("auth/signup-owner", {
      data: { ...input, ndprConsent: true },
    }),
    "signup-owner",
  );
}

export async function apiLogin(
  api: APIRequestContext,
  email: string,
  password: string,
): Promise<LoginResponse> {
  return unwrap(
    await api.post("auth/login", { data: { email, password } }),
    "login",
  );
}

export async function apiMe(
  api: APIRequestContext,
): Promise<{ user: { id: string; schoolId: string } }> {
  return unwrap(await api.get("auth/me"), "auth/me");
}

// Drive the five onboarding steps to flip the school from ONBOARDING to ACTIVE.
// Each step gates on the previous one (the API enforces step order), so this
// runs strictly sequentially. The school must be ACTIVE before invitations may
// be sent and before the (teacher) RequireAuth gate will render the portal.
export async function apiActivateSchool(
  api: APIRequestContext,
  opts: { name: string; phone: string; email: string },
): Promise<void> {
  await unwrap(
    await api.post("schools/me/onboarding/1", {
      data: { name: opts.name, phone: opts.phone, email: opts.email },
    }),
    "onboarding/1",
  );
  await unwrap(
    await api.post("schools/me/onboarding/2", { data: {} }),
    "onboarding/2",
  );
  await unwrap(
    await api.post("schools/me/onboarding/3", { data: { invites: [] } }),
    "onboarding/3",
  );
  await unwrap(
    await api.post("schools/me/onboarding/4", { data: { ndprConsent: true } }),
    "onboarding/4",
  );
  await unwrap(
    await api.post("schools/me/onboarding/5", { data: {} }),
    "onboarding/5",
  );
}

// ---------------------------------------------------------------------------
// Academic structure (slices 1–3)
// ---------------------------------------------------------------------------

interface AcademicYearRow {
  id: string;
  label: string;
}

interface TermRow {
  id: string;
  sequence: number;
}

interface SubjectRow {
  id: string;
  code: string;
}

interface ClassArmRow {
  id: string;
  code: string;
}

export async function apiListClassLevels(
  api: APIRequestContext,
): Promise<ClassLevelRow[]> {
  return unwrap(await api.get("class-levels"), "list class-levels");
}

export async function apiListAcademicYears(
  api: APIRequestContext,
): Promise<AcademicYearRow[]> {
  return unwrap(await api.get("academic-years"), "list academic-years");
}

export async function apiListTerms(
  api: APIRequestContext,
  yearId: string,
): Promise<TermRow[]> {
  return unwrap(
    await api.get(`academic-years/${yearId}/terms`),
    "list terms",
  );
}

export async function apiListSubjects(
  api: APIRequestContext,
): Promise<SubjectRow[]> {
  return unwrap(await api.get("subjects"), "list subjects");
}

export async function apiListClassArms(
  api: APIRequestContext,
  levelId: string,
): Promise<ClassArmRow[]> {
  return unwrap(
    await api.get(`class-levels/${levelId}/class-arms`),
    "list class-arms",
  );
}

export async function apiCreateAcademicYear(
  api: APIRequestContext,
  input: { label: string; startDate: string; endDate: string },
): Promise<CreatedRow> {
  return unwrap(
    await api.post("academic-years", { data: input }),
    "create academic-year",
  );
}

export async function apiSetCurrentYear(
  api: APIRequestContext,
  yearId: string,
): Promise<void> {
  await unwrap(
    await api.post(`academic-years/${yearId}/set-current`, { data: {} }),
    "set-current academic-year",
  );
}

export async function apiCreateTerm(
  api: APIRequestContext,
  yearId: string,
  input: { sequence: number; name: string; startDate: string; endDate: string },
): Promise<CreatedRow> {
  return unwrap(
    await api.post(`academic-years/${yearId}/terms`, { data: input }),
    "create term",
  );
}

export async function apiSetCurrentTerm(
  api: APIRequestContext,
  termId: string,
): Promise<void> {
  await unwrap(
    await api.post(`terms/${termId}/set-current`, { data: {} }),
    "set-current term",
  );
}

export async function apiCreateClassArm(
  api: APIRequestContext,
  levelId: string,
  input: { name: string; code: string },
): Promise<CreatedRow> {
  return unwrap(
    await api.post(`class-levels/${levelId}/class-arms`, { data: input }),
    "create class-arm",
  );
}

export async function apiCreateSubject(
  api: APIRequestContext,
  input: { name: string; code: string },
): Promise<CreatedRow> {
  return unwrap(await api.post("subjects", { data: input }), "create subject");
}

// ---------------------------------------------------------------------------
// Teacher assignment (slice 11 cp1)
// ---------------------------------------------------------------------------

export async function apiCreateTeacherAssignment(
  api: APIRequestContext,
  input: {
    teacherId: string;
    classArmId: string;
    subjectId: string;
    academicYearId: string;
    termId?: string | null;
  },
): Promise<CreatedRow> {
  return unwrap(
    await api.post("teacher-assignments", { data: input }),
    "create teacher-assignment",
  );
}
