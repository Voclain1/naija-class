"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { AnnouncementFeedItemDto } from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api-client";
import { getStaffAnnouncementFeed, markStaffAnnouncementRead } from "@/lib/announcements/announcements-api";

// School news (2026-10-19, the role audit): the announcements addressed to
// staff, for reading. Every staff role holds announcement.read, but the web
// app only had the sending desk (announcement.create, owner and admin), so a
// bursar, a teacher or a librarian could read the school's news only in the
// phone app. Shared by /news (admin shell) and /teacher/news.
//
// Unread items are tinted and labelled "New" in words (no accent borders,
// CLAUDE.md); opening the page marks what it shows as read.
export function StaffNews() {
  const [items, setItems] = useState<AnnouncementFeedItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const feed = await getStaffAnnouncementFeed();
      setItems(feed.data);
      for (const item of feed.data) {
        if (!item.readAt) void markStaffAnnouncementRead(item.id).catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the school's news.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="School news" subtitle="Announcements from the school's office, newest first." />
      {error && (
        <InlineAlert title="Could not load the news" action={{ label: "Retry", onClick: () => void load() }}>
          {error}
        </InlineAlert>
      )}
      {!items && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      )}
      {items && items.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No announcements yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={item.readAt ? "rounded-md border bg-card p-4" : "rounded-md border bg-primary/5 p-4"}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-medium">{item.title}</h2>
                {!item.readAt && <Badge>New</Badge>}
                {item.urgent && <Badge variant="destructive">Urgent</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">{item.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
