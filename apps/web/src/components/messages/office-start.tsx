"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { MESSAGE_LIMITS, type MessageGuardianOptionDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { officeStartThread, searchMessageGuardians } from "@/lib/messages/messages-api";

// Phase 9 / CP8.1 — the school office writes to one parent (docs/modules/
// phase-9.md §17.8 answer 2): admins and Inbox officers only. The family sees
// it from "<School> office". Announcements remain the way to write to many.

export function OfficeStart({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<MessageGuardianOptionDto[] | null>(null);
  const [guardian, setGuardian] = useState<MessageGuardianOptionDto | null>(null);
  const [studentId, setStudentId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setFound(await searchMessageGuardians(q.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not search.");
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!guardian) return;
    setBusy(true);
    setError(null);
    try {
      const t = await officeStartThread({ guardianId: guardian.id, studentId: studentId || null, subject: subject.trim(), body: body.trim() });
      router.push(`${basePath}/${t.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The message was not sent. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link href={basePath} className="text-sm text-primary hover:underline">
        ← Messages
      </Link>
      <h1 className="font-serif text-2xl font-semibold">Write to a parent</h1>
      <p className="text-sm text-muted-foreground">The parent sees this from the school office. To write to many families, send an announcement.</p>
      {!guardian ? (
        <form onSubmit={search} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="msg-search">Parent&apos;s name or phone</Label>
            <Input id="msg-search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={q.trim().length < 2}>
            Find
          </Button>
        </form>
      ) : (
        <p className="text-sm">
          To <span className="font-medium">{guardian.name}</span> ({guardian.phone}){" "}
          <button type="button" className="text-primary hover:underline" onClick={() => setGuardian(null)}>
            Change
          </button>
        </p>
      )}
      {!guardian && found && (
        found.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parent found.</p>
        ) : (
          <ul className="divide-y rounded-md border bg-card text-sm">
            {found.map((g) => (
              <li key={g.id}>
                <button type="button" className="w-full p-3 text-left hover:bg-muted/40" onClick={() => setGuardian(g)}>
                  <span className="font-medium">{g.name}</span> · {g.phone}
                  {g.children.length > 0 && <span className="block text-muted-foreground">{g.children.map((c) => c.name).join(", ")}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {guardian && (
        <form onSubmit={send} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="msg-child">About</Label>
            <select id="msg-child" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">General</option>
              {guardian.children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="msg-subject">Subject</Label>
            <Input id="msg-subject" value={subject} maxLength={MESSAGE_LIMITS.subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="msg-body">Message</Label>
            <textarea id="msg-body" className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={6} maxLength={MESSAGE_LIMITS.body} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={busy || !subject.trim() || !body.trim()}>
            Send
          </Button>
        </form>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </div>
  );
}
