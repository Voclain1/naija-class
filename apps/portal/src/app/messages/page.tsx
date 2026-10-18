"use client";

// Phase 9 / CP8.1 — a parent's own conversations with the school
// (docs/modules/phase-9.md §17.8). Each one is with the person or office the
// parent chose; only they (and anyone it is passed to) see it.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PortalMessageListDto } from "@school-kit/types";

import { Appear, EmptyState, PageHeader, PageSkeleton } from "@school-kit/ui";

import { SchoolBanner } from "@/components/school-banner";
import { SignOutButton } from "@/components/sign-out-button";
import { messageTime, portalJson } from "@/lib/portal-api";

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; data: PortalMessageListDto };

export default function MessagesPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void portalJson<PortalMessageListDto>("/messages", {}, (url) => router.replace(url)).then((r) => {
      if (cancelled || (!r.ok && r.redirected)) return;
      setState(r.ok ? { kind: "loaded", data: r.body } : { kind: "error", message: r.message });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <SchoolBanner />
      <div className="flex flex-col gap-2">
        <Link href="/" className="self-start text-sm text-muted-foreground hover:underline">
          ← Your children
        </Link>
        <PageHeader title="Messages" subtitle="Private conversations with your children's teachers and the school." actions={<SignOutButton />} />
      </div>
      <Link href="/messages/new" className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        Write a message
      </Link>

      {state.kind === "loading" && <PageSkeleton rows={3} />}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && state.data.items.length === 0 && (
        <EmptyState title="No messages yet." body="Write to your child's teacher, the bursar or the school office, and their reply will appear here." />
      )}
      {state.kind === "loaded" && state.data.items.length > 0 && (
        <Appear>
          <ul className="flex flex-col gap-3">
            {state.data.items.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/messages/${t.id}`}
                  // Unread: a tinted background and the word "New", never a coloured edge.
                  className={["flex flex-col gap-1 rounded-lg border p-4 shadow-sm hover:bg-muted/50", t.unread ? "bg-primary/5" : "bg-card"].join(" ")}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words font-medium">{t.subject}</span>
                    {t.unread && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">New reply</span>}
                    {t.status === "CLOSED" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Closed</span>}
                  </span>
                  <span className="break-words text-sm text-muted-foreground">
                    To {t.withLabel}
                    {t.childName ? ` · about ${t.childName}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{messageTime(t.lastMessageAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Appear>
      )}
    </main>
  );
}
