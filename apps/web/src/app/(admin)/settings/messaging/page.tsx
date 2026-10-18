"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { MessagingStaffDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { getMessagingStaff, setMessagingRoles } from "@/lib/messages/messages-api";

// Phase 9 / CP8.1 — Settings → Messaging (docs/modules/phase-9.md §17.8). The
// admin appoints who parents can write to beyond the class teacher, the
// bursar and the school admin: the Principal (JSS, SSS), the Head teacher
// (nursery, primary) and the Inbox officers who answer for the school office.
// Each is an extra role; the person keeps their own.

type Key = "principal" | "headTeacher" | "inboxOfficer";

const GROUPS: { key: Key; title: string; help: string }[] = [
  { key: "principal", title: "Principal", help: "Parents of JSS and SSS children can write to the principal." },
  { key: "headTeacher", title: "Head teacher", help: "Parents of nursery and primary children can write to the head teacher." },
  {
    key: "inboxOfficer",
    title: "Inbox officers",
    help: "They answer messages to the school office and can write to a parent. With none, the owner and admins answer the office.",
  },
];

export default function MessagingSettingsPage() {
  const [rows, setRows] = useState<MessagingStaffDto[] | null>(null);
  const [chosen, setChosen] = useState<Record<Key, string[]>>({ principal: [], headTeacher: [], inboxOfficer: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load(r: MessagingStaffDto[]) {
    setRows(r);
    setChosen({
      principal: r.filter((s) => s.principal).map((s) => s.id),
      headTeacher: r.filter((s) => s.headTeacher).map((s) => s.id),
      inboxOfficer: r.filter((s) => s.inboxOfficer).map((s) => s.id),
    });
  }

  useEffect(() => {
    getMessagingStaff()
      .then(load)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load staff."));
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      load(await setMessagingRoles({ principalIds: chosen.principal, headTeacherIds: chosen.headTeacher, inboxOfficerIds: chosen.inboxOfficer }));
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/settings" className="text-sm text-primary hover:underline">
        ← Settings
      </Link>
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Messaging</h1>
        <p className="text-sm text-muted-foreground">
          Parents can write privately to their child&apos;s form or class teacher, the bursar, the school admin and the school office. Choose who else they can reach. Only the person or office a parent writes to sees the message.
        </p>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      {!rows ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        GROUPS.map((g) => (
          <section key={g.key} aria-labelledby={`msg-${g.key}`} className="space-y-3 rounded-md border bg-card p-4">
            <h2 id={`msg-${g.key}`} className="font-serif text-lg font-medium">
              {g.title}
            </h2>
            <p className="text-sm text-muted-foreground">{g.help}</p>
            <fieldset className="space-y-1">
              <legend className="sr-only">{g.title}</legend>
              {rows.map((s) => (
                <label key={s.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={chosen[g.key].includes(s.id)}
                    onChange={(e) =>
                      setChosen({ ...chosen, [g.key]: e.target.checked ? [...chosen[g.key], s.id] : chosen[g.key].filter((c) => c !== s.id) })
                    }
                  />
                  <span className="min-w-0 break-words">
                    {s.name}
                    {s.roles.length > 0 && <span className="text-muted-foreground"> ({s.roles.join(", ")})</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          </section>
        ))
      )}
      {saved && <p className="text-sm text-emerald-800 dark:text-emerald-300">Messaging roles saved.</p>}
      <Button onClick={() => void save()} disabled={saving || !rows}>
        {saving ? "Saving…" : "Save messaging roles"}
      </Button>
    </div>
  );
}
