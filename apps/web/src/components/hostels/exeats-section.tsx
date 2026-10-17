"use client";

import { useCallback, useEffect, useState } from "react";

import {
  formatSickbayDay,
  formatSickbayTime,
  HOSTEL_EXEAT_STATUS_LABEL,
  sickbayDayOf,
  sickbayMomentFrom,
  type HostelExeatDto,
  type HouseBoardersDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  approveHostelExeat,
  cancelHostelExeat,
  enterHostelExeat,
  hostelExeatBack,
  hostelExeatLeft,
  hostelExeats,
  refuseHostelExeat,
} from "@/lib/hostels/hostels-api";

// Phase 9 / CP6b.3 — leave out (exeats) on the Boarding page
// (docs/modules/phase-9.md §15 CP6b-D6). The house master approves or refuses
// (with a note the parent reads), then logs the child out and back. A child
// out past the time agreed is tinted and says "Late" in words; nothing is sent.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

/** "18 Oct 2026, 09:00", in the school's time. */
export function exeatMoment(at: string | Date): string {
  return `${formatSickbayDay(at)}, ${formatSickbayTime(at)}`;
}

function tint(e: HostelExeatDto): string {
  if (e.late) return "bg-red-50 dark:bg-red-950/40";
  if (e.status === "REQUESTED") return "bg-amber-50 dark:bg-amber-950/40";
  if (e.status === "OUT") return "bg-sky-50 dark:bg-sky-950/40";
  return "";
}

export function ExeatsSection({ hostelId, boarders }: { hostelId: string; boarders: HouseBoardersDto["boarders"] }) {
  const [view, setView] = useState<"open" | "past">("open");
  const [rows, setRows] = useState<HostelExeatDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    hostelExeats(hostelId, view)
      .then(setRows)
      .catch((e: unknown) => setError(message(e)));
  }, [hostelId, view]);

  useEffect(() => load(), [load]);

  const late = rows?.filter((e) => e.late).length ?? 0;
  const waiting = rows?.filter((e) => e.status === "REQUESTED").length ?? 0;

  return (
    <section aria-labelledby="exeats-heading" className="space-y-3 rounded-md border bg-card p-4">
      <div className="space-y-1">
        <h2 id="exeats-heading" className="font-serif text-lg font-medium">
          Leave out
        </h2>
        <p className="text-sm text-muted-foreground">
          Parents ask in their app. Approve or refuse, then mark the child out and back. A child not back on time shows as late; no message is sent.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Which leave outs">
        <Button size="sm" variant={view === "open" ? "default" : "outline"} aria-pressed={view === "open"} onClick={() => setView("open")}>
          Open
        </Button>
        <Button size="sm" variant={view === "past" ? "default" : "outline"} aria-pressed={view === "past"} onClick={() => setView("past")}>
          Past
        </Button>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{view === "open" ? "No leave out waiting, approved or under way." : "No past leave out yet."}</p>
      ) : (
        <>
          {view === "open" && (waiting > 0 || late > 0) && (
            <p className="text-sm">
              {[waiting ? `${waiting} waiting for you` : "", late ? `${late} late back` : ""].filter(Boolean).join("; ")}.
            </p>
          )}
          <ul className="divide-y rounded-md border">
            {rows.map((e) => (
              <ExeatRow key={e.id} exeat={e} onChanged={load} />
            ))}
          </ul>
        </>
      )}
      {view === "open" && boarders.length > 0 && <EnterExeat hostelId={hostelId} boarders={boarders} onEntered={load} />}
    </section>
  );
}

