"use client";

// Phase 9 / CP10.1 — a parent's reply to an event that asks them
// (docs/modules/phase-9.md §19.2). Yes, No or Maybe, and how many are coming
// when the school asks. Changeable until replies close.

import { useState } from "react";

import { RSVP_ANSWER_LABELS, RSVP_ANSWERS, RSVP_MAX_ATTENDING, formatCalendarRange, type FamilyRsvpDto, type RsvpAnswer } from "@school-kit/types";

import { portalJson } from "@/lib/portal-api";

export function RsvpAnswer({ eventId, title, rsvp: initial }: { eventId: string; title: string; rsvp: FamilyRsvpDto }) {
  const [rsvp, setRsvp] = useState(initial);
  const [answer, setAnswer] = useState<RsvpAnswer | null>(initial.answer);
  const [attending, setAttending] = useState(initial.attending ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function send(a: RsvpAnswer) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await portalJson<FamilyRsvpDto>(`/calendar/events/${encodeURIComponent(eventId)}/rsvp`, {
      method: "POST",
      json: { answer: a, attending: rsvp.askCount && a !== "NO" ? attending : null },
    });
    setBusy(false);
    if (r.ok) {
      setRsvp(r.body);
      setAnswer(r.body.answer);
      setSaved(true);
    } else setError(r.message);
  }

  const until = rsvp.deadline ? ` by ${formatCalendarRange(rsvp.deadline, rsvp.deadline)}` : "";
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-sm" aria-label={`Reply to ${title}`}>
      {rsvp.open ? (
        <>
          <span className="font-medium">The school asks you to reply{until}.</span>
          {rsvp.askCount && (
            <label className="flex items-center gap-2">
              How many people will come?
              <select className="h-9 rounded-md border bg-background px-2" value={attending} onChange={(e) => setAttending(Number(e.target.value))}>
                {Array.from({ length: RSVP_MAX_ATTENDING }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Your answer">
            {RSVP_ANSWERS.map((a) => (
              <button
                key={a}
                type="button"
                disabled={busy}
                aria-pressed={answer === a}
                onClick={() => void send(a)}
                className={[
                  "h-9 rounded-md px-4 font-medium disabled:opacity-50",
                  answer === a ? "bg-primary text-primary-foreground" : "border bg-background",
                ].join(" ")}
              >
                {RSVP_ANSWER_LABELS[a]}
              </button>
            ))}
          </div>
          {answer && (
            <span className="text-muted-foreground">
              {saved ? "Saved. " : ""}Your answer: {RSVP_ANSWER_LABELS[answer]}
              {rsvp.attending ? `, ${rsvp.attending} coming` : ""}. You can change it until replies close.
            </span>
          )}
        </>
      ) : (
        <span>
          Replies have closed.{" "}
          {answer ? `Your answer: ${RSVP_ANSWER_LABELS[answer]}${rsvp.attending ? `, ${rsvp.attending} coming` : ""}.` : "You did not reply."}
        </span>
      )}
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
