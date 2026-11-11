"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { STORE_ORDER_BILLING_LABELS, type StoreOrderSummaryDto } from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { StoreNav } from "@/components/store/store-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import type { CsvColumn } from "@/lib/csv-export";
import { formatKobo } from "@/lib/finance/format";
import { listStoreOrders } from "@/lib/store/store-api";
import { invoiceLabel } from "@/lib/store/order-labels";
import { cn } from "@/lib/utils";

// /store/orders — every sale, newest first (docs/modules/store-orders.md).
// "To collect" shows orders with items still to hand over: uniforms paid for
// before they arrived, a class's packs, anything not taken at the counter.

const COLUMNS: CsvColumn<StoreOrderSummaryDto>[] = [
  { header: "Order", accessor: (r) => r.number },
  { header: "Date", accessor: (r) => new Date(r.createdAt).toISOString().slice(0, 10) },
  { header: "Buyer", accessor: (r) => r.buyerName },
  { header: "Admission no. / class", accessor: (r) => r.buyerDetail },
  { header: "Billed", accessor: (r) => STORE_ORDER_BILLING_LABELS[r.billing] },
  { header: "Total (₦)", accessor: (r) => (r.total / 100).toFixed(2) },
  { header: "Items", accessor: (r) => r.itemCount },
  { header: "To collect", accessor: (r) => r.toCollect },
  { header: "Status", accessor: (r) => (r.status === "CANCELLED" ? "Cancelled" : "Active") },
];

function formatDay(value: string | Date) {
  return new Date(value).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function OrdersPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { permissions } = useAuth();
  const canSell = hasPermission(permissions, "store.sell");
  const [toCollect, setToCollect] = useState(params.get("toCollect") === "true");
  const classSaleId = params.get("classSale") ?? undefined;
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [orders, setOrders] = useState<StoreOrderSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders(await listStoreOrders({ toCollect, q: applied || undefined, from: from || undefined, to: to || undefined, classSaleId }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the orders.");
    }
  }, [toCollect, applied, from, to, classSaleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Store orders"
        subtitle="Every sale, and what is still to be handed over."
        actions={
          <div className="flex flex-wrap gap-2">
            <ListExportMenu title="Store orders" csvFilename="store-orders.csv" columns={COLUMNS} getRows={() => orders ?? []} disabled={!orders?.length} />
            {canSell && (
              <Button size="sm" asChild>
                <Link href="/store/sell">New sale</Link>
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
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium">Find an order</span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buyer's name, admission number or SO-number" />
          </label>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">From</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">To</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button
          variant={toCollect ? "default" : "outline"}
          aria-pressed={toCollect}
          onClick={() => {
            setToCollect(!toCollect);
            router.replace(toCollect ? "/store/orders" : "/store/orders?toCollect=true");
          }}
        >
          To collect
        </Button>
      </div>
      {classSaleId && (
        <p className="text-sm text-muted-foreground">
          Showing one class sale.{" "}
          <Link href="/store/orders" className="underline">
            Show all orders
          </Link>
        </p>
      )}

      {error && <InlineAlert>{error}</InlineAlert>}

      {orders === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : orders.length === 0 ? (
        <EmptyState
          title={toCollect ? "Nothing waiting to be collected" : "No orders yet"}
          body={toCollect ? "Every order has been handed over." : "Sales made on the Sell page appear here."}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Buyer</th>
                <th className="px-3 py-2">Billed</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">To collect</th>
                <th className="px-3 py-2">When</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((o) => {
                const inv = invoiceLabel(o);
                return (
                  <tr key={o.id} className={cn(o.status === "CANCELLED" && "text-muted-foreground")}>
                    <td className="px-3 py-2">
                      <Link href={`/store/orders/${o.id}`} className="font-mono font-medium hover:underline">
                        {o.number}
                      </Link>
                      {o.status === "CANCELLED" && (
                        <Badge variant="muted" className="ml-2">
                          Cancelled
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-medium">{o.buyerName}</span>
                      {o.buyerDetail && <span className="block text-xs text-muted-foreground">{o.buyerDetail}</span>}
                      {o.packName && <span className="block text-xs text-muted-foreground">{o.packName}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {STORE_ORDER_BILLING_LABELS[o.billing]}
                      {inv && o.status === "ACTIVE" && (
                        <Badge variant={inv.tone} className="ml-2">
                          {inv.text}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatKobo(o.total)}</td>
                    <td className={cn("px-3 py-2 text-right tabular-nums", o.toCollect > 0 && "font-semibold text-amber-800 dark:text-amber-300")}>
                      {o.toCollect || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">{formatDay(o.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function StoreOrdersPage() {
  return (
    <Suspense>
      <OrdersPageInner />
    </Suspense>
  );
}
