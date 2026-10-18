"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatSickbayDay, formatSickbayTime, type StaffMessageListDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { listMessages } from "@/lib/messages/messages-api";

// Phase 9 / CP8.1 — the conversations addressed or passed to this member of
// staff, and only those (docs/modules/phase-9.md §17.8). Open first; unread
// ones tinted and labelled "New", never a coloured edge.

export function InboxList({ basePath }: { basePath: string }) {
  const { permissions } = useAuth();
  const canStart = hasPermission(permissions, "messages.start");
  const [box, setBox] = useState<"OPEN" | "CLOSED">("OPEN");
  const [data, setData] = useState<StaffMessageListDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    listMessages(box)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load messages."));
  }, [box]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Conversations">
          <Button size="sm" variant={box === "OPEN" ? "default" : "outline"} aria-pressed={box === "OPEN"} onClick={() => setBox("OPEN")}>
            Open{data && box === "OPEN" && data.unread > 0 ? ` (${data.unread} new)` : ""}
          </Button>
          <Button size="sm" variant={box === "CLOSED" ? "default" : "outline"} aria-pressed={box === "CLOSED"} onClick={() => setBox("CLOSED")}>
            Closed
          </Button>
        </div>
        {canStart && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`${basePath}/new`}>Write to a parent</Link>
          </Button>
        )}
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{box === "OPEN" ? "No open conversations." : "No closed conversations."}</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {data.items.map((t) => (
            <li key={t.id} className={t.unread ? "bg-primary/5" : undefined}>
              <Link href={`${basePath}/${t.id}`} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm hover:bg-muted/40">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-medium">{t.subject}</span>
                    {t.unread && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">New</span>}
                  </p>
                  <p className="break-words text-muted-foreground">{t.withLabel}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    To {t.addressedTo.join(", then ")}
                    {t.handledBy ? ` · ${t.handledBy} is handling it` : ""}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{formatSickbayDay(t.lastMessageAt)}</p>
                  <p>{formatSickbayTime(t.lastMessageAt)}</p>
                  <p>{t.lastMessageBy === "GUARDIAN" ? "Parent wrote last" : "School wrote last"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
