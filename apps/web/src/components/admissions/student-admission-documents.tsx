"use client";

import { useEffect, useState } from "react";

import { formatSickbayDay, type StudentAdmissionDocumentsDto } from "@school-kit/types";

import { getStudentAdmissionDocuments, studentAdmissionDocumentUrl } from "@/lib/admissions/admissions-api";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

// Phase 9 / CP7.2 — the documents the family sent with the application the
// child was admitted from (docs/modules/phase-9.md §16 CP7-D5), on the
// student page's Bio tab. Owner and admin only (admission.admit); each one
// opens through a 5-minute link, and each open is audited.
export function StudentAdmissionDocumentsField({ studentId }: { studentId: string }) {
  const { permissions } = useAuth();
  const allowed = hasPermission(permissions, "admission.admit");
  const [state, setState] = useState<{ loaded: boolean; value: StudentAdmissionDocumentsDto | null }>({ loaded: false, value: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    getStudentAdmissionDocuments(studentId)
      .then((value) => setState({ loaded: true, value }))
      .catch(() => setState({ loaded: true, value: null }));
  }, [allowed, studentId]);

  // Most students were not admitted online; say nothing for them.
  if (!allowed || !state.value) return null;
  const v = state.value;

  async function open(documentId: string) {
    setError(null);
    try {
      const { url } = await studentAdmissionDocumentUrl(studentId, documentId);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not open the document.");
    }
  }

  return (
    <div className="flex flex-col gap-0.5 sm:col-span-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Admission documents</dt>
      <dd className="space-y-1">
        <p className="text-muted-foreground">
          From application {v.reference}
          {v.admittedAt ? `, admitted ${formatSickbayDay(v.admittedAt)}` : ""}.
        </p>
        {v.documents.length === 0 ? (
          <p>No documents were sent.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {v.documents.map((d) => (
              <li key={d.id}>
                <button type="button" className="text-primary hover:underline" onClick={() => void open(d.id)}>
                  {d.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-destructive">{error}</p>}
      </dd>
    </div>
  );
}
