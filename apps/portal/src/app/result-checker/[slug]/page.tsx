"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { ResultCheckerResultDto, ResultCheckerSchoolDto } from "@school-kit/types";

import { Appear, PageHeader, PageSkeleton } from "@school-kit/ui";

import { ResultCard } from "@/components/result-card";

// The public Result Checker (Phase 8c / CP6b, docs/modules/phase-8.md §21.5).
// No sign-in: admission number + result PIN + term (D49). Outside the
// portal's session middleware on purpose.
//
// It calls the API DIRECTLY from the browser rather than through this app's
// server proxy. The API throttles per client address (client-ip-throttler
// .guard.ts); through the proxy every family would arrive from the same
// server and share one limit. CORS already allows the portal's origin.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type SchoolState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error" }
  | { kind: "ready"; school: ResultCheckerSchoolDto };

const FIELD = "h-10 rounded-md border bg-background px-3 text-base text-foreground";

export default function ResultCheckerPage() {
  const params = useParams<{ slug: string }>();
  const [schoolState, setSchoolState] = useState<SchoolState>({ kind: "loading" });
  const [admissionNumber, setAdmissionNumber] = useState("");
  const [pin, setPin] = useState("");
  const [termId, setTermId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState<ResultCheckerResultDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/result-checker/${encodeURIComponent(params.slug)}`);
        if (response.status === 404) {
          if (!cancelled) setSchoolState({ kind: "missing" });
          return;
        }
        if (!response.ok) {
          if (!cancelled) setSchoolState({ kind: "error" });
          return;
        }
        const school = (await response.json()) as ResultCheckerSchoolDto;
        if (cancelled) return;
        setSchoolState({ kind: "ready", school });
        setTermId(school.terms[0]?.termId ?? "");
      } catch {
        if (!cancelled) setSchoolState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug]);

  async function check(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !admissionNumber.trim() || !pin.trim() || !termId) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}/result-checker/${encodeURIComponent(params.slug)}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ admissionNumber: admissionNumber.trim(), pin, termId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        setChecked(body as ResultCheckerResultDto);
        setPin("");
        return;
      }
      const error = (body as { error?: { message?: string } } | null)?.error;
      setMessage(error?.message ?? "That didn't work. Check the details and try again.");
    } catch {
      setMessage("We couldn't reach SchoolKit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const school = schoolState.kind === "ready" ? schoolState.school : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <PageHeader
        title={school ? `${school.schoolName} result checker` : "Result checker"}
        subtitle="Enter the student's admission number and the 12-digit PIN from your result card."
      />

      {schoolState.kind === "loading" && <PageSkeleton rows={2} />}
      {schoolState.kind === "missing" && (
        <p className="text-sm text-muted-foreground">There is no result checker at this address. Check the link on your card.</p>
      )}
      {schoolState.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load the result checker. Try again shortly.
        </p>
      )}

      {school && school.terms.length === 0 && (
        <p className="text-sm text-muted-foreground">No results are available to check yet.</p>
      )}

      {school && school.terms.length > 0 && !checked && (
        <form onSubmit={(e) => void check(e)} className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
          <label className="flex flex-col gap-1 text-sm">
            Admission number
            <input
              className={FIELD}
              autoComplete="off"
              value={admissionNumber}
              onChange={(e) => setAdmissionNumber(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Result PIN
            <input
              className={`${FIELD} font-mono tracking-wider`}
              inputMode="numeric"
              autoComplete="off"
              placeholder="1234 5678 9012"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Session and term
            <select className={FIELD} value={termId} onChange={(e) => setTermId(e.target.value)}>
              {school.terms.map((t) => (
                <option key={t.termId} value={t.termId}>
                  {t.academicYearLabel} · {t.termName}
                </option>
              ))}
            </select>
          </label>
          {message ? (
            <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {message}
            </p>
          ) : null}
          <div>
            <button
              type="submit"
              disabled={busy || !admissionNumber.trim() || !pin.trim()}
              className="h-10 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Checking…" : "Check result"}
            </button>
          </div>
        </form>
      )}

      {checked && (
        <Appear>
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">
                {checked.result.student.firstName} {checked.result.student.lastName}
              </h2>
              <p className="text-sm text-muted-foreground">
                {checked.result.termName} · {checked.result.academicYearLabel} · {checked.result.classArmName}
              </p>
              <p className="text-sm text-muted-foreground">
                {checked.usesLeft === 0
                  ? "This PIN has no uses left."
                  : `This PIN has ${checked.usesLeft} use${checked.usesLeft === 1 ? "" : "s"} left.`}
              </p>
            </section>
            {checked.pdfUrl ? (
              <a
                href={checked.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              >
                Download report card (PDF)
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">The printable report card is still being prepared.</p>
            )}
            <ResultCard result={checked.result} />
            <button
              type="button"
              onClick={() => {
                setChecked(null);
                setMessage(null);
              }}
              className="self-start text-sm underline"
            >
              Check another result
            </button>
          </div>
        </Appear>
      )}
    </main>
  );
}
