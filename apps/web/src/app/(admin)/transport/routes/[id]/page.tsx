"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatKobo,
  formatMinuteOfDay,
  parseMinuteOfDay,
  type StudentDto,
  type TransportDriverDto,
  type TransportPlaceDto,
  type TransportRouteDto,
  type TransportVehicleDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES, TermPicker, useTermPicker } from "@/components/transport/term-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { nairaInputToKobo } from "@/lib/finance/naira-input";
import { listStudents } from "@/lib/students/students-api";
import {
  createPlace,
  deleteRoute,
  getRoute,
  listDrivers,
  listPlaces,
  listRoutes,
  listVehicles,
  movePlace,
  removePlace,
  setRouteFee,
  setStops,
  updateRoute,
} from "@/lib/transport/transport-api";

// Phase 9 / CP5.2 — one route (docs/modules/phase-9.md §13 CP5-D7/D8). Its
// vehicle and driver, its fee per term (set here and nowhere else — owner,
// 2026-10-14), its stops in order, and the children on it in a term. Every
// amount and seat count is the API's.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function RoutePage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "transport.manage");
  const canSetFee = hasPermission(permissions, "charge.raise");
  const [route, setRoute] = useState<TransportRouteDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRoute(await getRoute(id));
    } catch (e) {
      setError(message(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (error && !route) return <InlineAlert>{error}</InlineAlert>;
  if (!route) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/transport" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Transport
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="break-words font-serif text-2xl font-semibold">{route.name}</h1>
          <Button asChild size="sm" variant="outline">
            <Link href={`/transport/routes/${route.id}/daily`}>Today&apos;s list</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {route.fee > 0 ? `${formatKobo(route.fee)} a term` : "Free"} ·{" "}
          {route.vehicle ? `${route.vehicle.plate}, ${route.vehicle.seats} seats` : "no vehicle yet"} ·{" "}
          {route.driver ? (
            <>
              {route.driver.name},{" "}
              <a href={`tel:${route.driver.phone}`} className="underline-offset-2 hover:underline">
                {route.driver.phone}
              </a>
            </>
          ) : (
            "no driver yet"
          )}
        </p>
      </div>

      {canManage && <Details route={route} onSaved={setRoute} />}
      {(canSetFee || route.fee > 0) && <Fee route={route} canSet={canSetFee} onSaved={setRoute} />}
      <Stops route={route} canManage={canManage} onSaved={setRoute} />
      <Children route={route} canManage={canManage} />
      {canManage && <DeleteRoute route={route} />}
    </div>
  );
}

// ─── Vehicle and driver ─────────────────────────────────────────────────────

function Details({ route, onSaved }: { route: TransportRouteDto; onSaved: (r: TransportRouteDto) => void }) {
  const [vehicles, setVehicles] = useState<TransportVehicleDto[]>([]);
  const [drivers, setDrivers] = useState<TransportDriverDto[]>([]);
  const [name, setName] = useState(route.name);
  const [vehicleId, setVehicleId] = useState(route.vehicle?.id ?? "");
  const [driverId, setDriverId] = useState(route.driver?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([listVehicles(), listDrivers()])
      .then(([v, d]) => {
        setVehicles(v);
        setDrivers(d);
      })
      .catch((e: unknown) => setError(message(e)));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await updateRoute(route.id, { name: name.trim(), vehicleId: vehicleId || null, driverId: driverId || null }));
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="details-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="details-heading" className="font-medium">
        Route details
      </h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Saved.</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="route-name">Name</Label>
          <Input id="route-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="route-vehicle">Vehicle</Label>
          <select id="route-vehicle" className={`${SELECT_CLASSES} sm:w-full`} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">No vehicle</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} ({v.seats} seats)
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="route-driver">Driver</Label>
          <select id="route-driver" className={`${SELECT_CLASSES} sm:w-full`} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">No driver</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The vehicle&apos;s seats are the route&apos;s limit. Add vehicles and drivers on{" "}
        <Link href="/transport/vehicles" className="text-primary underline-offset-2 hover:underline">
          Vehicles and drivers
        </Link>
        .
      </p>
      <Button size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save details"}
      </Button>
    </section>
  );
}

