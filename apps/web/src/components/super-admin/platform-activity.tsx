"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { PlatformAdminAuditEntryDto, PlatformAdminAuditLogResponse } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError, proxyFetch } from "@/lib/api-client";

import { describeAuditEntry } from "./audit-entry";

// Platform-admin tools, slice 3 (2026-10-07): the platform's own audit trail —
// who changed what, on which school, when. Owner's decision: platform admins
// only, to start. Used twice: the dashboard's "Platform activity" card (every
// school), and the Manage dialog's "History" (one school, `schoolId`).

interface Props {
  schoolId?: string;
  pageSize?: number;
  /** Offer "Show page views" (the dashboard card does; a school's history does not). */
  allowViews?: boolean;
}

export function PlatformActivity({ schoolId, pageSize = 25, allowViews = false }: Props) {
  const [entries, setEntries] = useState<PlatformAdminAuditEntryDto[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [includeViews, setIncludeViews] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const qs = new URLSearchParams({ limit: String(pageSize) });
      if (schoolId) qs.set("schoolId", schoolId);
      if (includeViews) qs.set("includeViews", "true");
      if (before) qs.set("before", before);
      return proxyFetch<PlatformAdminAuditLogResponse>(`/api/platform-admin/audit-log?${qs.toString()}`);
    },
    [schoolId, includeViews, pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetchPage(null)
      .then((res) => {
        if (cancelled) return;
        setEntries(res.entries);
        setNextBefore(res.nextBefore);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the activity log.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(nextBefore);
      setEntries((current) => [...(current ?? []), ...res.entries]);
      setNextBefore(res.nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {allowViews ? (
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" className="h-4 w-4" checked={includeViews} onChange={(e) => setIncludeViews(e.target.checked)} />
          Show page views too
        </label>
      ) : null}
      {error ? <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {entries === null ? (
        error ? null : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border" aria-label={schoolId ? "School history" : "Platform activity"}>
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 p-3 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <span>{describeAuditEntry(e)}</span>
                {!schoolId && e.schoolName ? <span className="text-muted-foreground"> · {e.schoolName}</span> : null}
                <span className="block text-xs text-muted-foreground">by {e.actorName ?? "an account that no longer exists"}</span>
              </div>
              <time dateTime={e.at} className="shrink-0 text-xs text-muted-foreground">
                {new Date(e.at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ul>
      )}
      {nextBefore ? (
        <div>
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
