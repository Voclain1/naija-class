"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  FIXED_ASSET_CATEGORY_LABELS,
  FIXED_ASSET_CONDITION_LABELS,
  FIXED_ASSET_STATUS_LABELS,
  fixedAssetCategoryValues,
  fixedAssetConditionValues,
  type FixedAssetCategory,
  type FixedAssetCondition,
  type FixedAssetDto,
  type StorePersonDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { koboToNairaInput, nairaInputToKobo } from "@/lib/finance/naira-input";
import { createAsset, updateAsset } from "@/lib/store/store-api";

import { PersonPicker } from "./person-picker";

type LiveStatus = "IN_USE" | "IN_STORE" | "UNDER_REPAIR";
const LIVE_STATUSES: LiveStatus[] = ["IN_USE", "IN_STORE", "UNDER_REPAIR"];

// Add an asset to the register, or change one. A change of place, holder,
// condition or status is kept on the asset's history with the note.
export function AssetFormDialog({
  open,
  asset,
  onClose,
  onSaved,
}: {
  open: boolean;
  asset?: FixedAssetDto | null;
  onClose: () => void;
  onSaved: (asset: FixedAssetDto) => void;
}) {
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<FixedAssetCategory>("ICT");
  const [location, setLocation] = useState("");
  const [holderKind, setHolderKind] = useState<"NONE" | "STAFF" | "OTHER">("NONE");
  const [holder, setHolder] = useState<StorePersonDto | null>(null);
  const [holderText, setHolderText] = useState("");
  const [condition, setCondition] = useState<FixedAssetCondition>("GOOD");
  const [status, setStatus] = useState<LiveStatus>("IN_USE");
  const [serial, setSerial] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTag(asset?.tag ?? "");
    setName(asset?.name ?? "");
    setCategory(asset?.category ?? "ICT");
    setLocation(asset?.location ?? "");
    setHolderKind(asset?.assignedToUserId ? "STAFF" : asset?.assignedToText ? "OTHER" : "NONE");
    setHolder(asset?.assignedToUserId ? { id: asset.assignedToUserId, name: asset.assignedTo ?? "", detail: null } : null);
    setHolderText(asset?.assignedToText ?? "");
    setCondition(asset?.condition ?? "GOOD");
    setStatus(asset && asset.status !== "DISPOSED" ? asset.status : "IN_USE");
    setSerial(asset?.serialNumber ?? "");
    setSupplier(asset?.supplier ?? "");
    setPurchaseDate(asset?.purchaseDate ?? "");
    setCost(asset?.purchaseCost ? koboToNairaInput(asset.purchaseCost) : "");
    setNote("");
    setError(null);
  }, [open, asset]);

  async function save() {
    if (!tag.trim() || !name.trim()) return setError("Give the asset a tag number and a name.");
    const purchaseCost = cost.trim() ? nairaInputToKobo(cost) : null;
    if (cost.trim() && purchaseCost === null) return setError("Enter the cost in naira, like 450,000.");
    if (holderKind === "STAFF" && !holder) return setError("Choose the member of staff.");
    setBusy(true);
    setError(null);
    const fields = {
      tag: tag.trim(),
      name: name.trim(),
      category,
      location: location.trim() || null,
      assignedToUserId: holderKind === "STAFF" ? (holder?.id ?? null) : null,
      assignedToText: holderKind === "OTHER" ? holderText.trim() || null : null,
      condition,
      status,
      serialNumber: serial.trim() || null,
      supplier: supplier.trim() || null,
      purchaseDate: purchaseDate || null,
      purchaseCost,
    };
    try {
      onSaved(asset ? await updateAsset(asset.id, { ...fields, note: note.trim() || null }) : await createAsset(fields));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the asset.");
    } finally {
      setBusy(false);
    }
  }

  const select = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{asset ? `Change ${asset.tag}` : "Add an asset"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-tag">Tag number</Label>
            <Input id="as-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. SKA/ICT/001" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-cat">Category</Label>
            <select id="as-cat" value={category} onChange={(e) => setCategory(e.target.value as FixedAssetCategory)} className={select}>
              {fixedAssetCategoryValues.map((c) => (
                <option key={c} value={c}>
                  {FIXED_ASSET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="as-name">What it is</Label>
            <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Epson projector EB-X06" />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="as-loc">Where it is</Label>
            <Input id="as-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. ICT room, Principal's office" />
          </div>
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">Who has it</legend>
            <div className="flex flex-wrap gap-2">
              {(["NONE", "STAFF", "OTHER"] as const).map((k) => (
                <Button key={k} type="button" size="sm" variant={holderKind === k ? "default" : "outline"} aria-pressed={holderKind === k} onClick={() => setHolderKind(k)}>
                  {k === "NONE" ? "No one" : k === "STAFF" ? "A member of staff" : "A department or class"}
                </Button>
              ))}
            </div>
            {holderKind === "STAFF" && <PersonPicker kind="STAFF" label="Staff member" value={holder} onChange={setHolder} />}
            {holderKind === "OTHER" && (
              <Input aria-label="Department or class" value={holderText} onChange={(e) => setHolderText(e.target.value)} placeholder="e.g. Science department" />
            )}
          </fieldset>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-cond">Condition</Label>
            <select id="as-cond" value={condition} onChange={(e) => setCondition(e.target.value as FixedAssetCondition)} className={select}>
              {fixedAssetConditionValues.map((c) => (
                <option key={c} value={c}>
                  {FIXED_ASSET_CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-status">Status</Label>
            <select id="as-status" value={status} onChange={(e) => setStatus(e.target.value as LiveStatus)} className={select}>
              {LIVE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FIXED_ASSET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-date">Bought on (optional)</Label>
            <Input id="as-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-cost">Cost in naira (optional)</Label>
            <Input id="as-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-serial">Serial number (optional)</Label>
            <Input id="as-serial" value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="as-supplier">Supplier (optional)</Label>
            <Input id="as-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          {asset && (
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="as-note">Note for the history (optional)</Label>
              <Input id="as-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Moved for the inter-house quiz" />
            </div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {asset ? "Save changes" : "Add asset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
