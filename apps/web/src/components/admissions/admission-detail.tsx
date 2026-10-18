"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ADMISSION_STATUS_LABEL, formatSickbayDay, formatSickbayTime, type AdmissionDetailDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { admissionDocumentUrl, getAdmission } from "@/lib/admissions/admissions-api";
import { ApiError } from "@/lib/api-client";

// Phase 9 / CP7.1 — one application, as the family sent it: the child, the
// parent, the school's own fields and questions, and the documents, each
// opened through a 5-minute link. Review, offer and admitting come in CP7.2.

const GENDER = { MALE: "Male", FEMALE: "Female", OTHER: "Other" } as const;
const RELATIONSHIP: Record<string, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  OTHER: "Other",
};

export function AdmissionDetail({ id, backHref }: { id: string; backHref: string }) {
  const [a, setA] = useState<AdmissionDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdmission(id)
      .then(setA)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the application."));
  }, [id]);

  async function open(documentId: string) {
    setError(null);
    try {
      const { url } = await admissionDocumentUrl(id, documentId);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not open the document.");
    }
  }

  if (error && !a) return <InlineAlert>{error}</InlineAlert>;
  if (!a) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <Link href={backHref} className="text-sm text-primary hover:underline">
        ← Admissions
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="break-words font-serif text-2xl font-semibold">{a.childName}</h1>
          <p className="text-sm text-muted-foreground">
            {a.reference} · applied {formatSickbayDay(a.submittedAt)} at {formatSickbayTime(a.submittedAt)} · for {a.classLevel}
          </p>
        </div>
        <Badge variant={a.status === "SUBMITTED" ? "warning" : "muted"}>{ADMISSION_STATUS_LABEL[a.status]}</Badge>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}

      <section aria-labelledby="adm-child" className="space-y-2 rounded-md border bg-card p-4 text-sm">
        <h2 id="adm-child" className="font-medium">
          The child
        </h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Row label="Name" value={`${a.childFirstName} ${a.childLastName}`} />
          <Row label="Date of birth" value={formatSickbayDay(`${a.dateOfBirth}T12:00:00Z`)} />
          <Row label="Gender" value={GENDER[a.gender]} />
          <Row label="Class applied for" value={a.classLevel} />
        </dl>
      </section>

      <section aria-labelledby="adm-parent" className="space-y-2 rounded-md border bg-card p-4 text-sm">
        <h2 id="adm-parent" className="font-medium">
          Parent or guardian
        </h2>
        <dl className="grid gap-2 sm:grid-cols-2">
          <Row label="Name" value={`${a.guardian.firstName} ${a.guardian.lastName}`} />
          <Row label="Relationship" value={RELATIONSHIP[a.guardian.relationship] ?? a.guardian.relationship} />
          <Row label="Phone" value={<a href={`tel:${a.guardian.phone}`} className="text-primary hover:underline">{a.guardian.phone}</a>} />
          <Row label="Email" value={<a href={`mailto:${a.guardian.email}`} className="break-all text-primary hover:underline">{a.guardian.email}</a>} />
        </dl>
        {a.secondGuardian && (
          <p className="break-words">
            Also: {a.secondGuardian.name} ({RELATIONSHIP[a.secondGuardian.relationship] ?? a.secondGuardian.relationship}) · {a.secondGuardian.phone}
            {a.secondGuardian.email ? ` · ${a.secondGuardian.email}` : ""}
          </p>
        )}
      </section>

      {a.details.length > 0 && (
        <section aria-labelledby="adm-more" className="space-y-2 rounded-md border bg-card p-4 text-sm">
          <h2 id="adm-more" className="font-medium">
            More about the child
          </h2>
          <dl className="space-y-2">
            {a.details.map((d) => (
              <Row key={d.label} label={d.label} value={d.value} />
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="adm-docs" className="space-y-2 rounded-md border bg-card p-4 text-sm">
        <h2 id="adm-docs" className="font-medium">
          Documents
        </h2>
        {a.documentFiles.length === 0 ? (
          <p className="text-muted-foreground">No documents were sent.</p>
        ) : (
          <ul className="space-y-2">
            {a.documentFiles.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {d.label} <span className="text-muted-foreground">({d.ext.toUpperCase()}, {Math.max(1, Math.round(d.sizeBytes / 1024))} KB)</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void open(d.id)} aria-label={`Open ${d.label}`}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        The family agreed to the school using these details on {formatSickbayDay(a.consentAt)}. An application that is not successful or is withdrawn is deleted 90 days after it closes.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
