"use client";

import { Mail, MessageCircle, Phone, RefreshCw, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ACTIVATION_STAGES,
  activationStageLabel,
  daysSince,
  whatsappDigits,
  type ActivationStage,
  type PlatformActivationDto,
  type PlatformActivationEmailDto,
  type PlatformActivationSchoolDto,
} from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError, proxyFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { ConsoleHeading } from "./console-shell";
import { usePlatformLoad } from "./platform-load";

// Getting started (docs/modules/activation.md): where every school is after
// signing up, the setup reminders its owner has had and what happened to
// them, and the owner's contacts to call or WhatsApp. Contacts are shown on
// every row, by the owner's decision (2026-10-30).

type View = "stuck" | "emailed-not-moved" | "all" | ActivationStage;

const KIND_LABEL: Record<PlatformActivationEmailDto["kind"], string> = {
  FIRST: "1st",
  SECOND: "2nd",
  THIRD: "3rd",
};

function emailState(e: PlatformActivationEmailDto): string {
  if (e.status === "FAILED") return "not sent";
  if (e.status === "BOUNCED") return "bounced";
  if (e.status === "COMPLAINED") return "marked spam";
  if (e.clickCount > 0)
    return `clicked${e.clickCount > 1 ? ` ×${e.clickCount}` : ""}`;
  return e.status === "DELIVERED" ? "delivered" : "sent";
}

