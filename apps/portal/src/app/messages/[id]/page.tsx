"use client";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8). The
// school's replies are signed by who answered ("Mrs Okafor, Form teacher") or
// by the office. "Seen" appears once the school has opened the parent's
// latest message. A closed conversation is read-only.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MESSAGE_LIMITS, type PortalMessageThreadDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

import { SchoolBanner } from "@/components/school-banner";
import { messageTime, portalJson } from "@/lib/portal-api";

export default function MessageThreadPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [thread, setThread] = useState<PortalMessageThreadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void portalJson<PortalMessageThreadDto>(`/messages/${encodeURIComponent(params.id)}`, {}, (url) => router.replace(url)).then((r) => {
      if (r.ok) setThread(r.body);
      else if (!r.redirected) setError(r.message);
    });
  }, [params.id, router]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await portalJson<PortalMessageThreadDto>(`/messages/${encodeURIComponent(params.id)}`, { method: "POST", json: { body: reply.trim() } });
    setBusy(false);
    if (r.ok) {
      setThread(r.body);
      setReply("");
    } else setError(r.message);
  }

  const lastMine = thread ? [...thread.messages].reverse().find((m) => m.mine) : undefined;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <SchoolBanner />
      <div className="flex flex-col gap-2">
        <Link href="/messages" className="self-start text-sm text-muted-foreground hover:underline">
          ← Messages
        </Link>
        <PageHeader title={thread?.subject ?? "Message"} subtitle={thread ? `With ${thread.withLabel}${thread.childName ? ` · about ${thread.childName}` : ""}` : undefined} />
      </div>
      {!thread && !error && <PageSkeleton rows={3} />}
      {thread && (
        <ul className="flex flex-col gap-3" aria-label="Messages">
          {thread.messages.map((m) => (
            <li key={m.id} className={["flex max-w-[90%] flex-col gap-1 rounded-lg p-3 text-sm", m.mine ? "self-end bg-primary/10" : "self-start border bg-card"].join(" ")}>
              <span className="text-xs font-medium text-muted-foreground">
                {m.author} · {messageTime(m.sentAt)}
              </span>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              {m.id === lastMine?.id && thread.seen && <span className="self-end text-xs text-muted-foreground">Seen</span>}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {thread?.status === "CLOSED" && (
        <p className="rounded-md bg-muted p-3 text-sm">
          This conversation is closed.{" "}
          <Link href="/messages/new" className="font-medium text-primary hover:underline">
            Write a new message
          </Link>
        </p>
      )}
      {thread?.status === "OPEN" && (
        <form onSubmit={send} className="flex min-w-0 flex-col gap-2" aria-label="Reply">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Reply</span>
            <textarea
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={4}
              value={reply}
              maxLength={MESSAGE_LIMITS.body}
              onChange={(e) => setReply(e.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy || !reply.trim()} className="h-10 self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Send
          </button>
        </form>
      )}
    </main>
  );
}
