"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { PrintIdCardsDto, PrintableIdCardDto } from "@school-kit/types";

import { IdCardBack, IdCardFront } from "@/components/id-cards/id-card-face";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { cardsToPrint, printIdCards } from "@/lib/id-cards/id-cards-api";
import { PER_SHEET, mirrorRows } from "@/lib/id-cards/sheet";

// /id-cards/print (docs/modules/id-cards-and-store.md §3). Two layouts:
//
//   * A4 sheets: ten cards a page (two across, five down) with a dashed cut
//     line round each, fronts on one page and backs on the next. The backs
//     are laid out mirror-wise, so a double-sided print (flip on the long
//     edge) puts each back behind its own front.
//   * Card printer: one card per page at 85.6 × 54 mm, front then back, for
//     a PVC card printer.

type Layout = "a4" | "card";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}


export default function PrintIdCardsPage() {
  const [data, setData] = useState<PrintIdCardsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<Layout>("a4");

  useEffect(() => {
    const ids = cardsToPrint();
    if (ids.length === 0) {
      setError("No cards were chosen. Go back, tick the people whose cards you want, and choose Print.");
      return;
    }
    printIdCards(ids)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the cards."));
  }, []);

  const pageCss =
    layout === "a4"
      ? "@page { size: A4 portrait; margin: 12mm 19mm; }"
      : "@page { size: 85.6mm 54mm; margin: 0; }";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <style>{pageCss}</style>
      <div className="flex flex-col gap-4 print:hidden">
        <Link href="/id-cards/students" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to ID cards
        </Link>
        <h1 className="font-serif text-2xl font-medium tracking-tight">Print ID cards</h1>
        <fieldset className="flex flex-col gap-2 rounded-md border bg-card p-4 text-sm">
          <legend className="px-1 font-medium">Printer</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="layout" checked={layout === "a4"} onChange={() => setLayout("a4")} />
            <span>
              <span className="font-medium">A4 paper or card sheets</span> — ten cards a page with cut lines. Print double-sided,
              flipping on the long edge, then cut and laminate.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="layout" checked={layout === "card"} onChange={() => setLayout("card")} />
            <span>
              <span className="font-medium">PVC card printer</span> — one card per page at bank-card size (85.6 × 54 mm).
            </span>
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => window.print()} disabled={!data}>
            <Printer className="h-4 w-4" />
            Print {data ? data.cards.length : ""} {data?.cards.length === 1 ? "card" : "cards"}
          </Button>
          <span className="text-xs text-muted-foreground">
            In the print window, set margins to “Default” and turn on “Background graphics”.
          </span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!data && !error && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {data && layout === "a4" && (
        <div className="flex flex-col gap-8 print:gap-0">
          {chunk<PrintableIdCardDto>(data.cards, PER_SHEET).map((sheet, i) => {
            const padded: (PrintableIdCardDto | null)[] = [...sheet, ...Array(PER_SHEET - sheet.length).fill(null)];
            return (
              <div key={i} className="flex flex-col gap-8 print:gap-0">
                <Sheet label={`Sheet ${i + 1} — fronts`}>
                  {padded.map((c, j) => (
                    <Slot key={j}>{c ? <IdCardFront school={data.school} card={c} /> : null}</Slot>
                  ))}
                </Sheet>
                <Sheet label={`Sheet ${i + 1} — backs`}>
                  {mirrorRows(padded).map((c, j) => (
                    <Slot key={j}>{c ? <IdCardBack school={data.school} card={c} /> : null}</Slot>
                  ))}
                </Sheet>
              </div>
            );
          })}
        </div>
      )}

      {data && layout === "card" && (
        <div className="flex flex-col items-center gap-4 print:gap-0">
          {data.cards.flatMap((c) => [
            <div key={`${c.id}-f`} className="shadow-sm print:break-after-page print:shadow-none">
              <IdCardFront school={data.school} card={c} />
            </div>,
            <div key={`${c.id}-b`} className="shadow-sm print:break-after-page print:shadow-none">
              <IdCardBack school={data.school} card={c} />
            </div>,
          ])}
        </div>
      )}
    </div>
  );
}

function Sheet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="print:break-after-page">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground print:hidden">{label}</h2>
      <div className="overflow-x-auto">
        <div className="grid w-fit grid-cols-[85.6mm_85.6mm] grid-rows-[repeat(5,54mm)] bg-white">{children}</div>
      </div>
    </section>
  );
}

// A dashed cut line on all four sides (not an accent border: CLAUDE.md's rule
// is about one coloured edge; this is the guillotine guide).
function Slot({ children }: { children: React.ReactNode }) {
  return <div className="outline-dashed outline-[0.2mm] outline-offset-[-0.1mm] outline-[#9aa5aa]">{children}</div>;
}
