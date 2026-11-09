"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AssistantCapabilitiesDto } from "@school-kit/types";

import { assistantApi } from "@/lib/assistant/api";
import { AssistantStore, type AssistantState } from "@/lib/assistant/store";
import { useAuth } from "@/lib/auth/use-auth";

// Holds the SchoolKit Assistant’s in-memory conversation ABOVE the staff
// shells (docs/modules/assistant-workspace.md), so moving between admin and
// teacher pages keeps it. Binds it to the signed-in account: any change of
// account or school, a sign-out or a forced session end wipes it. Checks the
// 15-minute inactivity limit, and re-reads capabilities (which re-checks the
// person server-side) on focus and while the panel is open.

interface AssistantContextValue {
  store: AssistantStore;
  state: AssistantState;
  caps: AssistantCapabilitiesDto | null;
  refreshCaps: () => Promise<AssistantCapabilitiesDto | null>;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new AssistantStore());
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const { status, user, school } = useAuth();
  const account = status === "authed" && user && school ? `${school.id}:${user.id}` : null;
  const [caps, setCaps] = useState<AssistantCapabilitiesDto | null>(null);

  useEffect(() => {
    store.setAccount(account);
    setCaps(null);
  }, [account, store]);

  const refreshCaps = useCallback(async () => {
    if (!account) return null;
    try {
      const next = await assistantApi.capabilities();
      // A response for an account that is no longer signed in is discarded.
      if (store.snapshot().account !== account) return null;
      setCaps(next);
      if (!next.enabled) store.setOpen(false);
      return next;
    } catch {
      setCaps(null);
      return null;
    }
  }, [account, store]);

  useEffect(() => {
    if (!account) return;
    void refreshCaps();
    const onFocus = () => { store.checkIdle(); void refreshCaps(); };
    window.addEventListener("focus", onFocus);
    const idle = window.setInterval(() => store.checkIdle(), 30_000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(idle); };
  }, [account, refreshCaps, store]);

  useEffect(() => {
    if (!state.open || !account) return;
    const t = window.setInterval(() => void refreshCaps(), 60_000);
    return () => window.clearInterval(t);
  }, [state.open, account, refreshCaps]);

  const value = useMemo(() => ({ store, state, caps, refreshCaps }), [store, state, caps, refreshCaps]);
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant() must be used inside <AssistantProvider>");
  return ctx;
}
