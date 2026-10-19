"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { STORE_CATEGORY_LABELS, storeCategoryValues, type StoreCategory, type StoreItemSummaryDto } from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { ItemFormDialog } from "@/components/store/item-form-dialog";
import { StoreNav } from "@/components/store/store-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import type { CsvColumn } from "@/lib/csv-export";
import { formatKobo } from "@/lib/finance/format";
import { listStoreItems } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store — the school store's items and what is on the shelf
// (docs/modules/id-cards-and-store.md §4). An item at or below its reorder
// level is tinted and labelled "Low", and the dashboard counts them.

const COLUMNS: CsvColumn<StoreItemSummaryDto>[] = [
  { header: "Item", accessor: (r) => r.name },
  { header: "Code", accessor: (r) => r.code },
  { header: "Category", accessor: (r) => STORE_CATEGORY_LABELS[r.category] },
  { header: "In stock", accessor: (r) => r.onHand },
  { header: "Unit", accessor: (r) => r.unit },
  { header: "Reorder at", accessor: (r) => r.reorderLevel },
  { header: "Price (₦)", accessor: (r) => (r.sellPrice === null ? "" : (r.sellPrice / 100).toFixed(2)) },
  { header: "Stock value (₦)", accessor: (r) => (r.stockValue / 100).toFixed(2) },
];

function StorePageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "store.manage");
  const [low, setLow] = useState(params.get("low") === "true");
  const [category, setCategory] = useState<StoreCategory | "">("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<StoreItemSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await listStoreItems({ q: applied || undefined, category: category || undefined, low }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the store.");
    }
  }, [applied, category, low]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalValue = (items ?? []).reduce((n, i) => n + i.stockValue, 0);
  const lowCount = (items ?? []).filter((i) => i.low).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Store"
        subtitle="Uniforms, books, stationery and everything else the school keeps in its store."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ListExportMenu title="Store items" csvFilename="store-items.csv" columns={COLUMNS} getRows={() => items ?? []} disabled={!items?.length} />
            {canManage && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" />
                Add item
              </Button>
            )}
          </div>
        }
      />
      <StoreNav />

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q.trim());
          }}
        >
          <div className="flex flex-1 flex-col gap-1">
            <label htmlFor="store-q" className="text-sm font-medium">
              Find an item
            </label>
            <Input id="store-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or code" />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as StoreCategory | "")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All categories</option>
            {storeCategoryValues.map((c) => (
              <option key={c} value={c}>
                {STORE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant={low ? "default" : "outline"}
          aria-pressed={low}
          onClick={() => {
            setLow(!low);
            router.replace(low ? "/store" : "/store?low=true");
          }}
        >
          Running low only
        </Button>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      {items && items.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {items.length} item{items.length === 1 ? "" : "s"} · stock worth {formatKobo(totalValue)} at cost
          {lowCount > 0 ? ` · ${lowCount} running low` : ""}
        </p>
      )}

      {items === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : items.length === 0 ? (
        <EmptyState
          title={low || applied || category ? "No items match" : "The store is empty"}
          body={
            low || applied || category
              ? "Try clearing the search or the filters."
              : canManage
                ? "Add the first item: a uniform, a textbook, a ream of paper."
                : "Nothing has been added to the store yet."
          }
          action={
            canManage && !(low || applied || category) ? <Button onClick={() => setAdding(true)}>Add item</Button> : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">In stock</th>
                <th className="px-3 py-2 text-right">Reorder at</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <tr key={i.id} className={cn(i.low && "bg-amber-50 dark:bg-amber-950/30")}>
                  <td className="px-3 py-2">
                    <Link href={`/store/items/${i.id}`} className="font-medium hover:underline">
                      {i.name}
                    </Link>
                    {i.code ? <span className="ml-2 font-mono text-xs text-muted-foreground">{i.code}</span> : null}
                    {i.low && (
                      <Badge variant="warning" className="ml-2">
                        Low
                      </Badge>
                    )}
                    {!i.isActive && (
                      <Badge variant="muted" className="ml-2">
                        Not stocked
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">{STORE_CATEGORY_LABELS[i.category]}</td>
                  <td className={cn("px-3 py-2 text-right tabular-nums", i.low && "font-semibold text-amber-800 dark:text-amber-300")}>
                    {i.onHand} {i.unit}
                    {i.onHand === 1 ? "" : "s"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.reorderLevel || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.sellPrice === null ? "—" : formatKobo(i.sellPrice)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatKobo(i.stockValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ItemFormDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={(item) => {
          setAdding(false);
          router.push(`/store/items/${item.id}`);
        }}
      />
    </div>
  );
}

export default function StorePage() {
  return (
    <Suspense>
      <StorePageInner />
    </Suspense>
  );
}
