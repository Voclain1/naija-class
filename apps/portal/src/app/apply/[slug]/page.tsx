"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ADMISSION_DOCUMENT_LABEL,
  ADMISSION_STANDARD_DOCUMENTS,
  ADMISSION_STANDARD_SLOT,
  type AdmissionDocumentSlot,
  type AdmissionFieldMode,
  type PublicAdmissionFormDto,
  type SubmitAdmissionInput,
  type SubmitAdmissionResultDto,
} from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

// Phase 9 / CP7.1 — a school's PUBLIC admission form (docs/modules/
// phase-9.md §16, §16.8). Open by default; each school shapes its own fields,
// documents and questions. Outside the portal's session middleware on purpose.
//
// It calls the API DIRECTLY from the browser, as the result checker does, so
// the per-address limits key on each family rather than on this server. The
// whole application — answers and files — goes in ONE request, so nothing is
// left half-sent. Tomorrow the same page is the main page of the school's own
// address (§16.8).

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const FIELD = "h-10 w-full rounded-md border bg-background px-3 text-base text-foreground";
const AREA = "min-h-20 w-full rounded-md border bg-background p-3 text-base text-foreground";
const LABEL = "flex flex-col gap-1 text-sm";
const MAX_BYTES = 10 * 1024 * 1024;

const RELATIONSHIPS = [
  ["MOTHER", "Mother"],
  ["FATHER", "Father"],
  ["GUARDIAN", "Guardian"],
  ["AUNT", "Aunt"],
  ["UNCLE", "Uncle"],
  ["GRANDPARENT", "Grandparent"],
  ["SIBLING", "Brother or sister"],
  ["OTHER", "Other"],
] as const;

/** The form field each upload slot is sent as (the API's own names). */
const UPLOAD_FIELD: Record<AdmissionDocumentSlot, string> = {
  PHOTO: "photo",
  BIRTH_CERTIFICATE: "birthCertificate",
  LAST_REPORT: "lastReport",
  CUSTOM_1: "custom1",
  CUSTOM_2: "custom2",
  CUSTOM_3: "custom3",
};

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; form: PublicAdmissionFormDto };

