"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatSickbayDay, formatSickbayTime, MESSAGE_LIMITS, type MessageRecipient, type StaffMessageThreadDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { closeThread, getMessageThread, markThreadHandled, passThread, replyToThread } from "@/lib/messages/messages-api";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8). Reply,
// pass it to another recipient (who then sees all of it), mark that you are
// handling it, or close it. The family sees each reply signed by the writer's
// role, or by the school office; inside the school each shows who wrote it.

const RELATIONSHIP: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  OTHER: "Other",
};

export function ThreadView({ id, backHref }: { id: string; backHref: string }) {
  const [t, setT] = useState<StaffMessageThreadDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [passTo, setPassTo] = useState<MessageRecipient | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMessageThread(id)
      .then(setT)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the conversation."));
  }, [id]);

  async function run(action: () => Promise<StaffMessageThreadDto>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      setT(await action());
      after?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !t) return <InlineAlert>{error}</InlineAlert>;
  if (!t) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-primary hover:underline">
        ← Messages
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words font-serif text-2xl font-semibold">{t.subject}</h1>
          <p className="break-words text-sm text-muted-foreground">To {t.addressedTo.join(", then ")}</p>
        </div>
        <Badge variant={t.status === "OPEN" ? "success" : "muted"}>{t.status === "OPEN" ? "Open" : "Closed"}</Badge>
      </div>

      <section aria-label="The family" className="grid gap-2 rounded-md border bg-card p-4 text-sm sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Parent</p>
          <p className="break-words">
            {t.guardian.name} ({RELATIONSHIP[t.guardian.relationship] ?? t.guardian.relationship}) ·{" "}
            <a href={`tel:${t.guardian.phone}`} className="text-primary hover:underline">
              {t.guardian.phone}
            </a>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">About</p>
          <p className="break-words">{t.child ? `${t.child.name}${t.child.className ? `, ${t.child.className}` : ""}` : "General"}</p>
        </div>
      </section>

      <ul className="flex flex-col gap-3" aria-label="Messages">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className={["flex max-w-[90%] flex-col gap-1 rounded-lg p-3 text-sm", m.writtenBy ? "self-end bg-primary/10" : "self-start border bg-card"].join(" ")}
          >
            <span className="text-xs font-medium text-muted-foreground">
              {m.author}
              {m.writtenBy && !m.author.startsWith(m.writtenBy) ? ` (written by ${m.writtenBy})` : ""} · {formatSickbayDay(m.sentAt)} {formatSickbayTime(m.sentAt)}
            </span>
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        ))}
      </ul>
      {t.passes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t.passes.map((p) => `Passed to ${p.to} by ${p.by} on ${formatSickbayDay(p.at)}.`).join(" ")}
        </p>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}

      {t.status === "OPEN" ? (
        <>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => replyToThread(id, reply.trim()), () => setReply(""));
            }}
          >
            <Label htmlFor="msg-reply">Reply</Label>
            <textarea
              id="msg-reply"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              rows={4}
              maxLength={MESSAGE_LIMITS.body}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={busy || !reply.trim()}>
              Send reply
            </Button>
          </form>
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-muted/50 p-3 text-sm">
            {t.passOptions.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="msg-pass">Pass to</Label>
                  <select id="msg-pass" className="h-9 rounded-md border bg-background px-3 text-sm" value={passTo} onChange={(e) => setPassTo(e.target.value as MessageRecipient)}>
                    <option value="">Choose…</option>
                    {t.passOptions.map((o) => (
                      <option key={o.recipient} value={o.recipient}>
                        {o.label}
                        {o.name ? ` (${o.name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <Button size="sm" variant="outline" disabled={busy || !passTo} onClick={() => void run(() => passThread(id, passTo as MessageRecipient), () => setPassTo(""))}>
                  Pass on
                </Button>
              </div>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => markThreadHandled(id, !t.handledBy))}>
              {t.handledBy ? `Handled by ${t.handledBy}: clear` : "I'm handling this"}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => closeThread(id))}>
              Close conversation
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Only those it is addressed or passed to can see this conversation. It closes by itself after {MESSAGE_LIMITS.closeAfterDays} days without a new message.
          </p>
        </>
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm">Closed{t.closedAt ? ` on ${formatSickbayDay(t.closedAt)}` : ""}. The parent can start a new conversation.</p>
      )}
    </div>
  );
}
