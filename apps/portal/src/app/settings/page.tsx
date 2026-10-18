"use client";

// Phase 9 / CP8.3 — the parent's own email setting (docs/modules/phase-9.md
// §17.11): announcement emails on or off for the address the school holds.
// An address that bounced or was marked as spam is blocked until the school
// fixes it.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PortalEmailPreferencesDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

import { SchoolBanner } from "@/components/school-banner";
import { portalJson } from "@/lib/portal-api";

export default function SettingsPage() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<PortalEmailPreferencesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void portalJson<PortalEmailPreferencesDto>("/email-preferences", {}, (url) => router.replace(url)).then((r) => {
      if (r.ok) setPrefs(r.body);
      else if (!r.redirected) setError(r.message);
    });
  }, [router]);

  async function set(announcements: boolean) {
    setBusy(true);
    setError(null);
    const r = await portalJson<PortalEmailPreferencesDto>("/email-preferences", { method: "POST", json: { announcements } });
    setBusy(false);
    if (r.ok) setPrefs(r.body);
    else setError(r.message);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <SchoolBanner />
      <div className="flex flex-col gap-2">
        <Link href="/" className="self-start text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
        <PageHeader title="Settings" />
      </div>
      {!prefs && !error && <PageSkeleton rows={2} />}
      {prefs && (
        <section aria-labelledby="emails" className="flex flex-col gap-3 rounded-lg border bg-card p-5 text-sm">
          <h2 id="emails" className="font-medium">
            Emails
          </h2>
          {!prefs.email ? (
            <p className="text-muted-foreground">The school holds no email address for you. Ask the school to add one.</p>
          ) : prefs.blocked ? (
            <p className="rounded-md bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              Emails to <span className="break-all font-medium">{prefs.email}</span> could not be delivered, so the school has stopped sending them.
              Ask the school to check your address.
            </p>
          ) : (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={prefs.announcements} disabled={busy} onChange={(e) => void set(e.target.checked)} />
              <span>
                <span className="font-medium">Email me the school&apos;s announcements</span>
                <span className="block break-words text-xs text-muted-foreground">
                  To {prefs.email}. Messages from the school and receipts arrive either way.
                </span>
              </span>
            </label>
          )}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
