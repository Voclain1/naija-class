import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  GuardianLoginInput,
  GuardianLoginSchoolDto,
  GuardianLoginUserDto,
} from "@school-kit/types";

import { guardianLogin } from "../api/portal";
import { onUnauthorized } from "../api/client";
import { clearToken, getCachedToken, saveToken } from "./token-store";
import { wipeOfflineCache } from "../query/persist";

// Guardian session state for apps/mobile.
//
// WHAT IS AND IS NOT PERSISTED
//
//   token     -> expo-secure-store (Keychain/Keystore). Encrypted, OS-managed.
//   guardian  -> memory only.
//   school    -> memory only.
//
// The profile is deliberately NOT persisted. It is small enough to refetch,
// and writing a name and school to plaintext AsyncStorage to save one request
// is a bad trade on a shared family handset. The consequence is that a cold
// start with a valid token knows it is authenticated but not yet *who* — see
// `status: "restoring"` below.

export type SessionStatus = "loading" | "authenticated" | "guest";

interface SessionValue {
  status: SessionStatus;
  guardian: GuardianLoginUserDto | null;
  school: GuardianLoginSchoolDto | null;
  signIn: (input: GuardianLoginInput) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // initTokenStore() has already run by the time this mounts (the root layout
  // holds rendering until it resolves), so the cached token is authoritative
  // here rather than a maybe.
  const [status, setStatus] = useState<SessionStatus>(() =>
    getCachedToken() ? "authenticated" : "guest",
  );
  const [guardian, setGuardian] = useState<GuardianLoginUserDto | null>(null);
  const [school, setSchool] = useState<GuardianLoginSchoolDto | null>(null);

  const signOut = useCallback(async () => {
    setStatus("guest");
    setGuardian(null);
    setSchool(null);
    await clearToken();
    // D12. Clearing the in-memory client alone would leave the persisted copy
    // to rehydrate on next launch — the next child to pick up the phone would
    // see the previous one's results.
    await wipeOfflineCache(queryClient);
  }, [queryClient]);

  const signIn = useCallback(
    async (input: GuardianLoginInput) => {
      const response = await guardianLogin(input);
      // Token first: a render triggered by the state updates below can start
      // a query immediately, and it must not race an unauthenticated request.
      await saveToken(response.token);
      setGuardian(response.guardian);
      setSchool(response.school);
      setStatus("authenticated");
    },
    [],
  );

  useEffect(() => {
    // A 401 on any request means the server has rejected this token —
    // expired, revoked, or the account deactivated. Tear the session down
    // once, centrally, rather than at each call site.
    //
    // This only fires for requests that actually reached the server. A device
    // with no signal produces ApiNetworkError, never a 401, so going offline
    // can never sign a user out — which is the behaviour phase-6.md §7
    // requires ("expiry while offline must not dump the user to login and
    // discard their cached view").
    return onUnauthorized(() => {
      void signOut();
    });
  }, [signOut]);

  const value = useMemo<SessionValue>(
    () => ({ status, guardian, school, signIn, signOut }),
    [status, guardian, school, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return value;
}
