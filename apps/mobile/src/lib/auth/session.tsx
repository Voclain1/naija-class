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
  StudentLoginInput,
  StudentLoginResponse,
  StudentPortalSchoolDto,
  StudentPortalStudentDto,
} from "@school-kit/types";

import { guardianLogin } from "../api/portal";
import { studentLogin, studentLogout } from "../api/student-portal";
import { onUnauthorized } from "../api/client";
import {
  clearToken,
  getCachedPrincipal,
  getCachedToken,
  saveToken,
  type Principal,
} from "./token-store";
import { saveSchoolHint } from "./school-hint-store";
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

// One device, one signed-in account. Deliberately not two concurrent sessions:
// the shared family handset is the normal case (phase-6.md §7), and the rule
// there is that a second person signing in must not see the first one's cached
// data. Two live sessions would make that guarantee depend on every screen
// reading from the right one, instead of on there being only one.
interface SessionValue {
  status: SessionStatus;
  /** Which principal is signed in. `null` exactly when status is not "authenticated". */
  principal: Principal | null;
  guardian: GuardianLoginUserDto | null;
  student: StudentPortalStudentDto | null;
  school: GuardianLoginSchoolDto | StudentPortalSchoolDto | null;
  signIn: (input: GuardianLoginInput) => Promise<void>;
  signInStudent: (input: StudentLoginInput) => Promise<void>;
  /**
   * Adopt a student session the caller already obtained.
   *
   * Exists for invitation accept, which returns the same payload as login —
   * the child has just chosen a password and is, at that instant, signed in.
   * Making them retype the credential they set two seconds ago on the very
   * next screen would be a self-inflicted wound, and re-POSTing it to /login
   * would send the password over the wire a second time for no reason.
   */
  adoptStudentSession: (response: StudentLoginResponse) => Promise<void>;
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
  const [principal, setPrincipal] = useState<Principal | null>(() =>
    getCachedToken() ? getCachedPrincipal() : null,
  );
  const [guardian, setGuardian] = useState<GuardianLoginUserDto | null>(null);
  const [student, setStudent] = useState<StudentPortalStudentDto | null>(null);
  const [school, setSchool] = useState<
    GuardianLoginSchoolDto | StudentPortalSchoolDto | null
  >(null);

  const signOut = useCallback(async () => {
    // Tell the server first, while the token is still usable — clearToken()
    // below would strip the credential the revoke call needs. Only the student
    // surface has a logout endpoint today; the guardian one does not, which is
    // why this is not symmetrical.
    if (getCachedPrincipal() === "student") {
      await studentLogout();
    }
    setStatus("guest");
    setPrincipal(null);
    setGuardian(null);
    setStudent(null);
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
      await saveToken(response.token, "guardian");
      setPrincipal("guardian");
      setGuardian(response.guardian);
      setStudent(null);
      setSchool(response.school);
      setStatus("authenticated");
    },
    [],
  );

  const adoptStudentSession = useCallback(
    async (response: StudentLoginResponse) => {
      // Same ordering rule as the guardian path above.
      await saveToken(response.token, "student");
      // Remember the school code so the next sign-in doesn't ask for one the
      // child was never told. This is the choke point for BOTH student login
      // and invitation-accept, so activation alone is enough to seed it —
      // which matters, because activation is the first time a child ever
      // holds a session and the last moment the code is guaranteed known.
      await saveSchoolHint(response.school.slug);
      setPrincipal("student");
      setStudent(response.student);
      setGuardian(null);
      setSchool(response.school);
      setStatus("authenticated");
    },
    [],
  );

  const signInStudent = useCallback(
    async (input: StudentLoginInput) => {
      await adoptStudentSession(await studentLogin(input));
    },
    [adoptStudentSession],
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
    () => ({
      status,
      principal,
      guardian,
      student,
      school,
      signIn,
      signInStudent,
      adoptStudentSession,
      signOut,
    }),
    [
      status,
      principal,
      guardian,
      student,
      school,
      signIn,
      signInStudent,
      adoptStudentSession,
      signOut,
    ],
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
