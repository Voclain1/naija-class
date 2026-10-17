"use client";

import { useCallback, useEffect, useState } from "react";

import {
  formatSickbayTime,
  HOSTEL_GENDER_LABEL,
  sickbayDayOf,
  sickbayMomentFrom,
  type HostelVisitDto,
  type HouseBoardersDto,
  type HouseHostelDto,
} from "@school-kit/types";

import { ExeatsSection } from "@/components/hostels/exeats-section";
import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { deleteHostelVisit, hostelBoarders, hostelVisits, logHostelVisit, markVisitorLeft, myHostels } from "@/lib/hostels/hostels-api";

// Phase 9 / CP6b.2 — what a house master keeps (docs/modules/phase-9.md §15
// CP6b-D4, D5, D7): the boarders of their hostel this term and its visitor
// log. Owner and admin keep every hostel. The sickbay tells the house master
// only that a boarder was sent home today, never why (owner, §15.8).

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export function BoardingPanel() {
  const [hostels, setHostels] = useState<HouseHostelDto[] | null>(null);
  const [hostelId, setHostelId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    myHostels()
      .then((list) => {
        setHostels(list);
        setHostelId((current) => current || list[0]?.id || "");
      })
      .catch((e: unknown) => setError(message(e)));
  }, []);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!hostels) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (hostels.length === 0) {
    return (
      <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
        You are not house master of any hostel yet. The school&apos;s admin chooses house masters on each hostel&apos;s page.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {hostels.length > 1 && (
        <div className="max-w-sm space-y-1">
          <Label htmlFor="boarding-hostel">Hostel</Label>
          <select id="boarding-hostel" className={`${SELECT_CLASSES} w-full`} value={hostelId} onChange={(e) => setHostelId(e.target.value)}>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({HOSTEL_GENDER_LABEL[h.forGender]})
              </option>
            ))}
          </select>
        </div>
      )}
      {hostelId && <HostelBoarding key={hostelId} hostelId={hostelId} />}
    </div>
  );
}

