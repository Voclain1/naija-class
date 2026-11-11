"use client";

import { Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { StoreItemSummaryDto, StorePackDto } from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { StoreNav } from "@/components/store/store-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import { createPack, listPacks, listStoreItems, updatePack } from "@/lib/store/store-api";

// /store/packs — saved lists of items sold together, such as a "JSS1 starter
// pack" of uniforms, books and stationery (docs/modules/store-orders.md). A
// pack goes into a sale in one press, or is sold to a whole class. Sizes are
// chosen per child at the sale; a pack holds items, not sizes.

interface Draft {
  id: string | null;
  name: string;
  note: string;
  isActive: boolean;
  items: Array<{ itemId: string; name: string; quantity: number }>;
}

export default function PacksPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "store.manage");
  const canSell = hasPermission(permissions, "store.sell");
  const [packs, setPacks] = useState<StorePackDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<StoreItemSummaryDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPacks(await listPacks(true));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the packs.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(pack: StorePackDto | null) {
    setFormError(null);
    setDraft(
      pack
        ? { id: pack.id, name: pack.name, note: pack.note ?? "", isActive: pack.isActive, items: pack.items.map((i) => ({ itemId: i.itemId, name: i.itemName, quantity: i.quantity })) }
        : { id: null, name: "", note: "", isActive: true, items: [] },
    );
    if (items.length === 0) {
      try {
        setItems((await listStoreItems()).filter((i) => i.isActive));
      } catch {
        setItems([]);
      }
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setFormError(null);
    const body = {
      name: draft.name.trim(),
      note: draft.note.trim() || null,
      isActive: draft.isActive,
      items: draft.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
    };
    try {
      if (draft.id) await updatePack(draft.id, body);
      else await createPack(body);
      setDraft(null);
      await load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : "Could not save the pack.");
    } finally {
      setBusy(false);
    }
  }

  const available = items.filter((i) => !draft?.items.some((d) => d.itemId === i.id));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Packs"
        subtitle="Items sold together, such as a new pupil's uniforms, books and stationery."
        actions={
          <div className="flex flex-wrap gap-2">
            {canSell && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/store/class-sale">Sell a pack to a class</Link>
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={() => void open(null)}>
                <Plus className="h-4 w-4" />
                New pack
              </Button>
            )}
          </div>
        }
      />
      <StoreNav />
      {error && <InlineAlert>{error}</InlineAlert>}

      {packs === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : packs.length === 0 ? (
        <EmptyState
          title="No packs yet"
          body={canManage ? "Make a pack for what every new pupil buys, and sell it in one press." : "The storekeeper can make packs here."}
          action={canManage ? <Button onClick={() => void open(null)}>New pack</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {packs.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-md border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 font-medium">
                    <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {p.name}
                    {!p.isActive && <Badge variant="muted">Not in use</Badge>}
                  </h2>
                  {p.note && <p className="text-xs text-muted-foreground">{p.note}</p>}
                </div>
                {canManage && (
                  <Button variant="ghost" size="sm" onClick={() => void open(p)}>
                    <Pencil className="h-4 w-4" />
                    Change
                  </Button>
                )}
              </div>
              <ul className="text-sm">
                {p.items.map((i) => (
                  <li key={i.itemId} className="flex justify-between gap-2 py-0.5">
                    <span>
                      {i.quantity} × {i.itemName}
                      {i.sizes.filter((s) => s.isActive).length > 1 && <span className="text-xs text-muted-foreground"> · size chosen at sale</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-sm font-medium">
                {p.fixedTotal !== null ? formatKobo(p.fixedTotal) : "Price depends on the sizes chosen"}
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Change pack" : "New pack"}</DialogTitle>
            <DialogDescription>Choose the items and how many of each. Sizes are picked for each child when it is sold.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Name</span>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} placeholder="e.g. JSS1 starter pack" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Note (optional)</span>
                <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={200} />
              </label>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Items</span>
                {draft.items.length === 0 && <p className="text-sm text-muted-foreground">Add at least one item.</p>}
                {draft.items.map((i) => (
                  <div key={i.itemId} className="flex items-center gap-2 text-sm">
                    <Input
                      aria-label={`How many ${i.name}`}
                      className="h-8 w-16 text-center"
                      inputMode="numeric"
                      value={i.quantity}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(1000, Number(e.target.value.replace(/\D/g, "")) || 1));
                        setDraft({ ...draft, items: draft.items.map((x) => (x.itemId === i.itemId ? { ...x, quantity: n } : x)) });
                      }}
                    />
                    <span className="flex-1">{i.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Remove ${i.name}`}
                      onClick={() => setDraft({ ...draft, items: draft.items.filter((x) => x.itemId !== i.itemId) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <select
                  aria-label="Add an item"
                  value=""
                  onChange={(e) => {
                    const it = items.find((x) => x.id === e.target.value);
                    if (it) setDraft({ ...draft, items: [...draft.items, { itemId: it.id, name: it.name, quantity: 1 }] });
                  }}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Add an item…</option>
                  {available.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              {draft.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
                  In use (offered on the Sell page)
                </label>
              )}
              {formError && <InlineAlert>{formError}</InlineAlert>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Close
            </Button>
            <Button disabled={busy || !draft?.name.trim() || !draft?.items.length} onClick={() => void save()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save pack
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
