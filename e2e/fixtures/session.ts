import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  apiActivateSchool,
  apiLogin,
  apiSignupOwner,
  createApiContext,
} from "./api.js";
import { uniquePhone, uniqueSuffix } from "./unique.js";

// The web app authenticates with a bearer token in localStorage under this
// exact key (apps/web/src/lib/api-client.ts → AUTH_TOKEN_STORAGE_KEY). On cold
// boot, AuthProvider reads it and calls GET /auth/me to hydrate. We inject the
// token via addInitScript so it is present BEFORE any page script runs on every
// navigation in the context — no UI login round-trip, no race.
const AUTH_TOKEN_STORAGE_KEY = "sk_auth_token";

async function authedContext(
  browser: Browser,
  token: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [AUTH_TOKEN_STORAGE_KEY, token] as const,
  );
  const page = await context.newPage();
  return { context, page };
}

export interface AdminSession {
  context: BrowserContext;
  page: Page;
  api: APIRequestContext; // bearer-authed API context for setup calls
  token: string;
  schoolId: string;
  ownerUserId: string;
  email: string;
  password: string;
  schoolName: string;
}

// loginAsAdmin — provisions a fresh, ACTIVE school and returns an
// admin/owner session. "Admin" here is the school owner: the owner role is a
// superset of admin and can do every setup mutation cp4 needs (academic
// structure, teacher assignments). Provisioning a fresh school per test is the
// isolation guarantee — no shared state between tests, unique identifiers
// everywhere.
//
// Pass opts.email/opts.password to instead LOG IN to an already-provisioned
// school (used when a second context for the same admin is needed). The
// returned `api` is a standalone bearer-authed APIRequestContext; the caller
// disposes the whole session via closeSession().
export async function loginAsAdmin(
  browser: Browser,
  opts?: { email?: string; password?: string },
): Promise<AdminSession> {
  if (opts?.email && opts.password) {
    const anonApi = await createApiContext();
    const { user, token } = await apiLogin(anonApi, opts.email, opts.password);
    await anonApi.dispose();
    const api = await createApiContext(token);
    const { context, page } = await authedContext(browser, token);
    return {
      context,
      page,
      api,
      token,
      schoolId: user.schoolId,
      ownerUserId: user.id,
      email: opts.email,
      password: opts.password,
      schoolName: "",
    };
  }

  const suffix = uniqueSuffix();
  const email = `e2e-admin-${suffix}@school-kit.test`;
  const password = "Password1!";
  const schoolName = `E2E School ${suffix}`;

  const anonApi = await createApiContext();
  const signup = await apiSignupOwner(anonApi, {
    schoolName,
    schoolSlug: `e2e-${suffix}`,
    ownerFirstName: "Eve",
    ownerLastName: "Owner",
    ownerEmail: email,
    ownerPhone: uniquePhone(),
    password,
  });
  await anonApi.dispose();

  const api = await createApiContext(signup.token);
  // School contact is decoupled from the owner's personal contact (the schema
  // keeps School.phone unconstrained while User.phone is globally unique).
  await apiActivateSchool(api, {
    name: schoolName,
    phone: "+2348012345678",
    email: `e2e-school-${suffix}@school-kit.test`,
  });

  const { context, page } = await authedContext(browser, signup.token);
  return {
    context,
    page,
    api,
    token: signup.token,
    schoolId: signup.school.id,
    ownerUserId: signup.user.id,
    email,
    password,
    schoolName,
  };
}

export interface TeacherSession {
  context: BrowserContext;
  page: Page;
  token: string;
  userId: string;
}

// loginAsTeacher — opens a fresh browser context already authenticated as the
// given teacher, by logging in over the API and injecting the resulting token.
// Used to get a clean teacher browsing context from credentials (the teacher
// was created earlier via inviteAndAcceptTeacher, which returns email +
// password). No UI login form is driven — API login + token injection is faster
// and has no form-interaction flake surface.
export async function loginAsTeacher(
  browser: Browser,
  email: string,
  password: string,
): Promise<TeacherSession> {
  const anonApi = await createApiContext();
  const { user, token } = await apiLogin(anonApi, email, password);
  await anonApi.dispose();
  const { context, page } = await authedContext(browser, token);
  return { context, page, token, userId: user.id };
}
