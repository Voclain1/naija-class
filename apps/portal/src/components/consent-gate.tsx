"use client";

import { useEffect, useState } from "react";

import { LEGAL_URLS, type GuardianConsentDto } from "@school-kit/types";

import { portalJson } from "@/lib/portal-api";

// Parents who signed up before the consent wording was recorded, or whose
// agreement is to an older wording, are asked once before they go on
// (docs/modules/data-protection.md). Mounted by SchoolBanner, which every
// signed-in page shows. A failed read shows nothing: this must never lock a
// parent out of their child's page.

let checked: Promise<GuardianConsentDto | null> | null = null;

export function ConsentGate() {
  const [needed, setNeeded] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checked ??= portalJson<GuardianConsentDto>("/me/consent").then((r) => (r.ok ? r.body : null));
    let cancelled = false;
    void checked.then((c) => {
      if (!cancelled && c && !c.current) setNeeded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function agree() {
    setSaving(true);
    setError(null);
    const res = await portalJson<GuardianConsentDto>("/me/consent", { method: "POST", json: { consent: true } });
    setSaving(false);
    if (!res.ok) return setError(res.message);
    checked = Promise.resolve(res.body);
    setNeeded(false);
  }

  if (!needed) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl bg-card p-6 shadow-xl">
        <h2 id="consent-title" className="text-lg font-semibold">
          Before you continue
        </h2>
        <p className="text-sm text-muted-foreground">
          Your school uses SchoolKit to share your child&apos;s results, fees and news with you. SchoolKit keeps this
          information safe for the school, never sells it, and never uses it for advertising.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
          <span>
            I have read the{" "}
            <a href={LEGAL_URLS.privacy} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
              Privacy Policy
            </a>{" "}
            and I accept the{" "}
            <a href={LEGAL_URLS.terms} target="_blank" rel="noreferrer" className="font-medium text-primary underline">
              Terms of Service
            </a>
            .
          </span>
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <button
          type="button"
          disabled={!ticked || saving}
          onClick={() => void agree()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
