"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  ASSISTANT_BLOCKER_TEXT,
  type AssistantActivationItemDto,
  type FeatureKey,
  type PlatformAdminAssistantStatusDto,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetFeatureInput,
  type PlatformAdminSetFeatureResponse,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, proxyFetch } from "@/lib/api-client";
import { AssistantReleaseConsole } from "./assistant-release-console";

// The SchoolKit Assistant for one school, in its Manage dialog (2026-11-10,
// docs/modules/assistant-workspace.md, "Controlled activation").
//
// Only the platform admin sees this, and only the platform admin can change
// it: a school's own owner has no such control. Everything is off until
// switched on here, one audited switch at a time.
//
// Each row shows two things and never merges them: whether its SWITCH is on,
// and whether it is WORKING. A switch can be on while something else still
// stops it (the panel is off, AI is off for the school, the month's budget is
// used, the owner's approval of the AI prompt is not recorded), and then the
// row says "Not working" with every reason, in words, from the server.

/** The keys this section owns; the generic pilot list leaves them out. */
export const ASSISTANT_SECTION_KEYS: readonly FeatureKey[] = [
  "assistant-workspace",
  "assistant-billing",
  "reminder-campaigns",
  "student-intake",
  "student-corrections",
  "assistant-model-routing",
];

const ROW_LABEL: Record<string, { name: string; what: string }> = {
  "assistant-workspace": { name: "Assistant panel", what: "The SchoolKit Assistant button and panel in the staff app, with guide search." },
  "assistant-billing": { name: "Prepare invoices", what: "Prepare a term's invoices for review. A person with permission approves them." },
  "reminder-campaigns": { name: "Fee reminder campaigns", what: "Prepare a reviewed fee reminder campaign. A person with permission confirms it." },
  "student-intake": { name: "Add and enrol students", what: "Prepare a batch of new students for review. An owner or admin confirms it." },
  "student-corrections": { name: "Correct student records", what: "Prepare corrections to names, date of birth, gender and email. An owner or admin confirms them." },
  "assistant-model-routing": {
    name: "AI understanding",
    what: "Sends what staff type to the AI provider so requests can be understood in everyday language. Without it the panel still works, by buttons and fixed phrases.",
  },
};

const CONFIRM_ON: Partial<Record<FeatureKey, string>> = {
  "assistant-model-routing":
    "What staff type in the Assistant will be sent to the AI provider. Names on the school's roster and other personal details are screened out first, but screening cannot catch everything. Only turn this on for a school the owner has approved, after its consent is recorded.",
};

