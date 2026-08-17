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
} as const;