// ─── Fee ────────────────────────────────────────────────────────────────────

function Fee({ route, canSet, onSaved }: { route: TransportRouteDto; canSet: boolean; onSaved: (r: TransportRouteDto) => void }) {
  const [amount, setAmount] = useState(route.fee > 0 ? `${Math.floor(route.fee / 100)}.${String(route.fee % 100).padStart(2, "0")}` : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function save() {
    const kobo = amount.trim() === "" || amount.trim() === "0" ? 0 : nairaInputToKobo(amount);
    if (kobo === null) return setError("Enter the fee in naira, such as 35,000, or 0 for a free route.");
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const r = await setRouteFee(route.id, kobo);
      onSaved(r.route);
      const parts = [
        r.repriced ? `${r.repriced} waiting ${r.repriced === 1 ? "charge" : "charges"} now at the new fee` : "",
        r.raised ? `${r.raised} new ${r.raised === 1 ? "charge" : "charges"} raised` : "",
        r.voided ? `${r.voided} waiting ${r.voided === 1 ? "charge" : "charges"} voided` : "",
        r.keptBilled ? `${r.keptBilled} already on an invoice ${r.keptBilled === 1 ? "keeps its" : "keep their"} amount` : "",
      ].filter(Boolean);
      setResult(`Fee saved.${parts.length ? ` ${parts.join("; ")}.` : ""}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="fee-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="fee-heading" className="font-medium">
        Fee per term
      </h2>
      <p className="text-sm text-muted-foreground">
        Every child on this route is charged this each term, on their invoice. Changing it updates the charges not yet
        on an invoice, for this term and later ones.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {result && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{result}</p>}
      {canSet ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="route-fee">Fee (₦)</Label>
            <Input id="route-fee" inputMode="decimal" className="sm:w-48" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="35,000" />
          </div>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save fee"}
          </Button>
        </div>
      ) : (
        <p className="text-sm">{formatKobo(route.fee)} a term</p>
      )}
    </section>
  );
}

// ─── Stops ──────────────────────────────────────────────────────────────────

interface StopDraft {
  key: string;
  id?: string;
  name: string;
  time: string;
}

function Stops({ route, canManage, onSaved }: { route: TransportRouteDto; canManage: boolean; onSaved: (r: TransportRouteDto) => void }) {
  const toDrafts = (r: TransportRouteDto): StopDraft[] =>
    r.stops.map((s) => ({ key: s.id, id: s.id, name: s.name, time: s.pickupMinute === null ? "" : formatMinuteOfDay(s.pickupMinute) }));
  const [drafts, setDrafts] = useState<StopDraft[]>(() => toDrafts(route));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function change(index: number, patch: Partial<StopDraft>) {
    setSaved(false);
    setDrafts((d) => d.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }
  function moveStop(index: number, by: -1 | 1) {
    setSaved(false);
    setDrafts((d) => {
      const next = [...d];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }

  async function save() {
    const stops = [];
    for (const d of drafts) {
      if (!d.name.trim()) return setError("Every stop needs a name.");
      const minute = d.time.trim() === "" ? null : parseMinuteOfDay(d.time);
      if (d.time.trim() !== "" && minute === null) return setError(`"${d.time}" is not a time. Use the 24-hour clock, such as 06:45.`);
      stops.push({ ...(d.id ? { id: d.id } : {}), name: d.name.trim(), pickupMinute: minute });
    }
    setSaving(true);
    setError(null);
    try {
      const r = await setStops(route.id, { stops });
      onSaved(r);
      setDrafts(toDrafts(r));
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <section aria-labelledby="stops-heading" className="space-y-2 rounded-md border bg-card p-4">
        <h2 id="stops-heading" className="font-medium">
          Stops
        </h2>
        {route.stops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No stops yet.</p>
        ) : (
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {route.stops.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.pickupMinute !== null && <span className="text-muted-foreground"> · {formatMinuteOfDay(s.pickupMinute)}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="stops-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="stops-heading" className="font-medium">
        Stops, in pickup order
      </h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Stops saved.</p>}
      {drafts.length === 0 && <p className="text-sm text-muted-foreground">No stops yet.</p>}
      <ol className="space-y-2">
        {drafts.map((d, i) => (
          <li key={d.key} className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`stop-name-${d.key}`}>Stop {i + 1}</Label>
              <Input id={`stop-name-${d.key}`} value={d.name} maxLength={80} onChange={(e) => change(i, { name: e.target.value })} />
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`stop-time-${d.key}`}>Pickup</Label>
              <Input
                id={`stop-time-${d.key}`}
                aria-label={`Pickup time for stop ${i + 1}`}
                value={d.time}
                placeholder="06:45"
                onChange={(e) => change(i, { time: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => moveStop(i, -1)} aria-label={`Move stop ${i + 1} up`}>
                Up
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={i === drafts.length - 1} onClick={() => moveStop(i, 1)} aria-label={`Move stop ${i + 1} down`}>
                Down
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSaved(false);
                  setDrafts((all) => all.filter((_, j) => j !== i));
                }}
                aria-label={`Remove stop ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setSaved(false);
            setDrafts((d) => [...d, { key: `new-${Date.now()}-${d.length}`, name: "", time: "" }]);
          }}
        >
          Add a stop
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save stops"}
        </Button>
      </div>
    </section>
  );
}

