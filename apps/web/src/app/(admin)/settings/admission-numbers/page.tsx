"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/page-primitives";
import { InlineAlert } from "@/components/shared/inline-alert";
import { AdmissionNumbersEditor, useAdmissionNumbers } from "@/components/students/admission-numbers";
import { Button } from "@/components/ui/button";
import { formatAsPattern } from "@/lib/students/admission-format-ui";
import { updateAdmissionNumberSettings } from "@/lib/students/admission-numbers-api";

// /settings/admission-numbers — how the school's admission numbers are given
// (docs/modules/admission-numbers.md). Owner/admin; the API enforces it.

export default function AdmissionNumbersSettingsPage() {
  const { settings, setSettings, failed, reload } = useAdmissionNumbers();
  const [switching, setSwitching] = useState(false);

  const typeInstead = async () => {
    setSwitching(true);
    try {
      setSettings(await updateAdmissionNumberSettings({ mode: "MANUAL" }));
      toast.success("You'll type admission numbers in.");
    } catch {
      toast.error("Couldn't save. Try again.");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Admission numbers"
        subtitle="Let SchoolKit give each new student the next number in your school's format, or type them yourself."
      />

      {failed && (
        <InlineAlert title="Couldn't load your admission number settings" action={{ label: "Try again", onClick: () => void reload() }}>
          Check your connection and try again.
        </InlineAlert>
      )}
      {!settings && !failed && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

      {settings && (
        <>
          <section className="flex flex-col gap-1 rounded-md bg-muted/40 p-4 text-sm">
            {settings.mode === "AUTO" && settings.format ? (
              <>
                <span>
                  Now: <span className="font-medium">automatic</span>,{" "}
                  <span className="font-mono">{formatAsPattern(settings.format, new Date().getFullYear())}</span>
                </span>
                {settings.nextNumber && (
                  <span className="text-muted-foreground">
                    The next student will get <span className="font-mono text-foreground">{settings.nextNumber}</span>.
                  </span>
                )}
                <span className="text-muted-foreground">
                  A number typed when adding a student is always kept, so you can still number one by hand.
                </span>
                <div className="pt-2">
                  <Button type="button" variant="outline" size="sm" disabled={switching} onClick={() => void typeInstead()}>
                    Type numbers instead
                  </Button>
                </div>
              </>
            ) : (
              <span>
                Now: <span className="font-medium">typed by you</span>. Each new student needs an admission number
                entered by hand.
              </span>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {settings.mode === "AUTO" ? "Change the format" : "Assign numbers automatically"}
            </h2>
            {settings.studentCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Students you already have keep their numbers. If your format matches numbers already on the register,
                SchoolKit carries on from the highest one.
              </p>
            )}
            <AdmissionNumbersEditor
              key={`${settings.mode}-${settings.format}-${settings.order}`}
              settings={settings}
              idPrefix="settings"
              submitLabel={settings.mode === "AUTO" ? "Save" : "Turn on automatic numbers"}
              onSaved={setSettings}
            />
          </section>
        </>
      )}
    </div>
  );
}
