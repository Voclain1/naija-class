"use client";

import { useEffect, useState } from "react";

import { SCAN_RATINGS, SCAN_RATING_LABELS, SCAN_REVIEW_FIELD_LABELS, type SmartImportBetaDto, type SmartImportBetaFieldDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, proxyFetch } from "@/lib/api-client";

// The Smart Import beta from SchoolKit's side (docs/modules/smart-student-import.md
// §9): per school, pages read and the share of cells admins had to correct, per
// field. Counts only; nothing a child could be named by.

function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function FieldTable({ fields }: { fields: SmartImportBetaFieldDto[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Field</th>
          <th className="py-1 pr-2 font-medium">Corrected</th>
          <th className="py-1 font-medium">Flagged unreadable</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.field} className="border-b last:border-0">
            <td className="py-1 pr-2">{SCAN_REVIEW_FIELD_LABELS[f.field]}</td>
            <td className="py-1 pr-2 tabular-nums">
              {percent(f.changed, f.compared)} <span className="text-muted-foreground">({f.changed} of {f.compared})</span>
            </td>
            <td className="py-1 tabular-nums">{f.flagged}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SmartImportBetaCard() {
  const [data, setData] = useState<SmartImportBetaDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    proxyFetch<SmartImportBetaDto>("/api/platform-admin/smart-import-beta", { method: "GET" })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load the beta results."));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Smart Import <Badge variant="warning">Beta</Badge> results
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : data === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : data.schools.length === 0 ? (
          <p className="text-sm text-muted-foreground">No school is in the beta yet. Turn Smart Import on from a school&apos;s Manage dialog.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {data.totals.scans} page{data.totals.scans === 1 ? "" : "s"} read, {data.totals.scansSaved} saved; {data.totals.rowsRead} rows
              read, {data.totals.rowsRemoved} removed by admins. Reading took {data.totals.averageReadSeconds ?? "—"}s on average,{" "}
              {data.totals.slowestReadSeconds ?? "—"}s at the slowest. Ratings:{" "}
              {SCAN_RATINGS.map((r) => `${SCAN_RATING_LABELS[r]} ${data.totals.ratings[r]}`).join(", ")}.
            </p>
            <FieldTable fields={data.totals.fields} />
            <div className="flex flex-col gap-2">
              {data.schools.map((s) => (
                <div key={s.schoolId} className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{s.slug}</span>
                    <Badge variant={s.smartImportEnabled ? "success" : "muted"}>{s.smartImportEnabled ? "On" : "Off"}</Badge>
                    {!s.consentAt ? <Badge variant="muted">Not agreed yet</Badge> : null}
                    <span className="text-muted-foreground">
                      {s.scans} page{s.scans === 1 ? "" : "s"}, {s.rowsRead} rows
                      {s.lastScanAt ? `, last ${new Date(s.lastScanAt).toLocaleDateString("en-NG")}` : ""}
                    </span>
                    {s.scansSaved > 0 ? (
                      <button type="button" className="text-sm underline" onClick={() => setOpen(open === s.schoolId ? null : s.schoolId)}>
                        {open === s.schoolId ? "Hide fields" : "Fields"}
                      </button>
                    ) : null}
                  </div>
                  {open === s.schoolId ? <FieldTable fields={s.fields} /> : null}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