// ─── Children on the route ──────────────────────────────────────────────────

const CHARGE_TEXT = { OPEN: "Fee waiting to be billed", BILLED: "Fee on an invoice", VOID: "No fee" } as const;

function Children({ route, canManage }: { route: TransportRouteDto; canManage: boolean }) {
  const picker = useTermPicker();
  const [places, setPlaces] = useState<TransportPlaceDto[] | null>(null);
  const [seatInfo, setSeatInfo] = useState<{ taken: number; seats: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!picker.termId) return;
    setError(null);
    try {
      const [p, r] = await Promise.all([listPlaces(route.id, picker.termId), getRoute(route.id, picker.termId)]);
      setPlaces(p);
      setSeatInfo({ taken: r.placesTaken, seats: r.seats });
    } catch (e) {
      setError(message(e));
    }
  }, [route.id, picker.termId]);

  useEffect(() => {
    setPlaces(null);
    void load();
  }, [load]);

  return (
    <section aria-labelledby="children-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="children-heading" className="font-medium">
        Children on this route
      </h2>
      <TermPicker picker={picker} idPrefix="route" />
      {picker.error && <InlineAlert>{picker.error}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}
      {!picker.termId ? (
        <p className="text-sm text-muted-foreground">Choose a term.</p>
      ) : !places ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {seatInfo && (
            <p className="text-sm">
              {seatInfo.taken} of {seatInfo.seats} seats taken
              {seatInfo.seats === 0 ? " — give the route a vehicle before adding children" : ""}
            </p>
          )}
          {places.length === 0 ? (
            <p className="text-sm text-muted-foreground">No children on this route this term.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {places.map((p) => (
                <PlaceRow key={p.id} place={p} route={route} canManage={canManage} onChanged={load} />
              ))}
            </ul>
          )}
          {canManage && <AddChild route={route} termId={picker.termId} onAdded={load} />}
        </>
      )}
    </section>
  );
}

