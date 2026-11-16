"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  CORE_SCHOOL_MODULES,
  SCHOOL_MODULE_KEYS,
  type SchoolModuleKey,
} from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/lib/auth/use-auth";
import { patchSchoolMe } from "@/lib/onboarding/schools-api";

const COPY: Record<SchoolModuleKey, { title: string; description: string; group: "core" | "more" }> = {
  students: { title: "Students & classes", description: "Student records, admissions and class placement.", group: "core" },
  fees: { title: "Fees & payments", description: "School fees, invoices, payments and debtors.", group: "core" },
  attendance: { title: "Attendance", description: "Daily class registers and attendance reports.", group: "core" },
  results: { title: "Results & report cards", description: "Score entry, results and report cards.", group: "core" },
  "parent-communication": { title: "Parent communication", description: "Parents, messages, announcements and school news.", group: "core" },
  homework: { title: "Homework", description: "Homework lookup and class assignments.", group: "more" },
  cbt: { title: "Questions & CBT", description: "Question bank, exam papers and computer-based tests.", group: "more" },
  health: { title: "Health & sickbay", description: "Health records, allergies and sickbay visits.", group: "more" },
  transport: { title: "Transport", description: "School buses, routes and transport fees.", group: "more" },
  hostel: { title: "Hostel & boarding", description: "Hostels, rooms, beds and boarding records.", group: "more" },
  library: { title: "Library", description: "Books, borrowing and overdue returns.", group: "more" },
  store: { title: "Store & inventory", description: "Stock, uniforms, school items and assets.", group: "more" },
  insights: { title: "Insights", description: "Performance and trend views for established schools.", group: "more" },
};

export default function SchoolModulesPage() {
  const { school, setSchool } = useAuth();
  const initial = useMemo<SchoolModuleKey[]>(
    () => [...(school?.modulePreferences?.selected ?? SCHOOL_MODULE_KEYS)],
    [school?.modulePreferences?.selected],
  );
  const [selected, setSelected] = useState<SchoolModuleKey[]>(initial);
  const [saving, setSaving] = useState(false);
  const changed = useMemo(
    () => JSON.stringify([...selected].sort()) !== JSON.stringify([...initial].sort()),
    [initial, selected],
  );

  function toggle(key: SchoolModuleKey) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  async function save() {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const updated = await patchSchoolMe({ modulePreferences: { selected } });
      setSchool(updated);
      toast.success("Your SchoolKit menu has been updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your modules. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Choose what your school uses"
        subtitle="Keep the daily menu short. Turning an area off only hides it—it never deletes its records."
      />

      <ModuleSection title="Daily school work" description="New schools start with these five practical areas." keys={CORE_SCHOOL_MODULES} selected={selected} onToggle={toggle} />
      <ModuleSection title="More school tools" description="Turn these on when your school is ready to use them." keys={SCHOOL_MODULE_KEYS.filter((key) => COPY[key].group === "more")} selected={selected} onToggle={toggle} />

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <p className="text-sm text-muted-foreground">{selected.length} areas selected</p>
        <Button onClick={save} disabled={!changed || saving || selected.length === 0}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          Save menu choices
        </Button>
      </div>
    </div>
  );
}

function ModuleSection({ title, description, keys, selected, onToggle }: { title: string; description: string; keys: readonly SchoolModuleKey[]; selected: SchoolModuleKey[]; onToggle: (key: SchoolModuleKey) => void }) {
  return (
    <section className="space-y-3">
      <div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {keys.map((key) => {
          const active = selected.includes(key);
          return (
            <Card key={key} className={active ? "bg-primary/[0.04] ring-1 ring-primary/30" : ""}>
              <CardContent className="flex items-start gap-3 p-4">
                <button type="button" role="switch" aria-checked={active} onClick={() => onToggle(key)} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}>
                  {active && <Check className="h-4 w-4" aria-hidden />}
                  <span className="sr-only">{active ? "Hide" : "Show"} {COPY[key].title}</span>
                </button>
                <button type="button" onClick={() => onToggle(key)} className="min-w-0 text-left">
                  <span className="block font-medium text-foreground">{COPY[key].title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{COPY[key].description}</span>
                </button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
