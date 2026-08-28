"use client";

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
  ApiError,
  type UnauthorizedEventDetail,
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

import { beginAuthForcedNavigation, parkSessionEndReason } from "./session-end-navigation";
import { buildLoginUrl, reasonFromErrorCode } from "./session-end";

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
  // Returns { requiresTwoFactor: true; challengeToken } when 2FA is needed;
  // the caller (LoginForm) is responsible for collecting the TOTP code and
  // calling loginWithChallenge. Returns { requiresTwoFactor: false; roles }
  // when login completes normally — LoginForm needs `roles` synchronously
  // (not by reading useAuth() again right after awaiting this) to pick the
  // post-login redirect target via homeRouteForRoles(), since a closure over
  // this hook's own `roles` would still hold the pre-login (empty) value at
  // that point in the render that captured it.
  login: (
    input: LoginInput,
  ) => Promise<{ requiresTwoFactor: true; challengeToken: string } | { requiresTwoFactor: false; roles: AuthMeRoleDto[] }>;
  // Always succeeds or throws (the 2FA challenge endpoint never itself asks
  // for a further challenge) — returns the resolved roles for the same
  // reason `login()` does above.
  loginWithChallenge: (input: TotpChallengeInput) => Promise<AuthMeRoleDto[]>;
  signup: (input: SignupOwnerInput) => Promise<void>;
  logout: () => Promise<void>;
  // Called by the onboarding flow to keep the auth context's school in sync
  // after each POST /onboarding/:step without a full /auth/me round-trip.
  setSchool: (school: SchoolMeDto) => void;
  // Called after POST /users/me/complete-tour so the first-login tour's
  // "don't show again" state is reflected immediately, no /auth/me re-fetch.
  setUser: (user: SignupOwnerUserDto) => void;
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
      } catch (error) {
        if (cancelled) return;
        clearStoredToken();
        // Keep the reason the API just gave us. This call runs with
        // notifyOnUnauthorized:false, so it never fires the eviction event and
        // never redirects — RequireAuth does that, and it cannot know why on
        // its own. Parking the code here is what stops a deactivated teacher
        // landing on a bare /login after following an ordinary link.
        //
        // Park only. NOT beginAuthForcedNavigation: nothing is navigating, and
        // raising that flag would silence every unsaved-changes guard in the
        // document. Unrecognised codes and network errors park null, so a
        // visitor who simply has no session is still told nothing.
        parkSessionEndReason(
          reasonFromErrorCode(error instanceof ApiError ? error.code : undefined),
        );
        setState(guestState());
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Mid-session 401 handling. When apiFetch sees a 401 on any authed call it
  // clears the in-memory token and dispatches AUTH_UNAUTHORIZED_EVENT with
  // the API's error code. We listen here, drop to guest, and redirect to a
  // login screen that can SAY WHY and REMEMBER WHERE (F-10) — previously
  // this was a bare router.replace("/login"), which is why an expiry and a
  // deliberate sign-out were indistinguishable.
  useEffect(() => {
    const handler = (event: Event) => {
      clearStoredToken();
      setState(guestState());

      const code = (event as CustomEvent<UnauthorizedEventDetail | undefined>).detail?.code;
      const reason = reasonFromErrorCode(code);
      const current = `${window.location.pathname}${window.location.search}`;
      const target = buildLoginUrl({ reason, next: current });

      // Mark this as an EVICTION before the navigation starts, so the app's
      // beforeunload guards stand down (see session-end-navigation.ts).
      //
      // Without this, `window.location.replace` below fires beforeunload on
      // any dirty page and the browser offers "Leave or Stay" — with the
      // credential already cleared two lines up. "Stay" cancels the
      // navigation and nothing else: the queued guest state still flushes,
      // RequireAuth still unmounts the form, and the user is still ejected,
      // now via a client-side redirect that carries NO reason. Reproduced on
      // the gradebook and the class-subject matrix, 2026-08-28.
      //
      // Standing the guards down does not save the work — nothing here can.
      // It stops the app offering a button that pretends to.
      beginAuthForcedNavigation(reason);

      // FULL-DOCUMENT navigation, for the same reason logout uses one.
      // setState(guestState()) above also makes RequireAuth's guest branch
      // fire, and that branch redirects with reason:null (it cannot know
      // why). With router.replace the two raced and RequireAuth could win —
      // silently discarding the very reason this slice exists to surface.
      // A document replace tears the tree down first, so the reason always
      // survives.
      //
      // It also guarantees no stale authenticated data is left in memory
      // behind the login screen, which router.replace alone does not.
      window.location.replace(target);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  }, []);

  const login = useCallback(
    async (
      input: LoginInput,
    ): Promise<
      { requiresTwoFactor: true; challengeToken: string } | { requiresTwoFactor: false; roles: AuthMeRoleDto[] }
    > => {
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
      return { requiresTwoFactor: false, roles: me.roles };
    },
    [],
  );

  const loginWithChallenge = useCallback(async (input: TotpChallengeInput): Promise<AuthMeRoleDto[]> => {
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
    return me.roles;
  }, []);

  const setSchool = useCallback((school: SchoolMeDto) => {
    setState((prev) => ({ ...prev, school }));
  }, []);

  const setUser = useCallback((user: SignupOwnerUserDto) => {
    setState((prev) => ({ ...prev, user }));
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
    // FULL-DOCUMENT navigation, not router.replace.
    //
    // Two reasons, and the first is a bug this fixes. Setting guest state
    // also makes RequireAuth's guest branch fire, and that branch now
    // appends `?next=<current path>` — so a deliberate sign-out raced with
    // it and could land on /login?next=/dashboard, which is exactly what a
    // sign-out must NOT carry (see session-end.ts: returning you to where
    // you were is a courtesy for an interruption, not for a decision to
    // leave). A document replace tears the React tree down before that
    // effect can run, so the bare /login always wins.
    //
    // Second, it takes the authenticated URL out of the history stack, so
    // Back cannot return to it — the same shared-device reasoning as the
    // guardian portal's SignOutButton, which uses this for both reasons.
    window.location.replace("/login");
  }, []);

  return (
    <AuthContext.Provider
      value={{ ...state, login, loginWithChallenge, signup, logout, setSchool, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
