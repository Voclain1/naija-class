"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { formatMinuteOfDay, lagosTodayIso, type DailyRouteListDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { ListExportMenu } from "@/components/shared/list-export-menu";
import { PrintButton } from "@/components/shared/print-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import type { CsvColumn } from "@/lib/csv-export";
import { getDailyList } from "@/lib/transport/transport-api";

// Phase 9 / CP5.3 — the route for one day, stop by stop, for the driver
// (docs/modules/phase-9.md §13 CP5-D9). Printed from the browser, or as a PDF
// or Excel file through the audited list export. It carries each child's
// primary guardian's phone (owner, 2026-10-16), so the page and every copy
// say it is confidential.

interface Row {
  stop: string;
  pickup: string;
  name: string;
  admissionNumber: string;
  classArm: string;
  guardianPhone: string;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: "Stop", accessor: (r) => r.stop },
  { header: "Pickup", accessor: (r) => r.pickup },
  { header: "Child", accessor: (r) => r.name },
  { header: "Class", accessor: (r) => r.classArm },
  { header: "Parent's phone", accessor: (r) => r.guardianPhone },
];

const CONFIDENTIAL = "Confidential: for the driver's use on this route.";

function rowsOf(list: DailyRouteListDto): Row[] {
  return list.stops.flatMap((s) =>
    s.children.map((c) => ({
      stop: s.name,
      pickup: s.pickupMinute === null ? "" : formatMinuteOfDay(s.pickupMinute),
      name: c.name,
      admissionNumber: c.admissionNumber,
      classArm: c.classArm ?? "",
      guardianPhone: c.guardianPhone ?? "",
    })),
  );
}

export default function DailyRouteListPage() {
  const { id } = useParams<{ id: string }>();
  const [date, setDate] = useState(() => lagosTodayIso());
  const [list, setList] = useState<DailyRouteListDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    setError(null);
    try {
      setList(await getDailyList(id, date));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the list.");
    }
  }, [id, date]);
  useEffect(() => void load(), [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="space-y-1 print:hidden">
        <Link href={`/transport/routes/${id}`} className="text-sm text-primary underline-offset-2 hover:underline">
          ← Route
        </Link>
      </div>
      <div className="space-y-1">
        <h1 className="break-words font-serif text-2xl font-semibold">{list ? list.route.name : "Route list"}</h1>
        {list && (
          <p className="text-sm text-muted-foreground">
            {list.date}
            {list.termName ? ` · ${list.termName}` : ""}
            {list.route.vehiclePlate ? ` · ${list.route.vehiclePlate}` : ""}
            {list.route.driverName ? ` · ${list.route.driverName}` : ""}
            {list.route.driverPhone ? `, ${list.route.driverPhone}` : ""}
          </p>
        )}
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{CONFIDENTIAL}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end print:hidden">
        <div className="space-y-1">
          <Label htmlFor="daily-date">Date</Label>
          <Input id="daily-date" type="date" className="sm:w-48" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintButton disabled={!list} />
          {list && (
            <ListExportMenu
              title={`${list.route.name} — ${list.date}`}
              subtitle={CONFIDENTIAL}
              csvFilename={`route-${list.date}.csv`}
              columns={COLUMNS}
              getRows={() => rowsOf(list)}
            />
          )}
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}
      {!list ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          {list.termId === null && <p className="text-sm text-muted-foreground">That date is not in any term, so no children are listed.</p>}
          <p className="text-sm">
            {list.total} {list.total === 1 ? "child" : "children"}
          </p>
          <ol className="space-y-3">
            {list.stops.map((s, i) => (
              <li key={s.id} className="break-inside-avoid rounded-md border bg-card p-3">
                <p className="font-medium">
                  {i + 1}. {s.name}
                  {s.pickupMinute !== null && <span className="text-muted-foreground"> · {formatMinuteOfDay(s.pickupMinute)}</span>}
                </p>
                {s.children.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one at this stop.</p>
                ) : (
                  <ul className="mt-2 divide-y text-sm">
                    {s.children.map((c) => (
                      <li key={c.studentId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5">
                        <span className="min-w-0 break-words">
                          {c.name}
                          {c.classArm && <span className="text-muted-foreground"> · {c.classArm}</span>}
                        </span>
                        {c.guardianPhone ? (
                          <a href={`tel:${c.guardianPhone}`} className="tabular-nums underline-offset-2 hover:underline">
                            {c.guardianPhone}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">No parent phone</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
