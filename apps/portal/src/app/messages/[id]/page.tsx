"use client";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8). The
// school's replies are signed by who answered ("Mrs Okafor, Form teacher") or
// by the office. "Seen" appears once the school has opened the parent's
// latest message. A closed conversation is read-only.
//
// CP8.2: photos, and "Report this conversation", which lets the school's owner
// and admins read it. The parent sees that they reported it, nothing more.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MESSAGE_LIMITS, type PortalMessageThreadDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

import { MessagePhotos, PhotoPicker, type PickedPhoto } from "@/components/message-photos";
import { SchoolBanner } from "@/components/school-banner";
import { messageTime, portalJson } from "@/lib/portal-api";

export default function MessageThreadPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [thread, setThread] = useState<PortalMessageThreadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reportNote, setReportNote] = useState("");

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
    const r = await portalJson<PortalMessageThreadDto>(`/messages/${encodeURIComponent(params.id)}`, {
      method: "POST",
      json: { body: reply.trim(), imageIds: photos.map((p) => p.id) },
    });
    setBusy(false);
    if (r.ok) {
      setThread(r.body);
      setReply("");
      setPhotos([]);
    } else setError(r.message);
  }

  async function report(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const note = reportNote.trim();
    const r = await portalJson<PortalMessageThreadDto>(`/messages/${encodeURIComponent(params.id)}/report`, { method: "POST", json: note ? { note } : {} });
    setBusy(false);
    if (r.ok) {
      setThread(r.body);
      setReporting(false);
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
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              <MessagePhotos images={m.images} />
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
              required={photos.length === 0}
            />
          </label>
          <PhotoPicker photos={photos} onChange={setPhotos} onError={setError} />
          <button type="submit" disabled={busy || (!reply.trim() && photos.length === 0)} className="h-10 self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
            Send
          </button>
        </form>
      )}
      {thread?.reported && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          You reported this conversation. The school&apos;s owner and admins can read it.
        </p>
      )}
      {thread && !thread.reported && !reporting && (
        <button type="button" onClick={() => setReporting(true)} className="self-start text-sm text-muted-foreground underline">
          Report this conversation
        </button>
      )}
      {thread && reporting && (
        <form onSubmit={report} className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/50 p-4 text-sm" aria-label="Report">
          <p>
            If something in this conversation worries you, report it. The school&apos;s owner and admins will be told and can read the whole conversation.
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">What worries you? (optional)</span>
            <textarea
              className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              maxLength={MESSAGE_LIMITS.flagNote}
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Report
            </button>
            <button type="button" onClick={() => setReporting(false)} className="h-10 rounded-md px-4 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
