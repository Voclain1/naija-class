"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { formatSickbayDay, formatSickbayTime, MESSAGE_LIMITS, type MessageImageDto, type MessageRecipient, type StaffMessageThreadDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  clearThreadFlag,
  closeThread,
  flagThread,
  getMessageThread,
  markThreadHandled,
  passThread,
  replyToThread,
  stageMessageImage,
} from "@/lib/messages/messages-api";

// Phase 9 / CP8.1 — one conversation (docs/modules/phase-9.md §17.8). Reply,
// pass it to another recipient (who then sees all of it), mark that you are
// handling it, or close it. The family sees each reply signed by the writer's
// role, or by the school office; inside the school each shows who wrote it.
//
// CP8.2: up to 3 photos on a reply; "Flag for the owner and admins"; and, for
// the owner and admins, why it was flagged, which messages hold a safeguarding
// word (tinted and labelled, never an edge), and "Clear flag".

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
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [cleared, setCleared] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, MESSAGE_LIMITS.images - photos.length)) {
        if (file.size > MESSAGE_LIMITS.imageBytes) {
          setError(`${file.name} is larger than 5 MB.`);
          continue;
        }
        const staged = await stageMessageImage(file);
        setPhotos((p) => [...p, { id: staged.id, name: file.name }]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The photo could not be added.");
    } finally {
      setUploading(false);
    }
  }

  async function clearFlag() {
    setBusy(true);
    setError(null);
    try {
      await clearThreadFlag(id);
      // The conversation may no longer be ours to see; reload if it still is.
      try {
        setT(await getMessageThread(id));
      } catch {
        setCleared(true);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (cleared) {
    return (
      <div className="space-y-3">
        <p className="rounded-md bg-muted p-3 text-sm">Flag cleared. The conversation is back with the people it was addressed to.</p>
        <Link href={backHref} className="text-sm text-primary hover:underline">
          ← Messages
        </Link>
      </div>
    );
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

      {t.flag && (
        <section aria-label="Flagged" className="space-y-2 rounded-md bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">
            Flagged: {t.flag.label} · {formatSickbayDay(t.flag.at)}
          </p>
          {t.flag.note && <p className="whitespace-pre-wrap break-words">&ldquo;{t.flag.note}&rdquo;</p>}
          <p>The owner and admins can see this conversation until the flag is cleared. It is kept past the two-year deletion while flagged.</p>
          {t.canClearFlag && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearFlag()}>
              Clear flag
            </Button>
          )}
        </section>
      )}

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
        {t.messages.map((m) => {
          const safeguarding = t.safeguardingMessageIds.includes(m.id);
          return (
            <li
              key={m.id}
              className={[
                "flex max-w-[90%] flex-col gap-1 rounded-lg p-3 text-sm",
                m.writtenBy ? "self-end" : "self-start border",
                safeguarding ? "bg-amber-50 dark:bg-amber-950/30" : m.writtenBy ? "bg-primary/10" : "bg-card",
              ].join(" ")}
            >
              {safeguarding && <span className="text-xs font-medium text-amber-900 dark:text-amber-200">Safeguarding word</span>}
              <span className="text-xs font-medium text-muted-foreground">
                {m.author}
                {m.writtenBy && !m.author.startsWith(m.writtenBy) ? ` (written by ${m.writtenBy})` : ""} · {formatSickbayDay(m.sentAt)} {formatSickbayTime(m.sentAt)}
              </span>
              {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
              <MessagePhotos images={m.images} />
            </li>
          );
        })}
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
              void run(
                () => replyToThread(id, reply.trim(), photos.map((p) => p.id)),
                () => {
                  setReply("");
                  setPhotos([]);
                },
              );
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
            <div className="flex flex-wrap items-center gap-2">
              {photos.map((p) => (
                <span key={p.id} className="flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  <span className="truncate">{p.name}</span>
                  <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Remove ${p.name}`} onClick={() => setPhotos((all) => all.filter((x) => x.id !== p.id))}>
                    ×
                  </button>
                </span>
              ))}
              {photos.length < MESSAGE_LIMITS.images && (
                <label className="cursor-pointer text-sm text-primary hover:underline">
                  {uploading ? "Adding photo…" : "Add photo"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <span className="text-xs text-muted-foreground">Up to {MESSAGE_LIMITS.images} photos, 5 MB each.</span>
            </div>
            <Button size="sm" type="submit" disabled={busy || uploading || (!reply.trim() && photos.length === 0)}>
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
            {!t.flag && !flagging && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setFlagging(true)}>
                Flag for the owner and admins
              </Button>
            )}
          </div>
          {flagging && (
            <form
              className="space-y-2 rounded-md bg-muted/50 p-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => flagThread(id, flagNote.trim()),
                  () => {
                    setFlagging(false);
                    setFlagNote("");
                    setNotice("Flagged. The owner and admins have been told and can now read this conversation.");
                  },
                );
              }}
            >
              <Label htmlFor="msg-flag">Why are you flagging it? (optional)</Label>
              <textarea
                id="msg-flag"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                rows={2}
                maxLength={MESSAGE_LIMITS.flagNote}
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">The owner and admins will be able to read the whole conversation. The parent is not told.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" type="submit" disabled={busy}>
                  Flag it
                </Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setFlagging(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {notice && <p className="rounded-md bg-muted p-3 text-sm">{notice}</p>}
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

/** A message's photos, each opening full size in a new tab (a 5-minute link). */
export function MessagePhotos({ images }: { images: MessageImageDto[] }) {
  if (images.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, i) => (
        <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived private link, not a static asset */}
          <img src={img.url} alt={`Photo ${i + 1}`} className="h-28 w-28 rounded-md object-cover" />
        </a>
      ))}
    </div>
  );
}
