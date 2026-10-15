"use client";

import { useRef, useState } from "react";
import { VACCINATION_NAME_MAX, type HealthProfileDto, type HealthVaccinationDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import {
  addVaccination,
  getVaccinationDocumentUrl,
  uploadVaccinationDocument,
  withdrawVaccination,
} from "@/lib/health/health-api";

// Phase 9 / CP3.2 — a child's vaccinations, each with an optional document
// (a card photo or a PDF, up to 10 MB). Documents are private: "View" asks
// the API for a five-minute link, and that read is audited.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Opens the private document in a new tab. The tab opens first, so a popup blocker allows it. */
export async function openPrivateDocument(getUrl: () => Promise<{ url: string }>): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await getUrl();
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

function Row({
  v,
  canEdit,
  onChanged,
}: {
  v: HealthVaccinationDto;
  canEdit: boolean;
  onChanged: (p: HealthProfileDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const withdrawn = v.withdrawnAt !== null;

  async function run(fn: () => Promise<HealthProfileDto | void>) {
    setBusy(true);
    setError(null);
    try {
      const next = await fn();
      if (next) onChanged(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={["flex flex-col gap-2 rounded-md border bg-card p-3", withdrawn ? "opacity-60" : ""].join(" ")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={["break-words text-sm font-medium", withdrawn ? "line-through" : ""].join(" ")}>{v.name}</p>
          <p className="text-xs text-muted-foreground">
            Given {formatDay(v.givenOn)}
            {v.recordedByName ? ` · recorded by ${v.recordedByName}` : ""}
            {withdrawn ? " · withdrawn" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {v.documentType && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => openPrivateDocument(() => getVaccinationDocumentUrl(v.id)))}
            >
              View {v.documentType === "pdf" ? "PDF" : "photo"}
            </Button>
          )}
          {canEdit && !withdrawn && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                aria-label={`Document for ${v.name}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(() => uploadVaccinationDocument(v.id, file));
                }}
              />
              <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
                {v.documentType ? "Replace document" : "Add document"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Withdraw this vaccination?\n\nIt stays on the record, marked withdrawn.")) {
                    void run(() => withdrawVaccination(v.id));
                  }
                }}
              >
                Withdraw
              </Button>
            </>
          )}
        </div>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
    </li>
  );
}

export function VaccinationsSection({
  profile,
  canEdit,
  onChanged,
}: {
  profile: HealthProfileDto;
  canEdit: boolean;
  onChanged: (p: HealthProfileDto) => void;
}) {
  const [name, setName] = useState("");
  const [givenOn, setGivenOn] = useState(isoToday());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onChanged(await addVaccination(profile.studentId, { name: name.trim(), givenOn }));
      setName("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add that vaccination.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-base font-medium">Vaccinations</h3>
      {profile.vaccinations.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {profile.vaccinations.map((v) => (
            <Row key={v.id} v={v} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={add}>
          <label className="flex w-full max-w-xs flex-col gap-1 text-sm">
            <span className="font-medium">Vaccine</span>
            <input
              value={name}
              maxLength={VACCINATION_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="For example, Yellow fever"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              required
            />
          </label>
          <label className="flex w-full max-w-[12rem] flex-col gap-1 text-sm">
            <span className="font-medium">Date given</span>
            <input
              type="date"
              value={givenOn}
              max={isoToday()}
              onChange={(e) => setGivenOn(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              required
            />
          </label>
          <Button type="submit" disabled={saving || name.trim() === ""}>
            {saving ? "Adding…" : "Add vaccination"}
          </Button>
        </form>
      )}
      {canEdit && (
        <p className="text-xs text-muted-foreground">
          A document can be a photo (JPEG, PNG or WebP) or a PDF, up to 10 MB.
        </p>
      )}
      {error && <InlineAlert>{error}</InlineAlert>}
    </section>
  );
}
