"use client";

import { useState } from "react";
import { toast } from "sonner";

import type {
  PlatformAdminSchoolDto,
  PlatformAdminSetAiEnabledInput,
  PlatformAdminSetAiEnabledResponse,
  PlatformAdminSetEarlyAccessInput,
  PlatformAdminSetEarlyAccessResponse,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, proxyFetch } from "@/lib/api-client";

// The per-school switches that used to be Schools table columns (moved here in
// the 2026-10-30 console redesign, docs/modules/platform-admin.md). Same calls
// and the same rules as before:
// - AI is read on the API's hot path, so it takes effect on the school's next
//   request. Turning it ON asks first; turning it OFF does not, because a kill
//   switch you have to argue with is a broken kill switch.
// - Early access is a marker only (School.earlyAccessGrantedAt); nothing reads
//   it to decide anything.
// - Staff mobile is READ-ONLY: enablement runs through the one-school rollout
//   rail (apps/api/scripts/set-staff-mobile.ts) with its dry run and exact
//   --confirm-school-id. A one-click toggle would undo that friction.

interface Props {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}

export function SchoolSwitchesSection({ school, onChanged }: Props) {
  const [busy, setBusy] = useState<"ai" | "early" | null>(null);

  async function setAi(next: boolean) {
    if (next && !window.confirm(`Enable AI features for ${school.name}?`))
      return;
    setBusy("ai");
    try {
      const payload: PlatformAdminSetAiEnabledInput = { aiEnabled: next };
      const res = await proxyFetch<PlatformAdminSetAiEnabledResponse>(
        `/api/platform-admin/schools/${school.schoolId}/ai`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      onChanged({ aiEnabled: res.aiEnabled });
      toast.success(
        next
          ? `AI enabled for ${school.name}.`
          : `AI disabled for ${school.name}.`,
      );
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Could not update AI access.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function setEarly(next: boolean) {
    setBusy("early");
    try {
      const payload: PlatformAdminSetEarlyAccessInput = { earlyAccess: next };
      const res = await proxyFetch<PlatformAdminSetEarlyAccessResponse>(
        `/api/platform-admin/schools/${school.schoolId}/early-access`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      );
      onChanged({ earlyAccessGrantedAt: res.earlyAccessGrantedAt });
      toast.success(next ? "Marked as early access." : "Early access removed.");
    } catch (err) {
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not update early access.",
      );
    } finally {
      setBusy(null);
    }
  }

  const row =
    "flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2";

  return (
    <section className="flex flex-col gap-2" aria-labelledby="manage-switches">
      <h3 id="manage-switches" className="font-medium">
        Switches
      </h3>
      <div className={row}>
        <span className="flex items-center gap-2 text-sm">
          AI features{" "}
          <Badge variant={school.aiEnabled ? "success" : "muted"}>
            {school.aiEnabled ? "On" : "Off"}
          </Badge>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void setAi(!school.aiEnabled)}
        >
          {busy === "ai"
            ? "Saving…"
            : school.aiEnabled
              ? "Turn off"
              : "Turn on"}
        </Button>
      </div>
      <div className={row}>
        <span className="flex items-center gap-2 text-sm">
          Early access
          {school.earlyAccessGrantedAt ? (
            <Badge variant="success">
              Since{" "}
              {new Date(school.earlyAccessGrantedAt).toLocaleDateString(
                "en-NG",
              )}
            </Badge>
          ) : (
            <Badge variant="muted">No</Badge>
          )}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => void setEarly(!school.earlyAccessGrantedAt)}
        >
          {busy === "early"
            ? "Saving…"
            : school.earlyAccessGrantedAt
              ? "Remove"
              : "Mark"}
        </Button>
      </div>
      <div className={row}>
        <span className="flex items-center gap-2 text-sm">
          Staff mobile app{" "}
          <Badge variant={school.staffMobileEnabled ? "success" : "muted"}>
            {school.staffMobileEnabled ? "On" : "Off"}
          </Badge>
        </span>
        <span className="text-xs text-muted-foreground">
          Changed with the rollout script
        </span>
      </div>
    </section>
  );
}
