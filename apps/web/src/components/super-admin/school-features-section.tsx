"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type {
  PlatformAdminSchoolDto,
  PlatformAdminSetSmartImportInput,
  PlatformAdminSetSmartImportResponse,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, proxyFetch } from "@/lib/api-client";

// Smart Student Import's own switch (2026-10-11), in the school's Manage
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
