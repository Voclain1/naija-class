"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_REPORT_CARD_DESIGN,
  readReportCardDesign,
  reportCardDesignSchema,
  type ReportCardDesign,
} from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { getSchoolMe, patchSchoolMe } from "@/lib/onboarding/schools-api";
import { getSchoolPlan } from "@/lib/plans/plans-api";

const control = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
export function ReportCardDesignEditor() {
  const [draft, setDraft] = useState<ReportCardDesign>(
    DEFAULT_REPORT_CARD_DESIGN,
  );
  const [saved, setSaved] = useState<ReportCardDesign>(
    DEFAULT_REPORT_CARD_DESIGN,
  );
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([getSchoolMe(), getSchoolPlan()])
      .then(([school, plan]) => {
        if (!active) return;
        const design = readReportCardDesign(school.reportCardDesign);
        setDraft(design);
        setSaved(design);
        setAvailable(
          plan.features.some(
            (f) => f.feature === "reportCardBranding" && f.available,
          ),
        );
      })
      .catch((e: unknown) => {
        if (active)
          setMessage(
            e instanceof Error ? e.message : "Could not load report design.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  function change<K extends keyof ReportCardDesign>(
    key: K,
    value: ReportCardDesign[K],
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
    setMessage(null);
  }
  async function save(reset = false) {
    const parsed = reportCardDesignSchema.safeParse(
      reset ? DEFAULT_REPORT_CARD_DESIGN : draft,
    );
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Check the design settings.",
      );
      return;
    }
    setSaving(true);
    try {
      const school = await patchSchoolMe({ reportCardDesign: parsed.data });
      const design = readReportCardDesign(school.reportCardDesign);
      setDraft(design);
      setSaved(design);
      setMessage(
        "Design saved. Regenerate a PDF to apply the changes; existing PDFs stay as issued.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the design.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold">Report design</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every plan includes complete report cards, your school logo, positions
          and cumulative results. Paid plans add design customisation.
        </p>
      </div>
      {!loading && !available && (
        <p className="rounded-lg bg-muted p-3 text-sm">
          The standard design is included free.{" "}
          <Link className="underline" href="/settings/plan">
            Choose a paid plan
          </Link>{" "}
          for templates, colours and extra fields.
        </p>
      )}
      {loading ? (
        <p className="text-sm">Loading design…</p>
      ) : (
        <fieldset disabled={!available || saving} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Template
              <select
                className={control}
                value={draft.template}
                onChange={(e) =>
                  change(
                    "template",
                    e.target.value as ReportCardDesign["template"],
                  )
                }
              >
                <option value="standard">Standard — balanced and clear</option>
                <option value="classic">
                  Classic — traditional school header
                </option>
                <option value="compact">Compact — denser subject table</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Typography
              <select
                className={control}
                value={draft.font}
                onChange={(e) =>
                  change("font", e.target.value as ReportCardDesign["font"])
                }
              >
                <option value="sans">Sans serif</option>
                <option value="serif">Serif</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Report colour
              <input
                type="color"
                className={`${control} h-11`}
                value={draft.color}
                onChange={(e) => change("color", e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Watermark text
              <input
                className={control}
                maxLength={60}
                value={draft.watermark}
                onChange={(e) => change("watermark", e.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Additional fields</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to 8 text fields. Teachers enter a value for each child before
              form review.
            </p>
          </div>
          {draft.customFields.map((field, i) => (
            <div key={field.key} className="flex items-end gap-2">
              <label className="grow text-sm">
                Field {i + 1} label
                <input
                  className={control}
                  maxLength={60}
                  value={field.label}
                  onChange={(e) =>
                    change(
                      "customFields",
                      draft.customFields.map((f) =>
                        f.key === field.key
                          ? { ...f, label: e.target.value }
                          : f,
                      ),
                    )
                  }
                />
              </label>
              <Button
                variant="outline"
                type="button"
                onClick={() =>
                  change(
                    "customFields",
                    draft.customFields.filter((f) => f.key !== field.key),
                  )
                }
                aria-label={`Remove field ${i + 1}`}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            type="button"
            disabled={draft.customFields.length >= 8}
            onClick={() =>
              change("customFields", [
                ...draft.customFields,
                {
                  key: `field_${crypto.randomUUID().replaceAll("-", "")}`,
                  label: "",
                },
              ])
            }
          >
            Add a field
          </Button>
          <div>
            <Button
              disabled={JSON.stringify(draft) === JSON.stringify(saved)}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save design"}
            </Button>
          </div>
        </fieldset>
      )}
      {!loading &&
        JSON.stringify(saved) !==
          JSON.stringify(DEFAULT_REPORT_CARD_DESIGN) && (
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Restore standard design
          </Button>
        )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
