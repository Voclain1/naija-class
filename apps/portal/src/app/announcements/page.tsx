"use client";

// Announcements for parents (docs/modules/announcements.md) — the school's
// messages, in the portal as well as the app.
//
// Reading is what marks one read: there is no "mark as read" button, because
// a parent who has opened the page HAS read it, and a button only gives them
// a second thing to forget. Each unread item is marked as read once it has
// been on screen; the request is fire-and-forget (a failed mark leaves it
// unread, which is the safe direction).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AnnouncementFeedItemDto, AnnouncementFeedResponse } from "@school-kit/types";

import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; items: AnnouncementFeedItemDto[] };

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AnnouncementsPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Marks already attempted this visit, so a re-render does not re-post them.
  const marked = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/portal/announcements");
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 401) {
          router.replace(
            buildLoginUrl({
              reason: reasonFromErrorCode(errorCodeFromBody(body)),
              next: `${window.location.pathname}${window.location.search}`,
            }),
          );
          return;
        }
        if (!res.ok) {
          const message =
            body !== null && typeof body === "object" && "error" in body
              ? ((body as { error?: { message?: string } }).error?.message ?? "Something went wrong. Try again.")
              : "Could not reach the server. Try again in a moment.";
          if (!cancelled) setState({ kind: "error", message });
          return;
        }
        const items = (body as AnnouncementFeedResponse).data;
        if (cancelled) return;
        setState({ kind: "loaded", items });

        for (const item of items) {
          if (item.readAt !== null || marked.current.has(item.id)) continue;
          marked.current.add(item.id);
          void fetch(`/api/portal/announcements/${encodeURIComponent(item.id)}/read`, { method: "POST" }).catch(
            () => undefined,
          );
        }
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← Your children
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">From the school</h1>
          <p className="text-sm text-muted-foreground">Announcements sent to you and to your children&apos;s classes.</p>
        </div>
        <SignOutButton />
      </header>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && state.items.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          The school hasn&apos;t sent anything yet.
        </div>
      )}

      {state.kind === "loaded" && state.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.items.map((item) => (
            <li
              key={item.id}
              className={[
                "flex flex-col gap-1 rounded-lg border bg-card p-4 shadow-sm",
                // The unread mark is a left edge rather than a dot: it survives
                // a small screen and does not compete with the urgent badge.
                item.readAt === null ? "border-l-4 border-l-primary" : "",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.title}</span>
                {item.urgent && (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    Urgent
                  </span>
                )}
                {item.readAt === null && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">New</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{when(item.createdAt)}</span>
              <p className="whitespace-pre-wrap text-sm">{item.body}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
