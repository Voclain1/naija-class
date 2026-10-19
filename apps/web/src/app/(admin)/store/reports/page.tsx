"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  STORE_CATEGORY_LABELS,
  STORE_MOVEMENT_LABELS,
  type StoreMovementDto,
  type StoreSalesReportDto,
  type StoreSalesReportRowDto,
  type StoreStockReportDto,
  type StoreStockReportRowDto,
} from "@school-kit/types";

import { PageHeader, StatGrid, StatRow } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { StoreNav } from "@/components/store/store-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import type { CsvColumn } from "@/lib/csv-export";
import { formatKobo } from "@/lib/finance/format";
import { getSalesReport, getStockReport, listStoreMovements } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store/reports — stock on hand and its value at cost, sales over a period
// (what was billed to students), and every movement. Each exports to Excel,
// CSV or PDF.

const naira = (kobo: number | null) => (kobo === null ? "" : (kobo / 100).toFixed(2));

const STOCK_COLUMNS: CsvColumn<StoreStockReportRowDto>[] = [
  { header: "Item", accessor: (r) => r.itemName },
  { header: "Size", accessor: (r) => r.variantLabel },
  { header: "Category", accessor: (r) => STORE_CATEGORY_LABELS[r.category] },
  { header: "In stock", accessor: (r) => r.onHand },
  { header: "Unit", accessor: (r) => r.unit },
  { header: "Average cost (₦)", accessor: (r) => naira(r.averageCost) },
  { header: "Value (₦)", accessor: (r) => naira(r.value) },
  { header: "Low", accessor: (r) => (r.low ? "Yes" : "") },
];

const SALES_COLUMNS: CsvColumn<StoreSalesReportRowDto>[] = [
  { header: "Item", accessor: (r) => r.itemName },
  { header: "Size", accessor: (r) => r.variantLabel },
  { header: "Quantity sold", accessor: (r) => r.quantity },
  { header: "Amount billed (₦)", accessor: (r) => naira(r.amount) },
];

const MOVEMENT_COLUMNS: CsvColumn<StoreMovementDto>[] = [
  { header: "Date", accessor: (m) => new Date(m.createdAt).toISOString().slice(0, 10) },
  { header: "What", accessor: (m) => STORE_MOVEMENT_LABELS[m.kind] },
  { header: "Item", accessor: (m) => m.itemName },
  { header: "Size", accessor: (m) => m.variantLabel },
  { header: "Quantity", accessor: (m) => m.quantity },
  { header: "Who / why", accessor: (m) => [m.party, m.supplier, m.reason].filter(Boolean).join(" · ") },
  { header: "By", accessor: (m) => m.createdByName },
];

function firstOfMonth(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${d.toISOString().slice(0, 8)}01`;
}
function today(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function StoreReportsPage() {
  const [stock, setStock] = useState<StoreStockReportDto | null>(null);
  const [sales, setSales] = useState<StoreSalesReportDto | null>(null);
  const [movements, setMovements] = useState<StoreMovementDto[] | null>(null);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStockReport()
      .then(setStock)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the stock report."));
  }, []);

  const loadRange = useCallback(async () => {
    setSales(null);
    setMovements(null);
    try {
      const [s, m] = await Promise.all([getSalesReport({ from, to }), listStoreMovements({ from, to })]);
      setSales(s);
      setMovements(m);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the report.");
    }
  }, [from, to]);

  useEffect(() => {
    void loadRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once; the button reloads
  }, []);

  const lowRows = stock?.rows.filter((r) => r.low).length ?? 0;
  const range = `${from} to ${to}`;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
      <PageHeader title="Store reports" subtitle="What the store holds and what it is worth, and what was sold and moved." />
      <StoreNav />
      {error && <InlineAlert>{error}</InlineAlert>}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-serif text-xl font-medium">Stock on hand</h2>
          <ListExportMenu title="Store stock on hand" csvFilename="store-stock.csv" columns={STOCK_COLUMNS} getRows={() => stock?.rows ?? []} disabled={!stock?.rows.length} />
        </div>
        {stock === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <StatGrid>
              <StatRow value={formatKobo(stock.totalValue)} label="Stock value at cost" />
              <StatRow value={stock.rows.length} label="Lines in stock" />
              <StatRow value={lowRows} label="Lines running low" tone={lowRows > 0 ? "warning" : "default"} href={lowRows > 0 ? "/store?low=true" : undefined} />
            </StatGrid>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">In stock</th>
                    <th className="px-3 py-2 text-right">Average cost</th>
                    <th className="px-3 py-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stock.rows.map((r, i) => (
                    <tr key={`${r.itemId}-${i}`} className={cn(r.low && "bg-amber-50 dark:bg-amber-950/30")}>
                      <td className="px-3 py-2">
                        {r.itemName}
                        {r.variantLabel ? <span className="text-muted-foreground"> · {r.variantLabel}</span> : null}
                        {r.low ? <span className="ml-2 text-xs font-semibold text-amber-800 dark:text-amber-300">Low</span> : null}
                      </td>
                      <td className="px-3 py-2">{STORE_CATEGORY_LABELS[r.category]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.onHand}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.averageCost === null ? "—" : formatKobo(r.averageCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatKobo(r.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-xl font-medium">Sales and movements</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void loadRange();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button type="submit" variant="outline">
            Show
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Sales{sales ? ` · ${sales.totalQuantity} sold · ${formatKobo(sales.totalAmount)} billed` : ""}
          </h3>
          <ListExportMenu title="Store sales" subtitle={range} csvFilename="store-sales.csv" columns={SALES_COLUMNS} getRows={() => sales?.rows ?? []} disabled={!sales?.rows.length} />
        </div>
        {sales === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : sales.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing was sold in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Sold</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sales.rows.map((r) => (
                  <tr key={`${r.itemId}-${r.variantLabel ?? ""}`}>
                    <td className="px-3 py-2">
                      {r.itemName}
                      {r.variantLabel ? <span className="text-muted-foreground"> · {r.variantLabel}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKobo(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Movements{movements ? ` · ${movements.length}` : ""}
          </h3>
          <ListExportMenu title="Store movements" subtitle={range} csvFilename="store-movements.csv" columns={MOVEMENT_COLUMNS} getRows={() => movements ?? []} disabled={!movements?.length} />
        </div>
        {movements === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing moved in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">What</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Who / why</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-3 py-2">{new Date(m.createdAt).toLocaleDateString("en-NG")}</td>
                    <td className="px-3 py-2">{STORE_MOVEMENT_LABELS[m.kind]}</td>
                    <td className="px-3 py-2">
                      {m.itemName}
                      {m.variantLabel ? <span className="text-muted-foreground"> · {m.variantLabel}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                    <td className="px-3 py-2">{[m.party, m.supplier, m.reason].filter(Boolean).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
