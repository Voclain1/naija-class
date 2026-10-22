"use client";

import { useEffect, useState } from "react";

import {
  ADMISSION_DOCUMENT_LABEL,
  ADMISSION_FIELD_LABEL,
  ADMISSION_FIELD_MODE_LABEL,
  ADMISSION_LIMITS,
  ADMISSION_OPTIONAL_FIELDS,
  ADMISSION_QUESTION_KIND_LABEL,
  ADMISSION_STANDARD_DOCUMENTS,
  admissionFieldModeValues,
  admissionQuestionKindValues,
  type AdmissionFieldMode,
  type AdmissionFormConfig,
  type AdmissionOfficerDto,
  type AdmissionQuestion,
  type AdmissionSettingsDto,
} from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAdmissionOfficers, getAdmissionSettings, setAdmissionOfficers, updateAdmissionSettings } from "@/lib/admissions/admissions-api";
import { ApiError } from "@/lib/api-client";

// Phase 9 / CP7.1 — Settings → Admissions (docs/modules/phase-9.md §16.8).
// Applications are open by default; here the owner or an admin can switch them
// off, close classes, shape the school's own form, choose who is told, write
// the default offer letter, and name Admissions officers.

/** Where the public form lives. Tomorrow, the school's own address (§16.8). */
const PORTAL_URL =
  process.env.NEXT_PUBLIC_PORTAL_URL ?? (process.env.NODE_ENV === "production" ? "https://portal.schoolkit.ng" : "http://localhost:3002");

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

function newQuestionId(existing: AdmissionQuestion[]): string {
  for (let i = 1; ; i += 1) {
    const id = `q${i}`;
    if (!existing.some((q) => q.id === id)) return id;
  }
}

export default function AdmissionSettingsPage() {
  const [settings, setSettings] = useState<AdmissionSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdmissionSettings()
      .then(setSettings)
      .catch((e: unknown) => setError(message(e)));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Admissions" subtitle="Your online application form, and who hears about each new application." />
      {error && <InlineAlert>{error}</InlineAlert>}
      {!settings ? !error && <p className="text-sm text-muted-foreground">Loading…</p> : <SettingsForm initial={settings} onSaved={setSettings} />}
      <Officers />
    </div>
  );
}

