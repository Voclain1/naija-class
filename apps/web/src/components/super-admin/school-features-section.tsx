"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  PLAN_LABELS,
  PLAN_STUDENT_CAPS,
  PLATFORM_ADMIN_STUDENT_CAP_MAX,
  SCHOOL_PLANS,
  studentCapFor,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetPlanInput,
  type PlatformAdminSetPlanResponse,
  type PlatformAdminSetSmartImportInput,
  type PlatformAdminSetSmartImportResponse,
  type SchoolPlan,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Two sections of the school's Manage dialog (2026-10-11).
//
// Smart Student Import's own switch, in the school's Manage
// dialog. Turning it on asks first, because it is the one feature that sends
// children's names to the model, and docs/modules/smart-student-import.md
// says no school should use it before the real-register accuracy check.
// Turning it off does not ask.
export function SmartImportSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function set(next: boolean) {
    if (
      next &&
      !window.confirm(
        `Turn on Smart Import for ${school.name}? Photographed registers, with children's names, will be sent to the AI provider to be read. Only do this once the accuracy check has passed.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const payload: PlatformAdminSetSmartImportInput = { smartImportEnabled: next };
      const res = await proxyFetch<PlatformAdminSetSmartImportResponse>(
        `/api/platform-admin/schools/${school.schoolId}/smart-import`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      onChanged({ smartImportEnabled: res.smartImportEnabled });
      toast.success(
        res.smartImportEnabled ? `Smart Import is on for ${school.name}.` : `Smart Import is off for ${school.name}.`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update Smart Import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-smart-import">
      <h3 id="manage-smart-import" className="flex items-center gap-2 font-medium">
        Smart Import
        <Badge variant={school.smartImportEnabled ? "success" : "muted"}>
          {school.smartImportEnabled ? "On" : "Off"}
        </Badge>
      </h3>
      <p className="text-sm text-muted-foreground">
        Lets the school photograph a class register and have it read into student records.
        {school.smartImportEnabled && !school.aiEnabled
          ? " AI is off for this school, so nothing can be read until AI is on too."
          : ""}
      </p>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={busy}
        onClick={() => void set(!school.smartImportEnabled)}
      >
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {school.smartImportEnabled ? "Turn off" : "Turn on"}
      </Button>
    </section>
  );
}

// The school's plan and, for a deal, its own student cap
// (docs/modules/plans.md D1). Saving asks first when the school already has
// more students on the roll than the new cap, so a downgrade is never
// accidental.
export function PlanSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [plan, setPlan] = useState<SchoolPlan>(school.plan);
  const [override, setOverride] = useState(school.studentCapOverride?.toString() ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(school.plan);
    setOverride(school.studentCapOverride?.toString() ?? "");
  }, [school.schoolId, school.plan, school.studentCapOverride]);

  const trimmed = override.replace(/[,\s]/g, "");
  const overrideValue = trimmed === "" ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
  const overrideValid =
    overrideValue === null ||
    (Number.isInteger(overrideValue) && overrideValue > 0 && overrideValue <= PLATFORM_ADMIN_STUDENT_CAP_MAX);
  const newCap = overrideValid ? studentCapFor(plan, overrideValue) : null;
  const unchanged = plan === school.plan && overrideValue === school.studentCapOverride;

  async function save() {
    if (!overrideValid) return;
    if (
      newCap !== null &&
      school.studentsOnRoll > newCap &&
      !window.confirm(
        `${school.name} has ${school.studentsOnRoll} students on the roll, more than ${newCap}. Save anyway?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const payload: PlatformAdminSetPlanInput = { plan, studentCapOverride: overrideValue };
      const res = await proxyFetch<PlatformAdminSetPlanResponse>(
        `/api/platform-admin/schools/${school.schoolId}/plan`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      onChanged({ plan: res.plan, studentCapOverride: res.studentCapOverride, studentCap: res.studentCap });
      toast.success(`${school.name} is on the ${PLAN_LABELS[res.plan]} plan.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the plan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-plan">
      <h3 id="manage-plan" className="font-medium">
        Plan
      </h3>
      <p className="text-sm text-muted-foreground">
        {school.studentsOnRoll.toLocaleString("en-NG")} students on the roll
        {school.studentCap === null
          ? ", no limit."
          : ` of ${school.studentCap.toLocaleString("en-NG")}.`}{" "}
        Nothing bills, and the limit only blocks once enforcement is switched on for everyone.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="school-plan">Plan</Label>
          <select
            id="school-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as SchoolPlan)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {SCHOOL_PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABELS[p]}
                {PLAN_STUDENT_CAPS[p] === null ? " (by agreement)" : ` (up to ${PLAN_STUDENT_CAPS[p]!.toLocaleString("en-NG")})`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="school-cap-override">Own student limit</Label>
          <Input
            id="school-cap-override"
            inputMode="numeric"
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="The plan's"
            className="w-36"
          />
        </div>
        <Button type="button" disabled={busy || !overrideValid || unchanged} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          Save plan
        </Button>
      </div>
      {!overrideValid ? (
        <p className="text-sm text-destructive">
          Enter a whole number of students, up to {PLATFORM_ADMIN_STUDENT_CAP_MAX.toLocaleString("en-NG")}, or leave it blank.
        </p>
      ) : null}
    </section>
  );
}
