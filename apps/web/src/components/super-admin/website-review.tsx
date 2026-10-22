"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PlatformWebsiteReportQueueDto, PlatformWebsiteReviewDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import {
  dismissWebsiteReport,
  getPlatformWebsiteReview,
  getWebsiteReportQueue,
  takeDownWebsiteItem,
} from "@/lib/school-website/school-website-api";

// SchoolKit's side of school websites (docs/modules/school-website.md W4):
// reports from the public pages, and the take-down. A take-down hides the
// photo or post at once, answers every report about it, and the school sees
// the reason; it cannot put it back up. Each review and take-down is audited.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

/** The queue: schools with reports SchoolKit has not answered. Empty most days. */
export function WebsiteReportsCard() {
  const [queue, setQueue] = useState<PlatformWebsiteReportQueueDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    getWebsiteReportQueue()
      .then(setQueue)
      .catch(() => setQueue({ schools: [] }));
  }, []);
  useEffect(load, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>School website reports</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {queue === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : queue.schools.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports waiting.</p>
        ) : (
          queue.schools.map((s) => (
            <div key={s.schoolId} className="flex flex-col gap-2 rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">{s.slug}</span>
                <Badge variant="warning">
                  {s.openReports} report{s.openReports === 1 ? "" : "s"}
                </Badge>
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(open === s.schoolId ? null : s.schoolId)}>
                  {open === s.schoolId ? "Close" : "Review"}
                </Button>
              </div>
              {open === s.schoolId && <WebsiteReviewPanel schoolId={s.schoolId} onChanged={load} />}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** One school's website: open reports, every photo and post, take-down. */
export function WebsiteReviewPanel({ schoolId, onChanged }: { schoolId: string; onChanged?: () => void }) {
  const [review, setReview] = useState<PlatformWebsiteReviewDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getPlatformWebsiteReview(schoolId)
      .then(setReview)
      .catch((e: unknown) => toast.error(message(e)));
  }, [schoolId]);
  useEffect(load, [load]);

  async function takeDown(target: { photoId: string } | { postId: string }) {
    const reason = window.prompt("Reason the school will see (for example: Pupils are visible).");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      await takeDownWebsiteItem(schoolId, { ...target, reason: reason.trim() });
      toast.success("Taken down.");
      load();
      onChanged?.();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(reportId: string) {
    setBusy(true);
    try {
      await dismissWebsiteReport(schoolId, reportId);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (!review) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const reported = new Set(review.reports.flatMap((r) => [r.photoId, r.postId]).filter(Boolean));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Open reports ({review.reports.length})</h4>
        {review.reports.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {review.reports.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md bg-card p-2 text-sm">
            <span>{r.photoId ? "Photo" : "Post"}:</span>
            <span className="italic">“{r.reason}”</span>
            <span className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("en-GB")}</span>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss(r.id)}>
              Dismiss
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">Photos ({review.photos.length})</h4>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {review.photos.map((p) => (
            <li key={p.id} className={`flex flex-col gap-1 rounded-md p-2 ${reported.has(p.id) ? "bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
              <img src={p.thumbUrl} alt={p.caption ?? ""} className={`aspect-[4/3] w-full rounded object-cover ${p.takenDown ? "opacity-40" : ""}`} />
              <span className="text-xs text-muted-foreground">
                {p.kind.toLowerCase()}
                {reported.has(p.id) ? " · reported" : ""}
              </span>
              {p.takenDown ? (
                <Badge variant="muted">Taken down</Badge>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void takeDown({ photoId: p.id })}>
                  Take down
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-medium">News posts ({review.posts.length})</h4>
        {review.posts.map((p) => (
          <div key={p.id} className={`flex flex-col gap-1 rounded-md p-2 text-sm ${reported.has(p.id) ? "bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.title}</span>
              <Badge variant={p.takenDown ? "muted" : p.status === "PUBLISHED" ? "success" : "outline"}>
                {p.takenDown ? "Taken down" : p.status === "PUBLISHED" ? "Published" : "Draft"}
              </Badge>
              {reported.has(p.id) && <Badge variant="warning">Reported</Badge>}
              {!p.takenDown && (
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void takeDown({ postId: p.id })}>
                  Take down
                </Button>
              )}
            </div>
            <p className="line-clamp-3 whitespace-pre-line text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
