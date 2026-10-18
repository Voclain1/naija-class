"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ADMISSION_ASSESSMENT_LABEL,
  admissionAssessmentKindValues,
  formatSickbayDay,
  formatSickbayTime,
  sickbayDayOf,
  type AdmissionAssessmentKind,
  type AdmissionDetailDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import {
  admitApplication,
  bookAdmissionAssessment,
  offerAdmission,
  recordAdmissionAcceptance,
  rejectAdmission,
  reviewAdmission,
  withdrawAdmission,
} from "@/lib/admissions/admissions-api";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { listClassLevels } from "@/lib/class-levels/class-levels-api";

// Phase 9 / CP7.2 — moving an application to a decision (docs/modules/
// phase-9.md §16.8): review, the assessment, an offer with its letter, not
// successful, withdrawn, the family's acceptance, and Admit. Each step the
// family should hear about is emailed by the API. Admit, which creates the
// student, shows only to those who hold admission.admit (owner, admin).

type Panel = "assessment" | "offer" | "reject" | "accept" | "withdraw" | null;

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const TEXTAREA = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function AdmissionActions({ a, onChanged }: { a: AdmissionDetailDto; onChanged: () => Promise<void> }) {
  const { permissions } = useAuth();
  const canAdmit = hasPermission(permissions, "admission.admit");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = a.decision;
  const deciding = a.status === "SUBMITTED" || a.status === "UNDER_REVIEW";
  const open = deciding || a.status === "OFFERED" || a.status === "OFFER_ACCEPTED";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPanel(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="adm-decision" className="space-y-3 rounded-md border bg-card p-4 text-sm">
      <h2 id="adm-decision" className="font-medium">
        Decision
      </h2>

      {d.assessment && (
        <p>
          <span className="font-medium">{d.assessment.label}:</span> {formatSickbayDay(`${d.assessment.day}T12:00:00Z`)} at {d.assessment.time}
          {d.assessment.note ? ` · ${d.assessment.note}` : ""}
        </p>
      )}
      {d.offerLetter && (
        <div className="space-y-1">
          <p className="font-medium">
            Offer letter{d.offeredAt ? `, sent ${formatSickbayDay(d.offeredAt)}` : ""}
          </p>
          <div className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3">{d.offerLetter}</div>
        </div>
      )}
      {d.acceptedAt && (
        <p className="rounded-md bg-emerald-50 p-2 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Offer accepted on {formatSickbayDay(d.acceptedAt)} at {formatSickbayTime(d.acceptedAt)}, recorded by {d.acceptedBy}.
        </p>
      )}
      {a.status === "REJECTED" && <p>Not successful.{d.decisionNote ? ` Note sent to the family: ${d.decisionNote}` : " No reason was sent."}</p>}
      {a.status === "WITHDRAWN" && <p>Withdrawn. The application is deleted 90 days after it closed.</p>}
      {a.status === "ADMITTED" && d.student && (
        <p className="rounded-md bg-emerald-50 p-2 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Admitted{d.admittedAt ? ` on ${formatSickbayDay(d.admittedAt)}` : ""} as {d.student.name}, admission number {d.student.admissionNumber}.{" "}
          {canAdmit && (
            <Link href={`/students/${d.student.id}`} className="font-medium underline">
              Open the student
            </Link>
          )}
        </p>
      )}

      {error && <InlineAlert>{error}</InlineAlert>}

      {open && panel === null && (
        <div className="flex flex-wrap gap-2">
          {a.status === "SUBMITTED" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(() => reviewAdmission(a.id))}>
              Start review
            </Button>
          )}
          {deciding && (
            <Button size="sm" variant="outline" onClick={() => setPanel("assessment")}>
              {d.assessment ? "Change the assessment" : "Book an assessment"}
            </Button>
          )}
          {deciding && <Button size="sm" onClick={() => setPanel("offer")}>Offer a place</Button>}
          {a.status === "OFFERED" && <Button size="sm" onClick={() => setPanel("accept")}>Record the family&apos;s acceptance</Button>}
          <Button size="sm" variant="outline" onClick={() => setPanel("reject")}>
            Not successful
          </Button>
          <Button size="sm" variant="outline" onClick={() => setPanel("withdraw")}>
            Withdraw
          </Button>
        </div>
      )}

      {panel === "assessment" && <AssessmentForm a={a} busy={busy} onCancel={() => setPanel(null)} onSave={(input) => void run(() => bookAdmissionAssessment(a.id, input))} />}
      {panel === "offer" && (
        <OfferForm defaultLetter={d.defaultOfferLetter ?? ""} busy={busy} onCancel={() => setPanel(null)} onSave={(letter) => void run(() => offerAdmission(a.id, letter))} />
      )}
      {panel === "reject" && <RejectForm busy={busy} onCancel={() => setPanel(null)} onSave={(note) => void run(() => rejectAdmission(a.id, note))} />}
      {panel === "accept" && <AcceptForm busy={busy} onCancel={() => setPanel(null)} onSave={() => void run(() => recordAdmissionAcceptance(a.id))} />}
      {panel === "withdraw" && (
        <div className="space-y-2 rounded-md bg-muted/50 p-3">
          <p>Withdraw this application because the family asked? They are emailed, and it is deleted 90 days later.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void run(() => withdrawAdmission(a.id))}>
              Withdraw the application
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPanel(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {a.status === "OFFER_ACCEPTED" && panel === null && (canAdmit ? <AdmitForm a={a} onDone={onChanged} /> : <p className="text-muted-foreground">An admin admits the child into a class.</p>)}
      {open && <p className="text-xs text-muted-foreground">The family is emailed when an assessment is booked or changed, when they are offered a place, when it is not successful, and when the application is withdrawn.</p>}
    </section>
  );
}

