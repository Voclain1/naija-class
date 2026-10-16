"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { LicenceState, TransportDriverDto, TransportVehicleDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import {
  createDriver,
  createVehicle,
  deleteDriver,
  deleteVehicle,
  listDrivers,
  listVehicles,
  updateDriver,
  updateVehicle,
} from "@/lib/transport/transport-api";

// Phase 9 / CP5.2 — the school's vehicles (plate, seats) and drivers (name,
// phone, licence). A driver's licence state is the server's, against today;
// an expired or expiring licence is shown on a tinted row AND in words.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

const LICENCE: Record<LicenceState, { text: string; tint: string }> = {
  VALID: { text: "Licence valid", tint: "" },
  EXPIRING: { text: "Licence expires soon", tint: "bg-amber-500/10" },
  EXPIRED: { text: "Licence expired", tint: "bg-destructive/10" },
  NOT_RECORDED: { text: "Licence expiry not recorded", tint: "" },
};

export default function VehiclesAndDriversPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "transport.manage");
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="space-y-1">
        <Link href="/transport" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Transport
        </Link>
        <h1 className="font-serif text-2xl font-semibold">Vehicles and drivers</h1>
      </div>
      <Vehicles canManage={canManage} />
      <Drivers canManage={canManage} />
    </div>
  );
}

// ─── Vehicles ───────────────────────────────────────────────────────────────

function Vehicles({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<TransportVehicleDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listVehicles());
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function remove(v: TransportVehicleDto) {
    if (!window.confirm(`Delete ${v.plate}?`)) return;
    setError(null);
    try {
      await deleteVehicle(v.id);
      await load();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section aria-labelledby="vehicles-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="vehicles-heading" className="text-lg font-medium">
          Vehicles
        </h2>
        {canManage && editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            Add a vehicle
          </Button>
        )}
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {editing === "new" && (
        <VehicleForm
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await createVehicle(input);
            setEditing(null);
            await load();
          }}
        />
      )}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No vehicles yet.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((v) =>
            editing === v.id ? (
              <li key={v.id} className="p-3">
                <VehicleForm
                  vehicle={v}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    await updateVehicle(v.id, input);
                    setEditing(null);
                    await load();
                  }}
                />
              </li>
            ) : (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{v.plate}</p>
                  <p className="break-words text-muted-foreground">
                    {v.seats} seats{v.description ? ` · ${v.description}` : ""} · {v.routeCount}{" "}
                    {v.routeCount === 1 ? "route" : "routes"}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(v.id)} aria-label={`Edit ${v.plate}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(v)} aria-label={`Delete ${v.plate}`}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function VehicleForm({
  vehicle,
  onSave,
  onCancel,
}: {
  vehicle?: TransportVehicleDto;
  onSave: (input: { plate: string; seats: number; description: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [seats, setSeats] = useState(vehicle ? String(vehicle.seats) : "");
  const [description, setDescription] = useState(vehicle?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const seatCount = Number(seats);
    if (!plate.trim()) return setError("Enter the plate number.");
    if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 200) return setError("Seats must be a whole number from 1 to 200.");
    setSaving(true);
    setError(null);
    try {
      await onSave({ plate: plate.trim(), seats: seatCount, description: description.trim() || null });
    } catch (e) {
      setError(message(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-md bg-muted/40 p-3"
      aria-label={vehicle ? `Edit ${vehicle.plate}` : "New vehicle"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="vehicle-plate">Plate number</Label>
          <Input id="vehicle-plate" value={plate} maxLength={20} onChange={(e) => setPlate(e.target.value)} placeholder="KJA 123 XY" />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="vehicle-seats">Seats for children</Label>
          <Input id="vehicle-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="18" />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="vehicle-description">Description (optional)</Label>
          <Input id="vehicle-description" value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} placeholder="White Toyota Coaster" />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save vehicle"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ─── Drivers ────────────────────────────────────────────────────────────────

function Drivers({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<TransportDriverDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listDrivers());
    } catch (e) {
      setError(message(e));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function remove(d: TransportDriverDto) {
    if (!window.confirm(`Delete ${d.name}?`)) return;
    setError(null);
    try {
      await deleteDriver(d.id);
      await load();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section aria-labelledby="drivers-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="drivers-heading" className="text-lg font-medium">
          Drivers
        </h2>
        {canManage && editing !== "new" && (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            Add a driver
          </Button>
        )}
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {editing === "new" && (
        <DriverForm
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            await createDriver(input);
            setEditing(null);
            await load();
          }}
        />
      )}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drivers yet.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((d) =>
            editing === d.id ? (
              <li key={d.id} className="p-3">
                <DriverForm
                  driver={d}
                  onCancel={() => setEditing(null)}
                  onSave={async (input) => {
                    await updateDriver(d.id, input);
                    setEditing(null);
                    await load();
                  }}
                />
              </li>
            ) : (
              <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${LICENCE[d.licenceState].tint}`}>
                <div className="min-w-0">
                  <p className="break-words font-medium">{d.name}</p>
                  <p className="text-muted-foreground">
                    <a href={`tel:${d.phone}`} className="underline-offset-2 hover:underline">
                      {d.phone}
                    </a>
                    {d.licenceNumber ? ` · ${d.licenceNumber}` : ""}
                  </p>
                  <p>
                    {LICENCE[d.licenceState].text}
                    {d.licenceExpiry ? ` (${d.licenceExpiry})` : ""}
                  </p>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(d.id)} aria-label={`Edit ${d.name}`}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(d)} aria-label={`Delete ${d.name}`}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function DriverForm({
  driver,
  onSave,
  onCancel,
}: {
  driver?: TransportDriverDto;
  onSave: (input: { name: string; phone: string; licenceNumber: string | null; licenceExpiry: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [licenceNumber, setLicenceNumber] = useState(driver?.licenceNumber ?? "");
  const [licenceExpiry, setLicenceExpiry] = useState(driver?.licenceExpiry ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("Enter the driver's name.");
    if (phone.trim().length < 7) return setError("Enter the driver's phone number.");
    setSaving(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), phone: phone.trim(), licenceNumber: licenceNumber.trim() || null, licenceExpiry: licenceExpiry || null });
    } catch (e) {
      setError(message(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-md bg-muted/40 p-3"
      aria-label={driver ? `Edit ${driver.name}` : "New driver"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="driver-name">Name</Label>
          <Input id="driver-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="driver-phone">Phone</Label>
          <Input id="driver-phone" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} placeholder="0803 123 4567" />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="driver-licence">Licence number (optional)</Label>
          <Input id="driver-licence" value={licenceNumber} maxLength={40} onChange={(e) => setLicenceNumber(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="driver-expiry">Licence expiry (optional)</Label>
          <Input id="driver-expiry" type="date" value={licenceExpiry} onChange={(e) => setLicenceExpiry(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save driver"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
