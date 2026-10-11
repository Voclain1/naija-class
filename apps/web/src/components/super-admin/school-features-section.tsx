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
  type PlatformAdminDecideSmsSenderInput,
  type PlatformAdminDecideSmsSenderResponse,
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

// The school's own SMS sender name (docs/modules/school-identity.md slice 2).
// The school asks in its settings; the operator submits the name through
// SchoolKit's Termii account with the school's CAC documents, then records here
// what the networks decided. Only a REQUESTED name can be decided.
export function SmsSenderSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [busy, setBusy] = useState<PlatformAdminDecideSmsSenderInput["decision"] | null>(null);

  async function decide(decision: PlatformAdminDecideSmsSenderInput["decision"]) {
    const verb = decision === "APPROVED" ? "approved" : "rejected";
    if (!window.confirm(`Record that the networks ${verb} "${school.smsSenderId}" for ${school.name}?`)) return;
    setBusy(decision);
    try {
      const payload: PlatformAdminDecideSmsSenderInput = { decision };
      const res = await proxyFetch<PlatformAdminDecideSmsSenderResponse>(
        `/api/platform-admin/schools/${school.schoolId}/sms-sender`,
        { method: "PATCH", body: JSON.stringify(payload) },
      );
      onChanged({ smsSenderId: res.senderId, smsSenderStatus: res.status });
      toast.success(
        res.status === "APPROVED"
          ? `${school.name}'s SMS now go out as ${res.senderId}.`
          : `Recorded that ${res.senderId} was not approved.`,
      );
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setBusy(null);
    }
  }

  const statusBadge: Record<PlatformAdminSchoolDto["smsSenderStatus"], { label: string; variant: "success" | "warning" | "destructive" | "muted" }> = {
    NONE: { label: "None", variant: "muted" },
    REQUESTED: { label: "Waiting", variant: "warning" },
    APPROVED: { label: "Approved", variant: "success" },
    REJECTED: { label: "Not approved", variant: "destructive" },
  };
  const badge = statusBadge[school.smsSenderStatus];

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-sms-sender">
      <h3 id="manage-sms-sender" className="flex items-center gap-2 font-medium">
        SMS sender name
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </h3>
      {school.smsSenderId ? (
        <p className="text-sm text-muted-foreground">
          The school asked to send as <span className="font-mono text-foreground">{school.smsSenderId}</span>.
          {school.smsSenderStatus === "REQUESTED"
            ? " Collect its CAC certificate and request letter, submit the name through Termii, then record the networks' decision."
            : ""}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          The school has not asked for one. Its SMS go out under SchoolKit&apos;s name.
        </p>
      )}
      {school.smsSenderStatus === "REQUESTED" ? (
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void decide("APPROVED")}>
            {busy === "APPROVED" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Approved
          </Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void decide("REJECTED")}>
            {busy === "REJECTED" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Not approved
          </Button>
        </div>
      ) : null}
    </section>
  );
}
