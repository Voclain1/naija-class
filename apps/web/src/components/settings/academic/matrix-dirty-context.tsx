"use client";

import { createContext, useContext } from "react";

// Cross-cutting "the class-subject matrix has unsaved changes" signal.
// The matrix page is the provider; AcademicSubNav is the consumer. When
// dirty + the user clicks a sibling tab, the sub-nav shows a confirm
// prompt before letting the route change proceed.
//
// Scope: this only guards in-app navigation within the academic sub-nav.
// Browser-level navigation (close/refresh/URL bar) is handled separately
// by a beforeunload listener inside the matrix page. Sidebar links and
// top-nav are NOT guarded — documented Phase-1 trade-off in
// docs/deferred.md.
//
// Default `isDirty: false` keeps the sub-nav usable on every other page
// without wrapping the entire layout in a provider.
interface MatrixDirtyContextValue {
  isDirty: boolean;
}

const MatrixDirtyContext = createContext<MatrixDirtyContextValue>({
  isDirty: false,
});

export const MatrixDirtyProvider = MatrixDirtyContext.Provider;

export function useMatrixDirty(): boolean {
  return useContext(MatrixDirtyContext).isDirty;
}