function ExeatRow({ exeat: e, onChanged }: { exeat: HostelExeatDto; onChanged: () => void }) {
  const [refusing, setRefusing] = useState(false);
  const [note, setNote] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [collectedBy, setCollectedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`space-y-2 p-3 text-sm ${tint(e)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="break-words font-medium">{e.studentName}</p>
          <p>
            Out {exeatMoment(e.outAt)} · back by {exeatMoment(e.backBy)}
          </p>
          <p className="break-words text-muted-foreground">{e.reason}</p>
          <p className="break-words text-muted-foreground">
            Collected by {e.collector.name} ({e.collector.relationship}) · {e.collector.phone}
          </p>
          <p className="text-xs text-muted-foreground">{e.requestedBy}</p>
          {e.decisionNote && <p className="break-words text-xs">Note: {e.decisionNote}</p>}
          {e.leftAt && (
            <p className="text-xs">
              Left {exeatMoment(e.leftAt)}
              {e.collectedBy ? ` with ${e.collectedBy}` : ""}
              {e.backAt ? ` · back ${exeatMoment(e.backAt)}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {e.late && <Badge variant="destructive">Late: was due back {exeatMoment(e.backBy)}</Badge>}
          {e.returnedLate && <Badge variant="warning">Came back late</Badge>}
          <Badge variant={e.status === "REQUESTED" ? "warning" : e.status === "APPROVED" || e.status === "BACK" ? "success" : "muted"}>
            {HOSTEL_EXEAT_STATUS_LABEL[e.status]}
          </Badge>
        </div>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        {e.status === "REQUESTED" && (
          <Button size="sm" disabled={busy} onClick={() => void act(() => approveHostelExeat(e.id))} aria-label={`Approve leave out for ${e.studentName}`}>
            Approve
          </Button>
        )}
        {(e.status === "REQUESTED" || e.status === "APPROVED") && !refusing && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRefusing(true)} aria-label={`Refuse leave out for ${e.studentName}`}>
            {e.status === "APPROVED" ? "Withdraw approval" : "Refuse"}
          </Button>
        )}
        {e.status === "APPROVED" && !leaving && (
          <Button size="sm" disabled={busy} onClick={() => setLeaving(true)} aria-label={`${e.studentName} has left`}>
            Has left
          </Button>
        )}
        {e.status === "OUT" && (
          <Button size="sm" disabled={busy} onClick={() => void act(() => hostelExeatBack(e.id))} aria-label={`${e.studentName} is back`}>
            Is back
          </Button>
        )}
        {(e.status === "REQUESTED" || e.status === "APPROVED") && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Cancel ${e.studentName}'s leave out? Do this when the family no longer needs it.`)) void act(() => cancelHostelExeat(e.id));
            }}
          >
            Cancel it
          </Button>
        )}
      </div>
      {refusing && (
        <form
          className="space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!note.trim()) return setError("Say why, so the parent knows.");
            void act(() => refuseHostelExeat(e.id, note.trim()));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`refuse-${e.id}`}>Why not (the parent reads this)</Label>
            <Input id={`refuse-${e.id}`} value={note} maxLength={300} onChange={(ev) => setNote(ev.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="destructive" disabled={busy}>
              {e.status === "APPROVED" ? "Withdraw approval" : "Refuse"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRefusing(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
      {leaving && (
        <form
          className="space-y-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            void act(() => hostelExeatLeft(e.id, collectedBy.trim() || undefined));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`collected-${e.id}`}>Collected by, if not {e.collector.name}</Label>
            <Input id={`collected-${e.id}`} value={collectedBy} maxLength={120} onChange={(ev) => setCollectedBy(ev.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              Mark left now
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLeaving(false)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function EnterExeat({ hostelId, boarders, onEntered }: { hostelId: string; boarders: HouseBoardersDto["boarders"]; onEntered: () => void }) {
  const today = sickbayDayOf(new Date());
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [outDay, setOutDay] = useState(today);
  const [outTime, setOutTime] = useState("09:00");
  const [backDay, setBackDay] = useState(today);
  const [backTime, setBackTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Enter a request taken by phone
      </Button>
    );
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!studentId) return setError("Choose the boarder.");
    if (!reason.trim() || !name.trim() || !relationship.trim() || !phone.trim()) {
      return setError("Fill in the reason and who will collect the child, with their phone number.");
    }
    setSaving(true);
    setError(null);
    try {
      await enterHostelExeat(hostelId, {
        studentId,
        outAt: sickbayMomentFrom(outDay, outTime),
        backBy: sickbayMomentFrom(backDay, backTime),
        reason: reason.trim(),
        collectorName: name.trim(),
        collectorRelationship: relationship.trim(),
        collectorPhone: phone.trim(),
      });
      setOpen(false);
      setReason("");
      setName("");
      setRelationship("");
      setPhone("");
      setStudentId("");
      onEntered();
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form aria-label="Enter a leave out request" onSubmit={save} className="space-y-3 rounded-md bg-muted/30 p-3">
      <h3 className="text-sm font-medium">A request taken by phone</h3>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <Label htmlFor="exeat-boarder">Boarder</Label>
          <select id="exeat-boarder" className={`${SELECT_CLASSES} w-full`} value={studentId} onChange={(ev) => setStudentId(ev.target.value)}>
            <option value="">Choose…</option>
            {boarders.map((b) => (
              <option key={b.studentId} value={b.studentId}>
                {b.studentName} ({b.roomName})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-out-day">Out on</Label>
          <Input id="exeat-out-day" type="date" value={outDay} onChange={(ev) => setOutDay(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-out-time">Out at</Label>
          <Input id="exeat-out-time" type="time" value={outTime} onChange={(ev) => setOutTime(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-back-day">Back by (day)</Label>
          <Input id="exeat-back-day" type="date" value={backDay} onChange={(ev) => setBackDay(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-back-time">Back by (time)</Label>
          <Input id="exeat-back-time" type="time" value={backTime} onChange={(ev) => setBackTime(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <Label htmlFor="exeat-reason">Reason</Label>
          <Input id="exeat-reason" value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-collector">Who will collect</Label>
          <Input id="exeat-collector" value={name} maxLength={80} onChange={(ev) => setName(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-collector-rel">Their relationship</Label>
          <Input id="exeat-collector-rel" value={relationship} maxLength={40} onChange={(ev) => setRelationship(ev.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="exeat-collector-phone">Their phone</Label>
          <Input id="exeat-collector-phone" type="tel" value={phone} maxLength={20} onChange={(ev) => setPhone(ev.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save request"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