function HostelBoarding({ hostelId }: { hostelId: string }) {
  const [data, setData] = useState<HouseBoardersDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hostelBoarders(hostelId)
      .then(setData)
      .catch((e: unknown) => setError(message(e)));
  }, [hostelId]);

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const sentHome = data.boarders.filter((b) => b.sentHomeToday).length;

  return (
    <>
      <section aria-labelledby="boarders-heading" className="space-y-3 rounded-md border bg-card p-4">
        <div className="space-y-1">
          <h2 id="boarders-heading" className="font-serif text-lg font-medium">
            {data.hostel.name}: boarders{data.term ? ` · ${data.term.name}` : ""}
          </h2>
          <p className="text-sm text-muted-foreground">
            {!data.term
              ? "No term is set as current, so there are no boarders to show."
              : `${data.boarders.length} ${data.boarders.length === 1 ? "boarder" : "boarders"}${sentHome ? `; ${sentHome} sent home by the sickbay today` : ""}.`}
          </p>
        </div>
        {data.boarders.length > 0 && (
          <ul className="divide-y rounded-md border">
            {data.boarders.map((b) => (
              <li key={b.bedId} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${b.sentHomeToday ? "bg-amber-50 dark:bg-amber-950/40" : ""}`}>
                <div className="min-w-0">
                  <p className="break-words font-medium">{b.studentName}</p>
                  <p className="text-muted-foreground">
                    {b.admissionNumber}
                    {b.classArm ? ` · ${b.classArm}` : ""} · {b.roomName}, bed {b.bedNumber}
                  </p>
                </div>
                {b.sentHomeToday && <Badge variant="warning">Sent home by the sickbay today</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <ExeatsSection hostelId={hostelId} boarders={data.boarders} />
      <VisitorLog hostelId={hostelId} boarders={data.boarders} />
    </>
  );
}

function VisitorLog({ hostelId, boarders }: { hostelId: string; boarders: HouseBoardersDto["boarders"] }) {
  const today = sickbayDayOf(new Date());
  const [day, setDay] = useState(today);
  const [visits, setVisits] = useState<HostelVisitDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setVisits(null);
    hostelVisits(hostelId, day)
      .then(setVisits)
      .catch((e: unknown) => setError(message(e)));
  }, [hostelId, day]);

  useEffect(() => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) load();
  }, [day, load]);

  async function left(v: HostelVisitDto) {
    setError(null);
    try {
      await markVisitorLeft(v.id);
      load();
    } catch (e) {
      setError(message(e));
    }
  }

  async function remove(v: HostelVisitDto) {
    if (!window.confirm(`Remove the visit by ${v.visitorName}? Only do this for an entry made by mistake.`)) return;
    setError(null);
    try {
      await deleteHostelVisit(v.id);
      load();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section aria-labelledby="visitors-heading" className="space-y-3 rounded-md border bg-card p-4">
      <div className="space-y-1">
        <h2 id="visitors-heading" className="font-serif text-lg font-medium">
          Visitor log
        </h2>
        <p className="text-sm text-muted-foreground">Who came to see a boarder, and when they arrived and left. Parents do not see this log.</p>
      </div>
      <div className="max-w-[12rem] space-y-1">
        <Label htmlFor="visitors-day">Day</Label>
        <Input id="visitors-day" type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!visits ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : visits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No visitors logged on this day.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {visits.map((v) => (
            <li key={v.id} className={`space-y-1 p-3 text-sm ${v.leftAt ? "" : "bg-sky-50 dark:bg-sky-950/40"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {v.visitorName} ({v.relationship}) to see {v.studentName}
                  </p>
                  <p className="text-muted-foreground">
                    Arrived {formatSickbayTime(v.arrivedAt)} · {v.leftAt ? `Left ${formatSickbayTime(v.leftAt)}` : "Still here"}
                    {v.phone ? ` · ${v.phone}` : ""}
                    {v.loggedByName ? ` · Logged by ${v.loggedByName}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!v.leftAt && (
                    <Button size="sm" variant="outline" onClick={() => void left(v)} aria-label={`${v.visitorName} has left`}>
                      Has left
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => void remove(v)} aria-label={`Remove the visit by ${v.visitorName}`}>
                    Remove
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {boarders.length > 0 && <LogVisitor hostelId={hostelId} boarders={boarders} day={day} onLogged={load} />}
    </section>
  );
}

function LogVisitor({ hostelId, boarders, day, onLogged }: { hostelId: string; boarders: HouseBoardersDto["boarders"]; day: string; onLogged: () => void }) {
  const [studentId, setStudentId] = useState("");
  const [visitorName, setVisitorName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [time, setTime] = useState(() => formatSickbayTime(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId) return setError("Choose the boarder being visited.");
    if (!visitorName.trim() || !relationship.trim()) return setError("Enter the visitor's name and who they are to the child.");
    if (!/^\d{2}:\d{2}$/.test(time)) return setError("Enter the time they arrived, like 14:30.");
    setSaving(true);
    setError(null);
    try {
      await logHostelVisit(hostelId, {
        studentId,
        visitorName: visitorName.trim(),
        relationship: relationship.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        arrivedAt: sickbayMomentFrom(day, time),
      });
      setVisitorName("");
      setRelationship("");
      setPhone("");
      setStudentId("");
      onLogged();
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label="Log a visitor" onSubmit={save} className="space-y-3 rounded-md bg-muted/30 p-3">
      <h3 className="text-sm font-medium">Log a visitor</h3>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="visit-boarder">Boarder</Label>
          <select id="visit-boarder" className={`${SELECT_CLASSES} w-full`} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">Choose…</option>
            {boarders.map((b) => (
              <option key={b.studentId} value={b.studentId}>
                {b.studentName} ({b.roomName})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="visit-name">Visitor&apos;s name</Label>
          <Input id="visit-name" value={visitorName} maxLength={80} onChange={(e) => setVisitorName(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="visit-relationship">Relationship</Label>
          <Input id="visit-relationship" value={relationship} maxLength={40} placeholder="Mother, uncle, family friend" onChange={(e) => setRelationship(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="visit-phone">Phone (optional)</Label>
          <Input id="visit-phone" type="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="visit-time">Arrived at</Label>
          <Input id="visit-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? "Logging…" : "Log visitor"}
      </Button>
    </form>
  );
}
