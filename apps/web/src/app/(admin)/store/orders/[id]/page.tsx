"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { STORE_COUNTER_METHOD_LABELS, STORE_ORDER_BILLING_LABELS, type StoreOrderDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";
import { invoiceLabel } from "@/lib/store/order-labels";
import { cancelStoreOrder, collectStoreOrder, getStoreOrder } from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store/orders/[id] — one order: what was bought, how it was billed, and what
// is still to be handed over. "Hand over" records the hand-over (stock leaves
// then). The page prints as a slip for the buyer (?print=1 opens the print
// dialog straight away).

function formatWhen(value: string | Date): string {
  return new Date(value).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function OrderPageInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const { permissions, school } = useAuth();
  const canHandOver = hasPermission(permissions, "store.manage") || hasPermission(permissions, "store.sell");
  const canSell = hasPermission(permissions, "store.sell");
  const [order, setOrder] = useState<StoreOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [give, setGive] = useState<Record<string, number>>({});
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const printed = useRef(false);

  const load = useCallback(async () => {
    try {
      const o = await getStoreOrder(params.id);
      setOrder(o);
      setGive(Object.fromEntries(o.lines.map((l) => [l.id, Math.min(l.toCollect, Math.max(l.onHand, 0))])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this order.");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (order && search.get("print") === "1" && !printed.current) {
      printed.current = true;
      window.setTimeout(() => window.print(), 300);
    }
  }, [order, search]);

  async function handOver(only?: string) {
    if (!order) return;
    const lines = order.lines
      .filter((l) => (only ? l.id === only : true))
      .map((l) => ({ lineId: l.id, quantity: give[l.id] ?? 0 }))
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const o = await collectStoreOrder(order.id, { lines });
      setOrder(o);
      setGive(Object.fromEntries(o.lines.map((l) => [l.id, Math.min(l.toCollect, Math.max(l.onHand, 0))])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record the hand-over.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!order || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await cancelStoreOrder(order.id, reason.trim()));
      setCancelling(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not cancel the order.");
      setCancelling(false);
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return error ? <InlineAlert>{error}</InlineAlert> : <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  const inv = invoiceLabel(order);
  const active = order.status === "ACTIVE";
  const handedOverAny = order.lines.some((l) => l.collected > 0);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link href="/store/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" />
        Back to orders
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          {school?.name && <p className="hidden text-sm font-medium print:block">{school.name} · School store</p>}
          <h1 className="font-serif text-2xl font-medium tracking-tight">
            Order <span className="font-mono">{order.number}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {order.buyerName}
            {order.buyerDetail ? ` · ${order.buyerDetail}` : ""} · {formatWhen(order.createdAt)} · sold by {order.createdByName}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{STORE_ORDER_BILLING_LABELS[order.billing]}</Badge>
            {inv && active && <Badge variant={inv.tone}>{inv.text}</Badge>}
            {!active && <Badge variant="muted">Cancelled</Badge>}
            {order.packName && <Badge variant="muted">{order.packName}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print slip
          </Button>
          {canSell && active && !handedOverAny && (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
              Cancel order
            </Button>
          )}
        </div>
      </header>

      {error && <InlineAlert>{error}</InlineAlert>}

      {!active && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          Cancelled{order.cancelledByName ? ` by ${order.cancelledByName}` : ""}
          {order.cancelledAt ? ` on ${formatWhen(order.cancelledAt)}` : ""}: {order.cancelReason}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Handed over</th>
              {active && canHandOver && order.toCollect > 0 && <th className="px-3 py-2 print:hidden">Hand over now</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.lines.map((l) => (
              <tr key={l.id} className={cn(l.toCollect > 0 && "bg-amber-50 dark:bg-amber-950/30")}>
                <td className="px-3 py-2">
                  <span className="font-medium">{l.itemName}</span>
                  {l.variantLabel && <span className="text-muted-foreground"> ({l.variantLabel})</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKobo(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatKobo(l.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.collected} of {l.quantity}
                  {l.toCollect > 0 && <span className="block text-xs text-amber-800 dark:text-amber-300">{l.toCollect} to collect</span>}
                </td>
                {active && canHandOver && order.toCollect > 0 && (
                  <td className="px-3 py-2 print:hidden">
                    {l.toCollect > 0 ? (
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`How many ${l.itemName} to hand over`}
                          className="h-8 w-16 text-center"
                          inputMode="numeric"
                          value={give[l.id] ?? 0}
                          onChange={(e) => {
                            const n = Math.max(0, Math.min(l.toCollect, Number(e.target.value.replace(/\D/g, "")) || 0));
                            setGive((g) => ({ ...g, [l.id]: n }));
                          }}
                        />
                        <span className="text-xs text-muted-foreground">{l.onHand} in store</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Done</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="px-3 py-2" colSpan={3}>
                Total
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{formatKobo(order.total)}</td>
              <td />
              {active && canHandOver && order.toCollect > 0 && <td className="print:hidden" />}
            </tr>
          </tfoot>
        </table>
      </div>

      {active && canHandOver && order.toCollect > 0 && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button disabled={busy || Object.values(give).every((n) => !n)} onClick={() => void handOver()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Record hand-over
          </Button>
          <span className="text-sm text-muted-foreground">Stock leaves the store when you record it.</span>
        </div>
      )}

      <section className="flex flex-col gap-1 text-sm">
        {order.billing === "COUNTER" && order.counterMethod && (
          <p>
            Paid at the counter by {STORE_COUNTER_METHOD_LABELS[order.counterMethod].toLowerCase()}
            {order.counterReference ? ` (ref. ${order.counterReference})` : ""}.
          </p>
        )}
        {order.billing === "FEES_INVOICE" && (
          <p>
            Billed on the child&apos;s fees invoice
            {order.billedCharges > 0 ? " (already on an invoice)." : " (joins the next fees invoice)."}
          </p>
        )}
        {order.billing === "STORE_INVOICE" && order.invoice && (
          <p>
            Store invoice: {formatKobo(order.invoice.totalPaid)} paid of {formatKobo(order.invoice.totalDue)}.{" "}
            <Link href={`/finance/invoices/${order.invoice.id}`} className="underline print:hidden">
              Open the invoice to record or see payments
            </Link>
          </p>
        )}
        {order.note && <p className="text-muted-foreground">Note: {order.note}</p>}
      </section>

      <Dialog open={cancelling} onOpenChange={(o) => !o && setCancelling(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {order.number}?</DialogTitle>
            <DialogDescription>
              {order.billing === "COUNTER"
                ? "Give the buyer their money back. The order stays on record as cancelled."
                : order.billing === "STORE_INVOICE"
                  ? "The store invoice is cancelled too. You cannot cancel once it has a payment."
                  : "The amount comes off the child's bill. If it is already on a fees invoice, the bursar cancels that invoice first."}
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Why?</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Wrong size chosen" />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>
              Keep the order
            </Button>
            <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => void cancel()}>
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function StoreOrderPage() {
  return (
    <Suspense>
      <OrderPageInner />
    </Suspense>
  );
}
