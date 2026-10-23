"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { normaliseSchoolAddress, schoolAddressProblem, schoolHost, type PlatformAdminSchoolDto } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, proxyFetch } from "@/lib/api-client";

// The school's web address, set by SchoolKit (docs/modules/school-addresses.md).
// Beyond the school's own limits and never counted against them; the old
// address keeps working. Audited as platform_admin.schools.set-address.
export function SchoolAddressSection({
  school,
  onChanged,
}: {
  school: PlatformAdminSchoolDto;
  onChanged: (patch: Partial<PlatformAdminSchoolDto>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const code = normaliseSchoolAddress(draft);
  const problem = code ? schoolAddressProblem(code) : null;

  async function save() {
    if (!code || problem) return;
    if (!window.confirm(`Change ${school.name}'s address to ${schoolHost(code)}? The old address keeps working.`)) return;
    setBusy(true);
    try {
      const res = await proxyFetch<{ schoolId: string; slug: string }>(
        `/api/platform-admin/schools/${school.schoolId}/address`,
        { method: "PATCH", body: JSON.stringify({ code }) },
      );
      onChanged({ slug: res.slug });
      setDraft("");
      toast.success(`${school.name} is now at ${schoolHost(res.slug)}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change the address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="manage-address">
      <h3 id="manage-address" className="font-medium">
        Web address
      </h3>
      <p className="text-sm text-muted-foreground">
        Now <strong className="text-foreground">{schoolHost(school.slug)}</strong>. A change here does not use up the
        school&apos;s own two a year.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manage-address-input">New address</Label>
          <Input id="manage-address-input" value={draft} onChange={(e) => setDraft(e.target.value)} className="w-56" autoComplete="off" />
        </div>
        <Button type="button" disabled={!code || !!problem || busy} onClick={() => void save()}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Change
        </Button>
      </div>
      {problem && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {problem === "RESERVED" ? "That address is kept for SchoolKit." : "3 to 30 letters, numbers and hyphens."}
        </p>
      )}
    </section>
  );
}
