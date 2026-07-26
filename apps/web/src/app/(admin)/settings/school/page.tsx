"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoUpload } from "@/components/school/logo-upload";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { patchSchoolMe } from "@/lib/onboarding/schools-api";

// /settings/school — the school-basics + branding edit screen the original
// Phase 0 spec named (docs/modules/phase-0.md) but never actually got built
// until now (2026-07-26, alongside the real logo upload it was meant to
// house). Owner/admin only — PATCH /schools/me enforces it server-side.
export default function SchoolSettingsPage() {
  const { school, setSchool } = useAuth();

  const [name, setName] = useState(school?.name ?? "");
  const [motto, setMotto] = useState(school?.motto ?? "");
  const [address, setAddress] = useState(school?.address ?? "");
  const [phone, setPhone] = useState(school?.phone ?? "");
  const [email, setEmail] = useState(school?.email ?? "");
  const [saving, setSaving] = useState(false);

  if (!school) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const dirty =
    name !== (school.name ?? "") ||
    motto !== (school.motto ?? "") ||
    address !== (school.address ?? "") ||
    phone !== (school.phone ?? "") ||
    email !== (school.email ?? "");

  async function onSave(): Promise<void> {
    setSaving(true);
    try {
      const updated = await patchSchoolMe({
        name,
        motto: motto.trim() || undefined,
        address: address.trim() || undefined,
        phone,
        email,
      });
      setSchool(updated);
      toast.success("School details saved.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">School details</h1>
        <p className="text-sm text-muted-foreground">
          Basic information and branding shown across the app.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <Label>Logo</Label>
        <LogoUpload />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">School name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="motto">Motto (optional)</Label>
          <Input id="motto" value={motto} onChange={(e) => setMotto(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="address">Address (optional)</Label>
          <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" disabled={!dirty || saving} onClick={() => void onSave()}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {saving ? "Saving…" : "Save"}
        </Button>
        {dirty && <span className="text-xs text-amber-700">Unsaved change.</span>}
      </div>
    </div>
  );
}
