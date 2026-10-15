"use client";

import { Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BEHAVIOUR_INCIDENT_MAX_STUDENTS,
  BEHAVIOUR_INCIDENT_MAX_WITNESSES,
  BEHAVIOUR_INCIDENT_PLACE_MAX,
  BEHAVIOUR_NOTE_MAX,
  type BehaviourIncidentDto,
  type BehaviourIncidentOptionsDto,
  type BehaviourSettingsDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createIncident,
  getBehaviourSettings,
  getIncidentOptions,
  getIncidentRoster,
  listIncidents,
  withdrawIncident,
} from "@/lib/behaviour/behaviour-api";
import { cn } from "@/lib/utils";

// Behaviour incidents (docs/modules/phase-9.md §9 CP2-D2), on the admin
// /behaviour page and the teacher /teacher/behaviour page.
//
// One incident, several students: each student gets their own CONCERN record
// linked to it, so their history stays complete. The server narrows
// everything to the viewer — a teacher is offered only their own classes and
// sees only incidents they recorded or witnessed — so this component never
// decides scope itself.
//
// C14: staff only. C15: no AI. Nothing here is shown to a family.

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : `−${Math.abs(points)}`;
}

function message(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

interface Chosen {
  studentId: string;
  name: string;
  note: string;
}

export function IncidentsPanel() {
  const [incidents, setIncidents] = useState<BehaviourIncidentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setIncidents((await listIncidents()).data);
    } catch (e) {
      setError(message(e, "Could not load incidents."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdraw(incident: BehaviourIncidentDto): Promise<void> {
    const confirmed = window.confirm(
      "Withdraw this incident?\n\nIts records are withdrawn too. They stay on each student's record as withdrawn rather than disappearing.",
    );
    if (!confirmed) return;
    try {
      const updated = await withdrawIncident(incident.id);
      setIncidents((current) => current?.map((i) => (i.id === updated.id ? updated : i)) ?? null);
    } catch (e) {
      toast.error(message(e, "Could not withdraw that incident."));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">Staff only.</strong> An incident groups what happened to
        several students. Each student gets a concern on their own record. Parents and students do not see these.
      </div>

      {formOpen ? (
        <IncidentForm
          onCancel={() => setFormOpen(false)}
          onSaved={(created) => {
            setIncidents((current) => [created, ...(current ?? [])]);
            setFormOpen(false);
            toast.success("Incident recorded.");
          }}
        />
      ) : (
        <div>
          <Button type="button" onClick={() => setFormOpen(true)}>
            Record an incident
          </Button>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Incidents</h2>
        {error ? (
          <InlineAlert>{error}</InlineAlert>
        ) : incidents === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : incidents.length === 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
            No incidents recorded yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {incidents.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} onWithdraw={() => void withdraw(incident)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IncidentCard({ incident, onWithdraw }: { incident: BehaviourIncidentDto; onWithdraw: () => void }) {
  const withdrawn = incident.withdrawnAt !== null;
  return (
    <li className={cn("flex flex-col gap-3 rounded-lg border p-4", withdrawn ? "bg-card opacity-60" : "bg-destructive/5")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <p className={cn("break-words text-sm font-medium", withdrawn && "line-through")}>{incident.place}</p>
          <p className="text-xs text-muted-foreground">
            {formatDay(incident.occurredOn)} · recorded by {incident.recordedByName ?? "staff"}
            {withdrawn ? " · withdrawn" : ""}
          </p>
        </div>
        {incident.canWithdraw && (
          <Button type="button" size="sm" variant="outline" onClick={onWithdraw}>
            Withdraw
          </Button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{incident.description}</p>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Students</p>
        <ul className="flex flex-col gap-1 text-sm">
          {incident.students.map((student) => (
            <li key={student.recordId} className="break-words">
              <span className="font-medium">{student.name}</span>
              {student.note !== incident.description && <span className="text-muted-foreground"> — {student.note}</span>}
            </li>
          ))}
        </ul>
      </div>
      {incident.witnesses.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          Seen by {incident.witnesses.map((w) => w.name).join(", ")}
        </p>
      )}
    </li>
  );
}

function IncidentForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (incident: BehaviourIncidentDto) => void;
}) {
  const [options, setOptions] = useState<BehaviourIncidentOptionsDto | null>(null);
  const [settings, setSettings] = useState<BehaviourSettingsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [occurredOn, setOccurredOn] = useState(isoToday());
  const [place, setPlace] = useState("");
  const [description, setDescription] = useState("");
  const [armId, setArmId] = useState("");
  const [roster, setRoster] = useState<{ studentId: string; name: string }[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [witnessIds, setWitnessIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getIncidentOptions()
      .then(setOptions)
      .catch((e: unknown) => setLoadError(message(e, "Could not load the classes and staff.")));
    // A failure here only hides the category choice.
    getBehaviourSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);

  useEffect(() => {
    if (!armId) {
      setRoster(null);
      return;
    }
    let live = true;
    setRosterLoading(true);
    getIncidentRoster(armId)
      .then((r) => live && setRoster(r.students))
      .catch(() => live && setRoster([]))
      .finally(() => live && setRosterLoading(false));
    return () => {
      live = false;
    };
  }, [armId]);

  const concernCategories = useMemo(
    () => (settings?.pointsEnabled ? settings.categories.filter((c) => c.active && c.kind === "CONCERN") : []),
    [settings],
  );
  const chosenIds = new Set(chosen.map((c) => c.studentId));
  const full = chosen.length >= BEHAVIOUR_INCIDENT_MAX_STUDENTS;

  function toggleStudent(student: { studentId: string; name: string }): void {
    setChosen((current) =>
      current.some((c) => c.studentId === student.studentId)
        ? current.filter((c) => c.studentId !== student.studentId)
        : [...current, { ...student, note: "" }],
    );
  }

  function toggleWitness(userId: string): void {
    setWitnessIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  const valid = place.trim() !== "" && description.trim() !== "" && chosen.length > 0;

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createIncident({
        occurredOn,
        place: place.trim(),
        description: description.trim(),
        students: chosen.map((c) => ({
          studentId: c.studentId,
          ...(c.note.trim() ? { note: c.note.trim() } : {}),
        })),
        witnessIds,
        ...(categoryId ? { categoryId } : {}),
      });
      onSaved(created);
    } catch (e) {
      setSaveError(message(e, "Could not record that incident."));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <InlineAlert>{loadError}</InlineAlert>;
  if (!options) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5 rounded-lg border bg-card p-4" onSubmit={(e) => void save(e)}>
      <h2 className="text-base font-medium">Record an incident</h2>

      <div className="flex flex-wrap gap-4">
        <div className="flex w-full max-w-xs flex-col gap-1.5">
          <Label htmlFor="incident-date">When it happened</Label>
          <Input
            id="incident-date"
            type="date"
            value={occurredOn}
            max={isoToday()}
            onChange={(e) => setOccurredOn(e.target.value)}
            required
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="incident-place">Where</Label>
          <Input
            id="incident-place"
            value={place}
            maxLength={BEHAVIOUR_INCIDENT_PLACE_MAX}
            placeholder="For example, Playground"
            onChange={(e) => setPlace(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="incident-description">What happened</Label>
        <textarea
          id="incident-description"
          value={description}
          maxLength={BEHAVIOUR_NOTE_MAX}
          rows={4}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border border-input bg-background p-3 text-sm"
          placeholder="Write it as you would say it to a colleague."
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Students involved</legend>
        {options.arms.length === 0 ? (
          <p className="text-sm text-muted-foreground">You have no classes to choose students from.</p>
        ) : (
          <div className="flex w-full max-w-sm flex-col gap-1.5">
            <Label htmlFor="incident-class">Choose from a class</Label>
            <select
              id="incident-class"
              value={armId}
              onChange={(e) => setArmId(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose a class</option>
              {options.arms.map((arm) => (
                <option key={arm.id} value={arm.id}>
                  {arm.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {rosterLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the class…
          </div>
        ) : roster && roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No students are enrolled in that class this term.</p>
        ) : roster ? (
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {roster.map((student) => (
              <li key={student.studentId}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosenIds.has(student.studentId)}
                    disabled={full && !chosenIds.has(student.studentId)}
                    onChange={() => toggleStudent(student)}
                  />
                  <span className="break-words">{student.name}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}

        {chosen.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Chosen students">
            {chosen.map((c) => (
              <li key={c.studentId} className="flex flex-col gap-1.5 rounded-md border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="break-words text-sm font-medium">{c.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${c.name}`}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleStudent(c)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <Input
                  aria-label={`Note for ${c.name}`}
                  value={c.note}
                  maxLength={BEHAVIOUR_NOTE_MAX}
                  placeholder="Their part, if different (optional)"
                  onChange={(e) =>
                    setChosen((current) =>
                      current.map((x) => (x.studentId === c.studentId ? { ...x, note: e.target.value } : x)),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {full && (
          <p className="text-xs text-muted-foreground">An incident can name up to {BEHAVIOUR_INCIDENT_MAX_STUDENTS} students.</p>
        )}
      </fieldset>

      {options.staff.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Staff who saw it (optional)</legend>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {options.staff.map((member) => (
              <li key={member.userId}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={witnessIds.includes(member.userId)}
                    disabled={
                      witnessIds.length >= BEHAVIOUR_INCIDENT_MAX_WITNESSES && !witnessIds.includes(member.userId)
                    }
                    onChange={() => toggleWitness(member.userId)}
                  />
                  <span className="break-words">{member.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {concernCategories.length > 0 && (
        <div className="flex w-full max-w-sm flex-col gap-1.5">
          <Label htmlFor="incident-category">Category for every student (optional)</Label>
          <select
            id="incident-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">No category</option>
            {concernCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({signed(c.points)})
              </option>
            ))}
          </select>
        </div>
      )}

      {saveError && <InlineAlert>{saveError}</InlineAlert>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!valid || saving}>
          {saving ? "Saving…" : "Save incident"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
