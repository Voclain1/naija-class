"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SICKBAY_LIMITS,
  formatSickbayDay,
  formatSickbayTime,
  sickbayDayOf,
  sickbayMomentFrom,
  type SickbayVisitDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { addSickbayMedication, recordSickbayVisit, withdrawSickbayVisit } from "@/lib/health/sickbay-api";

// Phase 9 / CP3.3 — the sickbay log (docs/modules/phase-9.md §10 CP3-D5,
// CP3-D6). Owner, admin and the Health officer. Teachers never see it.
// Times are the school's (Lagos) time, whatever the browser's clock says.

const inputClass = "h-10 rounded-md border border-input bg-background px-3 text-sm";

/** Today and the time now, in the school's time. */
function lagosNow(): { day: string; time: string } {
  const now = new Date();
  return { day: sickbayDayOf(now), time: formatSickbayTime(now) };
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

/** "Parents told: 1 by app, 1 by SMS." in plain words. */
export function describeSickbayNotices(n: SickbayVisitDto["notices"]): string {
  const total = n.push + n.sms + n.none;
  if (total === 0) return "No parent is linked to this child.";
  const told = [n.push ? `${n.push} by the app` : "", n.sms ? `${n.sms} by SMS` : ""].filter(Boolean);
  const parts = [told.length ? `Parents told: ${told.join(", ")}.` : "", n.none ? `${n.none} not reachable.` : ""];
  return parts.filter(Boolean).join(" ");
}

type MedRow = { name: string; dose: string; time: string };

function MedicationFields({
  rows,
  onChange,
}: {
  rows: MedRow[];
  onChange: (rows: MedRow[]) => void;
}) {
  const set = (i: number, patch: Partial<MedRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
          <label className="flex w-full min-w-0 flex-col gap-1 text-sm sm:w-48">
            <span className="font-medium">Medicine</span>
            <input
              value={r.name}
              maxLength={SICKBAY_LIMITS.medicationName}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="For example, Paracetamol"
              className={inputClass}
            />
          </label>
          <label className="flex w-32 flex-col gap-1 text-sm">
            <span className="font-medium">Dose</span>
            <input
              value={r.dose}
              maxLength={SICKBAY_LIMITS.dose}
              onChange={(e) => set(i, { dose: e.target.value })}
              placeholder="500 mg"
              className={inputClass}
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="font-medium">Given at</span>
            <input type="time" value={r.time} onChange={(e) => set(i, { time: e.target.value })} className={inputClass} />
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Record a visit for one child. Parents are told when it is saved. */
export function SickbayVisitForm({
  studentId,
  studentName,
  onSaved,
  onCancel,
}: {
  studentId: string;
  studentName: string;
  onSaved: (visit: SickbayVisitDto) => void;
  onCancel?: () => void;
}) {
  const now = lagosNow();
  const [day, setDay] = useState(now.day);
  const [time, setTime] = useState(now.time);
  const [complaint, setComplaint] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [sentHome, setSentHome] = useState(false);
  const [share, setShare] = useState(false);
  const [meds, setMeds] = useState<MedRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (meds.some((m) => !m.name.trim() || !m.dose.trim() || !m.time)) {
      setError("Give every medicine a name, a dose and a time, or remove it.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await recordSickbayVisit({
          studentId,
          visitedAt: sickbayMomentFrom(day, time),
          complaint: complaint.trim(),
          ...(actionTaken.trim() ? { actionTaken: actionTaken.trim() } : {}),
          sentHome,
          shareWithParent: share,
          medications: meds.map((m) => ({ name: m.name.trim(), dose: m.dose.trim(), givenAt: sickbayMomentFrom(day, m.time) })),
        }),
      );
    } catch (e) {
      setError(message(e, "Could not save the visit."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-4 rounded-lg border bg-card p-4" onSubmit={save} aria-label={`Sickbay visit for ${studentName}`}>
      <p className="text-sm font-medium">Sickbay visit: {studentName}</p>
      <div className="flex flex-wrap gap-3">
        <label className="flex w-40 flex-col gap-1 text-sm">
          <span className="font-medium">Day</span>
          <input type="date" value={day} max={now.day} onChange={(e) => setDay(e.target.value)} className={inputClass} required />
        </label>
        <label className="flex w-28 flex-col gap-1 text-sm">
          <span className="font-medium">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} required />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Complaint</span>
        <textarea
          rows={2}
          value={complaint}
          maxLength={SICKBAY_LIMITS.complaint}
          onChange={(e) => setComplaint(e.target.value)}
          className="rounded-md border border-input bg-background p-3 text-sm"
          required
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Action taken</span>
        <textarea
          rows={2}
          value={actionTaken}
          maxLength={SICKBAY_LIMITS.actionTaken}
          onChange={(e) => setActionTaken(e.target.value)}
          className="rounded-md border border-input bg-background p-3 text-sm"
        />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Medicine given</span>
        {meds.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        <MedicationFields rows={meds} onChange={setMeds} />
        {meds.length < SICKBAY_LIMITS.medicationsPerVisit && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setMeds([...meds, { name: "", dose: "", time }])}>
              Add medicine
            </Button>
          </div>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={sentHome} onChange={(e) => setSentHome(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium">Sent home</span>
          <span className="block text-xs text-muted-foreground">Parents without the app get an SMS saying so.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium">Share details with the parent</span>
          <span className="block text-xs text-muted-foreground">
            Unticked, the parent sees only the time of the visit and whether the child was sent home.
          </span>
        </span>
      </label>
      <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        Saving tells the child&apos;s parents in the app. An SMS goes only when the child is sent home, and it never names
        the complaint or the medicine.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving || complaint.trim() === ""}>
          {saving ? "Saving…" : "Save visit"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** One visit, with "Add medicine" and "Withdraw" while it is live. */
export function SickbayVisitItem({
  visit,
  showStudent,
  onChanged,
}: {
  visit: SickbayVisitDto;
  showStudent: boolean;
  onChanged: (visit: SickbayVisitDto) => void;
}) {
  const withdrawn = visit.withdrawnAt !== null;
  const [adding, setAdding] = useState<MedRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<SickbayVisitDto>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await fn());
      setAdding(null);
    } catch (e) {
      setError(message(e, "That did not work. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const day = sickbayDayOf(visit.visitedAt);

  return (
    <li className={["flex flex-col gap-2 rounded-md border bg-card p-3", withdrawn ? "opacity-60" : ""].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {formatSickbayTime(visit.visitedAt)} · {formatSickbayDay(visit.visitedAt)}
            {showStudent && (
              <>
                {" · "}
                <Link href={`/health/students/${visit.studentId}`} className="text-primary hover:underline">
                  {visit.studentName}
                </Link>
                {visit.className ? ` (${visit.className})` : ""}
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {visit.sentHome && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                Sent home
              </span>
            )}
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {visit.shareWithParent ? "Details shared with the parent" : "Details not shared"}
            </span>
            {withdrawn && <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">Withdrawn</span>}
          </div>
        </div>
        {!withdrawn && (
          <div className="flex flex-wrap gap-2">
            {adding === null && visit.medications.length < SICKBAY_LIMITS.medicationsPerVisit && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setAdding([{ name: "", dose: "", time: lagosNow().time }])}>
                Add medicine
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Withdraw this visit?\n\nIt stays in the log, marked withdrawn, and the parent no longer sees it.")) {
                  void run(() => withdrawSickbayVisit(visit.id));
                }
              }}
            >
              Withdraw visit
            </Button>
          </div>
        )}
      </div>
      <dl className="grid gap-1 text-sm">
        <div>
          <dt className="inline font-medium">Complaint: </dt>
          <dd className="inline whitespace-pre-wrap break-words">{visit.complaint}</dd>
        </div>
        {visit.actionTaken && (
          <div>
            <dt className="inline font-medium">Action: </dt>
            <dd className="inline whitespace-pre-wrap break-words">{visit.actionTaken}</dd>
          </div>
        )}
        {visit.medications.length > 0 && (
          <div>
            <dt className="font-medium">Medicine given</dt>
            <dd>
              <ul className="list-disc pl-5">
                {visit.medications.map((m) => (
                  <li key={m.id} className="break-words">
                    {m.name}, {m.dose}, at {formatSickbayTime(m.givenAt)}
                    {m.givenByName ? ` by ${m.givenByName}` : ""}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">
        {visit.recordedByName ? `Recorded by ${visit.recordedByName}. ` : ""}
        {describeSickbayNotices(visit.notices)}
      </p>
      {adding && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const m = adding[0]!;
            if (!m.name.trim() || !m.dose.trim() || !m.time) {
              setError("Give the medicine a name, a dose and a time.");
              return;
            }
            void run(() =>
              addSickbayMedication(visit.id, { name: m.name.trim(), dose: m.dose.trim(), givenAt: sickbayMomentFrom(day, m.time) }),
            );
          }}
        >
          <MedicationFields rows={adding} onChange={(rows) => setAdding(rows.length ? rows : null)} />
          <div>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save medicine"}
            </Button>
          </div>
        </form>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </li>
  );
}
