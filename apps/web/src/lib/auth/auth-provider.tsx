"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import type {
  AuthMeRoleDto,
  LoginInput,
  MeResponse,
  SchoolMeDto,
  SignupOwnerInput,
  SignupOwnerUserDto,
} from "@school-kit/types";

import {
  AUTH_UNAUTHORIZED_EVENT,
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from "../api-client";
import { identify, resetIdentity, track } from "../observability/events";
import {
  loginRequest,
  logoutRequest,
  meRequest,
  signupOwnerRequest,
} from "./auth-api";

export type AuthStatus = "loading" | "authed" | "guest";

export interface AuthState {
  status: AuthStatus;
  user: SignupOwnerUserDto | null;
  school: SchoolMeDto | null;
  roles: AuthMeRoleDto[];
  permissions: string[];
  token: string | null;
}

export interface AuthContextValue extends AuthState {
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupOwnerInput) => Promise<void>;
  logout: () => Promise<void>;
  // Called by the onboarding flow after each POST /onboarding/:step to keep
  // the auth context's school in sync without a round-trip to /auth/me.
  // Status + onboardingStep are what RequireAuth/RequireOnboarding gate on,
  // so they must update the moment the step response lands or the
  // subsequent router.push to the next step would be redirected back.
  setSchool: (school: SchoolMeDto) => void;
}

const initialState: AuthState = {
  status: "loading",
  user: null,
  school: null,
  roles: [],
  permissions: [],
  token: null,
};

export const AuthContext = createContext<AuthContextValue | null>(null);

function applyMeToState(me: MeResponse, token: string): AuthState {
  return {
    status: "authed",
    user: me.user,
    school: me.school,
    roles: me.roles,
    permissions: me.permissions,
    token,
  };
}

function guestState(): AuthState {
  return { ...initialState, status: "guest" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>(initialState);

  // Cold-boot hydration. If a token is in localStorage, try /auth/me to
  // confirm it's still valid and to load the user/school. If the token is
  // missing, expired, or rejected, drop to `guest`.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setState(guestState());
      return;
    }
    let cancelled = false;
    meRequest()
      .then((me) => {
        if (cancelled) return;
        setState(applyMeToState(me, token));
        // Re-identify on every hydration so PostHog associates this
        // browser session with the right user, even after a tab reload.
        identify(me.user.id, {
          schoolId: me.school.id,
          schoolStatus: me.school.status,
          role: me.roles[0]?.key,
        });
      })
      .catch(() => {
        if (cancelled) return;
        clearStoredToken();
        setState(guestState());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mid-session 401 handling. When apiFetch sees a 401 on any authed call
  // it clears the token and dispatches AUTH_UNAUTHORIZED_EVENT. We listen
  // here, flip to guest, and let RequireAuth re-render to issue the
  // redirect. There IS a brief flash possible between the failed query
  // resolving and this effect firing — we accept that rather than wrap
  // the admin shell in an error boundary, because (a) it's at most one
  // frame, (b) the alternative adds error-boundary plumbing for every
  // query, and (c) the user lands on /login either way.
  useEffect(() => {
    const handler = () => {
      setState(guestState());
      router.replace("/login");
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  }, [router]);

  const login = useCallback(
    async (input: LoginInput) => {
      const response = await loginRequest(input);
      setStoredToken(response.token);
      // We just got the user + school back from /login; re-issue /auth/me
      // to also pull roles + permissions in the same shape we hydrate from
      // on reload. One extra request keeps the in-memory state consistent.
      const me = await meRequest();
      setState(applyMeToState(me, response.token));
      identify(me.user.id, {
        schoolId: me.school.id,
        schoolStatus: me.school.status,
        role: me.roles[0]?.key,
      });
      track("login_completed", {
        schoolId: me.school.id,
        role: me.roles[0]?.key ?? "unknown",
      });
    },
    [],
  );

  const setSchool = useCallback((school: SchoolMeDto) => {
    setState((prev) => ({ ...prev, school }));
  }, []);

  const signup = useCallback(async (input: SignupOwnerInput) => {
    const response = await signupOwnerRequest(input);
    setStoredToken(response.token);
    // Fetch /auth/me right after signup so roles + permissions populate
    // in the same shape as login/hydration. The signup response gives us
    // user + school + token; /auth/me adds the owner role grant.
    const me = await meRequest();
    setState(applyMeToState(me, response.token));
    identify(me.user.id, {
      schoolId: me.school.id,
      schoolStatus: me.school.status,
      role: me.roles[0]?.key,
    });
    track("signup_completed", {
      schoolId: me.school.id,
      schoolStatus: me.school.status,
      role: me.roles[0]?.key ?? "owner",
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Server-side logout failures are non-fatal — we still clear local
      // state so the user is not stuck in a phantom session.
    }
    clearStoredToken();
    // Reset PostHog identity so a subsequent login on the same browser
    // gets a fresh anonymous id (no event fusion across users).
    resetIdentity();
    setState(guestState());
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ ...state, login, signup, logout, setSchool }}>
      {children}
    </AuthContext.Provider>
  );
}
