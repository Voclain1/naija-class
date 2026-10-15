"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { HEALTH_LIMITS, type HealthProfileDto, type HealthProfileField } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { ApiError } from "@/lib/api-client";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getHealthProfile, saveHealthProfile } from "@/lib/health/health-api";
import { VaccinationsSection } from "@/components/health/vaccinations-section";

// Phase 9 / CP3.1 — one child's health profile (docs/modules/phase-9.md §10).
// Shown to owner, admin and the Health officer: on the Health page and as the
// Health tab of the student page. Who may read it is the API's; this panel
// only hides the Edit button from someone without health.manage.

const FIELDS: { key: HealthProfileField; label: string; hint?: string; multiline: boolean }[] = [
  { key: "allergies", label: "Allergies", multiline: true },
  { key: "conditions", label: "Conditions", multiline: true },
  { key: "medication", label: "Medication", hint: "What they take, and when.", multiline: true },
  { key: "gpClinic", label: "GP or clinic", multiline: false },
  { key: "emergencyNotes", label: "Emergency notes", hint: "What to do, and who to call, in an emergency.", multiline: true },
  { key: "bloodGroup", label: "Blood group", multiline: false },
];

type Values = Record<HealthProfileField, string>;

function valuesOf(p: HealthProfileDto): Values {
  return {
    allergies: p.allergies ?? "",
    conditions: p.conditions ?? "",
    medication: p.medication ?? "",
    gpClinic: p.gpClinic ?? "",
    emergencyNotes: p.emergencyNotes ?? "",
    bloodGroup: p.bloodGroup ?? "",
    teacherNote: p.teacherNote ?? "",
  };
}

function formatMoment(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function HealthProfilePanel({
  studentId,
  onLoaded,
}: {
  studentId: string;
  /** Called with each loaded record, so a page can name the child without a second read. */
  onLoaded?: (profile: HealthProfileDto) => void;
}) {
  const { permissions } = useAuth();
  const canEdit = hasPermission(permissions, "health.manage");
  const [profile, setProfile] = useState<HealthProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Values | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const loaded = await getHealthProfile(studentId);
      setProfile(loaded);
      onLoaded?.(loaded);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the health record.");
    }
  }, [studentId, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!values) return;
    setSaving(true);
    setSaveError(null);
    try {
      setProfile(await saveHealthProfile(studentId, values));
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not save the health record.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <InlineAlert>{error}</InlineAlert>;
  if (!profile) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  const notice = (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
      <strong className="font-medium text-foreground">Who sees this.</strong> The owner, admins, the health officer and
      the child&apos;s parents see the whole record. Teachers of the child see only the note for teachers. Every look
      at it is recorded.
    </div>
  );

  if (editing && values) {
    return (
      <form className="flex flex-col gap-4" onSubmit={save}>
        {notice}
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{f.label}</span>
            {f.hint && <span className="text-xs text-muted-foreground">{f.hint}</span>}
            {f.multiline ? (
              <textarea
                rows={3}
                maxLength={HEALTH_LIMITS[f.key]}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="rounded-md border border-input bg-background p-3 text-sm"
              />
            ) : (
              <input
                maxLength={HEALTH_LIMITS[f.key]}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className="h-10 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
              />
            )}
          </label>
        ))}
        <label className="flex flex-col gap-1 rounded-lg bg-secondary/10 p-3 text-sm">
          <span className="font-medium">For teachers</span>
          <span className="text-xs text-muted-foreground">
            The only part a teacher of this child sees. Write what they need to keep the child safe in class and on
            trips. Leave it empty to share nothing.
          </span>
          <textarea
            rows={2}
            maxLength={HEALTH_LIMITS.teacherNote}
            value={values.teacherNote}
            onChange={(e) => setValues({ ...values, teacherNote: e.target.value })}
            className="rounded-md border border-input bg-background p-3 text-sm"
          />
        </label>
        {saveError && <InlineAlert>{saveError}</InlineAlert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save health record"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice}
      {profile.updatedAt === null ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
          Nothing recorded yet.
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? "sm:col-span-2" : ""}>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="whitespace-pre-wrap break-words text-sm text-foreground">{profile[f.key] ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="rounded-lg bg-secondary/10 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">For teachers</p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {profile.teacherNote ?? "Nothing shared with teachers."}
        </p>
      </div>
      {profile.updatedAt && (
        <p className="text-xs text-muted-foreground">
          Last changed by {profile.updatedByName ?? "staff"} on {formatMoment(profile.updatedAt)}
        </p>
      )}
      {canEdit && (
        <div>
          <Button
            onClick={() => {
              setValues(valuesOf(profile));
              setEditing(true);
            }}
          >
            {profile.updatedAt === null ? "Add health record" : "Edit health record"}
          </Button>
        </div>
      )}
      {/* Phase 9 / CP3.2 */}
      <VaccinationsSection profile={profile} canEdit={canEdit} onChanged={setProfile} />
    </div>
  );
}
