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

import { callSchoolHref, type AnnouncementFeedItemDto, type AnnouncementFeedResponse, type SchoolContactResponse } from "@school-kit/types";

import { Appear, EmptyState, PageHeader, PageSkeleton } from "@school-kit/ui";

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
  // Fetched separately and silent on failure: the messages are what this page
  // is for, and a missing number means no button rather than an error.
  const [callHref, setCallHref] = useState<string | null>(null);
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

    async function loadSchool() {
      try {
        const res = await fetch("/api/portal/school");
        if (!res.ok) return;
        const body = (await res.json()) as SchoolContactResponse;
        if (!cancelled) setCallHref(callSchoolHref(body.phone));
      } catch {
        // Silent by design — see the note on callHref above.
      }
    }

    void load();
    void loadSchool();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <Link href="/" className="self-start text-sm text-muted-foreground hover:underline">
          ← Your children
        </Link>
        <PageHeader
          title="From the school"
          subtitle="Announcements sent to you and to your children's classes."
          actions={<SignOutButton />}
        />
      </div>

      {state.kind === "loading" && <PageSkeleton rows={3} />}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && state.items.length === 0 && (
        <EmptyState
          title="The school hasn't sent anything yet."
          body="Messages from the school to you or your children's classes will appear here."
        />
      )}

      {state.kind === "loaded" && state.items.length > 0 && (
        <Appear>
          <ul className="flex flex-col gap-3">
            {state.items.map((item) => (
              <li
                key={item.id}
                // Unread is a tinted background plus the "New" badge — never a
                // coloured edge; the project does not use accent borders
                // (2026-10-02, CLAUDE.md "Design system").
                className={[
                  "flex flex-col gap-1 rounded-lg border p-4 shadow-sm",
                  item.readAt === null ? "bg-primary/5" : "bg-card",
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
        </Appear>
      )}
      {/* D12 — the reply path, and the only one (D11 refuses general
          messaging). A parent who has just read something about their child
          rings the school; this saves them looking up the number. Hidden
          entirely when the school has set none — a dead button would tell them
          the feature exists and has been taken away. */}
      {callHref ? (
        <a
          href={callHref}
          className="self-start rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Call the school
        </a>
      ) : null}
    </main>
  );
}
