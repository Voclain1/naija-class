"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { RecordStoreMovementInput, StoreItemDto, StorePersonDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { formatKobo } from "@/lib/finance/format";
import { nairaInputToKobo } from "@/lib/finance/naira-input";
import { recordStoreMovement } from "@/lib/store/store-api";

import { PersonPicker } from "./person-picker";

// One form for every way stock moves (docs/modules/id-cards-and-store.md §4):
// receive from a supplier, issue to a student, staff member or department,
// sell to a student (billed on the child's next invoice), take back a return,
// or write off what was damaged or lost.

export type MovementKind = "RECEIVE" | "ISSUE" | "SELL" | "RETURN" | "WRITE_OFF";

const COPY: Record<MovementKind, { title: string; action: string; body: string }> = {
  RECEIVE: { title: "Receive stock", action: "Receive", body: "Add stock that has arrived from a supplier." },
  ISSUE: { title: "Issue from the store", action: "Issue", body: "Hand items out without charging: to a student, a member of staff or a department." },
  SELL: { title: "Sell to a student", action: "Sell and bill", body: "The amount is added to the child's bill and shows on their next invoice." },
  RETURN: { title: "Take back a return", action: "Take back", body: "Put returned items back into stock." },
  WRITE_OFF: { title: "Write off", action: "Write off", body: "Remove items that are damaged, lost or out of date. Say why." },
};

type Target = "STUDENT" | "STAFF" | "DEPARTMENT";

export function MovementDialog({
  kind,
  item,
  onClose,
  onDone,
}: {
  kind: MovementKind | null;
  item: StoreItemDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const variants = item.variants.filter((v) => v.isActive);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<Target>("STUDENT");
  const [person, setPerson] = useState<StorePersonDto | null>(null);
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind) return;
    setVariantId(variants[0]?.id ?? "");
    setQuantity("1");
    setCost("");
    setSupplier("");
    setReference("");
    setReason("");
    setTarget(kind === "SELL" ? "STUDENT" : "STUDENT");
    setPerson(null);
    setDepartment("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when the dialog opens
  }, [kind]);

  if (!kind) return null;
  const copy = COPY[kind];
  const variant = variants.find((v) => v.id === variantId);
  const qty = Number.parseInt(quantity || "0", 10);
  const price = variant?.effectivePrice ?? null;

  async function submit() {
    if (!kind || !variant) return setError("Choose the size.");
    if (!Number.isFinite(qty) || qty < 1) return setError("Enter how many, 1 or more.");
    let body: RecordStoreMovementInput;
    if (kind === "RECEIVE") {
      const unitCost = cost.trim() ? nairaInputToKobo(cost) : null;
      if (cost.trim() && unitCost === null) return setError("Enter the cost in naira, like 12,500.");
      body = { kind, variantId: variant.id, quantity: qty, unitCost, supplier: supplier || null, reference: reference || null };
    } else if (kind === "SELL") {
      if (!person) return setError("Choose the student.");
      body = { kind, variantId: variant.id, quantity: qty, studentId: person.id, reference: reference || null };
    } else if (kind === "WRITE_OFF") {
      if (!reason.trim()) return setError("Say why it is written off.");
      body = { kind, variantId: variant.id, quantity: qty, reason: reason.trim() };
    } else {
      const to =
        target === "DEPARTMENT"
          ? department.trim()
            ? { department: department.trim() }
            : null
          : person
            ? target === "STUDENT"
              ? { studentId: person.id }
              : { userId: person.id }
            : null;
      if (kind === "ISSUE" && !to) return setError("Choose who it is issued to.");
      body = { kind, variantId: variant.id, quantity: qty, ...(to ?? {}), reason: reason || null };
    }
    setBusy(true);
    setError(null);
    try {
      await recordStoreMovement(body);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {copy.title}: {item.name}
          </DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {variants.length > 1 || variants[0]?.label ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="mv-size">Size</Label>
              <select
                id="mv-size"
                value={variantId}
                onChange={(e) => setVariantId(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label ?? "—"} ({v.onHand} in stock)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{variant?.onHand ?? 0} in stock.</p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="mv-qty">How many ({item.unit}s)</Label>
            <Input id="mv-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>

          {kind === "RECEIVE" && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="mv-cost">Cost of one, in naira (optional)</Label>
                <Input id="mv-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Used for the stock's value" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="mv-supplier">Supplier (optional)</Label>
                <Input id="mv-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
            </>
          )}

          {(kind === "ISSUE" || kind === "RETURN") && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{kind === "ISSUE" ? "Issued to" : "Returned by (optional)"}</legend>
              <div className="flex flex-wrap gap-2">
                {(["STUDENT", "STAFF", "DEPARTMENT"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={target === t ? "default" : "outline"}
                    aria-pressed={target === t}
                    onClick={() => {
                      setTarget(t);
                      setPerson(null);
                    }}
                  >
                    {t === "STUDENT" ? "A student" : t === "STAFF" ? "A member of staff" : "A department"}
                  </Button>
                ))}
              </div>
              {target === "DEPARTMENT" ? (
                <Input aria-label="Department or class" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Sports, Science lab, JSS 2A" />
              ) : (
                <PersonPicker kind={target} label={target === "STUDENT" ? "Student" : "Staff member"} value={person} onChange={setPerson} />
              )}
            </fieldset>
          )}

          {kind === "SELL" && (
            <>
              <PersonPicker kind="STUDENT" label="Student" value={person} onChange={setPerson} />
              {price === null ? (
                <p className="text-sm text-destructive">This item has no selling price. Set one before selling it.</p>
              ) : (
                <p className="rounded-md bg-muted/40 p-3 text-sm">
                  {Number.isFinite(qty) && qty > 0 ? qty : 0} × {formatKobo(price)} ={" "}
                  <span className="font-semibold">{formatKobo(price * (Number.isFinite(qty) && qty > 0 ? qty : 0))}</span>, added to the
                  child&apos;s bill.
                </p>
              )}
            </>
          )}

          {(kind === "RECEIVE" || kind === "SELL") && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="mv-ref">{kind === "RECEIVE" ? "Delivery note or invoice no. (optional)" : "Receipt no. (optional)"}</Label>
              <Input id="mv-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          )}

          {(kind === "ISSUE" || kind === "RETURN" || kind === "WRITE_OFF") && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="mv-reason">{kind === "WRITE_OFF" ? "Why" : "Note (optional)"}</Label>
              <Input
                id="mv-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={kind === "WRITE_OFF" ? "e.g. Damaged by rain" : ""}
              />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || (kind === "SELL" && price === null)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
