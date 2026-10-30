"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import type {
  PlatformActivationDto,
  PlatformAdminPaystackSetupRequestDto,
  PlatformAdminSchoolDto,
  PlatformOnboardingCallDto,
  PlatformWebsiteReportQueueDto,
} from "@school-kit/types";

import { Card, CardContent } from "@/components/ui/card";
import { getWebsiteReportQueue } from "@/lib/school-website/school-website-api";
import { cn } from "@/lib/utils";

import { ConsoleHeading } from "./console-shell";
import { usePlatformLoad } from "./platform-load";

// The console's home (2026-10-30 redesign): four figures and the short list of
// what is waiting on the team, each line linking to the page that handles it.
// Nothing else lives here; the detail is one click away.

export function OverviewPanel() {
  const [schools] = usePlatformLoad<PlatformAdminSchoolDto[]>(
    "/api/platform-admin/schools",
    "Could not load schools.",
  );
  const [calls] = usePlatformLoad<PlatformOnboardingCallDto[]>(
    "/api/platform-admin/onboarding-calls",
    "Could not load setup calls.",
  );
  const [paystack] = usePlatformLoad<PlatformAdminPaystackSetupRequestDto[]>(
    "/api/platform-admin/paystack-setup-requests",
    "Could not load requests.",
  );
  const [activation] = usePlatformLoad<PlatformActivationDto>(
    "/api/platform-admin/activation",
    "Could not load Getting started.",
  );
  const [reports, setReports] = useState<PlatformWebsiteReportQueueDto | null>(
    null,
  );
  useEffect(() => {
    getWebsiteReportQueue()
      .then(setReports)
      .catch(() => setReports({ schools: [] }));
  }, []);

  const s = activation?.summary;
  const onRoll = schools?.reduce((n, x) => n + x.studentsOnRoll, 0);
  const inUse = s?.byStage[6];

  const needs: { label: string; count: number | undefined; href: string }[] = [
    {
      label: "Setup calls to hold",
      count: calls?.filter((c) => c.doneAt === null).length,
      href: "/super-admin/dashboard/requests?tab=calls",
    },
    {
      label: "Schools stuck in setup",
      count: s?.stuck,
      href: "/super-admin/dashboard/getting-started",
    },
    {
      label: "Paystack subaccounts to create",
      count: paystack?.filter((r) => r.status === "PENDING").length,
      href: "/super-admin/dashboard/requests?tab=paystack",
    },
    {
      label: "Website reports to answer",
      count: reports?.schools.length,
      href: "/super-admin/dashboard/requests?tab=websites",
    },
    {
      label: "SMS sender names to submit",
      count: schools?.filter((x) => x.smsSenderStatus === "REQUESTED").length,
      href: "/super-admin/dashboard/schools",
    },
  ];

  return (
    <>
      <ConsoleHeading
        title="Overview"
        description="SchoolKit at a glance, and what is waiting on the team."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Schools" value={schools?.length} />
        <Stat
          label="Using SchoolKit"
          value={inUse}
          hint="Marked a register, issued an invoice or entered a score"
        />
        <Stat
          label="Stuck in setup"
          value={s?.stuck}
          hint="A week or more, no students in classes"
          tone={s && s.stuck > 0 ? "warn" : undefined}
        />
        <Stat label="Students on roll" value={onRoll} />
      </div>

      <section aria-labelledby="needs-you" className="flex flex-col gap-3">
        <h2 id="needs-you" className="text-lg font-semibold">
          Needs you
        </h2>
        <Card>
          <CardContent className="p-0">
            <ul>
              {needs.map((n, i) => (
                <li key={n.label}>
                  <Link
                    href={n.href}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/60",
                      i > 0 && "border-t border-border/60",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold tabular-nums",
                        n.count
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {n.count ?? "…"}
                    </span>
                    <span className="flex-1">{n.label}</span>
                    {n.count === 0 && (
                      <span className="text-xs text-muted-foreground">
                        All clear
                      </span>
                    )}
                    <ChevronRight
                      className="h-4 w-4 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <Card className={cn(tone === "warn" && "bg-amber-50 dark:bg-amber-950/25")}>
      <CardContent className="p-4">
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="mt-1 block text-3xl font-semibold tabular-nums">
          {value === undefined ? "…" : value.toLocaleString("en-NG")}
        </span>
        {hint && (
          <span className="mt-1 block text-xs text-muted-foreground">
            {hint}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
