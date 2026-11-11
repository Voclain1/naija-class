"use client";

import { CheckCircle2, Loader2, Minus, Package, Plus, Printer, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  STORE_COUNTER_METHOD_LABELS,
  STORE_ORDER_BILLING_LABELS,
  storeCounterMethodValues,
  type StoreCheckoutContextDto,
  type StoreCounterMethod,
  type StoreItemSummaryDto,
  type StoreOrderDto,
  type StoreOrderPreviewDto,
  type StorePackDto,
  type StorePersonDto,
  type StoreStudentBilling,
} from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { PersonPicker } from "@/components/store/person-picker";
import { StoreNav } from "@/components/store/store-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { formatKobo } from "@/lib/finance/format";
import { recordManualPayment } from "@/lib/finance/payments-api";
import {
  createStoreOrder,
  getCheckoutContext,
  getStoreItem,
  listPacks,
  listStoreItems,
  previewStoreOrder,
} from "@/lib/store/store-api";
import { cn } from "@/lib/utils";

// /store/sell — the store's till (docs/modules/store-orders.md). One sale for
// many items: choose the buyer, add items or a pack, tick what is handed over
// now, and confirm. Every price and the total come from the API's preview; the
// page adds nothing up itself. A student's order is billed as the school
// decided (fees invoice or a store invoice, which can be paid now); staff and
// walk-in buyers pay at the counter.

type BuyerKind = "STUDENT" | "STAFF" | "WALK_IN";

interface SizeOption {
  variantId: string;
  label: string | null;
  price: number | null;
  onHand: number;
}

interface CartLine {
  key: string;
  itemId: string;
  itemName: string;
  sizes: SizeOption[];
  variantId: string | null;
  quantity: number;
  collectNow: boolean;
}

function newKey() {
  return crypto.randomUUID();
}