function PlaceRow({ place, route, canManage, onChanged }: { place: TransportPlaceDto; route: TransportRouteDto; canManage: boolean; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [routes, setRoutes] = useState<TransportRouteDto[]>([]);
  const [targetRouteId, setTargetRouteId] = useState(route.id);
  const [targetStopId, setTargetStopId] = useState(place.stopId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = routes.find((r) => r.id === targetRouteId) ?? route;

  useEffect(() => {
    if (moving && routes.length === 0) listRoutes().then(setRoutes).catch((e: unknown) => setError(message(e)));
  }, [moving, routes.length]);

  async function move() {
    setSaving(true);
    setError(null);
    try {
      await movePlace(place.id, { routeId: targetRouteId, stopId: targetStopId });
      setMoving(false);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Take ${place.studentName} off this route? A fee not yet on an invoice is voided.`)) return;
    setError(null);
    try {
      await removePlace(place.id);
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{place.studentName}</p>
          <p className="text-muted-foreground">
            {place.admissionNumber}
            {place.classArm ? ` · ${place.classArm}` : ""} · {place.stopName}
          </p>
        </div>
        {place.charge && <Badge variant={place.charge.status === "BILLED" ? "success" : place.charge.status === "OPEN" ? "warning" : "muted"}>{CHARGE_TEXT[place.charge.status]}</Badge>}
      </div>
      {canManage && !moving && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMoving(true)} aria-label={`Move ${place.studentName}`}>
            Move
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={`Remove ${place.studentName}`}>
            Remove
          </Button>
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      {moving && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`move-route-${place.id}`}>Route</Label>
              <select
                id={`move-route-${place.id}`}
                className={`${SELECT_CLASSES} sm:w-full`}
                value={targetRouteId}
                onChange={(e) => {
                  setTargetRouteId(e.target.value);
                  setTargetStopId(routes.find((r) => r.id === e.target.value)?.stops[0]?.id ?? "");
                }}
              >
                {(routes.length ? routes : [route]).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`move-stop-${place.id}`}>Stop</Label>
              <select id={`move-stop-${place.id}`} className={`${SELECT_CLASSES} sm:w-full`} value={targetStopId} onChange={(e) => setTargetStopId(e.target.value)}>
                {target.stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving || !targetStopId} onClick={() => void move()}>
              {saving ? "Moving…" : "Move"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMoving(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddChild({ route, termId, onAdded }: { route: TransportRouteDto; termId: string; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentDto[] | null>(null);
  const [chosen, setChosen] = useState<StudentDto | null>(null);
  const [stopId, setStopId] = useState(route.stops[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!query.trim()) return;
    setError(null);
    try {
      setResults((await listStudents({ search: query.trim(), status: "ACTIVE", limit: 10 })).data);
    } catch (e) {
      setError(message(e));
    }
  }

  async function add() {
    if (!chosen || !stopId) return;
    setSaving(true);
    setError(null);
    try {
      await createPlace({ studentId: chosen.id, termId, routeId: route.id, stopId });
      setChosen(null);
      setResults(null);
      setQuery("");
      onAdded();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  if (route.stops.length === 0) {
    return <p className="text-sm text-muted-foreground">Add the route&apos;s stops before adding children.</p>;
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3">
      <h3 className="text-sm font-medium">Add a child</h3>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!chosen ? (
        <>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="add-child-search">Find a student</Label>
              <Input id="add-child-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or admission number" />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Find
            </Button>
          </form>
          {results && results.length === 0 && <p className="text-sm text-muted-foreground">No students found.</p>}
          {results && results.length > 0 && (
            <ul className="divide-y rounded-md border bg-background">
              {results.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
                  <span className="min-w-0 break-words">
                    {s.firstName} {s.lastName} <span className="text-muted-foreground">· {s.admissionNumber}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setChosen(s)} aria-label={`Choose ${s.firstName} ${s.lastName}`}>
                    Choose
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {chosen.firstName} {chosen.lastName} · {chosen.admissionNumber}
          </p>
          <div className="space-y-1">
            <Label htmlFor="add-child-stop">Stop</Label>
            <select id="add-child-stop" className={SELECT_CLASSES} value={stopId} onChange={(e) => setStopId(e.target.value)}>
              {route.stops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {route.fee > 0 && <p className="text-xs text-muted-foreground">This raises a {formatKobo(route.fee)} transport charge for the term.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void add()}>
              {saving ? "Adding…" : "Add to route"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
              Choose someone else
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Delete ─────────────────────────────────────────────────────────────────

function DeleteRoute({ route }: { route: TransportRouteDto }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Delete the route ${route.name}? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteRoute(route.id);
      router.push("/transport");
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section className="space-y-2">
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button variant="ghost" size="sm" onClick={() => void remove()}>
        Delete this route
      </Button>
    </section>
  );
}
