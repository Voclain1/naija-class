"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  BEHAVIOUR_NOTE_MAX,
  type BehaviourKind,
  type BehaviourListResponse,
  type BehaviourRecordDto,
  type BehaviourSettingsDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { createBehaviour, getBehaviourSettings, listBehaviour, withdrawBehaviour } from "@/lib/behaviour/behaviour-api";

// One child's behaviour record (docs/modules/the-school-day.md Part C).
//
// C14: internal. This tab exists only in the ADMIN shell, there is no portal
// equivalent, and no endpoint would serve one. The panel says so out loud,
// because a teacher deciding how frankly to write needs to know who can read
// it — and because a school showing this screen to a parent by accident should
// see the line before the parent does.
//
// C16: commendations first in the form, deliberately. A system that records
// only what a child did wrong is one teachers stop using and parents rightly
// resent; the order of two radio buttons is a quiet argument about what the
// feature is for.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function BehaviourTab({ studentId }: { studentId: string }) {
  const [data, setData] = useState<BehaviourListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<BehaviourKind>("COMMENDATION");
  const [note, setNote] = useState("");
  // Phase 9 / CP2.1: the school's points categories, when points are on.
  // A failure to load them hides the picker rather than blocking a record.
  const [settings, setSettings] = useState<BehaviourSettingsDto | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [occurredOn, setOccurredOn] = useState(isoToday());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await listBehaviour(studentId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this record.");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getBehaviourSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  const offered = settings?.pointsEnabled
    ? settings.categories.filter((c) => c.active && c.kind === kind)
    : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaveError(null);
    setSaving(true);
    try {
      await createBehaviour({
        studentId,
        kind,
        note: note.trim(),
        occurredOn,
        ...(categoryId ? { categoryId } : {}),
      });
      setNote("");
      setCategoryId("");
      await load();
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not save that record.");
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(item: BehaviourRecordDto) {
    const confirmed = window.confirm(
      "Withdraw this record?\n\nIt stays on the record as withdrawn rather than disappearing — that it was written and taken back is part of the history.",
    );
    if (!confirmed) return;
    try {
      await withdrawBehaviour(item.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not withdraw that record.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">Staff only.</strong> Parents and students do not see these
        records. They are for the school&apos;s own use — a conversation at a parent meeting, or context for a report
        card comment a person still writes.
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={save}>
        <h3 className="text-base font-medium">Record something</h3>

        <fieldset className="flex flex-wrap gap-4">
          <legend className="sr-only">What kind of record</legend>
          {(["COMMENDATION", "CONCERN"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => {
                  setKind(option);
                  setCategoryId("");
                }}
              />
              {option === "COMMENDATION" ? "Commendation" : "Concern"}
            </label>
          ))}
        </fieldset>

        {offered.length > 0 && (
          <label className="flex w-full max-w-sm flex-col gap-1 text-sm">
            <span className="font-medium">Category (optional)</span>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">No category</option>
              {offered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({signed(c.points)})
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">What happened</span>
          <textarea
            value={note}
            maxLength={BEHAVIOUR_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            required
            className="rounded-md border border-input bg-background p-3 text-sm"
            placeholder="Write it as you would say it to a colleague."
          />
        </label>

        <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
          {/* Separate from when it was written: a teacher writes up Friday's
              incident on Monday, and a record that quietly claims Monday is one
              nobody can rely on in a meeting. */}
          <span className="font-medium">When it happened</span>
          <input
            type="date"
            value={occurredOn}
            max={isoToday()}
            onChange={(e) => setOccurredOn(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            required
          />
        </label>

        {saveError && <InlineAlert>{saveError}</InlineAlert>}

        <div>
          <Button type="submit" disabled={note.trim() === "" || saving}>
            {saving ? "Saving…" : "Save record"}
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-medium">Record</h3>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.commendations} commendation{data.commendations === 1 ? "" : "s"} · {data.concerns} concern
              {data.concerns === 1 ? "" : "s"}
              {data.termPoints !== null && (
                <>
                  {" · "}
                  <span className="font-medium text-foreground">
                    {data.termPoints === 0 ? "0" : signed(data.termPoints)} point
                    {Math.abs(data.termPoints) === 1 ? "" : "s"} this term
                  </span>
                </>
              )}
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : (data?.data.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            Nothing recorded yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {data!.data.map((item) => {
              const withdrawn = item.withdrawnAt !== null;
              return (
                <li
                  key={item.id}
                  className={[
                    "rounded-lg border p-4",
                    // The kind is a tinted background, never a coloured edge
                    // (CLAUDE.md "Design system", 2026-10-02). A withdrawn
                    // record no longer stands, so it carries no colour.
                    withdrawn ? "bg-card" : item.kind === "CONCERN" ? "bg-destructive/5" : "bg-primary/5",
                    withdrawn ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p
                        className={[
                          "text-sm font-medium",
                          item.kind === "CONCERN" ? "text-destructive" : "text-primary",
                          withdrawn ? "line-through" : "",
                        ].join(" ")}
                      >
                        {item.kind === "CONCERN" ? "Concern" : "Commendation"}
                        {item.categoryName !== null && (
                          <span className="font-normal">
                            {" · "}
                            {item.categoryName}
                            {item.points !== null ? ` (${signed(item.points)})` : ""}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDay(item.occurredOn)} · {item.recordedByName ?? "Staff"}
                        {withdrawn ? " · withdrawn" : ""}
                      </p>
                      {item.incident !== null && (
                        <p className="break-words text-xs text-muted-foreground">Part of an incident: {item.incident.place}</p>
                      )}
                    </div>
                    {!withdrawn && (
                      <Button size="sm" variant="outline" onClick={() => void withdraw(item)}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{item.note}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
