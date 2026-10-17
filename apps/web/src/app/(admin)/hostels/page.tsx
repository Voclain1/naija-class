"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatKobo, HOSTEL_GENDER_LABEL, type CopyBedsResultDto, type HostelDto, type HostelGender, type TermDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { SELECT_CLASSES, TermPicker, useTermPicker } from "@/components/transport/term-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { copyBeds, createHostel, listHostels } from "@/lib/hostels/hostels-api";

// Phase 9 / CP6b.1 — hostels (docs/modules/phase-9.md §15). Each hostel is for
// boys or girls, with rooms of numbered beds and a fee per term that stands
// until changed. How full each is in a term, a new hostel, and "Copy to next
// term". Every figure is the API's.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function HostelsPage() {
  const { permissions } = useAuth();
  const canManage = hasPermission(permissions, "hostel.manage");
  const picker = useTermPicker();
  const [hostels, setHostels] = useState<HostelDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setHostels(await listHostels(picker.termId || undefined));
    } catch (e) {
      setError(message(e));
    }
  }, [picker.termId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Hostels</h1>
        <p className="text-sm text-muted-foreground">
          The school&apos;s boarding houses. Each has rooms of numbered beds and a fee per term; a child with a bed is
          charged that fee on their invoice.
        </p>
      </div>

      {(error || picker.error) && <InlineAlert>{error ?? picker.error}</InlineAlert>}

      <TermPicker picker={picker} idPrefix="hostels" />
      {!picker.termId && <p className="text-sm text-muted-foreground">Choose a term to see how full each hostel is.</p>}

      {!hostels ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : hostels.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hostels yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {hostels.map((h) => {
            const full = picker.termId && h.beds > 0 && h.taken >= h.beds;
            return (
              <li key={h.id} className="space-y-2 rounded-md border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/hostels/${h.id}${picker.termId ? `?termId=${picker.termId}` : ""}`}
                    className="min-w-0 break-words font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {h.name}
                  </Link>
                  <span className="tabular-nums">{h.fee > 0 ? `${formatKobo(h.fee)} a term` : "No fee"}</span>
                </div>
                <p className="text-muted-foreground">
                  {HOSTEL_GENDER_LABEL[h.forGender]} · {h.rooms.length} {h.rooms.length === 1 ? "room" : "rooms"} · {h.beds} beds
                  {h.houseMasters.length > 0 ? ` · ${h.houseMasters.map((m) => m.name).join(", ")}` : " · no house master yet"}
                </p>
                {picker.termId && (
                  <p className={full ? "rounded bg-amber-500/10 px-2 py-1 text-amber-900 dark:text-amber-200" : ""}>
                    {h.taken} of {h.beds} beds taken{full ? " — full" : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && <NewHostel />}
      {canManage && picker.termId && <CopyToNextTerm fromTermId={picker.termId} onDone={load} />}
    </div>
  );
}

function NewHostel() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [forGender, setForGender] = useState<HostelGender | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return setError("Give the hostel a name.");
    if (!forGender) return setError("Say whether it is for boys or girls.");
    setSaving(true);
    setError(null);
    try {
      const h = await createHostel({ name: name.trim(), forGender });
      router.push(`/hostels/${h.id}`);
    } catch (e) {
      setError(message(e));
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-md border bg-card p-4"
      aria-label="New hostel"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <h2 className="font-medium">New hostel</h2>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="new-hostel-name">Hostel name</Label>
          <Input id="new-hostel-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Aggrey House" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-hostel-gender">For</Label>
          <select id="new-hostel-gender" className={SELECT_CLASSES} value={forGender} onChange={(e) => setForGender(e.target.value as HostelGender | "")}>
            <option value="">Choose</option>
            <option value="BOYS">Boys</option>
            <option value="GIRLS">Girls</option>
          </select>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? "Creating…" : "Create hostel"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">You add the rooms, house masters and fee on the hostel&apos;s page.</p>
    </form>
  );
}

function CopyToNextTerm({ fromTermId, onDone }: { fromTermId: string; onDone: () => void }) {
  const [toTermId, setToTermId] = useState("");
  // Every term of every year: the next term is often in the next session.
  const [allTerms, setAllTerms] = useState<Array<TermDto & { yearLabel: string }>>([]);
  useEffect(() => {
    listAcademicYears()
      .then((years) => Promise.all(years.map(async (y) => (await listTerms(y.id)).map((t) => ({ ...t, yearLabel: y.label })))))
      .then((lists) => setAllTerms(lists.flat()))
      .catch(() => setAllTerms([]));
  }, []);
  const [result, setResult] = useState<CopyBedsResultDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = allTerms.filter((t) => t.id !== fromTermId);

  async function copy() {
    if (!toTermId) return setError("Choose the term to copy to.");
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      setResult(await copyBeds({ fromTermId, toTermId }));
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
        Puts every boarder in the same bed in another term, where that bed is free, and raises that term&apos;s hostel
        charges at each hostel&apos;s fee as it stands. Children who have left the school are not copied.
      </p>
      {error && <InlineAlert>{error}</InlineAlert>}
      {result && (
        <p className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-200">
          {result.copied} copied. {result.alreadyPlaced} already had a bed, {result.bedTaken} left out because their bed was
          taken, {result.leftSchool} had left the school.
        </p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="copy-beds-to">Copy to</Label>
          <select id="copy-beds-to" className={SELECT_CLASSES} value={toTermId} onChange={(e) => setToTermId(e.target.value)}>
            <option value="">Choose a term</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.yearLabel} · {t.name}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" disabled={saving} onClick={() => void copy()}>
          {saving ? "Copying…" : "Copy beds"}
        </Button>
      </div>
    </section>
  );
}
