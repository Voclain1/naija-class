"use client";

import { ClipboardList, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { StoreStockTakeSummaryDto } from "@school-kit/types";

import { EmptyState, PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { STOCK_TAKE_STATUS } from "@/components/store/stock-take-status";
import { StoreNav } from "@/components/store/store-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { listStockTakes, startStockTake } from "@/lib/store/store-api";

// /store/stock-takes — counting what is really on the shelves. A count changes
// nothing until someone with the right to approve it does (the bursar, an
// admin or the owner), and then the differences become adjustments.

function formatDay(value: string | Date | null): string {
  return value ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function StockTakesPage() {
  const router = useRouter();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "store.manage");
  const [takes, setTakes] = useState<StoreStockTakeSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listStockTakes()
      .then(setTakes)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the stock takes."));
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const take = await startStockTake();
      router.push(`/store/stock-takes/${take.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start a stock take.");
      setBusy(false);
    }
  }

  const live = takes?.find((t) => t.status === "OPEN" || t.status === "SUBMITTED");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title="Stock takes"
        subtitle="Count what is on the shelves. The differences are applied only when the count is approved."
        actions={
          canManage && !live ? (
            <Button size="sm" onClick={() => void start()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
              Start a stock take
            </Button>
          ) : undefined
        }
      />
      <StoreNav />
      {error && <InlineAlert>{error}</InlineAlert>}
      {takes === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : takes.length === 0 ? (
        <EmptyState title="No stock takes yet" body="Count the store at the end of each term, or whenever the numbers look wrong." />
      ) : (
        <ul className="flex flex-col divide-y rounded-md border bg-card">
          {takes.map((t) => (
            <li key={t.id}>
              <Link href={`/store/stock-takes/${t.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent/50">
                <span className="flex flex-col">
                  <span className="font-medium">Started {formatDay(t.createdAt)}</span>
                  <span className="text-xs text-muted-foreground">
                    by {t.createdByName} · {t.counted} of {t.lines} counted
                    {t.decidedByName ? ` · ${t.status === "APPROVED" ? "approved" : "cancelled"} by ${t.decidedByName}` : ""}
                  </span>
                </span>
                <Badge variant={STOCK_TAKE_STATUS[t.status].variant}>{STOCK_TAKE_STATUS[t.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