function AssessmentForm({
  a,
  busy,
  onCancel,
  onSave,
}: {
  a: AdmissionDetailDto;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { kind: AdmissionAssessmentKind; day: string; time: string; note?: string }) => void;
}) {
  const current = a.decision.assessment;
  const [kind, setKind] = useState<AdmissionAssessmentKind>(current?.kind ?? "ENTRANCE_EXAM");
  const [day, setDay] = useState(current?.day ?? "");
  const [time, setTime] = useState(current?.time ?? "09:00");
  const [note, setNote] = useState(current?.note ?? "");
  return (
    <form
      className="space-y-3 rounded-md bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ kind, day, time, ...(note.trim() ? { note: note.trim() } : {}) });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="adm-kind">Kind</Label>
          <select id="adm-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as AdmissionAssessmentKind)}>
            {admissionAssessmentKindValues.map((k) => (
              <option key={k} value={k}>
                {ADMISSION_ASSESSMENT_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="adm-day">Date</Label>
          <Input id="adm-day" type="date" min={sickbayDayOf(new Date())} value={day} onChange={(e) => setDay(e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="adm-time">Time</Label>
          <Input id="adm-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="adm-note">Note for the family (optional)</Label>
        <textarea id="adm-note" className={TEXTAREA} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where to come, what to bring, or the link for an online assessment." />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy || !day}>
          {current ? "Save and tell the family" : "Book and tell the family"}
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OfferForm({ defaultLetter, busy, onCancel, onSave }: { defaultLetter: string; busy: boolean; onCancel: () => void; onSave: (letter: string) => void }) {
  const [letter, setLetter] = useState(defaultLetter);
  return (
    <form
      className="space-y-2 rounded-md bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(letter.trim());
      }}
    >
      <Label htmlFor="adm-letter">Offer letter</Label>
      <p className="text-xs text-muted-foreground">
        The family sees this in full, by email and on their tracking page, before they can accept. Give the complete breakdown: fees, items, the resumption date and any deadline.
      </p>
      <textarea id="adm-letter" className={TEXTAREA} rows={8} maxLength={5000} value={letter} onChange={(e) => setLetter(e.target.value)} required />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy || !letter.trim()}>
          Send the offer
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RejectForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: (note?: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <form
      className="space-y-2 rounded-md bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(note.trim() || undefined);
      }}
    >
      <Label htmlFor="adm-reject">Note for the family (optional)</Label>
      <p className="text-xs text-muted-foreground">The family is told the application was not successful. A reason is sent only if you write one.</p>
      <textarea id="adm-reject" className={TEXTAREA} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" variant="destructive" disabled={busy}>
          Mark not successful
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AcceptForm({ busy, onCancel, onSave }: { busy: boolean; onCancel: () => void; onSave: () => void }) {
  const [saw, setSaw] = useState(false);
  return (
    <form
      className="space-y-2 rounded-md bg-muted/50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p>Use this when the family accepts by phone or in person. They can also accept on their tracking page.</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1" checked={saw} onChange={(e) => setSaw(e.target.checked)} />
        <span>The family has seen the full offer letter.</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy || !saw}>
          Record the acceptance
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface Placement {
  terms: { id: string; name: string; isCurrent: boolean }[];
  arms: { id: string; label: string; applied: boolean }[];
}

/** Admit: the class and term, an admission number if the school types its own, and the two checks first. */
function AdmitForm({ a, onDone }: { a: AdmissionDetailDto; onDone: () => Promise<void> }) {
  const d = a.decision;
  const [placement, setPlacement] = useState<Placement | null | "none">(null);
  const [termId, setTermId] = useState("");
  const [armId, setArmId] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [arms, levels, years] = await Promise.all([listClassArms(), listClassLevels(), listAcademicYears()]);
        const year = years.find((y) => y.isCurrent) ?? years[0];
        const terms = year ? await listTerms(year.id) : [];
        const active = arms.filter((x) => x.isActive);
        if (!terms.length || !active.length) return setPlacement("none");
        const levelName = new Map(levels.map((l) => [l.id, l.name]));
        const list = active
          .map((x) => {
            const level = levelName.get(x.classLevelId) ?? "Class";
            return { id: x.id, label: `${level} — ${x.name}`, applied: level === a.classLevel };
          })
          // The class applied for first; the school may still place elsewhere after its assessment.
          .sort((p, q) => Number(q.applied) - Number(p.applied) || p.label.localeCompare(q.label));
        setPlacement({ terms: terms.map((t) => ({ id: t.id, name: t.name, isCurrent: t.isCurrent })), arms: list });
        const current = terms.filter((t) => t.isCurrent);
        if (current.length === 1) setTermId(current[0]!.id);
      } catch {
        setPlacement("none");
      }
    })();
  }, [a.classLevel]);

  async function admit() {
    setBusy(true);
    setError(null);
    try {
      await admitApplication(a.id, { termId, classArmId: armId, ...(number.trim() ? { admissionNumber: number.trim() } : {}) });
      await onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Admission did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/50 p-3">
      <h3 className="font-medium">Admit {a.childFirstName}</h3>
      <p>This creates {a.childFirstName} as a student, puts them in the class you choose, and links the parent as their primary guardian.</p>
      {d.possibleDuplicates.length > 0 && (
        <InlineAlert tone="warning" title="Possible duplicate">
          <p>
            Already at the school with the same name and date of birth:{" "}
            {d.possibleDuplicates.map((s, i) => (
              <span key={s.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/students/${s.id}`} className="underline">
                  {s.name} ({s.admissionNumber})
                </Link>
              </span>
            ))}
            . Check this is a different child before admitting.
          </p>
        </InlineAlert>
      )}
      <p>
        {d.existingGuardian
          ? `${d.existingGuardian.name} (${d.existingGuardian.phone}) is already a guardian at the school with this email, so they will be linked rather than added again.`
          : `${a.guardian.firstName} ${a.guardian.lastName} will be added as a new guardian.`}
      </p>
      {placement === null && <p className="text-muted-foreground">Loading classes…</p>}
      {placement === "none" && <InlineAlert tone="warning">Set up the school year, its terms and the classes before admitting.</InlineAlert>}
      {placement && placement !== "none" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="admit-arm">Class</Label>
            <select id="admit-arm" className={SELECT} value={armId} onChange={(e) => setArmId(e.target.value)}>
              <option value="">Choose a class…</option>
              {placement.arms.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="admit-term">Term</Label>
            <select id="admit-term" className={SELECT} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Choose a term…</option>
              {placement.terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isCurrent ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="admit-number">Admission number</Label>
            <Input id="admit-number" value={number} maxLength={40} onChange={(e) => setNumber(e.target.value)} placeholder="Blank: numbered for you" />
          </div>
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button size="sm" disabled={busy || !armId || !termId} onClick={() => void admit()}>
        Admit and enrol
      </Button>
    </div>
  );
}
