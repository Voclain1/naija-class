"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  formatKobo,
  HOSTEL_GENDER_LABEL,
  type HostelBedDto,
  type HostelDto,
  type HostelGender,
  type HostelRoomDto,
  type HouseMasterCandidateDto,
  type StudentDto,
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
import {
  createRoom,
  deleteHostel,
  deleteRoom,
  getHostel,
  houseMasterCandidates,
  listBeds,
  listHostels,
  moveStudent,
  placeStudent,
  removeStudent,
  setHostelFee,
  setHouseMasters,
  updateHostel,
  updateRoom,
} from "@/lib/hostels/hostels-api";
import { listStudents } from "@/lib/students/students-api";

// Phase 9 / CP6b.1 — one hostel (docs/modules/phase-9.md §15, §15.8): who it
// is for, its house masters, its fee per term (which stands until changed),
// its rooms of numbered beds, and the boarders in a term. Every amount and bed
// count is the API's; the API also keeps boys and girls to their own hostels.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

const CHARGE_TEXT = { OPEN: "Fee waiting to be billed", BILLED: "Fee on an invoice", VOID: "No fee" } as const;

export default function HostelPage() {
  const { id } = useParams<{ id: string }>();
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "hostel.manage");
  const canSetFee = hasPermission(permissions, "charge.raise");
  const [hostel, setHostel] = useState<HostelDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setHostel(await getHostel(id));
    } catch (e) {
      setError(message(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (error && !hostel) return <InlineAlert>{error}</InlineAlert>;
  if (!hostel) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <Link href="/hostels" className="text-sm text-primary underline-offset-2 hover:underline">
          ← Hostels
        </Link>
        <h1 className="break-words font-serif text-2xl font-semibold">{hostel.name}</h1>
        <p className="text-sm text-muted-foreground">
          {HOSTEL_GENDER_LABEL[hostel.forGender]} · {hostel.fee > 0 ? `${formatKobo(hostel.fee)} a term` : "no fee"} · {hostel.beds} beds
        </p>
      </div>

      {canManage && <Details hostel={hostel} onSaved={setHostel} />}
      {canManage && <HouseMasters hostel={hostel} onSaved={setHostel} />}
      {(canSetFee || hostel.fee > 0) && <Fee hostel={hostel} canSet={canSetFee} onSaved={setHostel} />}
      <Rooms hostel={hostel} canManage={canManage} onSaved={setHostel} />
      <Boarders hostel={hostel} canManage={canManage} />
      {canManage && <DeleteHostel hostel={hostel} />}
    </div>
  );
}

// ─── Details ────────────────────────────────────────────────────────────────

function Details({ hostel, onSaved }: { hostel: HostelDto; onSaved: (h: HostelDto) => void }) {
  const [name, setName] = useState(hostel.name);
  const [forGender, setForGender] = useState<HostelGender>(hostel.forGender);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await updateHostel(hostel.id, { name: name.trim(), forGender }));
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
        Hostel details
      </h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Saved.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="hostel-name">Name</Label>
          <Input id="hostel-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1">
          <Label htmlFor="hostel-gender">For</Label>
          <select id="hostel-gender" className={`${SELECT_CLASSES} sm:w-full`} value={forGender} onChange={(e) => setForGender(e.target.value as HostelGender)}>
            <option value="BOYS">Boys</option>
            <option value="GIRLS">Girls</option>
          </select>
        </div>
      </div>
      <Button size="sm" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save details"}
      </Button>
    </section>
  );
}

// ─── House masters ──────────────────────────────────────────────────────────

