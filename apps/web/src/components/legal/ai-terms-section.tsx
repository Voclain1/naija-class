"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { SchoolAiTermsDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-client";
import { aiTermsView } from "@/lib/assistant/ai-terms";

// Settings → Data protection → SchoolKit Assistant AI terms
// (docs/modules/assistant-ai-governance.md). Anyone who reaches the page can
// read the terms; only the owner can accept or withdraw (the API checks it
// again). Accepting switches nothing on: only SchoolKit can.
export function AiTermsSection() {
  const [status, setStatus] = useState<SchoolAiTermsDto | null>(null);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<SchoolAiTermsDto>("/schools/me/ai-terms")
      .then(setStatus)
      .catch((e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not load the AI terms."));
  }, []);

  async function decide(action: "accept" | "withdraw") {
    if (!status) return;
    setSaving(true);
    try {
      const body = action === "accept" ? { version: status.currentVersion, accept: true } : { withdraw: true };
      setStatus(await apiFetch<SchoolAiTermsDto>(`/schools/me/ai-terms/${action}`, { method: "POST", body }));
      setTicked(false);
      toast.success(action === "accept" ? "Accepted." : "Withdrawn. AI understanding is stopped for your school.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const view = aiTermsView(status);
  return (
    <section aria-labelledby="dp-ai-terms" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
      <h2 id="dp-ai-terms" className="text-lg font-semibold">
        SchoolKit Assistant: AI terms
      </h2>
      {view.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <p
            className={
              view.kind === "accepted"
                ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100"
                : "rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            }
          >
            <span className="font-medium">{view.kind === "accepted" ? "Accepted." : "Not accepted."}</span> {view.text}
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
            {status!.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Version {status!.currentVersion}</p>
          {status!.canDecide ? (
            view.kind === "accepted" ? (
              <Button type="button" variant="outline" className="self-start" disabled={saving} onClick={() => void decide("withdraw")}>
                {saving ? "Saving…" : "Withdraw acceptance"}
              </Button>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
                  <span>I have read these terms and accept them for the school.</span>
                </label>
                <Button type="button" className="self-start" disabled={!ticked || saving} onClick={() => void decide("accept")}>
                  {saving ? "Saving…" : "Accept"}
                </Button>
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Only the school owner can accept or withdraw these terms.</p>
          )}
        </>
      )}
    </section>
  );
}
