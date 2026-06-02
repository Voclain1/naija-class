"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";

import type { AssessmentFeedResponse, GradingSchemeDto } from "@school-kit/types";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  buildDefaultValues,
  makeGradebookSchema,
  type GradebookFormValues,
} from "./gradebook-form";

interface Props {
  scheme: GradingSchemeDto;
  feed: AssessmentFeedResponse;
}

// cp1: the gradebook grid renders REAL data — editable score cells with live
// per-cell validation, and READ-ONLY Total / Grade / Position bound to the
// server-materialized summary (never summed in the browser — acceptance #7).
// There is no Save yet; cp2 wires the bulk save, error binding, and sign-off.
export function GradebookGrid({ scheme, feed }: Props) {
  const components = scheme.components; // ordered by orderIndex from the API
  const form = useForm<GradebookFormValues>({
    resolver: zodResolver(makeGradebookSchema(components)),
    defaultValues: buildDefaultValues(feed.data, components),
    mode: "onChange",
  });
  const { fields } = useFieldArray({ control: form.control, name: "rows" });

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-medium">Student</th>
            {components.map((c) => (
              <th key={c.id} className="px-3 py-2 font-medium">
                {c.label}
                <span className="ml-1 font-normal normal-case text-muted-foreground/70">/{c.weight}</span>
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Total</th>
            <th className="px-3 py-2 font-medium">Grade</th>
            <th className="px-3 py-2 font-medium">Position</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, i) => {
            const row = feed.data[i];
            if (!row) return null; // fields and feed.data are built in lockstep
            const assessment = row.assessment;
            const rowErrors = form.formState.errors.rows?.[i]?.scores;
            return (
              <tr key={field.id} className="border-t">
                <td className="sticky left-0 z-10 bg-background px-3 py-2">
                  <div className="font-medium">
                    {row.student.lastName}, {row.student.firstName}
                  </div>
                  <div className="text-xs text-muted-foreground">{row.student.admissionNumber}</div>
                </td>

                {components.map((c) => {
                  const cellErr = rowErrors?.[c.id];
                  return (
                    <td key={c.id} className="px-2 py-2 align-top">
                      <Input
                        aria-label={`${row.student.lastName} ${c.label}`}
                        inputMode="numeric"
                        className={cn(
                          "w-16",
                          cellErr && "border-destructive focus-visible:ring-destructive",
                        )}
                        aria-invalid={Boolean(cellErr)}
                        {...form.register(`rows.${i}.scores.${c.id}`)}
                      />
                      {cellErr && <p className="mt-1 text-xs text-destructive">{cellErr.message}</p>}
                    </td>
                  );
                })}

                {/* Read-only, server-computed — never summed client-side. */}
                <td className="px-3 py-2 font-medium tabular-nums">
                  {assessment ? assessment.totalScore : "—"}
                </td>
                <td className="px-3 py-2">{assessment?.letterGrade ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{assessment?.subjectPosition ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