function HouseMasters({ hostel, onSaved }: { hostel: HostelDto; onSaved: (h: HostelDto) => void }) {
  const [candidates, setCandidates] = useState<HouseMasterCandidateDto[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(hostel.houseMasters.map((m) => m.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    houseMasterCandidates()
      .then(setCandidates)
      .catch((e: unknown) => setError(message(e)));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await setHouseMasters(hostel.id, chosen));
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="house-masters-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="house-masters-heading" className="font-medium">
        House masters
      </h2>
      <p className="text-sm text-muted-foreground">
        A teacher, or a member of staff invited as House master. They will see this hostel&apos;s boarders, keep its
        visitor log and decide leave-out requests, and nothing else about the school.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">House masters saved.</p>}
      {!candidates ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No teachers or House masters yet.</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">House masters</legend>
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={chosen.includes(c.id)}
                onChange={(e) => setChosen((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
              />
              <span className="min-w-0 break-words">
                {c.name} <span className="text-muted-foreground">· {c.role}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Button size="sm" disabled={saving || !candidates} onClick={() => void save()}>
        {saving ? "Saving…" : "Save house masters"}
      </Button>
    </section>
  );
}

// ─── Fee ────────────────────────────────────────────────────────────────────

function Fee({ hostel, canSet, onSaved }: { hostel: HostelDto; canSet: boolean; onSaved: (h: HostelDto) => void }) {
  const [amount, setAmount] = useState(hostel.fee > 0 ? `${Math.floor(hostel.fee / 100)}.${String(hostel.fee % 100).padStart(2, "0")}` : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function save() {
    const kobo = amount.trim() === "" || amount.trim() === "0" ? 0 : nairaInputToKobo(amount);
    if (kobo === null) return setError("Enter the fee in naira, such as 150,000, or 0 for no fee.");
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const r = await setHostelFee(hostel.id, kobo);
      onSaved(r.hostel);
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
        Every boarder here is charged this each term, on their invoice, and it stays the same for later terms and
        sessions until you change it. Changing it updates the charges not yet on an invoice, for this term and later.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {result && <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">{result}</p>}
      {canSet ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="hostel-fee">Fee (₦)</Label>
            <Input id="hostel-fee" inputMode="decimal" className="sm:w-48" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150,000" />
          </div>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save fee"}
          </Button>
        </div>
      ) : (
        <p className="text-sm">{formatKobo(hostel.fee)} a term</p>
      )}
    </section>
  );
}

// ─── Rooms ──────────────────────────────────────────────────────────────────

function Rooms({ hostel, canManage, onSaved }: { hostel: HostelDto; canManage: boolean; onSaved: (h: HostelDto) => void }) {
  const [name, setName] = useState("");
  const [beds, setBeds] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const n = Number(beds);
    if (!name.trim()) return setError("Give the room a name.");
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError("Enter the number of beds, from 1 to 60.");
    setSaving(true);
    setError(null);
    try {
      onSaved(await createRoom(hostel.id, { name: name.trim(), beds: n }));
      setName("");
      setBeds("");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="rooms-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="rooms-heading" className="font-medium">
        Rooms
      </h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      {hostel.rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rooms yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {hostel.rooms.map((r) => (
            <RoomRow key={r.id} room={r} canManage={canManage} onSaved={onSaved} onError={setError} />
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          aria-label="New room"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="new-room-name">Room name</Label>
            <Input id="new-room-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Room 4" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-room-beds">Beds</Label>
            <Input id="new-room-beds" className="w-24" inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Adding…" : "Add room"}
          </Button>
        </form>
      )}
    </section>
  );
}

function RoomRow({ room, canManage, onSaved, onError }: { room: HostelRoomDto; canManage: boolean; onSaved: (h: HostelDto) => void; onError: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(room.name);
  const [beds, setBeds] = useState(String(room.beds));

  async function save() {
    const n = Number(beds);
    if (!Number.isInteger(n) || n < 1 || n > 60) return onError("Enter the number of beds, from 1 to 60.");
    try {
      onSaved(await updateRoom(room.id, { name: name.trim(), beds: n }));
      setEditing(false);
    } catch (e) {
      onError(message(e));
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${room.name}?`)) return;
    try {
      onSaved(await deleteRoom(room.id));
    } catch (e) {
      onError(message(e));
    }
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`room-name-${room.id}`}>Room name</Label>
          <Input id={`room-name-${room.id}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`room-beds-${room.id}`}>Beds</Label>
          <Input id={`room-beds-${room.id}`} className="w-24" inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <span className="min-w-0 break-words">
        <span className="font-medium">{room.name}</span> · {room.beds} {room.beds === 1 ? "bed" : "beds"}
      </span>
      {canManage && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Change ${room.name}`}>
            Change
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={`Delete ${room.name}`}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}

// ─── Boarders ───────────────────────────────────────────────────────────────

function Boarders({ hostel, canManage }: { hostel: HostelDto; canManage: boolean }) {
  const picker = useTermPicker();
  const [beds, setBeds] = useState<HostelBedDto[] | null>(null);
  const [counts, setCounts] = useState<HostelDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!picker.termId) return;
    setError(null);
    try {
      const [b, h] = await Promise.all([listBeds(hostel.id, picker.termId), getHostel(hostel.id, picker.termId)]);
      setBeds(b);
      setCounts(h);
    } catch (e) {
      setError(message(e));
    }
  }, [hostel.id, picker.termId]);

  useEffect(() => {
    setBeds(null);
    void load();
  }, [load]);

  return (
    <section aria-labelledby="boarders-heading" className="space-y-3 rounded-md border bg-card p-4">
      <h2 id="boarders-heading" className="font-medium">
        Boarders
      </h2>
      <TermPicker picker={picker} idPrefix="hostel" />
      {picker.error && <InlineAlert>{picker.error}</InlineAlert>}
      {error && <InlineAlert>{error}</InlineAlert>}
      {!picker.termId ? (
        <p className="text-sm text-muted-foreground">Choose a term.</p>
      ) : !beds ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {counts && (
            <p className="text-sm">
              {counts.taken} of {counts.beds} beds taken
              {counts.beds === 0 ? " — add rooms before placing children" : ""}
            </p>
          )}
          {beds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No boarders in this hostel this term.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {beds.map((b) => (
                <BedRow key={b.id} bed={b} canManage={canManage} onChanged={load} />
              ))}
            </ul>
          )}
          {canManage && hostel.rooms.length > 0 && <AddBoarder hostel={hostel} termId={picker.termId} onAdded={load} />}
        </>
      )}
    </section>
  );
}

function BedRow({ bed, canManage, onChanged }: { bed: HostelBedDto; canManage: boolean; onChanged: () => void }) {
  const [moving, setMoving] = useState(false);
  const [hostels, setHostels] = useState<HostelDto[]>([]);
  const [roomId, setRoomId] = useState(bed.roomId);
  const [bedNumber, setBedNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (moving && hostels.length === 0) listHostels().then(setHostels).catch((e: unknown) => setError(message(e)));
  }, [moving, hostels.length]);

  async function move() {
    const n = bedNumber.trim() ? Number(bedNumber) : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) return setError("Enter a bed number, or leave it empty for the first free bed.");
    setSaving(true);
    setError(null);
    try {
      await moveStudent(bed.id, { roomId, ...(n !== undefined ? { bedNumber: n } : {}) });
      setMoving(false);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Take ${bed.studentName} out of the hostel this term? A fee not yet on an invoice is voided.`)) return;
    setError(null);
    try {
      await removeStudent(bed.id);
      onChanged();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <li className="space-y-2 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-medium">{bed.studentName}</p>
          <p className="text-muted-foreground">
            {bed.admissionNumber}
            {bed.classArm ? ` · ${bed.classArm}` : ""} · {bed.roomName}, bed {bed.bedNumber}
          </p>
        </div>
        {bed.charge && <Badge variant={bed.charge.status === "BILLED" ? "success" : bed.charge.status === "OPEN" ? "warning" : "muted"}>{CHARGE_TEXT[bed.charge.status]}</Badge>}
      </div>
      {canManage && !moving && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setMoving(true)} aria-label={`Move ${bed.studentName}`}>
            Move
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove()} aria-label={`Remove ${bed.studentName}`}>
            Remove
          </Button>
        </div>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
      {moving && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`move-room-${bed.id}`}>Room</Label>
              <select id={`move-room-${bed.id}`} className={`${SELECT_CLASSES} sm:w-full`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {hostels.flatMap((h) =>
                  h.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {h.name} · {r.name}
                    </option>
                  )),
                )}
                {hostels.length === 0 && <option value={bed.roomId}>{bed.roomName}</option>}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor={`move-bed-${bed.id}`}>Bed (empty for the first free)</Label>
              <Input id={`move-bed-${bed.id}`} inputMode="numeric" value={bedNumber} onChange={(e) => setBedNumber(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void move()}>
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

function AddBoarder({ hostel, termId, onAdded }: { hostel: HostelDto; termId: string; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentDto[] | null>(null);
  const [chosen, setChosen] = useState<StudentDto | null>(null);
  const [roomId, setRoomId] = useState(hostel.rooms[0]?.id ?? "");
  const [bedNumber, setBedNumber] = useState("");
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
    if (!chosen || !roomId) return;
    const n = bedNumber.trim() ? Number(bedNumber) : undefined;
    if (n !== undefined && (!Number.isInteger(n) || n < 1)) return setError("Enter a bed number, or leave it empty for the first free bed.");
    setSaving(true);
    setError(null);
    try {
      await placeStudent({ studentId: chosen.id, termId, roomId, ...(n !== undefined ? { bedNumber: n } : {}) });
      setChosen(null);
      setResults(null);
      setQuery("");
      setBedNumber("");
      onAdded();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3">
      <h3 className="text-sm font-medium">Add a boarder</h3>
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
              <Label htmlFor="add-boarder-search">Find a student</Label>
              <Input id="add-boarder-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or admission number" />
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
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="add-boarder-room">Room</Label>
              <select id="add-boarder-room" className={`${SELECT_CLASSES} sm:w-full`} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                {hostel.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.beds} beds)
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 space-y-1">
              <Label htmlFor="add-boarder-bed">Bed (empty for the first free)</Label>
              <Input id="add-boarder-bed" inputMode="numeric" value={bedNumber} onChange={(e) => setBedNumber(e.target.value)} />
            </div>
          </div>
          {hostel.fee > 0 && <p className="text-xs text-muted-foreground">This raises a {formatKobo(hostel.fee)} hostel charge for the term.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={saving} onClick={() => void add()}>
              {saving ? "Adding…" : "Give a bed"}
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

function DeleteHostel({ hostel }: { hostel: HostelDto }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Delete the hostel ${hostel.name}? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteHostel(hostel.id);
      router.push("/hostels");
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <section className="space-y-2">
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button variant="ghost" size="sm" onClick={() => void remove()}>
        Delete this hostel
      </Button>
    </section>
  );
}
