// Query keys, in one place.
//
// Centralised because the offline persister's `shouldDehydrateQuery` filter
// (src/lib/query/persist.ts) inspects the SERIALISED key to decide what is
// allowed onto disk — anything mentioning auth/session/token is excluded.
// Keys invented ad hoc at call sites would make that filter's behaviour
// impossible to reason about; here it can be read at a glance.
//
// Note there is deliberately NO key for the guardian session itself. The
// session lives in React state plus expo-secure-store, never in the query
// cache, so it cannot be persisted to plaintext AsyncStorage even by accident
// (phase-6.md D12).

export const queryKeys = {
  students: ["students"] as const,
  student: (studentId: string) => ["students", studentId] as const,
  invoices: (studentId: string) => ["students", studentId, "invoices"] as const,
  payment: (reference: string) => ["payments", reference] as const,
  // Released results. Safe to persist and DELIBERATELY long-lived: a released
  // report card is frozen by released-guard.ts on the server, so a cached one
  // cannot be wrong, only absent (D32).
  results: (studentId: string) => ["students", studentId, "results"] as const,
  result: (studentId: string, termId: string) =>
    ["students", studentId, "results", termId] as const,

  // The student principal's own data. Keyed under "me" rather than under the
  // student's id on purpose: the id never appears in a student-surface URL or
  // request (phase-6.md §8), so introducing one here just to build a cache key
  // would reintroduce the identifier the API deliberately refuses to take.
  //
  // These cannot collide with the guardian keys above even on a shared
  // handset, and the cache is wiped on every sign-out regardless (D12).
  // A guardian's view of one child's portal access state.
  portalStatus: (studentId: string) =>
    ["students", studentId, "portal-status"] as const,

  me: ["me"] as const,
  myResults: ["me", "results"] as const,
  myResult: (termId: string) => ["me", "results", termId] as const,
} as const;
