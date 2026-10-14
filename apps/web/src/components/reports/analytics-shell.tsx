"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { formatCalendarRange, type CompletenessTermDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

// Shared frame for the analytics tabs (Phase 9 / CP1.2): the term comes from
// the admin topbar's ?termId= (absent, the API uses the current term), and
// each page loads its one report.

export function useTermReport<T>(load: (termId?: string) => Promise<T>, enabled: boolean) {
  const termId = useSearchParams().get("termId") ?? undefined;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load(termId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the report.");
    } finally {
      setLoading(false);
    }
  }, [load, termId]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  return { termId, data, loading, error, reload };
}

export function useAnalyticsAccess() {
  const { permissions } = useAuth();
  return {
    canRead: hasPermission(permissions, "reports.analytics.read"),
    canExport: hasPermission(permissions, "reports.export"),
  };
}

export function AnalyticsPage({
  title,
  description,
  canRead,
  loading,
  error,
  onRetry,
  term,
  actions,
  children,
}: {
  title: string;
  description: string;
  canRead: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  term: CompletenessTermDto | null | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) {
  if (!canRead) {
    return (
      <div className="flex w-full max-w-5xl flex-col gap-4">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{title}</h1>
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          You don&apos;t have access to this report.
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
          {term ? (
            <p className="text-sm text-muted-foreground">
              {term.name} ({term.academicYearLabel}) · {formatCalendarRange(term.startDate, term.endDate)}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>

      {error && <InlineAlert action={{ label: "Try again", onClick: onRetry }}>{error}</InlineAlert>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
        </div>
      ) : error ? null : term === null ? (
        <p className="text-sm text-muted-foreground">Set a current term to see this report.</p>
      ) : (
        children
      )}
    </div>
  );
}

export function ReportSection({
  id,
  title,
  note,
  actions,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  /** Sits on the heading row (an Export menu); wraps under it on a narrow screen. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="min-w-0 font-serif text-xl font-medium text-foreground">
          {title}
        </h2>
        {actions}
      </div>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </section>
  );
}
