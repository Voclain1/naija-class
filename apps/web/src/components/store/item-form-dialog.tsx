"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { STORE_CATEGORY_LABELS, storeCategoryValues, type StoreCategory, type StoreItemDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { koboToNairaInput, nairaInputToKobo } from "@/lib/finance/naira-input";
import { createStoreItem, updateStoreItem } from "@/lib/store/store-api";

// Add an item, or change one. Sizes are typed once, separated by commas, when
// the item is added; more can be added later on the item's page.
export function ItemFormDialog({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item?: StoreItemDto | null;
  onClose: () => void;
  onSaved: (item: StoreItemDto) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState<StoreCategory>("UNIFORM");
  const [unit, setUnit] = useState("piece");
  const [reorder, setReorder] = useState("0");
  const [price, setPrice] = useState("");
  const [sizes, setSizes] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setCode(item?.code ?? "");
    setCategory(item?.category ?? "UNIFORM");
    setUnit(item?.unit ?? "piece");
    setReorder(String(item?.reorderLevel ?? 0));
    setPrice(item?.sellPrice ? koboToNairaInput(item.sellPrice) : "");
    setSizes("");
    setNotes(item?.notes ?? "");
    setError(null);
  }, [open, item]);

  async function save() {
    const reorderLevel = Number.parseInt(reorder || "0", 10);
    if (!name.trim()) return setError("Give the item a name.");
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) return setError("The reorder level is a whole number, 0 or more.");
    const sellPrice = price.trim() ? nairaInputToKobo(price) : null;
    if (price.trim() && (sellPrice === null || sellPrice <= 0)) return setError("Enter the price in naira, like 15,000.");
    setBusy(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        code: code.trim() || null,
        category,
        unit: unit.trim() || "piece",
        reorderLevel,
        sellPrice,
        notes: notes.trim() || null,
      };
      const saved = item
        ? await updateStoreItem(item.id, body)
        : await createStoreItem({
            ...body,
            variants: sizes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? `Change ${item.name}` : "Add an item"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="item-name">Name</Label>
            <Input id="item-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. School blazer" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-category">Category</Label>
            <select
              id="item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as StoreCategory)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {storeCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {STORE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-code">Code (optional)</Label>
            <Input id="item-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. BLZ" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-unit">Counted in</Label>
            <Input id="item-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="piece, pack, box, ream" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="item-reorder">Reorder when down to</Label>
            <Input id="item-reorder" inputMode="numeric" value={reorder} onChange={(e) => setReorder(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="item-price">Selling price in naira (optional)</Label>
            <Input id="item-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Leave empty if it is not sold to students" />
          </div>
          {!item && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="item-sizes">Sizes (optional)</Label>
              <Input id="item-sizes" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="e.g. Size 8, Size 10, Size 12" />
              <p className="text-xs text-muted-foreground">Separate sizes with commas. Stock is kept for each size.</p>
            </div>
          )}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="item-notes">Notes (optional)</Label>
            <Input id="item-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {item ? "Save changes" : "Add item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
