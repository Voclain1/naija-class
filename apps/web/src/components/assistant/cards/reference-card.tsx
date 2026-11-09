"use client";

import { useState } from "react";
import { ASSISTANT_WORKFLOW_LABELS } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { correctionApi, invoiceRunApi } from "@/lib/assistant/api";
import type { AssistantTask } from "@/lib/assistant/store";
import { durableCampaignApi } from "@/lib/reminder-campaigns/durable-api";
import { intakeApi } from "@/lib/students/intake-api";

import { useAssistant } from "../assistant-provider";
import { CardShell, Notice } from "./common";

// What remains of a task after the conversation was cleared while its outcome
// was open: its workflow and opaque server ids, nothing typed. It can only
// READ the original proposal, run or campaign; it never repeats an action.

export function ReferenceCard({ task }: { task: AssistantTask }) {
  const { store } = useAssistant();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true); setError(null);
    try {
      const r = task.ref;
      let text: string;
      if (task.workflow === "invoices" && r.runId) {
        const run = await invoiceRunApi.get(r.runId);
        text = run.result ? `Issued: ${run.result.created} invoices, ${run.result.skipped} skipped.` : "Not issued. Nothing was created by this run.";
      } else if (task.workflow === "reminders" && (r.campaignId || r.proposalId)) {
        const id = r.campaignId ?? (await durableCampaignApi.proposal(r.proposalId!)).campaignId;
        if (!id) text = "Not confirmed. No reminders were sent from this review.";
        else {
          const c = await durableCampaignApi.campaign(id);
          text = `Campaign ${c.status.toLowerCase()}: ${c.counts.ACCEPTED} accepted, ${c.counts.UNKNOWN} may have been sent, ${c.counts.PENDING} waiting, ${c.counts.FAILED} refused.`;
        }
      } else if (task.workflow === "intake" && r.proposalId) {
        const p = await intakeApi.get(r.proposalId);
        text = p.status === "COMPLETED" && p.outcome ? `Saved: ${p.outcome.createdCount} students.` : "Not saved. No students were created from this review.";
      } else if (task.workflow === "corrections" && r.proposalId) {
        const p = await correctionApi.get(r.proposalId);
        text = p.status === "COMPLETED" && p.outcome ? `Applied: ${p.outcome.updatedCount} records corrected.` : "Not applied. No record was changed by this review.";
      } else {
        text = "Nothing was sent to the server for this task.";
      }
      setResult(text);
      store.updateTask(task.id, { status: "done" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not check just now. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardShell title={ASSISTANT_WORKFLOW_LABELS[task.workflow]} status={result ? "Checked" : "Check the outcome"} tone={result ? "done" : "warning"}>
      {result ? <Notice tone="success">{result}</Notice> : <Notice tone="warning">This task’s outcome was still open when the conversation was cleared. Check it before doing it again.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {!result && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" disabled={busy} onClick={() => void check()}>{busy ? "Checking…" : "Check the original outcome"}</button>}
    </CardShell>
  );
}
