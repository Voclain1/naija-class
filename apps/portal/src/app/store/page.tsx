"use client";

// The school store's price list for parents (2026-10-19,
// docs/modules/id-cards-and-store.md §4b): what the store sells and for how
// much, by size, available or not. Read-only: buying is done at the school.

import Link from "@/components/portal-link";
import { useEffect, useState } from "react";

import { STORE_CATEGORY_LABELS, formatKobo, type PortalStorePriceListDto } from "@school-kit/types";

import { Appear, EmptyState, PageHeader, PageSkeleton } from "@school-kit/ui";

import { SchoolBanner } from "@/components/school-banner";
import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";
import { usePortalRouter } from "@/lib/portal-router";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; list: PortalStorePriceListDto };

export default function StorePricesPage() {
  const router = usePortalRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/portal/store/prices");
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 401) {
          router.replace(buildLoginUrl({ reason: reasonFromErrorCode(errorCodeFromBody(body)), next: window.location.pathname }));
          return;
        }
        if (!res.ok) {
          if (!cancelled) setState({ kind: "error", message: "Could not load the price list. Try again in a moment." });
          return;
        }
        if (!cancelled) setState({ kind: "loaded", list: body as PortalStorePriceListDto });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <SchoolBanner />
      <div className="flex flex-col gap-2">
        <Link href="/" className="self-start text-sm text-muted-foreground hover:underline">
          ← Your children
        </Link>
        <PageHeader
          title="School store prices"
          subtitle="What the school store sells and the price. Buy at the school; the amount goes on your child's bill."
          actions={<SignOutButton />}
        />
      </div>

      {state.kind === "loading" && <PageSkeleton rows={3} />}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      {state.kind === "loaded" && !state.list.shown && (
        <EmptyState title="The school has not shared its store prices." body="Ask the school office for the price of anything you need." />
      )}
      {state.kind === "loaded" && state.list.shown && state.list.items.length === 0 && (
        <EmptyState title="No prices yet." body="Items appear here once the school sets their selling price." />
      )}
      {state.kind === "loaded" && state.list.shown && state.list.items.length > 0 && (
        <Appear className="flex flex-col gap-3">
          {state.list.items.map((item) => (
            <section key={item.id} aria-label={item.name} className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">{item.name}</h2>
                <span className="text-xs text-muted-foreground">{STORE_CATEGORY_LABELS[item.category]}</span>
              </div>
              <ul className="flex flex-col divide-y text-sm">
                {item.sizes.map((size, i) => (
                  <li key={`${size.label ?? ""}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span>{size.label ?? `Per ${item.unit}`}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{formatKobo(size.price)}</span>
                      <span
                        className={
                          size.available
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        }
                      >
                        {size.available ? "Available" : "Out of stock"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </Appear>
      )}
    </main>
  );
}