function SettingsForm({ initial, onSaved }: { initial: AdmissionSettingsDto; onSaved: (s: AdmissionSettingsDto) => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [intro, setIntro] = useState(initial.intro ?? "");
  const [closed, setClosed] = useState<string[]>(initial.classLevels.filter((l) => !l.open).map((l) => l.id));
  const [form, setForm] = useState<AdmissionFormConfig>(initial.form);
  const [smsAlerts, setSmsAlerts] = useState(initial.smsAlerts);
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail ?? "");
  const [offerLetter, setOfferLetter] = useState(initial.offerLetter ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const link = initial.applyUrl ?? `${PORTAL_URL}${initial.applyPath}`;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await updateAdmissionSettings({
        enabled,
        intro: intro.trim() || null,
        smsAlerts,
        notifyEmail: notifyEmail.trim() || null,
        offerLetter: offerLetter.trim() || null,
        form,
        closedClassLevelIds: closed,
      });
      onSaved(next);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const setField = (key: (typeof ADMISSION_OPTIONAL_FIELDS)[number], mode: AdmissionFieldMode) => setForm({ ...form, fields: { ...form.fields, [key]: mode } });
  const setDoc = (key: (typeof ADMISSION_STANDARD_DOCUMENTS)[number], mode: AdmissionFieldMode) => setForm({ ...form, documents: { ...form.documents, [key]: mode } });
  const setQuestion = (i: number, q: AdmissionQuestion) => setForm({ ...form, questions: form.questions.map((x, j) => (j === i ? q : x)) });

  return (
    <div className="space-y-6">
      <section aria-labelledby="adm-open" className="space-y-3 rounded-md border bg-card p-4">
        <h2 id="adm-open" className="font-serif text-lg font-medium">
          Taking applications
        </h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <span className="font-medium">Take applications online</span>
            <span className="block text-muted-foreground">
              {enabled ? "Families can apply at your form's address." : "Off: the form says the school is not taking applications online."}
            </span>
          </span>
        </label>
        <p className="break-all text-sm">
          Your form: <a href={link} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{link}</a>
        </p>
        <div className="space-y-1">
          <Label htmlFor="adm-intro">Introduction at the top of the form (optional)</Label>
          <textarea
            id="adm-intro"
            className="min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
            maxLength={ADMISSION_LIMITS.intro}
            value={intro}
            placeholder="Admission into JSS1 for the 2027/2028 session is open. Entrance examinations hold on…"
            onChange={(e) => setIntro(e.target.value)}
          />
        </div>
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Classes open for application</legend>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {initial.classLevels.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!closed.includes(l.id)}
                  onChange={(e) => setClosed(e.target.checked ? closed.filter((c) => c !== l.id) : [...closed, l.id])}
                />
                {l.name}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="adm-fields" className="space-y-3 rounded-md border bg-card p-4">
        <h2 id="adm-fields" className="font-serif text-lg font-medium">
          What the form asks
        </h2>
        <p className="text-sm text-muted-foreground">
          The child&apos;s names, date of birth, gender and class, and one parent&apos;s name, relationship, phone and email, are always asked.
        </p>
        <ModeTable
          rows={ADMISSION_OPTIONAL_FIELDS.map((key) => ({ key, label: ADMISSION_FIELD_LABEL[key], mode: form.fields[key], onChange: (m) => setField(key, m) }))}
          idPrefix="field"
        />
        <h3 className="pt-2 text-sm font-medium">Documents</h3>
        <ModeTable
          rows={ADMISSION_STANDARD_DOCUMENTS.map((key) => ({ key, label: ADMISSION_DOCUMENT_LABEL[key], mode: form.documents[key], onChange: (m) => setDoc(key, m) }))}
          idPrefix="doc"
        />
        <div className="space-y-2">
          {form.documents.custom.map((c, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor={`custom-doc-${i}`}>Your own document {i + 1}</Label>
                <Input
                  id={`custom-doc-${i}`}
                  value={c.label}
                  maxLength={60}
                  placeholder="Baptismal certificate"
                  onChange={(e) => setForm({ ...form, documents: { ...form.documents, custom: form.documents.custom.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) } })}
                />
              </div>
              <select
                aria-label={`Your own document ${i + 1}: required or optional`}
                className={SELECT_CLASSES}
                value={c.mode}
                onChange={(e) =>
                  setForm({ ...form, documents: { ...form.documents, custom: form.documents.custom.map((x, j) => (j === i ? { ...x, mode: e.target.value as "REQUIRED" | "OPTIONAL" } : x)) } })
                }
              >
                <option value="REQUIRED">Required</option>
                <option value="OPTIONAL">Optional</option>
              </select>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm({ ...form, documents: { ...form.documents, custom: form.documents.custom.filter((_, j) => j !== i) } })}
              >
                Remove
              </Button>
            </div>
          ))}
          {form.documents.custom.length < ADMISSION_LIMITS.customDocuments && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setForm({ ...form, documents: { ...form.documents, custom: [...form.documents.custom, { label: "", mode: "OPTIONAL" }] } })}
            >
              Ask for another document
            </Button>
          )}
        </div>
        <h3 className="pt-2 text-sm font-medium">Your own questions</h3>
        {form.questions.map((q, i) => (
          <div key={q.id} className="space-y-2 rounded-md bg-muted/30 p-3">
            <div className="space-y-1">
              <Label htmlFor={`q-label-${q.id}`}>Question {i + 1}</Label>
              <Input id={`q-label-${q.id}`} value={q.label} maxLength={ADMISSION_LIMITS.questionLabel} placeholder="How did you hear about us?" onChange={(e) => setQuestion(i, { ...q, label: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select aria-label={`Question ${i + 1}: kind of answer`} className={SELECT_CLASSES} value={q.kind} onChange={(e) => setQuestion(i, { ...q, kind: e.target.value as AdmissionQuestion["kind"] })}>
                {admissionQuestionKindValues.map((k) => (
                  <option key={k} value={k}>
                    {ADMISSION_QUESTION_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={q.required} onChange={(e) => setQuestion(i, { ...q, required: e.target.checked })} />
                Required
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ ...form, questions: form.questions.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
            {q.kind === "CHOICE" && (
              <div className="space-y-1">
                <Label htmlFor={`q-options-${q.id}`}>Choices, one per line</Label>
                <textarea
                  id={`q-options-${q.id}`}
                  className="min-h-16 w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={q.options.join("\n")}
                  onChange={(e) => setQuestion(i, { ...q, options: e.target.value.split("\n").map((o) => o.trim()).filter(Boolean).slice(0, ADMISSION_LIMITS.choiceOptions) })}
                />
              </div>
            )}
          </div>
        ))}
        {form.questions.length < ADMISSION_LIMITS.questions && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm({ ...form, questions: [...form.questions, { id: newQuestionId(form.questions), label: "", kind: "SHORT", options: [], required: false }] })}
          >
            Add a question
          </Button>
        )}
      </section>

      <section aria-labelledby="adm-told" className="space-y-3 rounded-md border bg-card p-4">
        <h2 id="adm-told" className="font-serif text-lg font-medium">
          Who is told
        </h2>
        <p className="text-sm text-muted-foreground">
          Every new application goes to the owner, admins and Admissions officers by app notification and email.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={smsAlerts} onChange={(e) => setSmsAlerts(e.target.checked)} />
          <span>
            <span className="font-medium">Also by SMS</span>
            <span className="block text-muted-foreground">Each SMS costs money. At most {ADMISSION_LIMITS.smsPerDay} a day are sent; after that, email and the app only.</span>
          </span>
        </label>
        <div className="max-w-sm space-y-1">
          <Label htmlFor="adm-notify">Also email a copy to (optional)</Label>
          <Input id="adm-notify" type="email" value={notifyEmail} placeholder="admissions@yourschool.ng" onChange={(e) => setNotifyEmail(e.target.value)} />
        </div>
      </section>

      <section aria-labelledby="adm-offer" className="space-y-3 rounded-md border bg-card p-4">
        <h2 id="adm-offer" className="font-serif text-lg font-medium">
          Default offer letter
        </h2>
        <p className="text-sm text-muted-foreground">
          Sent in full when you offer a place: the fees, what to bring, the resumption date and any deadline to accept. You can change it for each offer.
        </p>
        <textarea
          aria-label="Default offer letter"
          className="min-h-32 w-full rounded-md border border-input bg-background p-2 text-sm"
          maxLength={ADMISSION_LIMITS.offerLetter}
          value={offerLetter}
          onChange={(e) => setOfferLetter(e.target.value)}
        />
      </section>

      {error && <InlineAlert>{error}</InlineAlert>}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Admissions settings saved.</p>}
      <Button onClick={() => void save()} disabled={saving} className="w-full sm:w-auto">
        {saving ? "Saving…" : "Save admissions settings"}
      </Button>
    </div>
  );
}

function ModeTable({ rows, idPrefix }: { rows: { key: string; label: string; mode: AdmissionFieldMode; onChange: (m: AdmissionFieldMode) => void }[]; idPrefix: string }) {
  return (
    <div className="divide-y rounded-md border">
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
          <label htmlFor={`${idPrefix}-${r.key}`}>{r.label}</label>
          <select id={`${idPrefix}-${r.key}`} className={SELECT_CLASSES} value={r.mode} onChange={(e) => r.onChange(e.target.value as AdmissionFieldMode)}>
            {admissionFieldModeValues.map((m) => (
              <option key={m} value={m}>
                {ADMISSION_FIELD_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function Officers() {
  const [rows, setRows] = useState<AdmissionOfficerDto[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAdmissionOfficers()
      .then((r) => {
        setRows(r);
        setChosen(r.filter((o) => o.isOfficer).map((o) => o.id));
      })
      .catch((e: unknown) => setError(message(e)));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const r = await setAdmissionOfficers(chosen);
      setRows(r);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="adm-officers" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="adm-officers" className="font-serif text-lg font-medium">
        Admissions officers
      </h2>
      <p className="text-sm text-muted-foreground">
        The owner and admins handle applications. You can also let any member of staff do it; they keep their own role.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No other staff yet.</p>
      ) : (
        <fieldset className="space-y-1">
          <legend className="sr-only">Admissions officers</legend>
          {rows.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(o.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, o.id] : chosen.filter((c) => c !== o.id))} />
              {o.name}
              {o.roles.length > 0 && <span className="text-muted-foreground">({o.roles.join(", ")})</span>}
            </label>
          ))}
        </fieldset>
      )}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Admissions officers saved.</p>}
      <Button variant="outline" onClick={() => void save()} disabled={saving || !rows}>
        {saving ? "Saving…" : "Save admissions officers"}
      </Button>
    </section>
  );
}
