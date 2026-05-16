"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

import { AuthProvider } from "./auth/auth-provider";

export function Providers({ children }: { children: ReactNode }) {
  // useState ensures the QueryClient is stable across re-renders without
  // becoming a module-level singleton that would leak across users in
  // server-rendered or hot-reloaded scenarios.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Slice 5 is read-light — keep retries off so failed /auth/me
            // calls surface immediately rather than waiting for backoff.
            retry: false,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
