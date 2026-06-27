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
  TotpChallengeInput,
} from "@school-kit/types";

import {
  AUTH_UNAUTHORIZED_EVENT,
  clearStoredToken,
  setStoredToken,
} from "../api-client";
import { identify, resetIdentity, track } from "../observability/events";
import {
  loginRequest,
  logoutRequest,
  meRequest,
  sessionRequest,
  signupOwnerRequest,
  twoFactorChallengeRequest,
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
  // Returns void when login completes normally.
  // Returns { requiresTwoFactor: true; challengeToken } when 2FA is needed;
  // the caller (LoginForm) is responsible for collecting the TOTP code and
  // calling loginWithChallenge.
  login: (input: LoginInput) => Promise<void | { requiresTwoFactor: true; challengeToken: string }>;
  loginWithChallenge: (input: TotpChallengeInput) => Promise<void>;
  signup: (input: SignupOwnerInput) => Promise<void>;
  logout: () => Promise<void>;
  // Called by the onboarding flow to keep the auth context's school in sync
  // after each POST /onboarding/:step without a full /auth/me round-trip.
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

  // Cold-boot hydration. GET /api/auth/session reads the sk_session HttpOnly
  // cookie server-side and returns the raw token. We store it in the
  // module-level activeToken (via setStoredToken) so subsequent apiFetch
  // calls can attach it as a bearer header. Then we call /auth/me to confirm
  // the token is still valid and load user/school/roles.
  //
  // If the session cookie is absent or /auth/me rejects, we drop to `guest`
  // quietly — no redirect event, no toast. The auth guard will redirect.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      let token: string | null = null;
      try {
        token = await sessionRequest();
      } catch {
        // /api/auth/session unavailable — treat as no session.
      }
      if (!token) {
        if (!cancelled) setState(guestState());
        return;
      }
      setStoredToken(token);
      try {
        const me = await meRequest();
        if (cancelled) return;
        setState(applyMeToState(me, token));
        identify(me.user.id, {
          schoolId: me.school.id,
          schoolStatus: me.school.status,
          role: me.roles[0]?.key,
        });
      } catch {
        if (cancelled) return;
        clearStoredToken();
        setState(guestState());
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mid-session 401 handling. When apiFetch sees a 401 on any authed call it
  // clears the in-memory token and dispatches AUTH_UNAUTHORIZED_EVENT. We
  // listen here, drop to guest, and let RequireAuth issue the redirect.
  useEffect(() => {
    const handler = () => {
      clearStoredToken();
      setState(guestState());
      router.replace("/login");
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  }, [router]);

  const login = useCallback(
    async (
      input: LoginInput,
    ): Promise<void | { requiresTwoFactor: true; challengeToken: string }> => {
      const response = await loginRequest(input);

      if (response.requiresTwoFactor) {
        // 2FA challenge: the proxy did NOT set a cookie yet. Return the
        // challenge data so LoginForm can collect the TOTP code and call
        // loginWithChallenge. Auth state stays "loading" until that resolves.
        return response;
      }

      // Full session: the proxy set the sk_session cookie. Also store the
      // token in-memory for immediate apiFetch use (e.g. the /auth/me call
      // that follows, which goes directly to NestJS with the bearer header).
      setStoredToken(response.token);
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

  const loginWithChallenge = useCallback(async (input: TotpChallengeInput): Promise<void> => {
    const response = await twoFactorChallengeRequest(input);
    // The challenge endpoint always returns requiresTwoFactor: false.
    if (response.requiresTwoFactor) {
      throw new Error("Unexpected 2FA response from challenge endpoint.");
    }
    setStoredToken(response.token);
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
  }, []);

  const setSchool = useCallback((school: SchoolMeDto) => {
    setState((prev) => ({ ...prev, school }));
  }, []);

  const signup = useCallback(async (input: SignupOwnerInput) => {
    const response = await signupOwnerRequest(input);
    // Proxy set the sk_session cookie. Also seed in-memory for immediate use.
    setStoredToken(response.token);
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
      await logoutRequest(); // proxy clears the sk_session cookie
    } catch {
      // Server-side logout failure is non-fatal — clear local state regardless.
    }
    clearStoredToken();
    resetIdentity();
    setState(guestState());
    router.replace("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{ ...state, login, loginWithChallenge, signup, logout, setSchool }}
    >
      {children}
    </AuthContext.Provider>
  );
}
