"use client";

// Phase 9 / CP8.1 — writing to the school (docs/modules/phase-9.md §17.8).
// The parent chooses the child (or "general") and then whom to write to: the
// child's form or class teacher, the bursar, the principal or head teacher,
// the school admin, or the school office. Only that person or office sees it.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { MESSAGE_LIMITS, type MessageRecipient, type MessageRecipientOptionDto, type PortalMessageThreadDto, type PortalStudentDto } from "@school-kit/types";

import { PageHeader } from "@school-kit/ui";

import { PhotoPicker, type PickedPhoto } from "@/components/message-photos";
import { SchoolBanner } from "@/components/school-banner";
import { portalJson } from "@/lib/portal-api";

const FIELD = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm";

export default function NewMessagePage() {
  const router = useRouter();
  const [children, setChildren] = useState<PortalStudentDto[] | null>(null);
  const [studentId, setStudentId] = useState<string>("");
  const [options, setOptions] = useState<MessageRecipientOptionDto[] | null>(null);
  const [recipient, setRecipient] = useState<MessageRecipient | "">("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void portalJson<{ data: PortalStudentDto[] }>("/students", {}, (url) => router.replace(url)).then((r) => {
      if (r.ok) {
        setChildren(r.body.data);
        if (r.body.data.length === 1) setStudentId(r.body.data[0]!.id);
      } else if (!r.redirected) setError(r.message);
    });
  }, [router]);

  useEffect(() => {
    setOptions(null);
    setRecipient("");
    if (children === null) return;
    const qs = studentId && studentId !== "general" ? `?studentId=${encodeURIComponent(studentId)}` : "";
    if (!studentId) return;
    void portalJson<MessageRecipientOptionDto[]>(`/messages/recipients${qs}`).then((r) => {
      if (r.ok) setOptions(r.body);
      else setError(r.message);
    });
  }, [studentId, children]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!recipient) return;
    setBusy(true);
    setError(null);
    const r = await portalJson<PortalMessageThreadDto>("/messages", {
      method: "POST",
      json: { studentId: studentId && studentId !== "general" ? studentId : null, recipient, subject: subject.trim(), body: body.trim(), imageIds: photos.map((p) => p.id) },
    });
    setBusy(false);
    if (r.ok) router.push(`/messages/${r.body.id}`);
    else setError(r.message);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <SchoolBanner />
      <div className="flex flex-col gap-2">
        <Link href="/messages" className="self-start text-sm text-muted-foreground hover:underline">
          ← Messages
        </Link>
        <PageHeader title="Write a message" subtitle="Only the person or office you choose will see it." />
      </div>
      <form onSubmit={send} className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5" aria-label="New message">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">About</span>
          <select className={FIELD} value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={children === null}>
            <option value="">Choose…</option>
            {(children ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
            <option value="general">General, not about one child</option>
          </select>
        </label>
        {studentId && (
          <fieldset className="flex min-w-0 flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">To</legend>
            {options === null && <p className="text-muted-foreground">Loading…</p>}
            {options?.map((o) => (
              <label key={o.recipient} className="flex items-start gap-2">
                <input type="radio" name="recipient" className="mt-1" checked={recipient === o.recipient} onChange={() => setRecipient(o.recipient)} />
                <span className="min-w-0 break-words">
                  {o.label}
                  {o.name ? <span className="text-muted-foreground"> ({o.name})</span> : null}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Subject</span>
          <input className={FIELD} value={subject} maxLength={MESSAGE_LIMITS.subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Message</span>
          <textarea className={FIELD} rows={6} value={body} maxLength={MESSAGE_LIMITS.body} onChange={(e) => setBody(e.target.value)} required={photos.length === 0} />
        </label>
        <PhotoPicker photos={photos} onChange={setPhotos} onError={setError} />
        <p className="text-xs text-muted-foreground">
          Conversations close after {MESSAGE_LIMITS.closeAfterDays} days without a new message, and the school keeps them for two years after that.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !recipient || !subject.trim() || (!body.trim() && photos.length === 0)}
          className="h-10 self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </main>
  );
}