function SellPageInner() {
  const params = useSearchParams();
  const [context, setContext] = useState<StoreCheckoutContextDto | null>(null);
  const [buyerKind, setBuyerKind] = useState<BuyerKind>("STUDENT");
  const [person, setPerson] = useState<StorePersonDto | null>(null);
  const [walkInName, setWalkInName] = useState("");
  const [billing, setBilling] = useState<StoreStudentBilling>("FEES_INVOICE");
  const [payNow, setPayNow] = useState(false);
  const [method, setMethod] = useState<StoreCounterMethod>("CASH");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [packId, setPackId] = useState<string | null>(null);
  const [packs, setPacks] = useState<StorePackDto[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<StoreItemSummaryDto[] | null>(null);
  const [preview, setPreview] = useState<StoreOrderPreviewDto | null>(null);
  const [formKey, setFormKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ order: StoreOrderDto; paymentError: string | null } | null>(null);

  useEffect(() => {
    getCheckoutContext()
      .then((c) => {
        setContext(c);
        setBilling(c.billingDefault);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not open the till."));
    listPacks()
      .then(setPacks)
      .catch(() => setPacks([]));
  }, []);

  const addItem = useCallback(async (itemId: string, preferVariant?: string) => {
    setError(null);
    try {
      const item = await getStoreItem(itemId);
      const sizes: SizeOption[] = item.variants
        .filter((v) => v.isActive)
        .map((v) => ({ variantId: v.id, label: v.label, price: v.effectivePrice, onHand: v.onHand }));
      if (sizes.length === 0) return;
      const chosen = preferVariant ?? (sizes.length === 1 ? sizes[0]!.variantId : null);
      setCart((c) => {
        const same = chosen ? c.find((l) => l.variantId === chosen) : undefined;
        if (same) return c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
        const onHand = sizes.find((s) => s.variantId === chosen)?.onHand ?? 0;
        return [...c, { key: newKey(), itemId, itemName: item.name, sizes, variantId: chosen, quantity: 1, collectNow: onHand > 0 }];
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that item.");
    }
  }, []);

  // ?item=<id> or ?variant=<id>&item=<id> from an item's page, added once per
  // address (an effect can run twice: React's development double-run, or a
  // re-render that hands back a new params object).
  const addedFromUrl = useRef<string | null>(null);
  useEffect(() => {
    const itemId = params.get("item");
    const key = itemId ? `${itemId}:${params.get("variant") ?? ""}` : null;
    if (!itemId || addedFromUrl.current === key) return;
    addedFromUrl.current = key;
    void addItem(itemId, params.get("variant") ?? undefined);
  }, [params, addItem]);

  function addPack(pack: StorePackDto) {
    setPackId(pack.id);
    setCart((c) => [
      ...c,
      ...pack.items
        .filter((i) => i.itemActive)
        .map((i) => {
          const sizes = i.sizes.filter((s) => s.isActive).map((s) => ({ variantId: s.variantId, label: s.label, price: s.price, onHand: s.onHand }));
          const chosen = sizes.length === 1 ? sizes[0]!.variantId : null;
          const onHand = sizes.find((s) => s.variantId === chosen)?.onHand ?? 0;
          return { key: newKey(), itemId: i.itemId, itemName: i.itemName, sizes, variantId: chosen, quantity: i.quantity, collectNow: onHand >= i.quantity };
        }),
    ]);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    try {
      setFound(await listStoreItems({ q: q.trim() || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not search the store.");
    }
  }

  const ready = cart.length > 0 && cart.every((l) => l.variantId);
  const duplicate = useMemo(() => {
    const ids = cart.flatMap((l) => (l.variantId ? [l.variantId] : []));
    return new Set(ids).size !== ids.length;
  }, [cart]);

  // The server prices the cart whenever it changes.
  useEffect(() => {
    if (!ready || duplicate) {
      setPreview(null);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      previewStoreOrder({ lines: cart.map((l) => ({ variantId: l.variantId!, quantity: l.quantity, collectNow: l.collectNow })) })
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [cart, ready, duplicate]);

  const previewFor = (variantId: string | null) => preview?.lines.find((l) => l.variantId === variantId);
  const buyerChosen = buyerKind === "WALK_IN" || person !== null;
  const canConfirm = ready && !duplicate && buyerChosen && preview?.total != null && !busy;
  const paying = buyerKind === "STUDENT" && billing === "STORE_INVOICE" && payNow && context?.mayRecordPayment;

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);
    try {
      const order = await createStoreOrder({
        idempotencyKey: formKey,
        buyer:
          buyerKind === "STUDENT"
            ? { kind: "STUDENT", studentId: person!.id }
            : buyerKind === "STAFF"
              ? { kind: "STAFF", userId: person!.id }
              : { kind: "WALK_IN", name: walkInName.trim() || null },
        ...(buyerKind === "STUDENT" ? { billing } : { counter: { method, reference: reference.trim() || null } }),
        ...(packId ? { packId } : {}),
        note: note.trim() || null,
        lines: cart.map((l) => ({ variantId: l.variantId!, quantity: l.quantity, collectNow: l.collectNow })),
      });
      let paymentError: string | null = null;
      if (paying && order.invoice && order.invoice.totalPaid === 0 && !order.replayed) {
        try {
          await recordManualPayment({
            invoiceId: order.invoice.id,
            amount: order.invoice.totalDue,
            method,
            paidAt: new Date().toISOString(),
            ...(reference.trim() ? { reference: reference.trim() } : {}),
            idempotencyKey: formKey,
          });
        } catch (e) {
          paymentError = e instanceof ApiError ? e.message : "The payment was not recorded.";
        }
      }
      setDone({ order, paymentError });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The sale was not recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setDone(null);
    setCart([]);
    setPackId(null);
    setPerson(null);
    setWalkInName("");
    setReference("");
    setNote("");
    setPayNow(false);
    setPreview(null);
    setFormKey(newKey());
    if (context) setBilling(context.billingDefault);
  }

  if (done) {
    const { order, paymentError } = done;
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader title="Sale recorded" subtitle={`${order.number} · ${order.buyerName}`} />
        <div className="flex flex-col gap-3 rounded-md border bg-emerald-50 p-4 dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 text-lg font-medium">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
            {formatKobo(order.total)} · {STORE_ORDER_BILLING_LABELS[order.billing]}
          </p>
          {order.billing === "FEES_INVOICE" && <p className="text-sm">It will show on the child&apos;s next fees invoice.</p>}
          {order.billing === "STORE_INVOICE" && order.invoice && (
            <p className="text-sm">
              {paying && !paymentError ? "Paid in full. A receipt goes to the family." : "A store invoice was issued for the family to pay."}{" "}
              <Link href={`/finance/invoices/${order.invoice.id}`} className="underline">
                See the invoice
              </Link>
            </p>
          )}
          {order.billing === "COUNTER" && order.counterMethod && (
            <p className="text-sm">Paid by {STORE_COUNTER_METHOD_LABELS[order.counterMethod].toLowerCase()}.</p>
          )}
          {order.toCollect > 0 && (
            <p className="text-sm">
              {order.toCollect} item{order.toCollect === 1 ? "" : "s"} still to hand over. Find them under Orders, “To collect”.
            </p>
          )}
        </div>
        {paymentError && <InlineAlert>Payment not recorded: {paymentError} Record it on the invoice.</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={reset}>
            <Plus className="h-4 w-4" />
            New sale
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/store/orders/${order.id}?print=1`}>
              <Printer className="h-4 w-4" />
              Print slip
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href={`/store/orders/${order.id}`}>Open the order</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Sell"
        subtitle="One sale for everything a buyer takes. Prices come from the store."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/store/class-sale">
              <Package className="h-4 w-4" />
              Sell a pack to a class
            </Link>
          </Button>
        }
      />
      <StoreNav />
      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        {/* Left: buyer and items */}
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 className="text-sm font-semibold">1. Who is buying?</h2>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Buyer">
              {(["STUDENT", "STAFF", "WALK_IN"] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  role="radio"
                  aria-checked={buyerKind === k}
                  variant={buyerKind === k ? "default" : "outline"}
                  onClick={() => {
                    setBuyerKind(k);
                    setPerson(null);
                  }}
                >
                  {k === "STUDENT" ? "A student" : k === "STAFF" ? "A member of staff" : "Walk-in buyer"}
                </Button>
              ))}
            </div>
            {buyerKind === "WALK_IN" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Name (optional)</span>
                <Input value={walkInName} onChange={(e) => setWalkInName(e.target.value)} maxLength={80} placeholder="e.g. Mrs Bello" />
              </label>
            ) : (
              <PersonPicker kind={buyerKind} label={buyerKind === "STUDENT" ? "Student" : "Member of staff"} value={person} onChange={setPerson} />
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 className="text-sm font-semibold">2. Add items</h2>
            {packs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {packs.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="outline" onClick={() => addPack(p)}>
                    <Package className="h-4 w-4" />
                    {p.name}
                  </Button>
                ))}
              </div>
            )}
            <form className="flex gap-2" onSubmit={(e) => void search(e)}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item by name or code" aria-label="Find an item" />
              <Button type="submit" variant="outline">
                <Search className="h-4 w-4" />
                Find
              </Button>
            </form>
            {found && (
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
                {found.filter((i) => i.isActive).length === 0 && <li className="px-3 py-2 text-muted-foreground">Nothing matches.</li>}
                {found
                  .filter((i) => i.isActive)
                  .map((i) => (
                    <li key={i.id}>
                      <button type="button" onClick={() => void addItem(i.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-accent">
                        <span>
                          <span className="font-medium">{i.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            · {i.onHand} in stock{i.sizes > 1 ? ` · ${i.sizes} sizes` : ""}
                          </span>
                        </span>
                        <span className="tabular-nums">{i.sellPrice === null ? "" : formatKobo(i.sellPrice)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>

        {/* Right: the cart and payment */}
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 className="text-sm font-semibold">3. The sale</h2>
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing added yet. Find an item or press a pack.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {cart.map((l) => {
                  const p = previewFor(l.variantId);
                  return (
                    <li key={l.key} className="flex flex-col gap-2 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-col">
                          <span className="font-medium">{l.itemName}</span>
                          {p?.unitPrice != null && <span className="text-xs text-muted-foreground">{formatKobo(p.unitPrice)} each</span>}
                        </div>
                        <span className="tabular-nums">{p?.amount != null ? formatKobo(p.amount) : ""}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        {l.sizes.length > 1 || l.sizes[0]?.label ? (
                          <select
                            aria-label={`Size of ${l.itemName}`}
                            value={l.variantId ?? ""}
                            onChange={(e) => {
                              const v = e.target.value || null;
                              const onHand = l.sizes.find((s) => s.variantId === v)?.onHand ?? 0;
                              setCart((c) => c.map((x) => (x.key === l.key ? { ...x, variantId: v, collectNow: onHand >= x.quantity } : x)));
                            }}
                            className={cn("h-8 rounded-md border border-input bg-background px-2 text-sm", !l.variantId && "border-amber-500")}
                          >
                            <option value="">Choose a size</option>
                            {l.sizes.map((s) => (
                              <option key={s.variantId} value={s.variantId}>
                                {s.label ?? "Standard"} · {s.onHand} in stock
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            aria-label={`One fewer ${l.itemName}`}
                            onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <Input
                            aria-label={`How many ${l.itemName}`}
                            className="h-8 w-14 text-center"
                            inputMode="numeric"
                            value={l.quantity}
                            onChange={(e) => {
                              const n = Math.max(1, Math.min(1000, Number(e.target.value.replace(/\D/g, "")) || 1));
                              setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: n } : x)));
                            }}
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            aria-label={`One more ${l.itemName}`}
                            onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(1000, x.quantity + 1) } : x)))}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={l.collectNow}
                            onChange={(e) => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, collectNow: e.target.checked } : x)))}
                          />
                          Hand over now
                        </label>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="ml-auto h-8 w-8"
                          aria-label={`Remove ${l.itemName}`}
                          onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {!l.collectNow && <span className="text-xs text-muted-foreground">Waits under Orders, “To collect”, until it is handed over.</span>}
                      {p?.problem && <span className="text-sm text-amber-800 dark:text-amber-300">{p.problem}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            {duplicate && <p className="text-sm text-amber-800 dark:text-amber-300">The same item and size is in the sale twice. Remove one and change the quantity.</p>}
            {!ready && cart.length > 0 && <p className="text-sm text-amber-800 dark:text-amber-300">Choose a size for every item.</p>}
            <div className="flex items-center justify-between border-t pt-3 text-lg font-medium">
              <span>Total</span>
              <span className="tabular-nums">{preview?.total != null ? formatKobo(preview.total) : "—"}</span>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
            <h2 className="text-sm font-semibold">4. Payment</h2>
            {buyerKind === "STUDENT" ? (
              <>
                {context?.sellerMayChooseBilling ? (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How it is billed">
                    {(["FEES_INVOICE", "STORE_INVOICE"] as const).map((b) => (
                      <Button key={b} type="button" size="sm" role="radio" aria-checked={billing === b} variant={billing === b ? "default" : "outline"} onClick={() => setBilling(b)}>
                        {b === "FEES_INVOICE" ? "Add to the fees invoice" : "Separate store invoice"}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm">
                    <Badge variant="muted">{STORE_ORDER_BILLING_LABELS[billing]}</Badge>{" "}
                    <span className="text-muted-foreground">as your school decided.</span>
                  </p>
                )}
                {billing === "FEES_INVOICE" ? (
                  <p className="text-sm text-muted-foreground">The total joins the child&apos;s school fees for this term.</p>
                ) : context?.mayRecordPayment ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />
                    The parent is paying now
                  </label>
                ) : (
                  <p className="text-sm text-muted-foreground">A store invoice is issued; the bursar records the payment.</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Staff and walk-in buyers pay at the counter.</p>
            )}
            {(buyerKind !== "STUDENT" || paying) && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">Paid by</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value as StoreCounterMethod)} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                    {storeCounterMethodValues.map((m) => (
                      <option key={m} value={m}>
                        {STORE_COUNTER_METHOD_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
                {method !== "CASH" && (
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    <span className="font-medium">Reference (optional)</span>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="POS or transfer reference" />
                  </label>
                )}
              </div>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Note (optional)</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </label>
            <Button size="lg" disabled={!canConfirm} onClick={() => void confirm()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {preview?.total != null ? `Confirm sale · ${formatKobo(preview.total)}` : "Confirm sale"}
            </Button>
            {!buyerChosen && <p className="text-xs text-muted-foreground">Choose who is buying first.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function SellPage() {
  return (
    <Suspense>
      <SellPageInner />
    </Suspense>
  );
}
