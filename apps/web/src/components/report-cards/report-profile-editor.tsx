"use client";

import { useEffect, useState } from "react";
import {
  AFFECTIVE_TRAITS,
  PSYCHOMOTOR_SKILLS,
  REPORT_RATING_KEY,
  readReportProfile,
  reportProfileSchema,
  type ReportCardDto,
  type ReportProfile,
} from "@school-kit/types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { updateReportProfile } from "@/lib/report-cards/report-card-api";

const inputClass =
  "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground";

export function ReportProfileEditor({
  card,
  definitions,
  editable,
  onSaved,
}: {
  card: ReportCardDto;
  definitions: { key: string; label: string }[];
  editable: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    readReportProfile(card.reportProfile),
  );
  const [saved, setSaved] = useState(() =>
    readReportProfile(card.reportProfile),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const profile = readReportProfile(card.reportProfile);
    setDraft(profile);
    setSaved(profile);
  }, [card.id, card.reportProfile]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  function change<K extends keyof ReportProfile>(
    key: K,
    value: ReportProfile[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function save() {
    const parsed = reportProfileSchema.safeParse({
      ...draft,
      customFields: draft.customFields.filter((f) =>
        definitions.some((d) => d.key === f.key),
      ),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the report details.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateReportProfile(card.id, parsed.data);
      setSaved(readReportProfile(updated.reportProfile));
      toast.success("Report details saved.");
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save report details.",
      );
    } finally {
      setSaving(false);
    }
  }
  const fields = editable ? definitions : draft.customFields;
  return (
    <section
      className="rounded-xl border bg-card p-5 sm:p-6"
      aria-labelledby="report-profile-title"
    >
      <h2 id="report-profile-title" className="text-lg font-semibold">
        Development & report details
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Record observations for this term. Unrated areas show “Not recorded”.
        Save these details before sending the class for approval; they lock after submission.
      </p>
      <fieldset disabled={!editable || saving} className="mt-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Report level
            <select
              className={inputClass}
              value={draft.level}
              onChange={(e) =>
                change("level", e.target.value as ReportProfile["level"])
              }
            >
              <option value="NURSERY">Nursery</option>
              <option value="PRIMARY">Primary</option>
              <option value="SECONDARY">Secondary</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Next term begins
            <input
              type="date"
              className={inputClass}
              value={draft.nextTermDate ?? ""}
              onChange={(e) => change("nextTermDate", e.target.value || null)}
            />
          </label>
          <label className="text-sm font-medium">
            Form teacher’s name
            <input
              maxLength={120}
              className={inputClass}
              value={draft.teacherName}
              onChange={(e) => change("teacherName", e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            {draft.level === "SECONDARY" ? "Principal’s" : "Headteacher’s"} name
            <input
              maxLength={120}
              className={inputClass}
              value={draft.headName}
              onChange={(e) => change("headName", e.target.value)}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{REPORT_RATING_KEY}</p>
        <div className="grid gap-6 sm:grid-cols-2">
          {(
            [
              ["affective", "Character & attitude", AFFECTIVE_TRAITS],
              ["psychomotor", "Practical skills", PSYCHOMOTOR_SKILLS],
            ] as const
          ).map(([key, title, traits]) => (
            <div key={key}>
              <h3 className="mb-2 text-sm font-semibold">{title}</h3>
              <div className="space-y-2">
                {traits.map((trait) => (
                  <label
                    key={trait}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span>{trait}</span>
                    <select
                      aria-label={`${title}: ${trait}`}
                      className="min-h-10 rounded-md border bg-background px-2 text-sm"
                      value={draft[key][trait] ?? ""}
                      onChange={(e) =>
                        change(key, {
                          ...draft[key],
                          [trait]: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">Not recorded</option>
                      {[5, 4, 3, 2, 1].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        {fields.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.key} className="text-sm font-medium">
                {field.label}
                <input
                  className={inputClass}
                  maxLength={300}
                  value={
                    draft.customFields.find((f) => f.key === field.key)
                      ?.value ?? ""
                  }
                  onChange={(e) =>
                    change("customFields", [
                      ...draft.customFields.filter(
                        (f) =>
                          f.key !== field.key &&
                          definitions.some((d) => d.key === f.key),
                      ),
                      {
                        key: field.key,
                        label: field.label,
                        value: e.target.value,
                      },
                    ])
                  }
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {editable && (
        <Button
          className="mt-5"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save report details"}
        </Button>
      )}
    </section>
  );
}