function whatsappHref(row: PlatformActivationSchoolDto): string | null {
  const digits = whatsappDigits(row.owner?.phone);
  if (!digits) return null;
  const first = row.owner?.name.split(" ")[0] ?? "";
  const text = `Hello${first ? ` ${first}` : ""}, this is the SchoolKit team. We'd love to help you finish setting up ${row.name}. Do you have a few minutes for a quick call?`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function GettingStartedPanel() {
  const [data, setData, error] = usePlatformLoad<PlatformActivationDto>(
    "/api/platform-admin/activation",
    "Could not load Getting started.",
  );
  const [refreshing, setRefreshing] = useState(false);

  // The API keeps the list for five minutes; Refresh reads every school again.
  async function refresh() {
    setRefreshing(true);
    try {
      setData(await proxyFetch<PlatformActivationDto>("/api/platform-admin/activation?fresh=1", { method: "GET" }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }
  const [view, setView] = useState<View>("stuck");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return (
      data.schools
        .filter((r) => {
          if (
            q &&
            !r.name.toLowerCase().includes(q) &&
            !r.slug.toLowerCase().includes(q) &&
            !(r.owner?.name.toLowerCase().includes(q) ?? false)
          )
            return false;
          if (view === "stuck") return r.stuck;
          if (view === "emailed-not-moved") return r.movedSinceEmail === false;
          if (view === "all") return true;
          return r.stage === view;
        })
        // Stuck schools oldest first: the longest wait is the first call.
        .sort((a, b) =>
          view === "stuck"
            ? a.signedUpAt.localeCompare(b.signedUpAt)
            : b.signedUpAt.localeCompare(a.signedUpAt),
        )
    );
  }, [data, view, query]);

  const s = data?.summary;

  return (
    <>
      <ConsoleHeading
        title="Getting started"
        description="How far each school has got since signing up, and the setup reminders sent to its owner."
        action={
          data && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>
                Read at {new Date(data.generatedAt).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}
              </span>
              <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw className={cn("mr-1 h-4 w-4", refreshing && "animate-spin")} aria-hidden />
                {refreshing ? "Reading…" : "Refresh"}
              </Button>
            </div>
          )
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!data && !error && (
        <p className="text-sm text-muted-foreground">
          Loading every school… this takes a few seconds.
        </p>
      )}

      {s && (
        <>
          {/* The stages as a row of tiles; each one filters the list. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ACTIVATION_STAGES.map((st) => (
              <button
                key={st.stage}
                type="button"
                onClick={() => setView(view === st.stage ? "all" : st.stage)}
                title={st.detail}
                aria-pressed={view === st.stage}
                className={cn(
                  "rounded-xl bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted",
                  view === st.stage && "bg-primary/10 hover:bg-primary/15",
                  st.stage === 6 &&
                    view !== st.stage &&
                    "bg-emerald-50 dark:bg-emerald-950/30",
                )}
              >
                <span className="block text-xs text-muted-foreground">
                  {st.stage}. {st.label}
                </span>
                <span className="mt-1 block text-2xl font-semibold tabular-nums">
                  {s.byStage[st.stage]}
                </span>
              </button>
            ))}
          </div>

          <Card>
            <CardContent className="flex flex-wrap gap-x-8 gap-y-3 p-4 text-sm">
              <Figure label="Reminders sent" value={s.emailsSent} />
              <Figure label="Delivered" value={s.emailsDelivered} />
              <Figure label="Clicked" value={s.emailsClicked} />
              <Figure label="Schools emailed" value={s.schoolsEmailed} />
              <Figure
                label="Moved on after a reminder"
                value={s.schoolsMovedAfterEmail}
                suffix={s.schoolsEmailed ? ` of ${s.schoolsEmailed}` : ""}
              />
              <Figure label="Stopped reminders" value={s.emailsStopped} />
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Show"
            >
              {(
                [
                  ["stuck", `Stuck (${s.stuck})`],
                  ["emailed-not-moved", "Emailed, not moved"],
                  ["all", `All (${s.schools})`],
                ] as const
              ).map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={view === v ? "default" : "outline"}
                  onClick={() => setView(v)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="relative min-w-0 lg:ml-auto lg:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="School, code or owner"
                className="pl-9"
                aria-label="Search"
              />
            </div>
          </div>

          {typeof view === "number" && (
            <p className="text-sm text-muted-foreground">
              Showing stage {view}, {activationStageLabel(view)}:{" "}
              {ACTIVATION_STAGES[view - 1]?.detail}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No school here.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((r) => (
                <SchoolRow key={r.schoolId} row={r} />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

function Figure({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums">
        {value}
        <span className="text-sm font-normal text-muted-foreground">
          {suffix}
        </span>
      </span>
    </div>
  );
}

function SchoolRow({ row }: { row: PlatformActivationSchoolDto }) {
  const days = daysSince(row.signedUpAt);
  const wa = whatsappHref(row);
  return (
    <li
      className={cn(
        "rounded-xl bg-card p-4 shadow-sm",
        row.stuck && "bg-amber-50 dark:bg-amber-950/25",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{row.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.slug}
            </span>
            <Badge variant={row.stage === 6 ? "success" : "muted"}>
              {row.stage}. {activationStageLabel(row.stage)}
            </Badge>
            {row.stuck && <Badge variant="warning">Stuck</Badge>}
            {row.setupCallBooked && (
              <Badge variant="success">Call booked</Badge>
            )}
            {row.emailsStopped && (
              <Badge variant="muted">Stopped reminders</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed up{" "}
            {days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`} ·{" "}
            {row.students} student{row.students === 1 ? "" : "s"} ·{" "}
            {row.enrolled} in classes · {row.staff} teacher
            {row.staff === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {row.emails.length === 0 ? (
              <span className="text-muted-foreground">No reminder yet</span>
            ) : (
              row.emails.map((e) => (
                <span
                  key={e.kind}
                  className="rounded-full bg-muted px-2 py-0.5"
                  title={new Date(e.sentAt).toLocaleString("en-NG")}
                >
                  {KIND_LABEL[e.kind]} reminder: {emailState(e)}
                </span>
              ))
            )}
            {row.movedSinceEmail === true && (
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                Moved on since
              </span>
            )}
            {row.movedSinceEmail === false && (
              <span className="text-amber-800 dark:text-amber-300">
                Not moved since
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-2 lg:w-80">
          {row.owner ? (
            <>
              <div className="text-sm">
                <span className="font-medium">{row.owner.name}</span>
                {row.owner.invitePending ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · invitation not accepted
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    · last signed in{" "}
                    {row.owner.lastLoginAt
                      ? new Date(row.owner.lastLoginAt).toLocaleDateString(
                          "en-NG",
                        )
                      : "never"}
                  </span>
                )}
              </div>
              <a
                href={`mailto:${row.owner.email}`}
                className="flex min-w-0 items-center gap-2 text-sm text-primary hover:underline"
              >
                <Mail className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{row.owner.email}</span>
              </a>
              {row.owner.phone && (
                <a
                  href={`tel:${row.owner.phone.replace(/\s/g, "")}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Phone className="h-4 w-4 shrink-0" aria-hidden />
                  {row.owner.phone}
                </a>
              )}
              <div className="flex flex-wrap gap-2">
                {wa && (
                  <Button asChild size="sm">
                    <a href={wa} target="_blank" rel="noreferrer">
                      <MessageCircle className="mr-1 h-4 w-4" aria-hidden />
                      WhatsApp
                    </a>
                  </Button>
                )}
                <Button asChild size="sm" variant="outline">
                  <Link
                    href={`/super-admin/dashboard/schools?manage=${row.schoolId}`}
                  >
                    Manage
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No owner on file.</p>
          )}
        </div>
      </div>
    </li>
  );
}
