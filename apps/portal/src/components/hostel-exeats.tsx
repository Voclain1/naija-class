"use client";

// Phase 9 / CP6b.3 — the child's leave out (exeats), under the hostel card
// (docs/modules/phase-9.md §15 CP6b-D6). Any linked guardian may ask, naming
// who will collect (owner's answer 5). The status reads in words; a refusal
// shows the school's note; a child out past the time agreed says "Late". The
// parent may cancel until the child has left.

import { useCallback, useEffect, useState } from "react";

import {
  formatSickbayDay,
  formatSickbayTime,
  HOSTEL_EXEAT_STATUS_LABEL,
  sickbayDayOf,
  sickbayMomentFrom,
  type PortalHostelExeatDto,
} from "@school-kit/types";

const INPUT = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const LABEL = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

function moment(at: string | Date): string {
  return `${formatSickbayDay(at)}, ${formatSickbayTime(at)}`;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string" && body.error.message) return body.error.message;
  } catch {
    // fall through
  }
  return fallback;
}

function tint(e: PortalHostelExeatDto): string {
  if (e.late) return "bg-red-50 dark:bg-red-950/40";
  if (e.status === "REFUSED") return "bg-muted";
  if (e.status === "APPROVED" || e.status === "OUT") return "bg-emerald-50 dark:bg-emerald-950/40";
  return "bg-muted/40";
}

export function HostelExeats({ studentId }: { studentId: string }) {
  const [rows, setRows] = useState<PortalHostelExeatDto[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/portal/students/${encodeURIComponent(studentId)}/exeats`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(base);
      setRows(res.ok ? ((await res.json()) as PortalHostelExeatDto[]) : []);
    } catch {
      setRows([]);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    if (!window.confirm("Cancel this leave out?")) return;
    setError(null);
    const res = await fetch(`${base}/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    if (!res.ok) setError(await readError(res, "Could not cancel it."));
    await load();
  }

  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <h3 className="text-sm font-semibold">Leave out</h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {rows && rows.length === 0 && !asking && <p className="text-sm text-muted-foreground">No leave out asked for yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((e) => (
            <li key={e.id} className={`flex flex-col gap-1 rounded-md p-3 text-sm ${tint(e)}`}>
              <p className="font-medium">
                {e.late ? "Late back: " : ""}
                {HOSTEL_EXEAT_STATUS_LABEL[e.status]}
              </p>
              <p>
                Out {moment(e.outAt)} · back by {moment(e.backBy)}
              </p>
              <p className="break-words text-muted-foreground">{e.reason}</p>
              <p className="break-words text-muted-foreground">
                Collected by {e.collectedBy ?? `${e.collector.name} (${e.collector.relationship})`}
              </p>
              {e.decisionNote && <p className="break-words">School&apos;s note: {e.decisionNote}</p>}
              {e.leftAt && (
                <p className="text-xs text-muted-foreground">
                  Left {moment(e.leftAt)}
                  {e.backAt ? ` · back ${moment(e.backAt)}` : ""}
                </p>
              )}
              {e.canCancel && (
                <button type="button" onClick={() => void cancel(e.id)} className="self-start text-sm font-medium text-primary hover:underline">
                  Cancel this leave out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {asking ? (
        <AskForm
          base={base}
          onDone={async (asked) => {
            setAsking(false);
            if (asked) await load();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="self-start rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
        >
          Ask for leave out
        </button>
      )}
    </div>
  );
}

function AskForm({ base, onDone }: { base: string; onDone: (asked: boolean) => void | Promise<void> }) {
  const today = sickbayDayOf(new Date());
  const [outDay, setOutDay] = useState(today);
  const [outTime, setOutTime] = useState("09:00");
  const [backDay, setBackDay] = useState(today);
  const [backTime, setBackTime] = useState("18:00");
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!reason.trim() || !name.trim() || !relationship.trim() || !phone.trim()) {
      return setError("Fill in the reason and who will collect your child, with their phone number.");
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outAt: sickbayMomentFrom(outDay, outTime),
          backBy: sickbayMomentFrom(backDay, backTime),
          reason: reason.trim(),
          collectorName: name.trim(),
          collectorRelationship: relationship.trim(),
          collectorPhone: phone.trim(),
        }),
      });
      if (!res.ok) return setError(await readError(res, "Could not send the request."));
      await onDone(true);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Ask for leave out" className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
      <p className="text-sm">The house master will approve or refuse it, and you will be told.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Out on</span>
          <input type="date" className={INPUT} value={outDay} min={today} onChange={(e) => setOutDay(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Out at</span>
          <input type="time" className={INPUT} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Back on</span>
          <input type="date" className={INPUT} value={backDay} min={today} onChange={(e) => setBackDay(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Back by</span>
          <input type="time" className={INPUT} value={backTime} onChange={(e) => setBackTime(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={LABEL}>Reason</span>
          <input className={INPUT} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Who will collect</span>
          <input className={INPUT} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Their relationship</span>
          <input className={INPUT} value={relationship} maxLength={40} placeholder="Mother, uncle, driver" onChange={(e) => setRelationship(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Their phone</span>
          <input type="tel" className={INPUT} value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? "Sending…" : "Send request"}
        </button>
        <button type="button" onClick={() => void onDone(false)} disabled={busy} className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
