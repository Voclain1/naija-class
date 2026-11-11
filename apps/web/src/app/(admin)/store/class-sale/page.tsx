"use client";

import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  STORE_ORDER_BILLING_LABELS,
  type ClassArmDto,
  type ClassSalePreviewDto,
  type ClassSaleResultDto,
  type StoreCheckoutContextDto,
  type StorePackDto,
  type StoreStudentBilling,
} from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { listClassArms } from "@/lib/class-arms/class-arms-api";
import { formatKobo } from "@/lib/finance/format";
import { createClassSale, getCheckoutContext, listPacks, previewClassSale } from "@/lib/store/store-api";

// /store/class-sale — one pack to a whole class at once (docs/modules/store-orders.md):
// each chosen child gets their own order, billed as the school decided, with
// everything waiting to be handed over. Children who already have this pack
// are left unticked. Items with sizes need a size for every child.

export default function ClassSalePage() {
  const [arms, setArms] = useState<ClassArmDto[]>([]);
  const [packs, setPacks] = useState<StorePackDto[]>([]);
  const [context, setContext] = useState<StoreCheckoutContextDto | null>(null);
  const [armId, setArmId] = useState("");
  const [packId, setPackId] = useState("");
  const [preview, setPreview] = useState<ClassSalePreviewDto | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [sizes, setSizes] = useState<Record<string, Record<string, string>>>({});
  const [billing, setBilling] = useState<StoreStudentBilling>("FEES_INVOICE");
  const [formKey, setFormKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ClassSaleResultDto | null>(null);

  useEffect(() => {
    listClassArms()
      .then((a) => setArms(a.filter((x) => x.isActive)))
      .catch(() => setArms([]));
    listPacks()
      .then(setPacks)
      .catch(() => setPacks([]));
    getCheckoutContext()
      .then((c) => {
        setContext(c);
        setBilling(c.billingDefault);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "You cannot sell from the store."));
  }, []);

  useEffect(() => {
    setPreview(null);
    if (!armId || !packId) return;
    let live = true;
    previewClassSale({ classArmId: armId, packId })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setChosen(new Set(p.children.filter((c) => !c.alreadyBought).map((c) => c.studentId)));
        setSizes({});
        setFormKey(crypto.randomUUID());
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : "Could not load the class."));
    return () => {
      live = false;
    };
  }, [armId, packId]);

  const sized = useMemo(() => (preview?.pack.items ?? []).filter((i) => i.sizes.filter((s) => s.isActive).length > 1), [preview]);
  const missing = useMemo(
    () => [...chosen].filter((sid) => sized.some((i) => !sizes[sid]?.[i.itemId])).length,
    [chosen, sized, sizes],
  );

  function setAll(itemId: string, variantId: string) {
    setSizes((s) => {
      const next = { ...s };
      for (const sid of chosen) next[sid] = { ...next[sid], [itemId]: variantId };
      return next;
    });
  }

  async function confirm() {
    if (!preview || chosen.size === 0 || missing > 0) return;
    setBusy(true);
    setError(null);
    try {
      setDone(
        await createClassSale({
          idempotencyKey: formKey,
          classArmId: armId,
          packId,
          billing,
          children: [...chosen].map((studentId) => ({
            studentId,
            sizes: Object.entries(sizes[studentId] ?? {}).map(([itemId, variantId]) => ({ itemId, variantId })),
          })),
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The class sale was not recorded.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader title="Class sale recorded" subtitle={`${preview?.pack.name ?? "Pack"} · ${preview?.classArmName ?? ""}`} />
        <div className="flex items-center gap-2 rounded-md border bg-emerald-50 p-4 text-lg font-medium dark:bg-emerald-950/30">
          <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          {done.orders} order{done.orders === 1 ? "" : "s"} · {formatKobo(done.total)} · {STORE_ORDER_BILLING_LABELS[billing]}
        </div>
        <p className="text-sm text-muted-foreground">Everything waits to be handed over. Record it on each order as children collect.</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/store/orders?classSale=${done.classSaleId}`}>See these orders</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/store/sell">Back to the till</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Link href="/store/sell" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back to the till
      </Link>
      <PageHeader title="Sell a pack to a class" subtitle="Each child gets their own order. Hand items over as they collect them." />
      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="flex flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Class</span>
          <select value={armId} onChange={(e) => setArmId(e.target.value)} className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Choose a class</option>
            {arms.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Pack</span>
          <select value={packId} onChange={(e) => setPackId(e.target.value)} className="h-9 min-w-48 rounded-md border border-input bg-background px-2 text-sm">
            <option value="">Choose a pack</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {packs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No packs yet.{" "}
            <Link href="/store/packs" className="underline">
              Make one
            </Link>
            .
          </p>
        )}
      </div>

      {preview && (
        <>
          <div className="flex flex-col gap-2 rounded-md border bg-card p-4 text-sm">
            <p>
              <span className="font-medium">{preview.pack.name}:</span>{" "}
              {preview.pack.items.map((i) => `${i.quantity} × ${i.itemName}`).join(", ")}
            </p>
            <p className="text-muted-foreground">
              {preview.pack.fixedTotal !== null ? `${formatKobo(preview.pack.fixedTotal)} per child.` : "The price depends on the sizes chosen."}
            </p>
            {sized.length > 0 && chosen.size > 0 && (
              <div className="flex flex-wrap gap-3">
                {sized.map((i) => (
                  <label key={i.itemId} className="flex items-center gap-2">
                    <span>Set every chosen child&apos;s {i.itemName} to</span>
                    <select
                      value=""
                      onChange={(e) => e.target.value && setAll(i.itemId, e.target.value)}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">…</option>
                      {i.sizes
                        .filter((s) => s.isActive)
                        .map((s) => (
                          <option key={s.variantId} value={s.variantId}>
                            {s.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>

          {preview.children.length === 0 ? (
            <InlineAlert>No children are enrolled in {preview.classArmName} this term.</InlineAlert>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Choose every child"
                        className="h-4 w-4"
                        checked={chosen.size === preview.children.length}
                        onChange={(e) => setChosen(e.target.checked ? new Set(preview.children.map((c) => c.studentId)) : new Set())}
                      />
                    </th>
                    <th className="px-3 py-2">Child</th>
                    {sized.map((i) => (
                      <th key={i.itemId} className="px-3 py-2">
                        {i.itemName} size
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {preview.children.map((c) => {
                    const on = chosen.has(c.studentId);
                    return (
                      <tr key={c.studentId}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Sell to ${c.name}`}
                            className="h-4 w-4"
                            checked={on}
                            onChange={(e) =>
                              setChosen((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(c.studentId);
                                else next.delete(c.studentId);
                                return next;
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{c.name}</span>
                          {c.admissionNumber && <span className="text-xs text-muted-foreground"> · {c.admissionNumber}</span>}
                          {c.alreadyBought && (
                            <Badge variant="muted" className="ml-2">
                              Already has this pack
                            </Badge>
                          )}
                        </td>
                        {sized.map((i) => (
                          <td key={i.itemId} className="px-3 py-2">
                            <select
                              aria-label={`${i.itemName} size for ${c.name}`}
                              disabled={!on}
                              value={sizes[c.studentId]?.[i.itemId] ?? ""}
                              onChange={(e) => setSizes((s) => ({ ...s, [c.studentId]: { ...s[c.studentId], [i.itemId]: e.target.value } }))}
                              className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                            >
                              <option value="">Choose</option>
                              {i.sizes
                                .filter((s) => s.isActive)
                                .map((s) => (
                                  <option key={s.variantId} value={s.variantId}>
                                    {s.label}
                                  </option>
                                ))}
                            </select>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-md border bg-card p-4">
            {context?.sellerMayChooseBilling ? (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How it is billed">
                {(["FEES_INVOICE", "STORE_INVOICE"] as const).map((b) => (
                  <Button key={b} type="button" size="sm" role="radio" aria-checked={billing === b} variant={billing === b ? "default" : "outline"} onClick={() => setBilling(b)}>
                    {b === "FEES_INVOICE" ? "Add to each child's fees invoice" : "A store invoice for each child"}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm">
                Billed: <Badge variant="muted">{STORE_ORDER_BILLING_LABELS[billing]}</Badge>
              </p>
            )}
            {missing > 0 && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {missing} chosen child{missing === 1 ? " needs" : "ren need"} a size.
              </p>
            )}
            <Button size="lg" disabled={busy || chosen.size === 0 || missing > 0} onClick={() => void confirm()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Sell to {chosen.size} child{chosen.size === 1 ? "" : "ren"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
