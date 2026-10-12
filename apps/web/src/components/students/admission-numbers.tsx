"use client";

import { Hash, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { AdmissionNumberOrder, AdmissionNumberSettingsDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  composeFormat,
  decomposeFormat,
  exampleNumbers,
  formatAsPattern,
  ORDER_CHOICES,
  type SimpleFormat,
} from "@/lib/students/admission-format-ui";
import { getAdmissionNumberSettings, updateAdmissionNumberSettings } from "@/lib/students/admission-numbers-api";

// Admission numbers assigned by SchoolKit (docs/modules/admission-numbers.md).
// The same pieces serve the three places the owner asked for: the first-time
// question on the add-student pages, Settings → Admission numbers, and the
// "Change" dialog while adding students.

const THIS_YEAR = new Date().getFullYear();
export const DEFAULT_FORMAT = "{YYYY}/{NNNN}";

/** The school's numbering, loaded once per page; `reload` after a change. */
export function useAdmissionNumbers() {
  const [settings, setSettings] = useState<AdmissionNumberSettingsDto | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      setSettings(await getAdmissionNumberSettings());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { settings, setSettings, failed, reload };
}

export function OrderChoice({
  value,
  onChange,
  name,
}: {
  value: AdmissionNumberOrder;
  onChange: (next: AdmissionNumberOrder) => void;
  name: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">How numbers are given</legend>
      {ORDER_CHOICES.map((option) => (
        <label
          key={option.value}
          className={
            value === option.value
              ? "flex cursor-pointer items-start gap-3 rounded-md bg-primary/10 p-3"
              : "flex cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-3"
          }
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** The one format field, with what each blank means and a live example. */
export function FormatField({
  id,
  value,
  onChange,
  order,
  error,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  order: AdmissionNumberOrder;
  error?: string | null;
}) {
  const preview = exampleNumbers(value, order, THIS_YEAR);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Your admission number format</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="VFM/{YYYY}/{NNNN}"
        className="font-mono"
        autoComplete="off"
        spellCheck={false}
      />
      <p className="text-xs text-muted-foreground">
        Write your number once and leave blanks for SchoolKit to fill: <code>{"{YYYY}"}</code> the year of
        admission, <code>{"{YY}"}</code> the short year, <code>{"{CLASS}"}</code> the class (per class only),
        and <code>{"{NNNN}"}</code> the number, one N per digit. Anything else is kept as you write it.
      </p>
      {preview.ok ? (
        <p className="text-xs">
          <span className="text-muted-foreground">Students will get: </span>
          <span className="font-mono font-medium text-foreground">{preview.examples.join(", ")}…</span>
        </p>
      ) : (
        <p className="text-xs text-destructive">{error ?? preview.error}</p>
      )}
      {preview.ok && error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Text before and after, a year or not, how many digits: the dialog's builder. */
function SimpleFormatFields({
  value,
  onChange,
}: {
  value: SimpleFormat;
  onChange: (next: SimpleFormat) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="adm-prefix">Prefix</Label>
        <Input
          id="adm-prefix"
          value={value.prefix}
          placeholder="VFM/"
          className="font-mono"
          onChange={(e) => onChange({ ...value, prefix: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="adm-suffix">Suffix</Label>
        <Input
          id="adm-suffix"
          value={value.suffix}
          placeholder="(none)"
          className="font-mono"
          onChange={(e) => onChange({ ...value, suffix: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="adm-digits">Digits</Label>
        <select
          id="adm-digits"
          value={value.digits}
          onChange={(e) => onChange({ ...value, digits: Number(e.target.value) })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {[3, 4, 5, 6, 7, 8].map((d) => (
            <option key={d} value={d}>
              {d} ({"0".repeat(d - 1)}1)
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          checked={value.withYear}
          onChange={(e) => onChange({ ...value, withYear: e.target.checked })}
        />
        Include the year
      </label>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
    return issues?.[0]?.message ?? error.message;
  }
  return "Could not reach the server. Try again.";
}

/**
 * The full editor (Settings and the first-time question): the format field
 * and the three ticks, saved as AUTO.
 */
export function AdmissionNumbersEditor({
  settings,
  onSaved,
  submitLabel = "Save",
  idPrefix,
}: {
  settings: AdmissionNumberSettingsDto;
  onSaved: (next: AdmissionNumberSettingsDto) => void;
  submitLabel?: string;
  idPrefix: string;
}) {
  const [order, setOrder] = useState<AdmissionNumberOrder>(settings.order);
  const [format, setFormat] = useState(settings.format ?? DEFAULT_FORMAT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per class needs {CLASS}; offer it rather than leave the admin to guess.
  const changeOrder = (next: AdmissionNumberOrder) => {
    setOrder(next);
    setError(null);
    if (next === "CLASS" && !/\{CLASS\}/i.test(format)) {
      setFormat((f) => f.replace(/\{N+\}/i, (n) => `{CLASS}/${n}`));
    } else if (next !== "CLASS") {
      setFormat((f) => f.replace(/\{CLASS\}\/?/i, ""));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateAdmissionNumberSettings({ mode: "AUTO", format, order });
      toast.success("Admission numbers will now be given automatically.");
      onSaved(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <OrderChoice value={order} onChange={changeOrder} name={`${idPrefix}-order`} />
      <FormatField id={`${idPrefix}-format`} value={format} onChange={setFormat} order={order} error={error} />
      <div>
        <Button type="button" onClick={() => void save()} disabled={saving || !exampleNumbers(format, order, THIS_YEAR).ok}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * The first-time question: a school with no students that has not answered
 * yet is asked on arrival at the add-student pages. "Decide later" closes it
 * for this visit only.
 */
export function AdmissionNumbersQuestion({
  settings,
  onDecided,
}: {
  settings: AdmissionNumberSettingsDto;
  onDecided: (next: AdmissionNumberSettingsDto) => void;
}) {
  const [open, setOpen] = useState(settings.studentCount === 0 && !settings.decided);
  const [choice, setChoice] = useState<"auto" | "manual" | null>(null);
  const [saving, setSaving] = useState(false);

  const chooseManual = async () => {
    setSaving(true);
    try {
      onDecided(await updateAdmissionNumberSettings({ mode: "MANUAL" }));
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>How does your school give admission numbers?</DialogTitle>
          <DialogDescription>
            SchoolKit can write each new student&apos;s number for you, in your school&apos;s format. You can
            change this any time in Settings → Admission numbers.
          </DialogDescription>
        </DialogHeader>

        {choice !== "auto" ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setChoice("auto")}
              className="flex flex-col gap-0.5 rounded-md bg-primary/10 p-3 text-left hover:bg-primary/15"
            >
              <span className="text-sm font-medium">SchoolKit assigns them</span>
              <span className="text-xs text-muted-foreground">
                Set your format once, like VFM/{THIS_YEAR}/0001. Every new student gets the next number.
              </span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void chooseManual()}
              className="flex flex-col gap-0.5 rounded-md bg-muted/40 p-3 text-left hover:bg-muted/60"
            >
              <span className="text-sm font-medium">We type them in</span>
              <span className="text-xs text-muted-foreground">You enter each student&apos;s number yourself.</span>
            </button>
          </div>
        ) : (
          <AdmissionNumbersEditor
            settings={settings}
            idPrefix="first-time"
            submitLabel="Use this format"
            onSaved={(next) => {
              onDecided(next);
              setOpen(false);
            }}
          />
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Decide later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The small "Change" dialog on the add-student pages: prefix, suffix, ticks. */
function ChangeDialog({
  settings,
  open,
  onOpenChange,
  onSaved,
}: {
  settings: AdmissionNumberSettingsDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (next: AdmissionNumberSettingsDto) => void;
}) {
  const initial = decomposeFormat(settings.format ?? DEFAULT_FORMAT);
  const [order, setOrder] = useState<AdmissionNumberOrder>(settings.order);
  const [simple, setSimple] = useState<SimpleFormat>(initial ?? { prefix: "", withYear: true, digits: 4, suffix: "" });
  // A hand-written format the builder can't show opens on the field instead.
  const [raw, setRaw] = useState<string | null>(initial ? null : (settings.format ?? DEFAULT_FORMAT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const format = raw ?? composeFormat(simple, order);
  const preview = exampleNumbers(format, order, THIS_YEAR);

  const save = async (mode: "AUTO" | "MANUAL") => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateAdmissionNumberSettings(mode === "AUTO" ? { mode, format, order } : { mode });
      onSaved(next);
      onOpenChange(false);
      toast.success(mode === "AUTO" ? "Admission numbers will be given automatically." : "You'll type admission numbers in.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Automatic admission numbers</DialogTitle>
          <DialogDescription>
            Leave the admission number blank when adding a student and SchoolKit fills it in. This changes it for
            everyone at your school.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <OrderChoice value={order} onChange={setOrder} name="change-order" />
          {raw === null ? (
            <SimpleFormatFields value={simple} onChange={setSimple} />
          ) : (
            <FormatField id="change-format" value={raw} onChange={setRaw} order={order} />
          )}
          {raw === null && (
            <p className="text-xs">
              {preview.ok ? (
                <>
                  <span className="text-muted-foreground">Students will get: </span>
                  <span className="font-mono font-medium">{preview.examples.join(", ")}…</span>
                </>
              ) : (
                <span className="text-destructive">{preview.error}</span>
              )}
            </p>
          )}
          <button
            type="button"
            className="self-start text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => setRaw(raw === null ? format : null)}
          >
            {raw === null ? "Write the format yourself" : "Use prefix and suffix instead"}
          </button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {settings.mode === "AUTO" ? (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void save("MANUAL")}>
              Type numbers instead
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" disabled={saving || !preview.ok} onClick={() => void save("AUTO")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The line above the add-student forms: how numbers are given, and Change. */
export function AdmissionNumbersBar({
  settings,
  onChanged,
}: {
  settings: AdmissionNumberSettingsDto;
  onChanged: (next: AdmissionNumberSettingsDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const auto = settings.mode === "AUTO" && settings.format;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2">
        <Hash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {auto ? (
          <span>
            Admission numbers: <span className="font-medium">automatic</span>,{" "}
            <span className="font-mono">{formatAsPattern(settings.format!, THIS_YEAR)}</span>
            {settings.order === "CLASS" ? " per class" : settings.order === "RANDOM" ? " (random)" : ""}
          </span>
        ) : (
          <span>Admission numbers: typed by you</span>
        )}
      </span>
      <span className="flex items-center gap-3">
        <Link href="/settings/admission-numbers" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          Settings
        </Link>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          {auto ? "Change" : "Assign automatically"}
        </Button>
      </span>
      {open && <ChangeDialog settings={settings} open={open} onOpenChange={setOpen} onSaved={onChanged} />}
    </div>
  );
}

/** The hint for an admission number field when SchoolKit can fill it. */
export function admissionNumberHint(settings: AdmissionNumberSettingsDto | null): string | null {
  if (!settings || settings.mode !== "AUTO" || !settings.format) return null;
  if (settings.nextNumber) return `Leave blank: SchoolKit will assign ${settings.nextNumber}.`;
  if (settings.order === "CLASS") return "Leave blank: SchoolKit assigns the next number for the class you choose.";
  return "Leave blank: SchoolKit will assign a random number.";
}
