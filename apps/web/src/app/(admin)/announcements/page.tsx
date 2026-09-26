"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  type AnnouncementAudience,
  type AnnouncementDto,
  type ClassArmDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import {
  createAnnouncement,
  listAnnouncements,
  withdrawAnnouncement,
} from "@/lib/announcements/announcements-api";
import { listClassArms } from "@/lib/class-arms/class-arms-api";

// /announcements — the school talking to everyone at once
// (docs/modules/announcements.md).
//
// Compose sits on the same page as the list on purpose: "has this already
// gone out?" is the question people ask just before sending the same thing
// twice, and a separate compose screen hides the answer behind a click.
//
// Sending is owner/admin only. The API enforces that twice (the permission
// grant, and a role re-check in the service). The controls on this page are a
// third, cosmetic layer — they are not the boundary.

const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  EVERYONE: "Everyone — parents, students and staff",
  PARENTS: "Parents only",
  STAFF: "Staff only",
  CLASS: "One class's parents and students",
};

function when(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementDto[]>([]);
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("EVERYONE");
  const [classArmId, setClassArmId] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, classArms] = await Promise.all([listAnnouncements(), listClassArms()]);
      setItems(list.data);
      setArms(classArms);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load announcements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSendError(null);
    setSent(null);

    // An announcement cannot be unsent — withdrawing takes it out of the
    // feeds, but the phones have already buzzed. So the confirmation names
    // WHO it is about to reach rather than asking a generic "are you sure?".
    const who =
      audience === "CLASS"
        ? (arms.find((a) => a.id === classArmId)?.name ?? "that class")
        : AUDIENCE_LABELS[audience];
    const warning = urgent
      ? "\n\nThis is marked urgent: it will wake phones tonight, outside quiet hours."
      : "";
    if (!window.confirm(`Send "${title.trim()}" to ${who}?${warning}\n\nAnnouncements cannot be unsent.`)) return;

    setSending(true);
    try {
      await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        audience,
        ...(audience === "CLASS" ? { classArmId } : {}),
        ...(urgent ? { urgent: true } : {}),
      });
      setTitle("");
      setBody("");
      setUrgent(false);
      setClassArmId("");
      setAudience("EVERYONE");
      setSent("Sent.");
      await load();
    } catch (e) {
      setSendError(e instanceof ApiError ? e.message : "Could not send the announcement.");
    } finally {
      setSending(false);
    }
  }

  async function withdraw(item: AnnouncementDto) {
    const confirmed = window.confirm(
      `Withdraw "${item.title}"?\n\nIt disappears from the parents', students' and staff feeds. Anyone who has already read it has read it.`,
    );
    if (!confirmed) return;
    try {
      await withdrawAnnouncement(item.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw the announcement.");
    }
  }

  const canSend = title.trim() !== "" && body.trim() !== "" && (audience !== "CLASS" || classArmId !== "");

  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Announcements</h1>
        <p className="text-sm text-muted-foreground">
          One message to the whole school, to a class, or to your staff. Parents and students see it in the app and in
          the portal.
        </p>
      </header>

      <section aria-labelledby="compose" className="rounded-lg border bg-card p-4">
        <h2 id="compose" className="mb-3 text-lg font-medium">
          New announcement
        </h2>
        <form className="flex flex-col gap-4" onSubmit={send}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <Input
              value={title}
              maxLength={ANNOUNCEMENT_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Gate closed tomorrow"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Message</span>
            <textarea
              value={body}
              maxLength={ANNOUNCEMENT_BODY_MAX}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              required
              className="rounded-md border border-input bg-background p-3 text-sm"
              placeholder="Write it as you would say it to a parent at the gate."
            />
            <span className="text-xs text-muted-foreground">
              {body.length}/{ANNOUNCEMENT_BODY_MAX}
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Who sees it</span>
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={audience}
                onChange={(e) => setAudience(e.target.value as AnnouncementAudience)}
              >
                {(Object.keys(AUDIENCE_LABELS) as AnnouncementAudience[]).map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_LABELS[a]}
                  </option>
                ))}
              </select>
            </label>

            {audience === "CLASS" && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Class</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={classArmId}
                  onChange={(e) => setClassArmId(e.target.value)}
                  required
                >
                  <option value="">Choose a class…</option>
                  {arms.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
            <span>
              <span className="font-medium">Urgent</span>
              <span className="block text-xs text-muted-foreground">
                Goes out straight away, even at night: quiet hours (9pm–6am) are skipped and phones will buzz. Every
                urgent announcement is recorded against your name.
              </span>
            </span>
          </label>

          {sendError && <InlineAlert>{sendError}</InlineAlert>}
          {sent && <p className="text-sm text-primary">{sent}</p>}

          <div>
            <Button type="submit" disabled={!canSend || sending}>
              {sending ? "Sending…" : "Send announcement"}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="sent-list" className="flex flex-col gap-3">
        <h2 id="sent-list" className="text-lg font-medium">
          Sent
        </h2>
        {error && <InlineAlert>{error}</InlineAlert>}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            Nothing has been announced yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">
                      {item.title}
                      {item.urgent && (
                        <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                          Urgent
                        </span>
                      )}
                      {item.withdrawnAt && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          Withdrawn
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.audience === "CLASS" ? (item.className ?? "One class") : AUDIENCE_LABELS[item.audience]}
                      {" · "}
                      {when(item.createdAt)}
                      {item.createdByName ? ` · ${item.createdByName}` : ""}
                    </p>
                  </div>
                  {!item.withdrawnAt && (
                    <Button size="sm" variant="outline" onClick={() => void withdraw(item)}>
                      Withdraw
                    </Button>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
