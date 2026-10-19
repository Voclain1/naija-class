"use client";

import { ArrowLeft, Loader2, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { STORE_CATEGORY_LABELS, STORE_MOVEMENT_LABELS, type StoreItemDto } from "@school-kit/types";

import { StatGrid, StatRow } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ItemFormDialog } from "@/components/store/item-form-dialog";
import { MovementDialog, type MovementKind } from "@/components/store/movement-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import { addStoreVariant, getStoreItem, updateStoreItem } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store/items/[id] — one item: its sizes and stock, what it is worth, the
// buttons for every way stock moves, and the full history of movements.

function formatWhen(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function StoreItemPage() {
  const params = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "store.manage");
  const canSell = hasPermission(permissions, "store.sell");
  const [item, setItem] = useState<StoreItemDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<MovementKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [newSize, setNewSize] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItem(await getStoreItem(params.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this item.");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addSize() {
    if (!item || !newSize.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setItem(await addStoreVariant(item.id, { label: newSize.trim() }));
      setNewSize("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add the size.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!item) return;
    setBusy(true);
    try {
      setItem(await updateStoreItem(item.id, { isActive: !item.isActive }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not change the item.");
    } finally {
      setBusy(false);
    }
  }

  if (!item) {
    return error ? <InlineAlert>{error}</InlineAlert> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const hasSizes = item.variants.some((v) => v.label);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link href="/store" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to the store
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-medium tracking-tight">{item.name}</h1>
          <p className="text-sm text-muted-foreground">
            {STORE_CATEGORY_LABELS[item.category]}
            {item.code ? ` · ${item.code}` : ""} · counted in {item.unit}s
          </p>
          <div className="flex flex-wrap gap-2">
            {item.low && <Badge variant="warning">Running low</Badge>}
            {!item.isActive && <Badge variant="muted">Not stocked</Badge>}
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" />
              Change
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void toggleActive()} disabled={busy}>
              {item.isActive ? "Stop stocking" : "Stock again"}
            </Button>
          </div>
        )}
      </header>

      {error && <InlineAlert>{error}</InlineAlert>}

      <StatGrid>
        <StatRow value={item.onHand} label={`In stock (${item.unit}s)`} tone={item.low ? "warning" : "default"} />
        <StatRow value={item.reorderLevel || "—"} label="Reorder when down to" />
        <StatRow value={item.sellPrice === null ? "—" : formatKobo(item.sellPrice)} label="Selling price" />
        <StatRow value={formatKobo(item.stockValue)} label="Stock value at cost" />
      </StatGrid>

      {item.isActive && (canManage || canSell) && (
        <div className="flex flex-wrap gap-2">
          {canManage && <Button onClick={() => setMoving("RECEIVE")}>Receive stock</Button>}
          {canManage && (
            <Button variant="outline" onClick={() => setMoving("ISSUE")}>
              Issue
            </Button>
          )}
          {canSell && (
            <Button variant="outline" onClick={() => setMoving("SELL")}>
              Sell to a student
            </Button>
          )}
          {canManage && (
            <Button variant="outline" onClick={() => setMoving("RETURN")}>
              Take back a return
            </Button>
          )}
          {canManage && (
            <Button variant="ghost" onClick={() => setMoving("WRITE_OFF")}>
              Write off
            </Button>
          )}
        </div>
      )}

      {(hasSizes || canManage) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Sizes</h2>
          {hasSizes ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2 text-right">In stock</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Average cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {item.variants.map((v) => (
                    <tr key={v.id} className={cn(!v.isActive && "text-muted-foreground")}>
                      <td className="px-3 py-2">{v.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.onHand}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.effectivePrice === null ? "—" : formatKobo(v.effectivePrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.averageCost === null ? "—" : formatKobo(v.averageCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">This item has no sizes.</p>
          )}
          {canManage && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addSize();
              }}
            >
              <div className="flex flex-col gap-1">
                <label htmlFor="new-size" className="text-sm font-medium">
                  Add a size
                </label>
                <Input id="new-size" value={newSize} onChange={(e) => setNewSize(e.target.value)} placeholder="e.g. Size 14" className="w-48" />
              </div>
              <Button type="submit" variant="outline" disabled={busy || !newSize.trim()}>
                <Plus className="h-4 w-4" />
                Add size
              </Button>
            </form>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">History</h2>
        {item.movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has moved yet. Receive stock to begin.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">What</th>
                  {hasSizes && <th className="px-3 py-2">Size</th>}
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Who / why</th>
                  <th className="px-3 py-2">By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {item.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-3 py-2">{formatWhen(m.createdAt)}</td>
                    <td className="px-3 py-2">
                      {STORE_MOVEMENT_LABELS[m.kind]}
                      {m.kind === "SELL" && m.unitPrice !== null ? ` at ${formatKobo(m.unitPrice)}` : ""}
                      {m.kind === "RECEIVE" && m.unitCost !== null ? ` at ${formatKobo(m.unitCost)}` : ""}
                    </td>
                    {hasSizes && <td className="px-3 py-2">{m.variantLabel ?? "—"}</td>}
                    <td className={cn("px-3 py-2 text-right tabular-nums", m.quantity < 0 ? "text-foreground" : "text-emerald-700 dark:text-emerald-400")}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="px-3 py-2">{[m.party, m.supplier, m.reason, m.reference].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{m.createdByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MovementDialog
        kind={moving}
        item={item}
        onClose={() => setMoving(null)}
        onDone={() => {
          setMoving(null);
          void load();
        }}
      />
      <ItemFormDialog
        open={editing}
        item={item}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          setItem(saved);
        }}
      />
    </div>
  );
}
