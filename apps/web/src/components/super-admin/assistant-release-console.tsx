"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { AiReleaseScope, AiReleaseStatusDto, AiReleaseRequirementDto } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ApiError, proxyFetch } from "@/lib/api-client";

const endpoint = "/api/platform-admin/ai-release";
function errorText(err: unknown) { return err instanceof ApiError ? err.message : "The request failed. Please retry."; }

export function AssistantReleaseConsole({ scope, onChanged }: { scope: AiReleaseScope; onChanged: () => void }) {
  const [data, setData] = useState<AiReleaseStatusDto | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [decisionReference, setDecisionReference] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const load = useCallback(async () => {
    try { setData(await proxyFetch<AiReleaseStatusDto>(endpoint)); setFailed(false); }
    catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const current = data?.scopes[scope];
  async function post(path: string, body: object) {
    setBusy(true);
    try {
      await proxyFetch<AiReleaseStatusDto>(`${endpoint}/${scope}/${path}`, { method: "POST", body: JSON.stringify(body) });
      await load(); onChanged(); toast.success("AI release status updated.");
    } catch (err) { toast.error(errorText(err)); }
    finally { setBusy(false); }
  }
  async function attest(req: AiReleaseRequirementDto) {
    const reference = references[req.id]?.trim() ?? "";
    if (reference.length < 3) return toast.error("Provide an evidence reference (at least 3 characters).");
    if (!window.confirm(`Confirm this statement is true?\n\n${req.statement}\n\nEvidence: ${reference}`)) return;
    await post("attestations", { requirementId: req.id, confirm: true, reference });
  }
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="AI release governance">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">AI release — {scope === "FICTIONAL" ? "fictional-data pilot" : "live school data"}</h4>
        {current && <Badge variant={current.authorised ? "success" : "warning"}>{current.authorised ? "Authorised" : "Not authorised"}</Badge>}
        <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={busy}>Refresh</Button>
      </div>
      <p className="text-sm text-muted-foreground">This release applies to every school classified {scope}. School-level switches and owner acceptance are still required. Only confirm facts you have personally verified.</p>
      {failed && <p role="alert" className="text-sm text-destructive">Could not load release status.</p>}
      {!current && !failed && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin"/>Loading release requirements</p>}
      {current && <>
        <p className="text-xs text-muted-foreground">Checklist version: {current.requirementsVersion}. {current.complete ? "All requirements complete." : "Incomplete — authorisation is blocked."}</p>
        <ul className="space-y-2">
          {current.requirements.map(req => <li key={req.id} className="space-y-1 rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{req.title}</span><Badge variant={req.status === "open" ? "warning" : "success"}>{req.status}</Badge></div>
            <p className="text-xs text-muted-foreground">{req.statement}</p>
            {req.evidence && <p className="break-words text-xs">Evidence: {req.evidence}</p>}
            {req.kind === "attestation" && req.status === "open" && <div className="flex flex-wrap gap-2">
              <input aria-label={`Evidence reference for ${req.title}`} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-sm" placeholder="Evidence reference or document" maxLength={300} value={references[req.id] ?? ""} onChange={e => setReferences(prev => ({...prev,[req.id]:e.target.value}))}/>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void attest(req)}>Attest</Button>
            </div>}
          </li>)}
        </ul>
        {current.lastDecision && <p className="text-xs text-muted-foreground">Last decision: {current.lastDecision.action} · {new Date(current.lastDecision.at).toLocaleString("en-NG")}</p>}
        {!current.authorised && <div className="space-y-2">
          <input aria-label="Release authorisation evidence reference" className="w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="Release decision evidence reference" maxLength={300} value={decisionReference} onChange={e => setDecisionReference(e.target.value)}/>
          <Button type="button" disabled={busy || !current.complete || decisionReference.trim().length < 3} onClick={() => { if(window.confirm(`Authorise ${scope} AI processing for all schools of this classification? School switches and owner terms remain required.`)) void post("authorise", { confirm: true, reference: decisionReference.trim() }); }}>Authorise {scope} release</Button>
        </div>}
        {current.authorised && <div className="space-y-2">
          <input aria-label="Reason to revoke release" className="w-full rounded-md border bg-background px-2 py-1 text-sm" placeholder="Reason for emergency revocation" maxLength={300} value={revokeReason} onChange={e => setRevokeReason(e.target.value)}/>
          <Button type="button" variant="destructive" disabled={busy || revokeReason.trim().length < 3} onClick={() => { if(window.confirm(`Revoke ${scope} release? This stops model-backed requests for every ${scope} school.`)) void post("revoke", { reason: revokeReason.trim() }); }}>Revoke release immediately</Button>
        </div>}
      </>}
    </section>
  );
}
