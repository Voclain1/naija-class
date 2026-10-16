"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatKobo, type CopyPlacesResultDto, type TermDto, type TransportRouteDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES, TermPicker, useTermPicker } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { copyPlaces, createRoute, listRoutes } from "@/lib/transport/transport-api";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13). The school's
// routes, how full each is in a term, a new route, and "Copy to next term".
// Every figure is the API's: seats, places taken and fees.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function TransportPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "transport.manage");
  const picker = useTermPicker();
  const [routes, setRoutes] = useState<TransportRouteDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRoutes(await listRoutes(picker.termId || undefined));
    } catch (e) {
      setError(message(e));
    }
  }, [picker.termId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-serif text-2xl font-semibold">Transport</h1>
          <p className="text-sm text-muted-foreground">
            The school&apos;s bus routes. Each route has stops, a vehicle, a driver and a fee per term; a child on a
            route is charged that fee on their invoice.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/transport/vehicles">Vehicles and drivers</Link>
        </Button>
      </div>

      {(error || picker.error) && <InlineAlert>{error ?? picker.error}</InlineAlert>}

      <TermPicker picker={picker} idPrefix="transport" />
      {!picker.termId && <p className="text-sm text-muted-foreground">Choose a term to see how full each route is.</p>}

      {!routes ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : routes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No routes yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {routes.map((r) => (
            <RouteCard key={r.id} route={r} termChosen={!!picker.termId} termId={picker.termId} />
          ))}
        </ul>
      )}

      {canManage && <NewRoute />}
      {canManage && picker.termId && <CopyToNextTerm fromTermId={picker.termId} onDone={load} />}
    </div>
  );
}

function RouteCard({ route, termChosen, termId }: { route: TransportRouteDto; termChosen: boolean; termId: string }) {
  const full = route.seats > 0 && route.placesTaken >= route.seats;
  return (
    <li className="space-y-2 rounded-md border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={`/transport/routes/${route.id}${termId ? `?termId=${termId}` : ""}`}
          className="min-w-0 break-words font-medium text-primary underline-offset-2 hover:underline"
        >
          {route.name}
        </Link>
        <span className="tabular-nums">{route.fee > 0 ? `${formatKobo(route.fee)} a term` : "Free"}</span>
      </div>
      <p className="text-muted-foreground">
        {route.vehicle ? `${route.vehicle.plate} · ${route.vehicle.seats} seats` : "No vehicle yet"}
        {" · "}
        {route.driver ? route.driver.name : "No driver yet"}
        {" · "}
        {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"}
      </p>
      {termChosen && (
        <p className={full ? "rounded bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-200" : ""}>
          {route.placesTaken} of {route.seats} seats taken{full ? " — full" : ""}
        </p>
      )}
    </li>
  );
}

function NewRoute() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return setError("Give the route a name.");
    setSaving(true);
    setError(null);
    try {
      const r = await createRoute({ name: name.trim() });
      router.push(`/transport/routes/${r.id}`);
    } catch (e) {
      setError(message(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-md border bg-card p-4"
      aria-label="New route"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <h2 className="font-medium">New route</h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="new-route-name">Route name</Label>
          <Input id="new-route-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Lekki – Ajah" />
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create route"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">You add the stops, vehicle, driver and fee on the route&apos;s page.</p>
    </form>
  );
}

function CopyToNextTerm({ fromTermId, onDone }: { fromTermId: string; onDone: () => void }) {
  const [toTermId, setToTermId] = useState("");
  // Every term of every year: the next term is often in the next year.
  const [allTerms, setAllTerms] = useState<Array<TermDto & { yearLabel: string }>>([]);
  useEffect(() => {
    listAcademicYears()
      .then((years) =>
        Promise.all(years.map(async (y) => (await listTerms(y.id)).map((t) => ({ ...t, yearLabel: y.label })))),
      )
      .then((lists) => setAllTerms(lists.flat()))
      .catch(() => setAllTerms([]));
  }, []);
  const [result, setResult] = useState<CopyPlacesResultDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = allTerms.filter((t) => t.id !== fromTermId);

  async function copy() {
    if (!toTermId) return setError("Choose the term to copy to.");
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      setResult(await copyPlaces({ fromTermId, toTermId }));
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="copy-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="copy-heading" className="font-medium">
        Copy to next term
      </h2>
      <p className="text-sm text-muted-foreground">
        Puts every child on the same route and stop in another term, as far as each route&apos;s seats allow, and
        raises that term&apos;s transport charges. Children who have left the school are not copied.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {result && (
        <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
          {result.copied} copied. {result.alreadyPlaced} already had a place, {result.routeFull} left out because the
          route was full, {result.leftSchool} had left the school.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="copy-to-term">Copy to</Label>
          <select id="copy-to-term" className={SELECT_CLASSES} value={toTermId} onChange={(e) => setToTermId(e.target.value)}>
            <option value="">Choose a term</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.yearLabel} · {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" disabled={saving} onClick={() => void copy()}>
          {saving ? "Copying…" : "Copy places"}
        </Button>
      </div>
    </section>
  );
}
