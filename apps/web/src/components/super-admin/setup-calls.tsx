"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { formatCallSlot, type PlatformOnboardingCallDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, proxyFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// Setup calls booked by new schools (docs/modules/onboarding-call.md): work
// waiting on the team, newest first. Confirm the time on WhatsApp or by email
// (the booker's account email, for a phone that is not on WhatsApp), hold the
// call, then mark it done.

function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `234${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}

function mailLink(email: string): string {
  return `mailto:${email}?subject=${encodeURIComponent("Your SchoolKit setup call")}`;
}

export function SetupCallsCard() {
  const [rows, setRows] = useState<PlatformOnboardingCallDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(() => {
    proxyFetch<PlatformOnboardingCallDto[]>("/api/platform-admin/onboarding-calls", { method: "GET" })
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load setup calls."));
  }, []);

  useEffect(load, [load]);

  async function mark(row: PlatformOnboardingCallDto, done: boolean) {
    try {
      await proxyFetch(`/api/platform-admin/onboarding-calls/${row.schoolId}/${row.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
      load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not update the call.");
    }
  }

  const open = rows?.filter((r) => r.doneAt === null) ?? [];
  const shown = showDone ? (rows ?? []) : open;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Setup calls {open.length > 0 && <Badge>{open.length} to hold</Badge>}
        </CardTitle>
        {rows && rows.length > open.length && (
          <Button variant="ghost" size="sm" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide done" : "Show done"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No setup calls waiting.</p>
        ) : (
          shown.map((r) => (
            <div key={r.id} className={cn("flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center sm:justify-between", r.doneAt ? "bg-muted/50" : "bg-primary/5")}>
              <div className="flex flex-col text-sm">
                <span className="font-semibold">
                  {r.schoolName} <span className="font-normal text-muted-foreground">({r.schoolSlug})</span>
                </span>
                <span>{formatCallSlot(r.date, r.startMinute)}, Lagos time{r.doneAt ? " · Done" : ""}</span>
                <span className="text-muted-foreground">
                  {r.contactName} · {r.contactPhone}
                </span>
                {r.contactEmail && (
                  <span className="break-all text-muted-foreground">{r.contactEmail}</span>
                )}
                {r.note && <span className="text-muted-foreground">“{r.note}”</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={waLink(r.contactPhone)} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                </Button>
                {r.contactEmail && (
                  <Button asChild variant="outline" size="sm">
                    <a href={mailLink(r.contactEmail)}>Email</a>
                  </Button>
                )}
                <Button size="sm" variant={r.doneAt ? "ghost" : "default"} onClick={() => mark(r, r.doneAt === null)}>
                  {r.doneAt ? "Not done" : "Mark done"}
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
