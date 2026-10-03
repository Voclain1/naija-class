"use client";

import { Download, KeyRound, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { GeneratedResultPinBatchDto, ResultPinBatchDto, SchoolMeDto } from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { Button } from "@/components/ui/button";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { isAuthForcedNavigation } from "@/lib/auth/session-end-navigation";
import { downloadCsv } from "@/lib/csv-export";
import { getSchoolMe } from "@/lib/onboarding/schools-api";
import { pinBatchCsv, pinBatchFilename, pinBatchPrintHtml } from "@/lib/result-pins/pin-export";
import {
  generateResultPinBatch,
  listResultPinBatches,
  voidResultPin,
  voidResultPinBatch,
} from "@/lib/result-pins/result-pins-api";

// /report-cards/pins — Result Checker PIN cards (Phase 8c / CP6b,
// docs/modules/phase-8.md §21.3). Owner/admin.
//
// Generating a batch returns the PINs ONCE (D16). They live only in this
// page's memory until the school downloads or prints them; leaving the page
// loses them for good, which the page says plainly and the browser's
// leave-page prompt backs up.

interface TermOption {
  id: string;
  label: string;
}

const FIELD = "h-9 rounded-md border bg-background px-3 text-sm";

export default function ResultPinsPage() {
  const [terms, setTerms] = useState<TermOption[]>([]);
  const [batches, setBatches] = useState<ResultPinBatchDto[] | null>(null);
  const [school, setSchool] = useState<SchoolMeDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [termId, setTermId] = useState("");
  const [quantity, setQuantity] = useState(100);
  const [maxUses, setMaxUses] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [fresh, setFresh] = useState<GeneratedResultPinBatchDto | null>(null);
  const [saved, setSaved] = useState(false);

  const [serial, setSerial] = useState("");
  const [voiding, setVoiding] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      setBatches((await listResultPinBatches()).data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load PIN batches.");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [years, me] = await Promise.all([listAcademicYears(), getSchoolMe()]);
        setSchool(me);
        const options: TermOption[] = [];
        let current = "";
        for (const year of years) {
          for (const term of await listTerms(year.id)) {
            options.push({ id: term.id, label: `${term.name} · ${year.label}` });
            if (term.isCurrent) current = term.id;
          }
        }
        setTerms(options);
        setTermId(current || options[0]?.id || "");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Could not load terms.");
      }
      await loadBatches();
    })();
  }, [loadBatches]);

  // The PINs exist nowhere else: warn before the tab closes with them unsaved.
  useEffect(() => {
    if (!fresh || saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      // A forced sign-out cannot be stayed (session-end-invariants.spec.ts).
      // The PINs are lost either way then; the batch can be voided and remade.
      if (isAuthForcedNavigation()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [fresh, saved]);

  async function onGenerate(): Promise<void> {
    if (!termId) return;
    if (fresh && !saved && !window.confirm("The last batch's PINs have not been downloaded or printed. Discard them?")) {
      return;
    }
    setGenerating(true);
    try {
      const generated = await generateResultPinBatch({ termId, quantity, maxUses });
      setFresh(generated);
      setSaved(false);
      toast.success(`Generated ${generated.pins.length} PINs. Download or print them now.`);
      await loadBatches();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't generate PINs — try again.");
    } finally {
      setGenerating(false);
    }
  }

  function onDownload(): void {
    if (!fresh) return;
    downloadCsv(pinBatchFilename(fresh), pinBatchCsv(fresh));
    setSaved(true);
  }

  function onPrint(): void {
    if (!fresh || !school) return;
    const checkerUrl = `${school.portalUrl.replace(/\/$/, "")}/result-checker/${school.slug}`;
    const win = window.open("", "_blank");
    if (!win) {
      toast.error("Your browser blocked the print window. Allow pop-ups for this site, or download the CSV.");
      return;
    }
    win.document.write(pinBatchPrintHtml(fresh, { schoolName: school.name, checkerUrl }));
    win.document.close();
    setSaved(true);
  }

  async function onVoidBatch(batch: ResultPinBatchDto): Promise<void> {
    if (!window.confirm(`Void every PIN in batch ${batch.number}? Cards already used keep the results they opened.`)) return;
    setVoiding(batch.id);
    try {
      await voidResultPinBatch(batch.id);
      toast.success(`Batch ${batch.number} voided.`);
      await loadBatches();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't void the batch — try again.");
    } finally {
      setVoiding(null);
    }
  }

  async function onVoidPin(): Promise<void> {
    const value = serial.trim();
    if (!value) return;
    setVoiding("serial");
    try {
      await voidResultPin(value);
      toast.success(`PIN ${value.toUpperCase()} voided.`);
      setSerial("");
      await loadBatches();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't void that PIN — try again.");
    } finally {
      setVoiding(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link href="/report-cards" className="self-start text-sm text-muted-foreground hover:underline">
          ← Report cards
        </Link>
        <PageHeader
          title="Result PINs"
          subtitle="PIN cards for classes released with “Result PIN required”. Sell or hand them out at the school."
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-4 rounded-md border bg-card p-5" aria-label="Generate PINs">
        <h2 className="font-medium">Generate a batch</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Term
            <select className={FIELD} value={termId} onChange={(e) => setTermId(e.target.value)}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            How many PINs
            <input
              type="number"
              min={1}
              max={2000}
              className={FIELD}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Uses per PIN
            <input
              type="number"
              min={1}
              max={20}
              className={FIELD}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          A PIN works only for the term it was made for, and only for the first student it is used for. Each check on
          the result checker uses one; opening it in the portal or app uses one, once.
        </p>
        <div>
          <Button
            type="button"
            onClick={() => void onGenerate()}
            disabled={generating || !termId || quantity < 1 || quantity > 2000 || maxUses < 1 || maxUses > 20}
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate PINs"}
          </Button>
        </div>
      </section>

      {fresh ? (
        // The once-only warning: tinted, and said in words (CLAUDE.md).
        <section className="flex flex-col gap-3 rounded-md bg-amber-50 p-5 text-amber-950" aria-label="New PINs">
          <h2 className="font-medium">
            Batch {fresh.batch.number}: {fresh.pins.length} PINs for {fresh.batch.termName} {fresh.batch.academicYearLabel}
          </h2>
          <p className="text-sm">
            <strong>These PINs are shown only now.</strong> SchoolKit keeps only a scrambled copy it cannot turn back
            into PINs, so if you leave this page without downloading or printing them, void the batch and make a new
            one.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={onDownload}>
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
            <Button type="button" variant="outline" onClick={onPrint} disabled={!school}>
              <Printer className="h-4 w-4" />
              Print cards
            </Button>
            {saved ? <span className="self-center text-sm">Saved.</span> : null}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3" aria-label="PIN batches">
        <h2 className="font-medium">Batches</h2>
        {batches === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PINs generated yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-normal">Batch</th>
                  <th className="px-3 py-2 font-normal">Term</th>
                  <th className="px-3 py-2 text-right font-normal">PINs</th>
                  <th className="px-3 py-2 text-right font-normal">Used</th>
                  <th className="px-3 py-2 text-right font-normal">Voided</th>
                  <th className="px-3 py-2 text-right font-normal">Uses each</th>
                  <th className="px-3 py-2 font-normal">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2">B{b.number}</td>
                    <td className="px-3 py-2">
                      {b.termName} {b.academicYearLabel}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.size}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.redeemedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.voidedCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{b.maxUses}</td>
                    <td className="px-3 py-2">{b.voidedAt ? "Voided" : "Active"}</td>
                    <td className="px-3 py-2 text-right">
                      {b.voidedAt ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={voiding === b.id}
                          onClick={() => void onVoidBatch(b)}
                        >
                          Void batch
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border bg-card p-5" aria-label="Void one PIN">
        <h2 className="font-medium">Void one lost or stolen card</h2>
        <p className="text-xs text-muted-foreground">Enter the serial printed on the card, for example B7-0142.</p>
        <div className="flex flex-wrap gap-3">
          <input
            className={FIELD}
            placeholder="Serial"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            aria-label="Serial"
          />
          <Button type="button" variant="outline" disabled={!serial.trim() || voiding === "serial"} onClick={() => void onVoidPin()}>
            Void PIN
          </Button>
        </div>
      </section>
    </div>
  );
}