export default function ApplyPage() {
  const params = useParams<{ slug: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [done, setDone] = useState<SubmitAdmissionResultDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/apply/${encodeURIComponent(params.slug)}`);
        if (res.status === 404) return void (!cancelled && setState({ kind: "missing" }));
        if (!res.ok) return void (!cancelled && setState({ kind: "error" }));
        const form = (await res.json()) as PublicAdmissionFormDto;
        if (!cancelled) setState({ kind: "ready", form });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  const form = state.kind === "ready" ? state.form : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        {form?.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
          <img src={form.logoUrl} alt="" className="h-12 w-12 rounded object-contain" />
        )}
        <PageHeader title={form ? `Apply to ${form.schoolName}` : "Apply for admission"} subtitle={done ? undefined : "It takes a few minutes. The school replies by email."} />
      </div>

      {state.kind === "loading" && <PageSkeleton rows={3} />}
      {state.kind === "missing" && <p className="text-sm text-muted-foreground">There is no school at this address. Check the link you were given.</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load the form. Try again shortly.
        </p>
      )}
      {form && !form.enabled && (
        <p className="rounded-lg bg-muted p-4 text-sm">This school is not taking applications online. Please contact the school.</p>
      )}
      {form && form.enabled && form.classLevels.length === 0 && (
        <p className="rounded-lg bg-muted p-4 text-sm">No class is open for application right now. Please contact the school.</p>
      )}
      {done && (
        <section className="flex flex-col gap-2 rounded-lg bg-emerald-50 p-5 dark:bg-emerald-950/40">
          <h2 className="text-lg font-semibold">Application sent</h2>
          <p className="text-sm">
            Your reference is <strong>{done.reference}</strong>. We have emailed you a copy, with a private link to see where the application stands.
          </p>
        </section>
      )}
      {form && form.enabled && form.classLevels.length > 0 && !done && <ApplicationForm slug={params.slug} form={form} onDone={setDone} />}
    </main>
  );
}

function ApplicationForm({ slug, form, onDone }: { slug: string; form: PublicAdmissionFormDto; onDone: (r: SubmitAdmissionResultDto) => void }) {
  const f = form.form.fields;
  const [values, setValues] = useState<Record<string, string>>({ relationship: "MOTHER", gender: "", classLevelId: "" });
  const [second, setSecond] = useState<Record<string, string>>({ relationship: "FATHER" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Partial<Record<AdmissionDocumentSlot, File>>>({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues({ ...values, [k]: e.target.value });
  const v = (k: string) => (values[k] ?? "").trim() || undefined;

  const documents: { slot: AdmissionDocumentSlot; label: string; mode: AdmissionFieldMode }[] = [
    ...ADMISSION_STANDARD_DOCUMENTS.map((d) => ({ slot: ADMISSION_STANDARD_SLOT[d], label: ADMISSION_DOCUMENT_LABEL[d], mode: form.form.documents[d] })),
    ...form.form.documents.custom.map((c, i) => ({ slot: `CUSTOM_${i + 1}` as AdmissionDocumentSlot, label: c.label, mode: c.mode })),
  ].filter((d) => d.mode !== "OFF");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!consent) return setError("Tick the consent box to send the application.");
    for (const d of documents) {
      const file = files[d.slot];
      if (d.mode === "REQUIRED" && !file) return setError(`Attach the ${d.label.toLowerCase()}.`);
      if (file && file.size > MAX_BYTES) return setError(`The ${d.label.toLowerCase()} is over 10 MB. Send a smaller photo or PDF.`);
    }
    const body: SubmitAdmissionInput = {
      classLevelId: values.classLevelId ?? "",
      child: {
        firstName: values.childFirstName?.trim() ?? "",
        middleName: f.middleName !== "OFF" ? v("childMiddleName") : undefined,
        lastName: values.childLastName?.trim() ?? "",
        dateOfBirth: values.dateOfBirth ?? "",
        gender: (values.gender || "OTHER") as SubmitAdmissionInput["child"]["gender"],
      },
      guardian: {
        firstName: values.guardianFirstName?.trim() ?? "",
        lastName: values.guardianLastName?.trim() ?? "",
        relationship: values.relationship as SubmitAdmissionInput["guardian"]["relationship"],
        phone: values.guardianPhone?.trim() ?? "",
        email: values.guardianEmail?.trim() ?? "",
      },
      ...(f.secondGuardian !== "OFF" && (second.firstName?.trim() || f.secondGuardian === "REQUIRED")
        ? {
            secondGuardian: {
              firstName: second.firstName?.trim() ?? "",
              lastName: second.lastName?.trim() ?? "",
              relationship: second.relationship as SubmitAdmissionInput["guardian"]["relationship"],
              phone: second.phone?.trim() ?? "",
              email: second.email?.trim() || undefined,
            },
          }
        : {}),
      previousSchool: v("previousSchool"),
      previousClass: v("previousClass"),
      homeAddress: v("homeAddress"),
      religion: v("religion"),
      stateOfOrigin: v("stateOfOrigin"),
      medicalNeeds: v("medicalNeeds"),
      answers,
      consent: true,
      website,
    };
    if (!values.gender) return setError("Choose the child's gender.");
    const data = new FormData();
    data.append("data", JSON.stringify(body));
    for (const d of documents) {
      const file = files[d.slot];
      if (file) data.append(UPLOAD_FIELD[d.slot], file);
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/apply/${encodeURIComponent(slug)}`, { method: "POST", body: data });
      const json: unknown = await res.json().catch(() => null);
      if (res.ok) return onDone(json as SubmitAdmissionResultDto);
      if (res.status === 429) return setError("Too many applications from this connection. Please try again in an hour.");
      const err = (json as { error?: { message?: string } } | null)?.error;
      setError(err?.message ?? "That didn't work. Check the details and try again.");
    } catch {
      setError("We couldn't reach SchoolKit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const optional = (mode: AdmissionFieldMode) => (mode === "OPTIONAL" ? " (optional)" : "");

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="Application form" className="flex flex-col gap-6" noValidate>
      {form.intro && <p className="whitespace-pre-line rounded-lg bg-muted p-4 text-sm">{form.intro}</p>}

      <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-base font-semibold">The child</legend>
        <label className={LABEL}>
          Class applying for
          <select className={FIELD} value={values.classLevelId} onChange={set("classLevelId")} required>
            <option value="">Choose…</option>
            {form.classLevels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className={LABEL}>
          First name
          <input className={FIELD} value={values.childFirstName ?? ""} onChange={set("childFirstName")} maxLength={60} autoComplete="off" />
        </label>
        {f.middleName !== "OFF" && (
          <label className={LABEL}>
            Middle name{optional(f.middleName)}
            <input className={FIELD} value={values.childMiddleName ?? ""} onChange={set("childMiddleName")} maxLength={60} autoComplete="off" />
          </label>
        )}
        <label className={LABEL}>
          Surname
          <input className={FIELD} value={values.childLastName ?? ""} onChange={set("childLastName")} maxLength={60} autoComplete="off" />
        </label>
        <label className={LABEL}>
          Date of birth
          <input type="date" className={FIELD} value={values.dateOfBirth ?? ""} onChange={set("dateOfBirth")} />
        </label>
        <label className={LABEL}>
          Gender
          <select className={FIELD} value={values.gender} onChange={set("gender")}>
            <option value="">Choose…</option>
            <option value="FEMALE">Girl</option>
            <option value="MALE">Boy</option>
          </select>
        </label>
        {f.previousSchool !== "OFF" && <TextField label={`Previous school${optional(f.previousSchool)}`} value={values.previousSchool} onChange={set("previousSchool")} />}
        {f.previousClass !== "OFF" && <TextField label={`Previous class${optional(f.previousClass)}`} value={values.previousClass} onChange={set("previousClass")} />}
        {f.religion !== "OFF" && <TextField label={`Religion${optional(f.religion)}`} value={values.religion} onChange={set("religion")} />}
        {f.stateOfOrigin !== "OFF" && <TextField label={`State of origin${optional(f.stateOfOrigin)}`} value={values.stateOfOrigin} onChange={set("stateOfOrigin")} />}
        {f.medicalNeeds !== "OFF" && (
          <label className={LABEL}>
            Medical needs or allergies{optional(f.medicalNeeds)}
            <textarea className={AREA} value={values.medicalNeeds ?? ""} onChange={set("medicalNeeds")} maxLength={1000} />
          </label>
        )}
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
        <legend className="px-1 text-base font-semibold">You, the parent or guardian</legend>
        <TextField label="First name" value={values.guardianFirstName} onChange={set("guardianFirstName")} autoComplete="given-name" />
        <TextField label="Surname" value={values.guardianLastName} onChange={set("guardianLastName")} autoComplete="family-name" />
        <label className={LABEL}>
          Relationship to the child
          <select className={FIELD} value={values.relationship} onChange={set("relationship")}>
            {RELATIONSHIPS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <TextField label="Phone" type="tel" value={values.guardianPhone} onChange={set("guardianPhone")} autoComplete="tel" />
        <TextField label="Email (the school replies here)" type="email" value={values.guardianEmail} onChange={set("guardianEmail")} autoComplete="email" />
        {f.homeAddress !== "OFF" && <TextField label={`Home address${optional(f.homeAddress)}`} value={values.homeAddress} onChange={set("homeAddress")} autoComplete="street-address" />}
      </fieldset>

      {f.secondGuardian !== "OFF" && (
        <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
          <legend className="px-1 text-base font-semibold">A second parent or guardian{optional(f.secondGuardian)}</legend>
          <TextField label="First name" value={second.firstName} onChange={(e) => setSecond({ ...second, firstName: e.target.value })} />
          <TextField label="Surname" value={second.lastName} onChange={(e) => setSecond({ ...second, lastName: e.target.value })} />
          <label className={LABEL}>
            Relationship to the child
            <select className={FIELD} value={second.relationship} onChange={(e) => setSecond({ ...second, relationship: e.target.value })}>
              {RELATIONSHIPS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <TextField label="Phone" type="tel" value={second.phone} onChange={(e) => setSecond({ ...second, phone: e.target.value })} />
          <TextField label="Email (optional)" type="email" value={second.email} onChange={(e) => setSecond({ ...second, email: e.target.value })} />
        </fieldset>
      )}

      {form.form.questions.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
          <legend className="px-1 text-base font-semibold">A few questions from the school</legend>
          {form.form.questions.map((q) => {
            const label = `${q.label}${q.required ? "" : " (optional)"}`;
            const value = answers[q.id] ?? "";
            const setAnswer = (a: string) => setAnswers({ ...answers, [q.id]: a });
            if (q.kind === "LONG") {
              return (
                <label key={q.id} className={LABEL}>
                  {label}
                  <textarea className={AREA} value={value} maxLength={1000} onChange={(e) => setAnswer(e.target.value)} />
                </label>
              );
            }
            if (q.kind === "YES_NO" || q.kind === "CHOICE") {
              const options = q.kind === "YES_NO" ? ["Yes", "No"] : q.options;
              return (
                <label key={q.id} className={LABEL}>
                  {label}
                  <select className={FIELD} value={value} onChange={(e) => setAnswer(e.target.value)}>
                    <option value="">Choose…</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }
            return <TextField key={q.id} label={label} value={value} onChange={(e) => setAnswer(e.target.value)} maxLength={200} />;
          })}
        </fieldset>
      )}

      {documents.length > 0 && (
        <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
          <legend className="px-1 text-base font-semibold">Documents</legend>
          <p className="text-sm text-muted-foreground">A photo (JPG, PNG or WebP) or a PDF, up to 10 MB each.</p>
          {documents.map((d) => (
            <label key={d.slot} className={LABEL}>
              {d.label}
              {d.mode === "OPTIONAL" ? " (optional)" : ""}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="w-full min-w-0 max-w-full text-sm"
                onChange={(e) => setFiles({ ...files, [d.slot]: e.target.files?.[0] })}
              />
            </label>
          ))}
        </fieldset>
      )}

      {/* The honeypot: hidden from people and screen readers; only a bot fills it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>

      <label className="flex items-start gap-2 rounded-lg bg-muted p-4 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{form.consentText}</span>
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="h-11 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground disabled:opacity-50">
        {busy ? "Sending…" : "Send application"}
      </button>
    </form>
  );
}

function TextField(props: {
  label: string;
  value: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
}) {
  return (
    <label className={LABEL}>
      {props.label}
      <input
        type={props.type ?? "text"}
        className={FIELD}
        value={props.value ?? ""}
        onChange={props.onChange}
        autoComplete={props.autoComplete ?? "off"}
        maxLength={props.maxLength ?? 200}
      />
    </label>
  );
}