function Row({
  item,
  schoolName,
  busy,
  disabled,
  onSet,
}: {
  item: AssistantActivationItemDto;
  schoolName: string;
  busy: boolean;
  disabled: boolean;
  onSet: (key: FeatureKey, next: boolean) => void;
}) {
  const label = ROW_LABEL[item.key]!;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border p-3" data-testid={`assistant-row-${item.key}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{label.name}</span>
        <Badge variant={item.switchOn ? "success" : "muted"}>{item.switchOn ? "Switch on" : "Switch off"}</Badge>
        <Badge variant={item.working ? "success" : item.switchOn ? "warning" : "muted"}>{item.working ? "Working" : "Not working"}</Badge>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={disabled}
          aria-label={`${item.switchOn ? "Turn off" : "Turn on"} ${label.name} for ${schoolName}`}
          onClick={() => onSet(item.key, !item.switchOn)}
        >
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {item.switchOn ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{label.what}</p>
      {item.blockers.length > 0 ? (
        <ul className="list-disc pl-5 text-sm">
          {item.blockers.map((b) => (
            <li key={b} data-blocker={b}>
              {ASSISTANT_BLOCKER_TEXT[b]}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function AssistantActivationSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [status, setStatus] = useState<PlatformAdminAssistantStatusDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<FeatureKey | null>(null);
  const [pilotBusy, setPilotBusy] = useState(false);
  const [reviewEvidence, setReviewEvidence] = useState("");
  const [reviewSchoolName, setReviewSchoolName] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await proxyFetch<PlatformAdminAssistantStatusDto>(`/api/platform-admin/schools/${school.schoolId}/assistant`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [school.schoolId]);

  // Re-read when the school's AI switch or budget changes elsewhere in the dialog.
  useEffect(() => {
    void load();
  }, [load, school.aiEnabled, school.aiMonthlyTokenBudget]);

  async function set(key: FeatureKey, next: boolean) {
    const name = ROW_LABEL[key]!.name;
    if (next && !window.confirm(`Turn on ${name} for ${school.name}? ${CONFIRM_ON[key] ?? "Only turn it on for a school the owner has approved."}`)) return;
    setBusyKey(key);
    try {
      const payload: PlatformAdminSetFeatureInput = { key, enabled: next };
      const res = await proxyFetch<PlatformAdminSetFeatureResponse>(`/api/platform-admin/schools/${school.schoolId}/features`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onChanged({ featureSwitches: res.featureSwitches });
      toast.success(`${name}: switch ${res.featureSwitches[key] ? "on" : "off"} for ${school.name}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not update ${name}.`);
    } finally {
      // The server's view after the write (or after a refusal), never a guess.
      await load();
      setBusyKey(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-assistant">
      <h3 id="manage-assistant" className="font-medium">
        SchoolKit Assistant
      </h3>
      <p className="text-sm text-muted-foreground">
        Off for every school until you turn it on here. The school cannot turn it on itself. Each task still needs the staff
        member&apos;s own permissions, and nothing is issued, sent or saved without a person&apos;s approval.
      </p>
      {failed ? (
        <p className="text-sm text-destructive" role="alert">
          Could not read the Assistant&apos;s status for this school.{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : status === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading status
        </p>
      ) : (
        <>


          <div className="space-y-3 rounded-lg border p-3">
            <p className="text-sm font-medium">School data: {status.aiUnderstanding.dataClassification}</p>
            <p className="text-xs text-muted-foreground">Existing school records are preserved. A Super Admin may classify an existing school as fictional only after independently reviewing all relevant records and verifying they contain no real personal data. This confirmation is audited; software cannot prove records are invented.</p>
            {status.aiUnderstanding.dataClassification !== "FICTIONAL" && <>
              <label className="block text-xs font-medium">School name reviewed for fictional-data classification
                <input className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm" value={reviewSchoolName} onChange={e => setReviewSchoolName(e.target.value)} placeholder={school.name} />
              </label>
              <label className="block text-xs font-medium">Evidence reference (review log or ticket)
                <input className="mt-1 w-full rounded-md border bg-background px-2 py-2 text-sm" maxLength={300} value={reviewEvidence} onChange={e => setReviewEvidence(e.target.value)} placeholder="Reference to completed data review" />
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" className="mt-1" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)} />
                I have reviewed this school&apos;s records and confirm they are exclusively invented test data, with no real student, guardian or staff personal data.
              </label>
              <Button type="button" size="sm" variant="outline" disabled={pilotBusy || !reviewConfirmed || reviewSchoolName !== school.name || reviewEvidence.trim().length < 3} onClick={async () => {
                if (!window.confirm(`Confirm ${school.name} contains fictional data only? This is an audited Super Admin assertion, not an automated data verification.`)) return;
                setPilotBusy(true);
                try {
                  await proxyFetch(`/api/platform-admin/schools/${school.schoolId}/ai-data-classification`, {method:"PATCH",body:JSON.stringify({classification:"FICTIONAL",existingRecordsReview:{confirmFictionalOnly:true,evidenceReference:reviewEvidence.trim(),reviewedSchoolName:reviewSchoolName}})});
                  toast.success("Fictional classification saved."); await load();
                } catch(err) {toast.error(err instanceof ApiError ? err.message : "Classification failed.");}
                finally {setPilotBusy(false);}
              }}>Classify reviewed school as fictional</Button>
            </>}
            {status.aiUnderstanding.dataClassification === "FICTIONAL" && <p className="text-xs text-muted-foreground">Existing records remain untouched. The fictional seed endpoint is intended only for empty schools; do not seed this existing school.</p>}
          </div>
          <AssistantReleaseConsole scope={status.aiUnderstanding.dataClassification} onChanged={() => void load()} />
          <ul className="flex flex-col gap-2">
            {[status.workspace, status.workflows.invoices, status.workflows.reminders, status.workflows.intake, status.workflows.corrections, status.aiUnderstanding].map((item) => (
              <Row key={item.key} item={item} schoolName={school.name} busy={busyKey === item.key} disabled={busyKey !== null} onSet={(k, n) => void set(k, n)} />
            ))}
          </ul>
          <p className="text-sm text-muted-foreground" data-testid="assistant-ai-facts">
            AI for this school: {status.ai.schoolEnabled ? "on" : "off"}. AI provider key on the server:{" "}
            {status.ai.providerConfigured ? "configured" : "not configured"}. Tokens this month:{" "}
            {status.ai.tokensUsedThisMonth.toLocaleString("en-NG")} of {status.ai.monthlyTokenBudget.toLocaleString("en-NG")}. Owner&apos;s
            approval of the AI prompt: {status.aiUnderstanding.allowlistApproval === "approved" ? "recorded" : "not recorded"}.
            {" "}School data: {status.aiUnderstanding.dataClassification === "FICTIONAL" ? "fictional (pilot)" : "live"}. AI release for
            this data: {status.aiUnderstanding.approval === "approved" ? "authorised" : "not authorised"}. Owner&apos;s AI terms:{" "}
            {status.aiUnderstanding.termsAccepted ? "accepted" : "not accepted"}.
          </p>
          <p className="text-sm text-muted-foreground">
            A change can take up to {status.switchCacheSeconds} seconds to reach every member of staff.
          </p>
        </>
      )}
    </section>
  );
}
