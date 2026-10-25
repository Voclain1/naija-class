"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { LEGAL_URLS, parentNoticeLetter, type SchoolDataProtectionDto } from "@school-kit/types";

import { LegalLink, SchoolConsentText } from "@/components/legal/legal-links";
import { Button } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";

// Settings → Data protection (docs/modules/data-protection.md): the owner's
// confirmation, with the wording version it covers; the letter that tells
// parents the school uses SchoolKit and asks their consent; and the legal
// documents. Any member of staff who reaches Settings can read it; only the
// owner can confirm, because it binds the school.

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

export default function DataProtectionSettingsPage() {
  const { school, roles } = useAuth();
  const isOwner = roles.some((r) => r.key === "owner");
  const [status, setStatus] = useState<SchoolDataProtectionDto | null>(null);
  const [ticked, setTicked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<SchoolDataProtectionDto>("/schools/me/data-protection")
      .then(setStatus)
      .catch((e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not load this page."));
  }, []);

  const letter = useMemo(
    () =>
      school
        ? parentNoticeLetter({ schoolName: school.name, schoolEmail: school.email, schoolPhone: school.phone, parentsUrl: school.siteUrls.parents })
        : "",
    [school],
  );

  async function confirm() {
    setSaving(true);
    try {
      setStatus(await apiFetch<SchoolDataProtectionDto>("/schools/me/data-protection/confirm", { method: "POST", body: { confirm: true } }));
      setTicked(false);
      toast.success("Confirmed. Thank you.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letter);
      toast.success("Letter copied.");
    } catch {
      toast.error("Could not copy. Select the text and copy it instead.");
    }
  }

  function printLetter() {
    const w = window.open("", "_blank", "noopener=no");
    if (!w) return;
    const doc = w.document;
    doc.title = "Letter to parents";
    const pre = doc.createElement("pre");
    pre.style.cssText = "font: 15px/1.6 Georgia, serif; white-space: pre-wrap; max-width: 680px; margin: 40px auto;";
    pre.textContent = letter;
    doc.body.appendChild(pre);
    w.print();
  }

  function downloadLetter() {
    const url = URL.createObjectURL(new Blob([letter], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "letter-to-parents.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Data protection</h1>
        <p className="text-sm text-muted-foreground">
          Nigerian data protection law asks your school to get each parent&apos;s consent before keeping their
          child&apos;s details, and to tell families how their information is used. This page helps you do both.
        </p>
      </header>

      <section aria-labelledby="dp-confirm" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
        <h2 id="dp-confirm" className="text-lg font-semibold">
          Your school&apos;s confirmation
        </h2>
        {status === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : status.current ? (
          <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
            <span className="font-medium">Confirmed.</span>{" "}
            {status.confirmedAt && `On ${formatDate(status.confirmedAt)}`}
            {status.confirmedByName && ` by ${status.confirmedByName}`}.
          </p>
        ) : (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
            <span className="font-medium">Please confirm.</span> SchoolKit&apos;s data protection terms were updated on{" "}
            {formatDate(status.currentVersion)}.{" "}
            {status.confirmedAt ? `Your school last confirmed on ${formatDate(status.confirmedAt)}.` : ""}
          </p>
        )}
        {status && !status.current && (
          isOwner ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
                <SchoolConsentText />
              </label>
              <Button type="button" className="self-start" disabled={!ticked || saving} onClick={() => void confirm()}>
                {saving ? "Saving…" : "Confirm"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Only the school owner can confirm this.</p>
          )
        )}
      </section>

      <section aria-labelledby="dp-letter" className="flex flex-col gap-3 rounded-lg border bg-card p-5">
        <h2 id="dp-letter" className="text-lg font-semibold">
          Letter to parents
        </h2>
        <p className="text-sm text-muted-foreground">
          Send this to every family, by email, on WhatsApp or printed, and keep the signed slips with each child&apos;s
          file. It tells parents what you keep and why, and asks their consent, including separate consent for health
          information. Families who apply through your online admission form give consent on the form, and parents
          agree to SchoolKit&apos;s privacy policy when they first sign in; SchoolKit keeps a record of both.
        </p>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-sans text-sm leading-relaxed">{letter}</pre>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyLetter()}>
            Copy
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={printLetter}>
            Print
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={downloadLetter}>
            Download
          </Button>
        </div>
      </section>

      <section aria-labelledby="dp-docs" className="flex flex-col gap-2 rounded-lg border bg-card p-5">
        <h2 id="dp-docs" className="text-lg font-semibold">
          The documents
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          <li>
            <LegalLink href={LEGAL_URLS.dataProcessing}>Data Processing Agreement</LegalLink> — what SchoolKit does
            with your school&apos;s data, and what your school is responsible for.
          </li>
          <li>
            <LegalLink href={LEGAL_URLS.privacy}>Privacy Policy</LegalLink> — what is collected, who it is shared with,
            and how long it is kept.
          </li>
          <li>
            <LegalLink href={LEGAL_URLS.terms}>Terms of Service</LegalLink> and the{" "}
            <LegalLink href={LEGAL_URLS.refunds}>Refund Policy</LegalLink>.
          </li>
          <li>
            <LegalLink href={LEGAL_URLS.deleteAccount}>Delete your account</LegalLink> — what to tell a parent or member
            of staff who asks. Requests made in the app arrive under Settings → Account deletion requests.
          </li>
        </ul>
      </section>
    </div>
  );
}
