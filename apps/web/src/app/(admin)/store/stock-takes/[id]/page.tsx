"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { StoreStockTakeDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { STOCK_TAKE_STATUS } from "@/components/store/stock-take-status";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import type { CsvColumn } from "@/lib/csv-export";
import {
  approveStockTake,
  cancelStockTake,
  getStockTake,
  saveStockTakeCounts,
  submitStockTake,
} from "@/lib/store/store-api";
import { cn } from "@/lib/utils";


type Line = StoreStockTakeDto["lineItems"][number];

const COLUMNS: CsvColumn<Line>[] = [
  { header: "Item", accessor: (l) => l.itemName },
  { header: "Size", accessor: (l) => l.variantLabel },
  { header: "Expected", accessor: (l) => l.expected },
  { header: "Counted", accessor: (l) => l.counted },
  { header: "Difference", accessor: (l) => l.difference },
];

// /store/stock-takes/[id] — the count sheet. While counting, type what is on
// the shelf (blank = not counted, left as it is) and save as often as you
// like; submit when done. Whoever approves sees each difference first.
export default function StockTakePage() {
  const params = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "store.manage");
  const canApprove = hasPermission(permissions, "store.approve");
  const [take, setTake] = useState<StoreStockTakeDto | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const accept = useCallback((t: StoreStockTakeDto) => {
    setTake(t);
    setCounts(Object.fromEntries(t.lineItems.map((l) => [l.id, l.counted === null ? "" : String(l.counted)])));
  }, []);

  useEffect(() => {
    getStockTake(params.id)
      .then(accept)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the stock take."));
  }, [params.id, accept]);

  const dirty = useMemo(
    () => (take ? take.lineItems.filter((l) => (l.counted === null ? "" : String(l.counted)) !== (counts[l.id] ?? "")) : []),
    [take, counts],
  );

  async function run(action: () => Promise<StoreStockTakeDto>, message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      accept(await action());
      setNotice(message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not go through.");
    } finally {
      setBusy(false);
    }
  }

  function changes() {
    const out: { lineId: string; counted: number | null }[] = [];
    for (const l of dirty) {
      const raw = (counts[l.id] ?? "").trim();
      const n = raw === "" ? null : Number.parseInt(raw, 10);
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error(`Check the count for ${l.itemName}.`);
      out.push({ lineId: l.id, counted: n });
    }
    return out;
  }

  async function save(): Promise<StoreStockTakeDto | null> {
    if (!take) return null;
    const c = changes();
    return c.length ? saveStockTakeCounts(take.id, c) : take;
  }

  if (!take) return error ? <InlineAlert>{error}</InlineAlert> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  const counting = take.status === "OPEN" && canManage;
  const status = STOCK_TAKE_STATUS[take.status];
  const differences = take.lineItems.filter((l) => l.difference !== null && l.difference !== 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link href="/store/stock-takes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to stock takes
      </Link>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight">Stock take</h1>
          <p className="text-sm text-muted-foreground">
            Started by {take.createdByName} · {take.counted} of {take.lines} counted
            {take.submittedByName ? ` · submitted by ${take.submittedByName}` : ""}
          </p>
          <Badge variant={status.variant} className="w-fit">
            {status.label}
          </Badge>
        </div>
        <ListExportMenu title="Stock take" csvFilename="stock-take.csv" columns={COLUMNS} getRows={() => take.lineItems} />
      </header>

      {error && <InlineAlert>{error}</InlineAlert>}
      {notice && <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      {take.status === "SUBMITTED" && (
        <div className="rounded-md bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {differences.length === 0
            ? "Every count matches the records. Approving changes nothing."
            : `${differences.length} line${differences.length === 1 ? "" : "s"} differ from the records. Approving adjusts the stock to the count.`}
          {!canApprove && " The bursar, an admin or the owner approves it."}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {counting && (
          <>
            <Button
              variant="outline"
              disabled={busy || dirty.length === 0}
              onClick={() => void run(async () => (await save())!, "Counts saved.")}
            >
              Save counts
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await save();
                  return submitStockTake(take.id);
                }, "Submitted for approval.")
              }
            >
              Submit for approval
            </Button>
          </>
        )}
        {take.status === "SUBMITTED" && canApprove && (
          <Button disabled={busy} onClick={() => void run(() => approveStockTake(take.id), "Approved. The stock now matches the count.")}>
            Approve and adjust stock
          </Button>
        )}
        {(take.status === "OPEN" || take.status === "SUBMITTED") && (canManage || canApprove) && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Cancel this stock take? Nothing in the store changes.")) {
                void run(() => cancelStockTake(take.id), "Cancelled.");
              }
            }}
          >
            Cancel stock take
          </Button>
        )}
        {busy && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">{take.status === "OPEN" ? "In the records" : "Expected"}</th>
              <th className="px-3 py-2 text-right">Counted</th>
              <th className="px-3 py-2 text-right">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {take.lineItems.map((l) => {
              const raw = counts[l.id] ?? "";
              const n = raw.trim() === "" ? null : Number.parseInt(raw, 10);
              const diff = n === null || !Number.isFinite(n) ? null : n - l.expected;
              return (
                <tr key={l.id} className={cn(diff !== null && diff !== 0 && "bg-amber-50 dark:bg-amber-950/30")}>
                  <td className="px-3 py-2">
                    {l.itemName}
                    {l.variantLabel ? <span className="text-muted-foreground"> · {l.variantLabel}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.expected}</td>
                  <td className="px-3 py-2 text-right">
                    {counting ? (
                      <input
                        aria-label={`Count of ${l.itemName}${l.variantLabel ? ` ${l.variantLabel}` : ""}`}
                        inputMode="numeric"
                        value={raw}
                        onChange={(e) => setCounts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        className="h-8 w-20 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
                      />
                    ) : (
                      <span className="tabular-nums">{l.counted ?? "—"}</span>
                    )}
                  </td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", diff !== null && diff !== 0 && "font-semibold text-amber-800 dark:text-amber-300")}>
                    {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
